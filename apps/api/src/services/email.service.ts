import nodemailer from 'nodemailer';
import { URL } from 'url';
import { config } from '../config';

export interface SendInvitationEmailParams {
  to: string;
  recipientName: string;
  inviterName: string;
  organizationName: string;
  role: string;
  invitationUrl: string;
  expiresAt: Date;
}

export interface EmailDeliveryResult {
  /**
   * Indicates whether the upstream email provider (SMTP server or Resend API) accepted the message.
   * NOTE: Provider acceptance does NOT guarantee mailbox delivery, which is subject to recipient MTA,
   * spam filtering, DMARC/SPF/DKIM policies, and recipient inbox status.
   */
  acceptedByProvider: boolean;
  delivered: boolean; // Retained for backwards compatibility; mirrors acceptedByProvider
  status: 'SENT' | 'BLOCKED_MISSING_CREDENTIALS' | 'FAILED';
  provider?: string;
  messageId?: string;
  error?: string;
  deliveryNote?: string;
}

/**
 * Escapes HTML control characters in untrusted user input before template insertion.
 * Neutralizes XSS and HTML injection in email clients.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates that an invitation URL conforms to the expected application origin and format.
 */
export function isValidInvitationUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    const configuredAppUrl = new URL(config.appUrl);

    // Protocol and origin must match configured application base URL
    if (parsed.origin !== configuredAppUrl.origin) {
      return false;
    }

    // Path must follow standard /invite/:token pattern with 64 hex characters
    if (!/^\/invite\/[a-f0-9]{64}$/.test(parsed.pathname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes error messages to prevent credential, token, or secret leaks in logs and responses.
 */
export function sanitizeEmailError(rawError: unknown): string {
  if (!rawError) return 'Email delivery encountered an unknown error';
  const msg = typeof rawError === 'string' ? rawError : (rawError as any).message || String(rawError);

  return msg
    // Redact URI user:password credentials: e.g. smtp://user:secret@host -> smtp://user:[REDACTED]@host
    .replace(/(:\/\/[^:]+:)([^@\s]+)(@)/gi, '$1[REDACTED]$3')
    // Redact password/secret/api_key key-values: e.g. password=secret -> password=[REDACTED]
    .replace(/(password|pass|secret|api[_-]?key|bearer)([\s:=]+)([^\s,;]+)/gi, '$1$2[REDACTED]')
    // Redact Resend API keys: e.g. re_...
    .replace(/(re_[a-zA-Z0-9_-]{20,})/gi, '[REDACTED_API_KEY]')
    .replace(/([a-zA-Z0-9_\-\.]{25,})/g, (token: string) => {
      if (/^[a-f0-9]{64}$/i.test(token)) return token; // Keep invitation token format readable
      return '[REDACTED_SECRET]';
    });
}

export class EmailService {
  /**
   * Determine active real email provider configuration
   */
  static getProviderConfig() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const resendApiKey = process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM || 'SupportOS <notifications@supportos.dev>';

    if (smtpHost && smtpUser && smtpPass) {
      return { type: 'SMTP', host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass, from: emailFrom };
    }

    if (resendApiKey) {
      return { type: 'RESEND', apiKey: resendApiKey, from: emailFrom };
    }

    return null;
  }

  /**
   * Renders the HTML template for an invitation email with full HTML escaping on all untrusted inputs.
   */
  static renderInvitationHtml(params: SendInvitationEmailParams): string {
    const safeOrgName = escapeHtml(params.organizationName);
    const safeRecipientName = escapeHtml(params.recipientName);
    const safeInviterName = escapeHtml(params.inviterName);
    const safeRole = escapeHtml(params.role);
    const safeUrl = escapeHtml(params.invitationUrl);
    const formattedExpiry = escapeHtml(params.expiresAt.toUTCString());

    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-bottom: 16px;">Welcome to ${safeOrgName}!</h2>
        <p style="font-size: 15px; line-height: 1.6; margin-bottom: 12px;">
          Hello ${safeRecipientName},
        </p>
        <p style="font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
          <strong>${safeInviterName}</strong> has invited you to join the team at <strong>${safeOrgName}</strong> as a <strong>${safeRole}</strong> on SupportOS.
        </p>
        <div style="margin: 32px 0;">
          <a href="${safeUrl}" 
             style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Accept Invitation & Set Password
          </a>
        </div>
        <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 8px;">
          This invitation link is single-use and will expire on <strong>${formattedExpiry}</strong>.
        </p>
        <p style="font-size: 12px; color: #94a3b8;">
          If the button above does not work, copy and paste this link into your browser:<br>
          <a href="${safeUrl}" style="color: #2563eb;">${safeUrl}</a>
        </p>
      </div>
    `.trim();
  }

  /**
   * Dispatches an agent workspace invitation email.
   * If real credentials are missing, strictly reports delivery as BLOCKED.
   * NEVER simulates successful delivery.
   */
  static async sendInvitation(params: SendInvitationEmailParams): Promise<EmailDeliveryResult> {
    // Security check: Verify invitation URL origin conforms to configured application
    if (!isValidInvitationUrl(params.invitationUrl)) {
      const err = `Invalid invitation URL origin or format: ${params.invitationUrl}`;
      console.error(`[Email Service Security Error] Refusing to dispatch email with untrusted URL: ${params.invitationUrl}`);
      return {
        acceptedByProvider: false,
        delivered: false,
        status: 'FAILED',
        error: err,
        deliveryNote: 'Security check rejected untrusted or malformed invitation URL origin/pattern.',
      };
    }

    const provider = this.getProviderConfig();

    if (!provider) {
      const blockedMsg =
        'Email delivery blocked: No real SMTP or Resend credentials configured (missing SMTP_HOST/SMTP_USER or RESEND_API_KEY). Delivery cannot be performed.';
      console.warn(`[Email Service Blocked] Invitation email to ${params.to} could not be sent. Real email credentials are missing.`);
      return {
        acceptedByProvider: false,
        delivered: false,
        status: 'BLOCKED_MISSING_CREDENTIALS',
        error: blockedMsg,
        deliveryNote: 'Provider credentials are unconfigured. The invitation was not transmitted to any mail transport.',
      };
    }

    const emailSubject = `You have been invited to join ${escapeHtml(params.organizationName)} on SupportOS`;
    const emailHtml = this.renderInvitationHtml(params);

    try {
      if (provider.type === 'SMTP') {
        const transporter = nodemailer.createTransport({
          host: provider.host,
          port: provider.port,
          secure: provider.port === 465,
          auth: {
            user: provider.user,
            pass: provider.pass,
          },
        });

        const info = await transporter.sendMail({
          from: provider.from,
          to: params.to,
          subject: emailSubject,
          html: emailHtml,
        });

        return {
          acceptedByProvider: true,
          delivered: true,
          status: 'SENT',
          provider: 'SMTP',
          messageId: info.messageId,
          deliveryNote: 'Accepted by SMTP transport for queuing/dispatch. Inbox delivery is subject to recipient mail server acceptance.',
        };
      }

      if (provider.type === 'RESEND') {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: provider.from,
            to: params.to,
            subject: emailSubject,
            html: emailHtml,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(`Resend API error: ${res.status}`);
        }

        const data: any = await res.json();
        return {
          acceptedByProvider: true,
          delivered: true,
          status: 'SENT',
          provider: 'RESEND',
          messageId: data.id,
          deliveryNote: 'Accepted by Resend API for delivery. Final mailbox receipt depends on recipient MTA and reputation policies.',
        };
      }

      return {
        acceptedByProvider: false,
        delivered: false,
        status: 'BLOCKED_MISSING_CREDENTIALS',
        error: 'No active email transport configured',
        deliveryNote: 'No active email transport configured.',
      };
    } catch (sendErr: any) {
      const sanitized = sanitizeEmailError(sendErr);
      console.error(`[Email Service Delivery Failed] Error sending to ${params.to}:`, sanitized);
      return {
        acceptedByProvider: false,
        delivered: false,
        status: 'FAILED',
        error: `Email delivery failed: ${sanitized}`,
        deliveryNote: 'Upstream mail provider rejected the delivery request or threw an error.',
      };
    }
  }
}
