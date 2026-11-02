import nodemailer from 'nodemailer';

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
  delivered: boolean;
  status: 'SENT' | 'BLOCKED_MISSING_CREDENTIALS' | 'FAILED';
  provider?: string;
  messageId?: string;
  error?: string;
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
   * Dispatches an agent workspace invitation email.
   * If real credentials are missing, strictly reports delivery as BLOCKED.
   * NEVER simulates successful delivery.
   */
  static async sendInvitation(params: SendInvitationEmailParams): Promise<EmailDeliveryResult> {
    const provider = this.getProviderConfig();

    if (!provider) {
      const blockedMsg =
        'Email delivery blocked: No real SMTP or Resend credentials configured (missing SMTP_HOST/SMTP_USER or RESEND_API_KEY). Delivery cannot be performed.';
      console.warn(`[Email Service Blocked] Invitation email to ${params.to} could not be sent. Real email credentials are missing.`);
      return {
        delivered: false,
        status: 'BLOCKED_MISSING_CREDENTIALS',
        error: blockedMsg,
      };
    }

    const emailSubject = `You have been invited to join ${params.organizationName} on SupportOS`;
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-bottom: 16px;">Welcome to ${params.organizationName}!</h2>
        <p style="font-size: 15px; line-height: 1.6; margin-bottom: 12px;">
          Hello ${params.recipientName},
        </p>
        <p style="font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
          <strong>${params.inviterName}</strong> has invited you to join the team at <strong>${params.organizationName}</strong> as a <strong>${params.role}</strong> on SupportOS.
        </p>
        <div style="margin: 32px 0;">
          <a href="${params.invitationUrl}" 
             style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Accept Invitation & Set Password
          </a>
        </div>
        <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 8px;">
          This invitation link is single-use and will expire on <strong>${params.expiresAt.toUTCString()}</strong>.
        </p>
        <p style="font-size: 12px; color: #94a3b8;">
          If the button above does not work, copy and paste this link into your browser:<br>
          <a href="${params.invitationUrl}" style="color: #2563eb;">${params.invitationUrl}</a>
        </p>
      </div>
    `;

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
          delivered: true,
          status: 'SENT',
          provider: 'SMTP',
          messageId: info.messageId,
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
          throw new Error(`Resend API error: ${res.status} ${JSON.stringify(errData)}`);
        }

        const data: any = await res.json();
        return {
          delivered: true,
          status: 'SENT',
          provider: 'RESEND',
          messageId: data.id,
        };
      }

      return {
        delivered: false,
        status: 'BLOCKED_MISSING_CREDENTIALS',
        error: 'No active email transport configured',
      };
    } catch (sendErr: any) {
      console.error(`[Email Service Delivery Failed] Error sending to ${params.to}:`, sendErr.message);
      return {
        delivered: false,
        status: 'FAILED',
        error: `Email delivery failed: ${sendErr.message}`,
      };
    }
  }
}
