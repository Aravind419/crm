'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header } from '../../components/layout/Header';
import { apiClient } from '../../lib/api';
import {
  Settings,
  Building,
  Inbox,
  Users,
  Copy,
  Check,
  Plus,
  Shield,
  Clock,
  Globe,
  Trash2,
  RefreshCw,
  UserCheck,
  UserX,
  Mail,
  Edit2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'org' | 'inboxes' | 'teams' | 'agents'>('org');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Organization settings state
  const [orgName, setOrgName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [brandColor, setBrandColor] = useState('#2563EB');
  const [timezone, setTimezone] = useState('UTC');
  const [locale, setLocale] = useState('en');
  const [allowedDomains, setAllowedDomains] = useState('');
  const [bizHoursEnabled, setBizHoursEnabled] = useState(true);
  const [bizStartTime, setBizStartTime] = useState('09:00');
  const [bizEndTime, setBizEndTime] = useState('18:00');
  const [bizDays, setBizDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  const [savingOrg, setSavingOrg] = useState(false);

  // Invite Agent state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirst, setInviteFirst] = useState('');
  const [inviteLast, setInviteLast] = useState('');
  const [inviteRole, setInviteRole] = useState('AGENT');
  const [inviteTeams, setInviteTeams] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [lastInviteResult, setLastInviteResult] = useState<any>(null);

  // Team modal state
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<any>(null);
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [teamLeadId, setTeamLeadId] = useState('');
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [savingTeam, setSavingTeam] = useState(false);

  // Edit Role modal state
  const [roleModalUser, setRoleModalUser] = useState<any>(null);
  const [selectedRole, setSelectedRole] = useState('AGENT');
  const [updatingRole, setUpdatingRole] = useState(false);

  // Public snippets
  const [snippets, setSnippets] = useState<any[]>([]);

  // Inbox Edit state
  const [editingInbox, setEditingInbox] = useState<any>(null);
  const [inboxGreeting, setInboxGreeting] = useState('');
  const [inboxColor, setInboxColor] = useState('#2563EB');
  const [inboxDomains, setInboxDomains] = useState('');
  const [savingInbox, setSavingInbox] = useState(false);

  async function loadAllData() {
    try {
      setLoading(true);
      const me = await apiClient<any>('/api/v1/auth/me');
      setUser(me.user);

      const orgRes = await apiClient<any>('/api/v1/organizations/current');
      const o = orgRes.organization;
      setOrganization(o);
      setSubscription(orgRes.subscription);
      setOrgName(o.name || '');
      setLogoUrl(o.logoUrl || '');
      setBrandColor(o.brandColor || '#2563EB');
      setTimezone(o.timezone || 'UTC');
      setLocale(o.locale || 'en');
      setAllowedDomains(o.allowedDomains || '');

      if (o.businessHours) {
        try {
          const bh = typeof o.businessHours === 'string' ? JSON.parse(o.businessHours) : o.businessHours;
          setBizHoursEnabled(bh.enabled ?? true);
          setBizStartTime(bh.startTime || '09:00');
          setBizEndTime(bh.endTime || '18:00');
          setBizDays(bh.days || [1, 2, 3, 4, 5]);
        } catch (_) {}
      }

      const inboxesRes = await apiClient<any>('/api/v1/inboxes');
      setInboxes(inboxesRes.inboxes || []);

      const snippetRes = await apiClient<any>('/api/v1/organizations/widget-snippet');
      setSnippets(snippetRes.snippets || []);

      const teamsRes = await apiClient<any>('/api/v1/teams');
      setTeams(teamsRes.teams || []);

      const staffRes = await apiClient<any>('/api/v1/users');
      setStaff(staffRes.users || []);
    } catch (err: any) {
      console.error(err);
      setFeedback({ type: 'error', message: err.message || 'Failed to load organization settings' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllData();
  }, []);

  function showMessage(type: 'success' | 'error', message: string) {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 5000);
  }

  function copyText(text: string, id: string, isLink = false) {
    navigator.clipboard.writeText(text);
    if (isLink) {
      setCopiedLink(id);
      setTimeout(() => setCopiedLink(null), 2500);
    } else {
      setCopiedKey(id);
      setTimeout(() => setCopiedKey(null), 2500);
    }
  }

  async function handleSaveOrg(e: React.FormEvent) {
    e.preventDefault();
    setSavingOrg(true);
    try {
      const bizHours = {
        enabled: bizHoursEnabled,
        startTime: bizStartTime,
        endTime: bizEndTime,
        days: bizDays,
        timezone,
      };

      const res = await apiClient<any>('/api/v1/organizations/current', {
        method: 'PATCH',
        body: JSON.stringify({
          name: orgName,
          logoUrl,
          brandColor,
          timezone,
          locale,
          allowedDomains,
          businessHours: JSON.stringify(bizHours),
        }),
      });

      setOrganization(res.organization);
      showMessage('success', 'Organization profile & branding updated successfully');
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setSavingOrg(false);
    }
  }

  async function handleInviteAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail || !inviteFirst || !inviteLast || inviting) return;
    setInviting(true);

    try {
      const res = await apiClient<any>('/api/v1/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail,
          firstName: inviteFirst,
          lastName: inviteLast,
          role: inviteRole,
          teamIds: inviteTeams,
        }),
      });

      setLastInviteResult(res);
      setInviteEmail('');
      setInviteFirst('');
      setInviteLast('');
      setInviteTeams([]);

      const staffRes = await apiClient<any>('/api/v1/users');
      setStaff(staffRes.users || []);
      showMessage('success', 'Invitation created successfully!');
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleResendInvite(userId: string) {
    try {
      const res = await apiClient<any>(`/api/v1/users/${userId}/invitation/resend`, {
        method: 'POST',
      });
      showMessage('success', 'Invitation refreshed and resent successfully');
      if (res.invitationUrl) {
        copyText(res.invitationUrl, userId, true);
      }
      const staffRes = await apiClient<any>('/api/v1/users');
      setStaff(staffRes.users || []);
    } catch (err: any) {
      showMessage('error', err.message);
    }
  }

  async function handleRevokeInvite(userId: string) {
    if (!confirm('Are you sure you want to revoke this pending invitation? The invite link will become invalid immediately.')) return;
    try {
      await apiClient(`/api/v1/users/${userId}/invitation`, {
        method: 'DELETE',
      });
      showMessage('success', 'Invitation revoked successfully');
      const staffRes = await apiClient<any>('/api/v1/users');
      setStaff(staffRes.users || []);
    } catch (err: any) {
      showMessage('error', err.message);
    }
  }

  async function handleToggleUserStatus(userId: string, currentStatus: string) {
    const targetStatus = currentStatus === 'ACTIVE' ? 'DEACTIVATED' : 'ACTIVE';
    const actionLabel = targetStatus === 'ACTIVE' ? 'reactivate' : 'deactivate';
    if (!confirm(`Are you sure you want to ${actionLabel} this staff member?`)) return;

    try {
      await apiClient(`/api/v1/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: targetStatus }),
      });
      showMessage('success', `User successfully ${targetStatus.toLowerCase()}`);
      const staffRes = await apiClient<any>('/api/v1/users');
      setStaff(staffRes.users || []);
    } catch (err: any) {
      showMessage('error', err.message);
    }
  }

  async function handleUpdateRole(e: React.FormEvent) {
    e.preventDefault();
    if (!roleModalUser || updatingRole) return;
    setUpdatingRole(true);
    try {
      await apiClient(`/api/v1/users/${roleModalUser.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: selectedRole }),
      });
      showMessage('success', `Role updated to ${selectedRole}`);
      setRoleModalUser(null);
      const staffRes = await apiClient<any>('/api/v1/users');
      setStaff(staffRes.users || []);
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setUpdatingRole(false);
    }
  }

  function openCreateTeamModal() {
    setEditingTeam(null);
    setTeamName('');
    setTeamDesc('');
    setTeamLeadId('');
    setTeamMembers([]);
    setShowTeamModal(true);
  }

  function openEditTeamModal(t: any) {
    setEditingTeam(t);
    setTeamName(t.name || '');
    setTeamDesc(t.description || '');
    setTeamLeadId(t.leadId || '');
    setTeamMembers(t.members?.map((m: any) => m.user.id) || []);
    setShowTeamModal(true);
  }

  async function handleSaveTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim() || savingTeam) return;
    setSavingTeam(true);

    try {
      if (editingTeam) {
        // Update team
        await apiClient(`/api/v1/teams/${editingTeam.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: teamName.trim(),
            description: teamDesc.trim(),
            leadId: teamLeadId || null,
          }),
        });

        // Sync members
        await apiClient(`/api/v1/teams/${editingTeam.id}/members`, {
          method: 'POST',
          body: JSON.stringify({ userIds: teamMembers }),
        });
        showMessage('success', 'Team updated successfully');
      } else {
        // Create team
        await apiClient('/api/v1/teams', {
          method: 'POST',
          body: JSON.stringify({
            name: teamName.trim(),
            description: teamDesc.trim(),
            leadId: teamLeadId || null,
            memberUserIds: teamMembers,
          }),
        });
        showMessage('success', 'Team created successfully');
      }

      setShowTeamModal(false);
      const teamsRes = await apiClient<any>('/api/v1/teams');
      setTeams(teamsRes.teams || []);
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setSavingTeam(false);
    }
  }

  async function handleDeleteTeam(teamId: string) {
    if (!confirm('Are you sure you want to delete this team? Open tickets and conversations will be unassigned from this team.')) return;
    try {
      await apiClient(`/api/v1/teams/${teamId}`, {
        method: 'DELETE',
      });
      showMessage('success', 'Team deleted successfully');
      const teamsRes = await apiClient<any>('/api/v1/teams');
      setTeams(teamsRes.teams || []);
    } catch (err: any) {
      showMessage('error', err.message);
    }
  }

  async function handleSaveInbox(e: React.FormEvent) {
    e.preventDefault();
    if (!editingInbox || savingInbox) return;
    setSavingInbox(true);
    try {
      await apiClient(`/api/v1/organizations/inboxes/${editingInbox.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          greeting: inboxGreeting,
          widgetColor: inboxColor,
          allowedOrigins: inboxDomains,
        }),
      });
      showMessage('success', 'Inbox channel settings updated');
      setEditingInbox(null);
      const inboxesRes = await apiClient<any>('/api/v1/inboxes');
      setInboxes(inboxesRes.inboxes || []);
      const snippetRes = await apiClient<any>('/api/v1/organizations/widget-snippet');
      setSnippets(snippetRes.snippets || []);
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setSavingInbox(false);
    }
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden font-sans">
      <Sidebar user={user} organization={organization} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          user={user}
          onUserUpdate={setUser}
          title="Organization Administration"
          subtitle="Configure company profile, branding, channels, support teams, and secure agent invitations"
        />

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Feedback notification alert */}
            {feedback && (
              <div
                className={`p-4 rounded-xl flex items-center justify-between text-xs font-semibold shadow-sm transition-all ${
                  feedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {feedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                  )}
                  <span>{feedback.message}</span>
                </div>
                <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              </div>
            )}

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <button
                onClick={() => setActiveTab('org')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
                  activeTab === 'org'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Building className="w-3.5 h-3.5" />
                <span>Company & Branding</span>
              </button>

              <button
                onClick={() => setActiveTab('inboxes')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
                  activeTab === 'inboxes'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>Channels & Widget</span>
              </button>

              <button
                onClick={() => setActiveTab('teams')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
                  activeTab === 'teams'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Teams</span>
              </button>

              <button
                onClick={() => setActiveTab('agents')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
                  activeTab === 'agents'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Agents & Invitations</span>
              </button>
            </div>

            {/* TAB 1: COMPANY & BRANDING */}
            {activeTab === 'org' && (
              <form onSubmit={handleSaveOrg} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Company Profile & Operating Hours</h3>
                  <p className="text-xs text-slate-500">Configure public business identity, timezones, and support operating schedules.</p>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Company Name</label>
                    <input
                      type="text"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Company Logo URL</label>
                    <input
                      type="url"
                      placeholder="https://example.com/logo.png"
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Brand Accent Color</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandColor}
                        onChange={(e) => setBrandColor(e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={brandColor}
                        onChange={(e) => setBrandColor(e.target.value)}
                        className="flex-1 font-mono text-xs p-2 border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Timezone</label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                    >
                      <option value="UTC">UTC (Universal Coordinated Time)</option>
                      <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                      <option value="America/New_York">America/New_York (EST/EDT)</option>
                      <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                      <option value="Europe/London">Europe/London (GMT/BST)</option>
                      <option value="Europe/Paris">Europe/Paris (CET)</option>
                      <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                      <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Default Locale</label>
                    <select
                      value={locale}
                      onChange={(e) => setLocale(e.target.value)}
                      className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                    >
                      <option value="en">English (en)</option>
                      <option value="en-US">English (US)</option>
                      <option value="en-IN">English (India)</option>
                      <option value="en-GB">English (UK)</option>
                      <option value="hi">Hindi (hi)</option>
                    </select>
                  </div>
                </div>

                {/* Business Hours */}
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-blue-600" />
                        <span>Business Operating Hours</span>
                      </h4>
                      <p className="text-[11px] text-slate-500">Define when agents are expected to be available for live customer interactions.</p>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={bizHoursEnabled}
                        onChange={(e) => setBizHoursEnabled(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span>Enforce Business Hours</span>
                    </label>
                  </div>

                  {bizHoursEnabled && (
                    <div className="grid md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Daily Support Window</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            value={bizStartTime}
                            onChange={(e) => setBizStartTime(e.target.value)}
                            className="text-xs p-2 border border-slate-200 rounded-lg bg-white"
                          />
                          <span className="text-xs text-slate-400">to</span>
                          <input
                            type="time"
                            value={bizEndTime}
                            onChange={(e) => setBizEndTime(e.target.value)}
                            className="text-xs p-2 border border-slate-200 rounded-lg bg-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Active Days of the Week</label>
                        <div className="flex items-center gap-1.5">
                          {[
                            { day: 1, label: 'M' },
                            { day: 2, label: 'T' },
                            { day: 3, label: 'W' },
                            { day: 4, label: 'T' },
                            { day: 5, label: 'F' },
                            { day: 6, label: 'S' },
                            { day: 0, label: 'S' },
                          ].map((item) => (
                            <button
                              type="button"
                              key={item.day}
                              onClick={() => {
                                if (bizDays.includes(item.day)) {
                                  setBizDays(bizDays.filter((d) => d !== item.day));
                                } else {
                                  setBizDays([...bizDays, item.day]);
                                }
                              }}
                              className={`w-7 h-7 text-xs font-bold rounded-lg border transition-colors ${
                                bizDays.includes(item.day)
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingOrg}
                    className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-sm disabled:opacity-50"
                  >
                    {savingOrg ? 'Saving Changes...' : 'Save Company Profile'}
                  </button>
                </div>
              </form>
            )}

            {/* TAB 2: CHANNELS & INBOXES */}
            {activeTab === 'inboxes' && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Website Live Chat Inboxes & Widget Snippets</h3>
                  <p className="text-xs text-slate-500">
                    Production-ready widget scripts generated with public URLs. Embed the customer chat widget into any web application or landing page.
                  </p>
                </div>

                <div className="space-y-4">
                  {snippets.map((inbox) => (
                    <div key={inbox.inboxId} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div style={{ background: inbox.widgetColor }} className="w-4 h-4 rounded-full shadow-sm" />
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{inbox.inboxName}</h4>
                            <span className="text-[11px] text-slate-500">Greeting: &quot;{inbox.greeting}&quot;</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
                            {inbox.inboxKey}
                          </span>
                          <button
                            onClick={() => {
                              setEditingInbox(inbox);
                              setInboxGreeting(inbox.greeting || '');
                              setInboxColor(inbox.widgetColor || '#2563EB');
                              setInboxDomains(inbox.allowedOrigins || '');
                            }}
                            className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 flex items-center gap-1 font-semibold"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                        </div>
                      </div>

                      {inbox.allowedOrigins && (
                        <div className="text-[11px] text-slate-600 bg-blue-50/60 p-2 rounded-lg border border-blue-100 flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5 text-blue-600" />
                          <span>Approved Embed Domains: <strong>{inbox.allowedOrigins}</strong></span>
                        </div>
                      )}

                      <div className="pt-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Production HTML Snippet Tag (Public Origin)
                        </label>
                        <div className="relative">
                          <pre className="p-3 bg-slate-950 text-slate-200 text-xs rounded-xl font-mono overflow-x-auto">
                            {inbox.snippet}
                          </pre>
                          <button
                            onClick={() => copyText(inbox.snippet, inbox.inboxId)}
                            className="absolute right-2 top-2 p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors"
                            title="Copy script"
                          >
                            {copiedKey === inbox.inboxId ? (
                              <Check className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 3: TEAMS */}
            {activeTab === 'teams' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Support Teams & Workload</h3>
                    <p className="text-xs text-slate-500">Organize agents into functional tiers and review real-time ticket workload distribution.</p>
                  </div>
                  <button
                    onClick={openCreateTeamModal}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Team</span>
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {teams.map((t) => (
                    <div key={t.id} className="p-5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-sm text-slate-900">{t.name}</div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditTeamModal(t)}
                            className="p-1 text-slate-400 hover:text-slate-600 rounded"
                            title="Edit Team"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteTeam(t.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded"
                            title="Delete Team"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-500">{t.description || 'No description provided'}</p>

                      {t.lead && (
                        <div className="text-[11px] text-slate-600 flex items-center gap-1.5 bg-white p-2 rounded-lg border border-slate-200">
                          <Shield className="w-3 h-3 text-amber-500" />
                          <span>Team Lead: <strong>{t.lead.firstName} {t.lead.lastName}</strong> ({t.lead.email})</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                        <span className="text-slate-600 font-semibold">{t.members?.length || 0} agents assigned</span>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-mono text-[10px] font-bold">
                            {t._count?.conversations || 0} Convs
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-mono text-[10px] font-bold">
                            {t._count?.tickets || 0} Tickets
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 4: AGENTS & INVITATIONS */}
            {activeTab === 'agents' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Agents & Invitations</h3>
                    <p className="text-xs text-slate-500">
                      Manage staff access, issue single-use secure invitation tokens, and control permission boundaries.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {subscription?.limits && (
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600">
                        Seats: {staff.filter((s) => s.status !== 'DEACTIVATED').length} / {subscription.limits.maxAgents}
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setLastInviteResult(null);
                        setShowInviteModal(true);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Invite Agent</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        <th className="py-3 px-6">Staff Member</th>
                        <th className="py-3 px-6">Email</th>
                        <th className="py-3 px-6">Role</th>
                        <th className="py-3 px-6">Status</th>
                        <th className="py-3 px-6">Teams</th>
                        <th className="py-3 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {staff.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50/80">
                          <td className="py-3.5 px-6 font-semibold text-slate-900">
                            {s.firstName} {s.lastName}
                          </td>
                          <td className="py-3.5 px-6 text-slate-600">{s.email}</td>
                          <td className="py-3.5 px-6">
                            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                              {s.role}
                            </span>
                          </td>
                          <td className="py-3.5 px-6">
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                s.status === 'ACTIVE'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : s.status === 'INVITED'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {s.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-6 text-slate-500">
                            {s.teamMemberships?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {s.teamMemberships.map((tm: any) => (
                                  <span key={tm.team.id} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                                    {tm.team.name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">None</span>
                            )}
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {s.status === 'INVITED' && (
                                <>
                                  <button
                                    onClick={() => handleResendInvite(s.id)}
                                    className="p-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1 font-semibold"
                                    title="Resend Invitation Token"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    <span>Resend</span>
                                  </button>
                                  <button
                                    onClick={() => handleRevokeInvite(s.id)}
                                    className="p-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg flex items-center gap-1 font-semibold"
                                    title="Revoke Invitation"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Revoke</span>
                                  </button>
                                </>
                              )}

                              {s.status !== 'INVITED' && (
                                <>
                                  <button
                                    onClick={() => {
                                      setRoleModalUser(s);
                                      setSelectedRole(s.role);
                                    }}
                                    className="p-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-semibold"
                                    title="Change Role"
                                  >
                                    Role
                                  </button>

                                  {s.status === 'ACTIVE' && s.id !== user?.id && (
                                    <button
                                      onClick={() => handleToggleUserStatus(s.id, s.status)}
                                      className="p-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-semibold"
                                      title="Deactivate Agent"
                                    >
                                      Deactivate
                                    </button>
                                  )}

                                  {s.status === 'DEACTIVATED' && (
                                    <button
                                      onClick={() => handleToggleUserStatus(s.id, s.status)}
                                      className="p-1.5 text-xs text-emerald-600 hover:bg-emerald-50 rounded-lg font-semibold"
                                      title="Reactivate Agent"
                                    >
                                      Reactivate
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invite Agent Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Invite New Support Agent</h3>
            <p className="text-xs text-slate-500">
              Generates a single-use cryptographically secure invitation token. The agent creates their own password upon acceptance.
            </p>

            {lastInviteResult && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs">
                <div className="font-bold text-emerald-800">✅ Invitation Created!</div>
                <div className="text-[11px] text-slate-600">
                  Email Delivery Status:{' '}
                  <span className="font-semibold text-slate-800">{lastInviteResult.emailDelivery?.status}</span>
                </div>
                {lastInviteResult.invitationUrl && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold text-slate-700">Invitation Link:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        readOnly
                        value={lastInviteResult.invitationUrl}
                        className="w-full text-[11px] font-mono p-1.5 border border-emerald-200 rounded bg-white"
                      />
                      <button
                        onClick={() => copyText(lastInviteResult.invitationUrl, 'modal_link', true)}
                        className="p-1.5 bg-emerald-600 text-white rounded text-xs"
                      >
                        {copiedLink === 'modal_link' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleInviteAgent} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Priya"
                    value={inviteFirst}
                    onChange={(e) => setInviteFirst(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Nair"
                    value={inviteLast}
                    onChange={(e) => setInviteLast(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  placeholder="agent@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Permitted Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="AGENT">Agent (Handle conversations and tickets)</option>
                  <option value="ADMIN">Admin (Manage teams, settings and users)</option>
                  {user?.role === 'OWNER' && <option value="OWNER">Owner (Full administrative authority)</option>}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assign to Teams</label>
                <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                  {teams.length === 0 ? (
                    <span className="text-[11px] text-slate-400 italic">No teams created yet</span>
                  ) : (
                    teams.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inviteTeams.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) setInviteTeams([...inviteTeams, t.id]);
                            else setInviteTeams(inviteTeams.filter((id) => id !== t.id));
                          }}
                          className="rounded text-blue-600"
                        />
                        <span>{t.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md disabled:opacity-50"
                >
                  {inviting ? 'Generating Invitation...' : 'Send Secure Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Team Modal (Create / Edit) */}
      {showTeamModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">{editingTeam ? 'Edit Support Team' : 'Create Support Team'}</h3>

            <form onSubmit={handleSaveTeam} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Team Name</label>
                <input
                  type="text"
                  required
                  placeholder="Tier 1 Frontline Support"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  placeholder="Handles initial customer inquiries and triaging"
                  value={teamDesc}
                  onChange={(e) => setTeamDesc(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 h-20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Team Lead</label>
                <select
                  value={teamLeadId}
                  onChange={(e) => setTeamLeadId(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="">No team lead designated</option>
                  {staff
                    .filter((s) => s.status === 'ACTIVE')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.firstName} {s.lastName} ({s.role})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Team Members</label>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                  {staff
                    .filter((s) => s.status === 'ACTIVE')
                    .map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={teamMembers.includes(s.id)}
                          onChange={(e) => {
                            if (e.target.checked) setTeamMembers([...teamMembers, s.id]);
                            else setTeamMembers(teamMembers.filter((id) => id !== s.id));
                          }}
                          className="rounded text-blue-600"
                        />
                        <span>
                          {s.firstName} {s.lastName} ({s.email})
                        </span>
                      </label>
                    ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTeamModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTeam}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md disabled:opacity-50"
                >
                  {savingTeam ? 'Saving Team...' : editingTeam ? 'Update Team' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {roleModalUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">Change Staff Role</h3>
            <p className="text-xs text-slate-500">
              Update role permissions for <strong>{roleModalUser.firstName} {roleModalUser.lastName}</strong> ({roleModalUser.email}).
            </p>

            <form onSubmit={handleUpdateRole} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">New Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="AGENT">Agent (Handle conversations & tickets)</option>
                  <option value="ADMIN">Admin (Manage teams & automations)</option>
                  {user?.role === 'OWNER' && <option value="OWNER">Owner (Transfer full ownership)</option>}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRoleModalUser(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingRole}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md disabled:opacity-50"
                >
                  {updatingRole ? 'Updating Role...' : 'Save Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Inbox Channel Modal */}
      {editingInbox && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">Edit Inbox Channel</h3>

            <form onSubmit={handleSaveInbox} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Greeting Message</label>
                <input
                  type="text"
                  required
                  value={inboxGreeting}
                  onChange={(e) => setInboxGreeting(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Widget Theme Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={inboxColor}
                    onChange={(e) => setInboxColor(e.target.value)}
                    className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={inboxColor}
                    onChange={(e) => setInboxColor(e.target.value)}
                    className="flex-1 font-mono text-xs p-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Approved Embed Website Domains</label>
                <input
                  type="text"
                  placeholder="app.mycompany.com, mycompany.com"
                  value={inboxDomains}
                  onChange={(e) => setInboxDomains(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-400">Comma-separated domains. Leave empty to allow all.</span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingInbox(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingInbox}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md disabled:opacity-50"
                >
                  {savingInbox ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
