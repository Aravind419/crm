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
  Code,
} from 'lucide-react';

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'inboxes' | 'teams' | 'agents' | 'org'>('inboxes');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Invite Agent state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirst, setInviteFirst] = useState('');
  const [inviteLast, setInviteLast] = useState('');
  const [inviteRole, setInviteRole] = useState('AGENT');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const me = await apiClient<any>('/api/v1/auth/me');
        setUser(me.user);
        setOrganization(me.organization);

        const inboxesRes = await apiClient<any>('/api/v1/inboxes');
        setInboxes(inboxesRes.inboxes || []);

        const teamsRes = await apiClient<any>('/api/v1/teams');
        setTeams(teamsRes.teams || []);

        const staffRes = await apiClient<any>('/api/v1/users');
        setStaff(staffRes.users || []);
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, []);

  function copySnippet(snippet: string, key: string) {
    navigator.clipboard.writeText(snippet);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function handleInviteAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail || !inviteFirst || !inviteLast || inviting) return;
    setInviting(true);

    try {
      await apiClient('/api/v1/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail,
          firstName: inviteFirst,
          lastName: inviteLast,
          role: inviteRole,
        }),
      });

      setShowInviteModal(false);
      setInviteEmail('');
      setInviteFirst('');
      setInviteLast('');
      const staffRes = await apiClient<any>('/api/v1/users');
      setStaff(staffRes.users || []);
      alert('Agent invitation sent successfully!');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <Sidebar user={user} organization={organization} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          user={user}
          onUserUpdate={setUser}
          title="Organization Settings"
          subtitle="Manage website widget inboxes, support teams, and agent permissions"
        />

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <button
                onClick={() => setActiveTab('inboxes')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
                  activeTab === 'inboxes'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>Channels & Inboxes</span>
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
                <span>Agents & Roles</span>
              </button>
            </div>

            {/* TAB: INBOXES & WIDGET CONFIG */}
            {activeTab === 'inboxes' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Website Live Chat Inboxes</h3>
                    <p className="text-xs text-slate-500">
                      Embed the customer chat widget into any web application or landing page.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {inboxes.map((inbox) => (
                    <div
                      key={inbox.id}
                      className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            style={{ background: inbox.widgetColor }}
                            className="w-4 h-4 rounded-full shadow-sm"
                          />
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{inbox.name}</h4>
                            <span className="text-[11px] text-slate-500">
                              Channel: {inbox.channelType}
                            </span>
                          </div>
                        </div>

                        <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
                          {inbox.inboxKey}
                        </span>
                      </div>

                      <div className="pt-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Widget Installation Script Tag
                        </label>
                        <div className="relative">
                          <pre className="p-3 bg-slate-950 text-slate-200 text-xs rounded-xl font-mono overflow-x-auto">
                            {`<script src="http://localhost:3000/widget.js" data-inbox-key="${inbox.inboxKey}" async></script>`}
                          </pre>
                          <button
                            onClick={() =>
                              copySnippet(
                                `<script src="http://localhost:3000/widget.js" data-inbox-key="${inbox.inboxKey}" async></script>`,
                                inbox.id
                              )
                            }
                            className="absolute right-2 top-2 p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors"
                            title="Copy script"
                          >
                            {copiedKey === inbox.id ? (
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

            {/* TAB: TEAMS */}
            {activeTab === 'teams' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h3 className="font-bold text-slate-900 text-base mb-1">Support Teams</h3>
                <p className="text-xs text-slate-500 mb-6">
                  Organize agents into functional tiers for routing.
                </p>

                <div className="grid md:grid-cols-2 gap-4">
                  {teams.map((t) => (
                    <div key={t.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                      <div className="font-bold text-sm text-slate-900 mb-1">{t.name}</div>
                      <p className="text-xs text-slate-500 mb-3">{t.description}</p>
                      <div className="text-[11px] text-blue-600 font-semibold">
                        {t.members?.length || 0} members assigned
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: AGENTS */}
            {activeTab === 'agents' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Agents & Roles</h3>
                    <p className="text-xs text-slate-500">Manage permissions across your support staff.</p>
                  </div>
                  <button
                    onClick={() => setShowInviteModal(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Invite Agent</span>
                  </button>
                </div>

                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-6">Staff Member</th>
                      <th className="py-3 px-6">Email</th>
                      <th className="py-3 px-6">Role</th>
                      <th className="py-3 px-6">Status</th>
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
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Invite New Support Agent</h3>
            <p className="text-xs text-slate-500 mb-4">Grant access to your organization workspace.</p>

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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="AGENT">Agent (Handle conversations & tickets)</option>
                  <option value="ADMIN">Admin (Manage teams & automations)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md disabled:opacity-50"
                >
                  {inviting ? 'Inviting...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
