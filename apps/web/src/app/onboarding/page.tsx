'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../lib/api';
import {
  Building2,
  Clock,
  Palette,
  MessageSquare,
  Users,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Globe,
  Mail,
  ShieldCheck,
  Copy,
  Check,
} from 'lucide-react';

interface BusinessDay {
  enabled: boolean;
  start: string;
  end: string;
}

interface BusinessHoursState {
  timezone: string;
  schedule: Record<string, BusinessDay>;
}

const DEFAULT_SCHEDULE: Record<string, BusinessDay> = {
  monday: { enabled: true, start: '09:00', end: '18:00' },
  tuesday: { enabled: true, start: '09:00', end: '18:00' },
  wednesday: { enabled: true, start: '09:00', end: '18:00' },
  thursday: { enabled: true, start: '09:00', end: '18:00' },
  friday: { enabled: true, start: '09:00', end: '18:00' },
  saturday: { enabled: false, start: '10:00', end: '16:00' },
  sunday: { enabled: false, start: '10:00', end: '16:00' },
};

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Form states
  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [locale, setLocale] = useState('en');

  const [brandColor, setBrandColor] = useState('#2563EB');
  const [businessHours, setBusinessHours] = useState<BusinessHoursState>({
    timezone: 'UTC',
    schedule: DEFAULT_SCHEDULE,
  });

  const [workspaceName, setWorkspaceName] = useState('Main Support Workspace');
  const [inboxGreeting, setInboxGreeting] = useState('Hello! How can our support team assist you today?');
  const [widgetColor, setWidgetColor] = useState('#2563EB');
  const [allowedDomains, setAllowedDomains] = useState('');

  // Step 4: Teammate invites
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'AGENT'>('AGENT');
  const [invitedMembers, setInvitedMembers] = useState<Array<{ email: string; role: string; status: string }>>([]);
  const [inviting, setInviting] = useState(false);

  // Snippet
  const [widgetSnippet, setWidgetSnippet] = useState('');

  useEffect(() => {
    async function loadCurrentOrg() {
      try {
        const res = await apiClient<{ organization: any }>('/api/v1/organizations/current');
        if (res.organization) {
          const org = res.organization;
          setCompanyName(org.name || '');
          setLogoUrl(org.logoUrl || '');
          setTimezone(org.timezone || 'UTC');
          setLocale(org.locale || 'en');
          setBrandColor(org.brandColor || '#2563EB');
          setWidgetColor(org.brandColor || '#2563EB');

          if (org.allowedDomains) {
            try {
              const parsed = JSON.parse(org.allowedDomains);
              if (Array.isArray(parsed)) setAllowedDomains(parsed.join(', '));
              else setAllowedDomains(org.allowedDomains);
            } catch {
              setAllowedDomains(org.allowedDomains);
            }
          }

          if (org.businessHours) {
            try {
              const parsed = JSON.parse(org.businessHours);
              if (parsed.schedule) setBusinessHours(parsed);
            } catch {
              // keep default
            }
          }

          if (org.workspaces && org.workspaces.length > 0) {
            setWorkspaceName(org.workspaces[0].name);
          }
          if (org.inboxes && org.inboxes.length > 0) {
            if (org.inboxes[0].greeting) setInboxGreeting(org.inboxes[0].greeting);
            if (org.inboxes[0].widgetColor) setWidgetColor(org.inboxes[0].widgetColor);
          }

          if (org.onboardingCompleted) {
            // Already completed, allow navigating back or to inbox
          } else if (org.onboardingStep && org.onboardingStep > 1 && org.onboardingStep <= 5) {
            setCurrentStep(org.onboardingStep);
          }
        }
      } catch (err: any) {
        console.error('Failed to load org for onboarding:', err);
      } finally {
        setFetching(false);
      }
    }

    loadCurrentOrg();
  }, []);

  async function saveStep(stepNum: number, isFinal: boolean = false) {
    setLoading(true);
    setError(null);
    try {
      const domainsArray = allowedDomains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);

      const payload: any = {
        step: stepNum,
        completed: isFinal,
        companyName,
        logoUrl: logoUrl || null,
        brandColor,
        timezone,
        locale,
        businessHours: {
          timezone,
          schedule: businessHours.schedule,
        },
        allowedDomains: domainsArray,
        workspaceName,
        inboxGreeting,
        widgetColor,
      };

      await apiClient('/api/v1/organizations/onboarding', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (isFinal) {
        // Fetch generated production snippet
        try {
          const snipRes = await apiClient<{ snippets: Array<{ snippet: string }> }>('/api/v1/organizations/widget-snippet');
          if (snipRes.snippets && snipRes.snippets.length > 0) {
            setWidgetSnippet(snipRes.snippets[0].snippet);
          }
        } catch {}
        setCurrentStep(5);
      } else {
        setCurrentStep(stepNum + 1);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration step');
    } finally {
      setLoading(false);
    }
  }

  async function handleInviteAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);

    try {
      const res = await apiClient<{ user: any; emailDelivery: any; invitationUrl: string }>('/api/v1/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      setInvitedMembers((prev) => [
        ...prev,
        {
          email: inviteEmail.trim(),
          role: inviteRole,
          status: res.emailDelivery?.status || 'INVITED',
        },
      ]);
      setInviteEmail('');
    } catch (err: any) {
      setError(err.message || 'Failed to invite team member');
    } finally {
      setInviting(false);
    }
  }

  function handleScheduleToggle(day: string) {
    setBusinessHours((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [day]: {
          ...prev.schedule[day],
          enabled: !prev.schedule[day].enabled,
        },
      },
    }));
  }

  function handleScheduleChange(day: string, field: 'start' | 'end', val: string) {
    setBusinessHours((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [day]: {
          ...prev.schedule[day],
          [field]: val,
        },
      },
    }));
  }

  if (fetching) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading organization settings...</span>
        </div>
      </div>
    );
  }

  const steps = [
    { num: 1, title: 'Company Profile', icon: Building2 },
    { num: 2, title: 'Branding & Schedule', icon: Palette },
    { num: 3, title: 'Support Channels', icon: MessageSquare },
    { num: 4, title: 'Team Setup', icon: Users },
    { num: 5, title: 'Complete', icon: Sparkles },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 selection:bg-blue-600">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-extrabold text-white text-lg shadow-lg">
              S
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">SupportOS Setup Wizard</h1>
              <p className="text-xs text-slate-400">Configure your company support tenant</p>
            </div>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Step {currentStep} of 5
          </span>
        </div>

        {/* Step Progress Tracker */}
        <div className="grid grid-cols-5 gap-2 mb-8">
          {steps.map((s) => {
            const Icon = s.icon;
            const isActive = currentStep === s.num;
            const isDone = currentStep > s.num;
            return (
              <div
                key={s.num}
                className={`flex flex-col items-center p-2.5 rounded-xl border text-center transition-all ${
                  isActive
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400 shadow-sm'
                    : isDone
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                    : 'border-slate-800 bg-slate-900/40 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {isDone ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Icon className="w-4 h-4" />}
                  <span className="text-xs font-bold">{s.num}</span>
                </div>
                <span className="text-[11px] font-medium truncate w-full hidden sm:block">{s.title}</span>
              </div>
            );
          })}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300 font-bold ml-2">
              ×
            </button>
          </div>
        )}

        {/* Card Body */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          {/* STEP 1: Company Profile */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white mb-1">Company Profile & Region</h2>
                <p className="text-xs text-slate-400">Establish your organization's legal name, brand mark, and operational timezone.</p>
              </div>

              <div className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Company / Organization Legal Name</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme Technologies Inc."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Company Logo URL (optional)</label>
                  <input
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://cdn.example.com/logo.png"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Direct HTTPS link to PNG, SVG, or WebP logo file.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Primary Operational Timezone</label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      <option value="UTC">UTC (Universal Coordinated Time)</option>
                      <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                      <option value="America/New_York">America/New_York (EST/EDT)</option>
                      <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                      <option value="Europe/London">Europe/London (GMT/BST)</option>
                      <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
                      <option value="Asia/Singapore">Asia/Singapore (SGT +8)</option>
                      <option value="Asia/Tokyo">Asia/Tokyo (JST +9)</option>
                      <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Default Language / Locale</label>
                    <select
                      value={locale}
                      onChange={(e) => setLocale(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      <option value="en">English (en)</option>
                      <option value="en-IN">English - India (en-IN)</option>
                      <option value="en-US">English - US (en-US)</option>
                      <option value="en-GB">English - UK (en-GB)</option>
                      <option value="hi">Hindi (hi)</option>
                      <option value="de">German (de)</option>
                      <option value="es">Spanish (es)</option>
                      <option value="fr">French (fr)</option>
                      <option value="ja">Japanese (ja)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => saveStep(1)}
                  disabled={loading || !companyName.trim()}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center gap-2 transition"
                >
                  {loading ? 'Saving...' : 'Continue to Branding'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Branding & Schedule */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white mb-1">Brand Identity & Support Hours</h2>
                <p className="text-xs text-slate-400">Match customer-facing surfaces with your brand and define active support windows.</p>
              </div>

              <div className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Primary Brand Accent Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={brandColor}
                      onChange={(e) => {
                        setBrandColor(e.target.value);
                        setWidgetColor(e.target.value);
                      }}
                      className="w-10 h-10 rounded-lg cursor-pointer bg-slate-950 border border-slate-700"
                    />
                    <input
                      type="text"
                      value={brandColor}
                      onChange={(e) => {
                        setBrandColor(e.target.value);
                        setWidgetColor(e.target.value);
                      }}
                      className="w-32 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                    <div
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm"
                      style={{ backgroundColor: brandColor }}
                    >
                      Sample Button
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Weekly Support Hours Schedule</label>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl divide-y divide-slate-800 text-xs">
                    {Object.entries(businessHours.schedule).map(([day, cfg]) => (
                      <div key={day} className="p-3 flex items-center justify-between gap-4">
                        <label className="flex items-center gap-2.5 capitalize font-medium text-slate-200 cursor-pointer w-28">
                          <input
                            type="checkbox"
                            checked={cfg.enabled}
                            onChange={() => handleScheduleToggle(day)}
                            className="rounded border-slate-700 text-blue-600 focus:ring-0 bg-slate-900"
                          />
                          {day}
                        </label>

                        {cfg.enabled ? (
                          <div className="flex items-center gap-2 text-slate-400">
                            <span>From</span>
                            <input
                              type="time"
                              value={cfg.start}
                              onChange={(e) => handleScheduleChange(day, 'start', e.target.value)}
                              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                            />
                            <span>to</span>
                            <input
                              type="time"
                              value={cfg.end}
                              onChange={(e) => handleScheduleChange(day, 'end', e.target.value)}
                              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
                            />
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">Closed / Off-hours</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-sm flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => saveStep(2)}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm flex items-center gap-2"
                >
                  {loading ? 'Saving...' : 'Continue to Channels'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Support Channels */}
          {currentStep === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white mb-1">Default Workspace & Live Chat Inbox</h2>
                <p className="text-xs text-slate-400">Configure your primary support workspace and customer widget settings.</p>
              </div>

              <div className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Primary Workspace Name</label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="Customer Support HQ"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Live Chat Welcome Greeting</label>
                  <input
                    type="text"
                    value={inboxGreeting}
                    onChange={(e) => setInboxGreeting(e.target.value)}
                    placeholder="Hi there! Welcome to support. How can we help?"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Displayed to website visitors when launching the live chat widget.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Approved Website Domains (CORS / Embed Isolation)</label>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={allowedDomains}
                      onChange={(e) => setAllowedDomains(e.target.value)}
                      placeholder="app.example.com, portal.example.com, https://example.com"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Comma-separated domains authorized to embed and initialize your SupportOS chat widget.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-sm flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => saveStep(3)}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm flex items-center gap-2"
                >
                  {loading ? 'Saving...' : 'Continue to Team Setup'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Invite First Teammates */}
          {currentStep === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white mb-1">Invite First Teammates</h2>
                <p className="text-xs text-slate-400">
                  Invite your support managers and agents. Single-use invitation tokens will be issued with verified hash storage.
                </p>
              </div>

              <form onSubmit={handleInviteAgent} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2 relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      <option value="AGENT">Support Agent</option>
                      <option value="ADMIN">Organization Admin</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1.5 transition"
                  >
                    {inviting ? 'Sending...' : 'Send Invitation'}
                  </button>
                </div>
              </form>

              {invitedMembers.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-400">Invited Teammates This Session:</span>
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-slate-950 text-xs">
                    {invitedMembers.map((m, idx) => (
                      <div key={idx} className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <span className="font-medium text-slate-200">{m.email}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 font-mono">{m.role}</span>
                        </div>
                        <span className="text-[11px] text-blue-400 font-medium">{m.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-sm flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => saveStep(4, true)}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center gap-2"
                >
                  {loading ? 'Finalizing...' : 'Complete Onboarding & Launch'}
                  <Sparkles className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: Complete & Launch */}
          {currentStep === 5 && (
            <div className="space-y-6 text-center py-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-lg">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h2 className="text-2xl font-bold text-white">Your Support Organization is Ready!</h2>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Company settings, working hours, and initial channel configurations are locked in. You can now embed the live chat widget or open your team inbox.
                </p>
              </div>

              {widgetSnippet && (
                <div className="text-left bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Production Widget Installation Script:</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(widgetSnippet);
                        setCopiedSnippet(true);
                        setTimeout(() => setCopiedSnippet(false), 2000);
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
                    >
                      {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSnippet ? 'Copied!' : 'Copy Script'}
                    </button>
                  </div>
                  <pre className="text-xs font-mono bg-slate-900 p-3 rounded-lg text-slate-200 overflow-x-auto border border-slate-800">
                    {widgetSnippet}
                  </pre>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => router.push('/inbox')}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg transition"
                >
                  Go to Team Inbox <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/settings')}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-sm"
                >
                  Manage Organization Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
