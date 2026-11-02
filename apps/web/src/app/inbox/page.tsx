'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header } from '../../components/layout/Header';
import { apiClient } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import {
  Inbox,
  User,
  Users,
  CheckCircle2,
  Clock,
  Send,
  Lock,
  Tag,
  AlertCircle,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  MessageSquare,
} from 'lucide-react';

export default function InboxPage() {
  const [user, setUser] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<any>(null);
  const [filterScope, setFilterScope] = useState<'all' | 'mine' | 'unassigned' | 'resolved'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Composer state
  const [messageMode, setMessageMode] = useState<'PUBLIC_REPLY' | 'INTERNAL_NOTE'>('PUBLIC_REPLY');
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Staff & Teams for assignment
  const [staffList, setStaffList] = useState<any[]>([]);
  const [teamList, setTeamList] = useState<any[]>([]);

  // Ticket creation modal state
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');
  const [ticketPriority, setTicketPriority] = useState('HIGH');
  const [creatingTicket, setCreatingTicket] = useState(false);

  // Load initial profile & lists
  useEffect(() => {
    async function init() {
      try {
        const me = await apiClient<any>('/api/v1/auth/me');
        setUser(me.user);
        setOrganization(me.organization);

        const usersRes = await apiClient<any>('/api/v1/users');
        setStaffList(usersRes.users || []);

        const teamsRes = await apiClient<any>('/api/v1/teams');
        setTeamList(teamsRes.teams || []);

        await loadConversations('all', '');
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Socket.IO event binding
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    function handleNewMessage(message: any) {
      if (activeConvId === message.conversationId) {
        setActiveConv((prev: any) => {
          if (!prev) return prev;
          // Avoid duplicate appends
          if (prev.messages?.some((m: any) => m.id === message.id)) return prev;
          return {
            ...prev,
            messages: [...(prev.messages || []), message],
          };
        });
        scrollToBottom();
      }

      // Update conversation in list
      setConversations((prev) =>
        prev.map((c) =>
          c.id === message.conversationId
            ? { ...c, lastMessageAt: message.createdAt, messages: [message] }
            : c
        )
      );
    }

    function handleConvUpdated(updated: any) {
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
      );
      if (activeConvId === updated.id) {
        setActiveConv((prev: any) => ({ ...prev, ...updated }));
      }
    }

    function handleNewConv(newConv: any) {
      setConversations((prev) => [newConv, ...prev.filter((c) => c.id !== newConv.id)]);
    }

    socket.on('message:created', handleNewMessage);
    socket.on('conversation:updated', handleConvUpdated);
    socket.on('conversation:created', handleNewConv);

    return () => {
      socket.off('message:created', handleNewMessage);
      socket.off('conversation:updated', handleConvUpdated);
      socket.off('conversation:created', handleNewConv);
    };
  }, [activeConvId]);

  async function loadConversations(scope: string, search: string) {
    try {
      let query = '';
      if (scope === 'resolved') {
        query = '?status=RESOLVED';
      } else {
        query = `?status=OPEN&scope=${scope}`;
      }
      if (search) query += `&search=${encodeURIComponent(search)}`;

      const res = await apiClient<any>(`/api/v1/conversations${query}`);
      setConversations(res.conversations || []);

      if (res.conversations && res.conversations.length > 0 && !activeConvId) {
        selectConversation(res.conversations[0].id);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  async function selectConversation(id: string) {
    setActiveConvId(id);
    try {
      const res = await apiClient<any>(`/api/v1/conversations/${id}`);
      setActiveConv(res.conversation);
      scrollToBottom();
    } catch (err) {
      console.error('Failed to load conversation details:', err);
    }
  }

  function scrollToBottom() {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }

  async function handleSendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!composerText.trim() || !activeConvId || sending) return;

    setSending(true);
    const content = composerText.trim();
    setComposerText('');

    try {
      await apiClient(`/api/v1/conversations/${activeConvId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content,
          messageType: messageMode,
        }),
      });
      // Refresh active thread
      selectConversation(activeConvId);
    } catch (err: any) {
      alert('Error sending message: ' + err.message);
      setComposerText(content);
    } finally {
      setSending(false);
    }
  }

  async function updateStatus(status: 'OPEN' | 'PENDING' | 'RESOLVED') {
    if (!activeConvId) return;
    try {
      await apiClient(`/api/v1/conversations/${activeConvId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      loadConversations(filterScope, searchQuery);
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function updateAssignee(assigneeId: string | null) {
    if (!activeConvId) return;
    try {
      await apiClient(`/api/v1/conversations/${activeConvId}`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId }),
      });
      selectConversation(activeConvId);
      loadConversations(filterScope, searchQuery);
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function updateTeam(teamId: string | null) {
    if (!activeConvId) return;
    try {
      await apiClient(`/api/v1/conversations/${activeConvId}`, {
        method: 'PATCH',
        body: JSON.stringify({ teamId }),
      });
      selectConversation(activeConvId);
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConv || creatingTicket) return;
    setCreatingTicket(true);

    try {
      await apiClient('/api/v1/tickets', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConv.id,
          customerId: activeConv.customerId,
          title: ticketTitle || `Escalation: ${activeConv.customer?.name}`,
          description: ticketDesc || 'Created from conversation thread.',
          priority: ticketPriority,
        }),
      });
      setShowTicketModal(false);
      setTicketTitle('');
      setTicketDesc('');
      selectConversation(activeConv.id);
      alert('Ticket successfully created!');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreatingTicket(false);
    }
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      {/* 1. Global Left Navigation */}
      <Sidebar user={user} organization={organization} />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          user={user}
          onUserUpdate={setUser}
          title="Shared Inbox"
          subtitle="Real-time multi-channel support stream"
        />

        {/* 3-Pane Inbox Layout */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* PANE 1: Filter Queues & Conversation Feed (320px) */}
          <div className="w-80 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
            {/* Filter Tabs */}
            <div className="p-3 border-b border-slate-200">
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">
                <button
                  onClick={() => {
                    setFilterScope('all');
                    loadConversations('all', searchQuery);
                  }}
                  className={`py-1.5 rounded-md transition-all ${
                    filterScope === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'hover:text-slate-900'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => {
                    setFilterScope('mine');
                    loadConversations('mine', searchQuery);
                  }}
                  className={`py-1.5 rounded-md transition-all ${
                    filterScope === 'mine' ? 'bg-white text-blue-600 shadow-sm' : 'hover:text-slate-900'
                  }`}
                >
                  Mine
                </button>
                <button
                  onClick={() => {
                    setFilterScope('unassigned');
                    loadConversations('unassigned', searchQuery);
                  }}
                  className={`py-1.5 rounded-md transition-all ${
                    filterScope === 'unassigned' ? 'bg-white text-blue-600 shadow-sm' : 'hover:text-slate-900'
                  }`}
                >
                  Open
                </button>
                <button
                  onClick={() => {
                    setFilterScope('resolved');
                    loadConversations('resolved', searchQuery);
                  }}
                  className={`py-1.5 rounded-md transition-all ${
                    filterScope === 'resolved' ? 'bg-white text-blue-600 shadow-sm' : 'hover:text-slate-900'
                  }`}
                >
                  Done
                </button>
              </div>

              {/* Search Box */}
              <div className="relative mt-2">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter threads..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    loadConversations(filterScope, e.target.value);
                  }}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Conversation List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {conversations.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  No conversations match this view.
                </div>
              ) : (
                conversations.map((c) => {
                  const isSelected = c.id === activeConvId;
                  const latestMsg = c.messages?.[0];
                  return (
                    <div
                      key={c.id}
                      onClick={() => selectConversation(c.id)}
                      className={`p-3.5 cursor-pointer transition-colors border-l-4 ${
                        isSelected
                          ? 'bg-blue-50/70 border-l-blue-600'
                          : 'hover:bg-slate-50 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs text-slate-900 truncate">
                          {c.customer?.name || 'Customer'}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(c.lastMessageAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 truncate line-clamp-1 mb-2">
                        {latestMsg?.content || 'Conversation initiated'}
                      </p>

                      <div className="flex items-center justify-between gap-1 text-[10px]">
                        <span
                          className={`px-1.5 py-0.5 rounded font-medium ${
                            c.priority === 'URGENT'
                              ? 'bg-rose-100 text-rose-700'
                              : c.priority === 'HIGH'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {c.priority}
                        </span>

                        <span className="text-slate-400 truncate max-w-[120px]">
                          {c.assignee
                            ? `${c.assignee.firstName} ${c.assignee.lastName?.[0]}.`
                            : 'Unassigned'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* PANE 2: Center Message Stream & Dual-Mode Composer */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden border-r border-slate-200">
            {activeConv ? (
              <>
                {/* Thread Header */}
                <div className="h-14 px-6 border-b border-slate-200 flex items-center justify-between bg-white flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                      {activeConv.customer?.name?.[0] || 'C'}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-slate-900 leading-tight">
                        {activeConv.customer?.name || 'Customer'}
                      </div>
                      <div className="text-xs text-slate-500">{activeConv.customer?.email}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowTicketModal(true)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-600" />
                      <span>Convert to Ticket</span>
                    </button>

                    {activeConv.status === 'RESOLVED' ? (
                      <button
                        onClick={() => updateStatus('OPEN')}
                        className="px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700 hover:bg-blue-100 flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Reopen</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => updateStatus('RESOLVED')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-1.5 shadow-sm"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Resolve</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Message Log */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/60">
                  {activeConv.messages?.map((msg: any) => {
                    const isInternal = msg.messageType === 'INTERNAL_NOTE';
                    const isCustomer = msg.senderType === 'CUSTOMER';

                    if (isInternal) {
                      return (
                        <div
                          key={msg.id}
                          className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm max-w-xl mx-auto"
                        >
                          <div className="flex items-center justify-between text-xs font-semibold text-amber-900 mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Lock className="w-3.5 h-3.5 text-amber-700" />
                              <span>Internal Note • {msg.senderName || 'Agent'}</span>
                            </div>
                            <span className="text-[11px] font-normal text-amber-700">
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-sm text-amber-950 whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}
                      >
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-xs font-semibold text-slate-700">
                            {isCustomer ? activeConv.customer?.name : msg.senderName || 'Agent'}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div
                          className={`max-w-lg px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                            isCustomer
                              ? 'bg-white text-slate-900 border border-slate-200 rounded-tl-sm'
                              : 'bg-blue-600 text-white rounded-tr-sm'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Dual-Mode Composer */}
                <div
                  className={`border-t p-4 transition-colors ${
                    messageMode === 'INTERNAL_NOTE'
                      ? 'bg-amber-50/80 border-amber-300'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  {/* Mode Selector Tabs */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setMessageMode('PUBLIC_REPLY')}
                        className={`px-3 py-1 rounded-md transition-colors ${
                          messageMode === 'PUBLIC_REPLY'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Public Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => setMessageMode('INTERNAL_NOTE')}
                        className={`px-3 py-1 rounded-md flex items-center gap-1 transition-colors ${
                          messageMode === 'INTERNAL_NOTE'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Lock className="w-3 h-3" />
                        <span>Internal Note</span>
                      </button>
                    </div>

                    <span className="text-[11px] text-slate-400">
                      {messageMode === 'INTERNAL_NOTE'
                        ? 'Private • Customer will never see this'
                        : 'Customer will see this reply immediately'}
                    </span>
                  </div>

                  {/* Input form */}
                  <form onSubmit={handleSendMessage} className="space-y-2">
                    <textarea
                      rows={3}
                      value={composerText}
                      onChange={(e) => setComposerText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          handleSendMessage();
                        }
                      }}
                      placeholder={
                        messageMode === 'INTERNAL_NOTE'
                          ? 'Write a private note or mention teammates with @...'
                          : 'Write your reply to customer (Cmd+Enter to send)...'
                      }
                      className={`w-full p-3 rounded-xl text-sm border focus:outline-none transition-colors ${
                        messageMode === 'INTERNAL_NOTE'
                          ? 'bg-white border-amber-300 focus:border-amber-500 text-amber-950 placeholder-amber-700/50'
                          : 'bg-slate-50 border-slate-200 focus:border-blue-500 focus:bg-white text-slate-900'
                      }`}
                    />

                    <div className="flex items-center justify-end">
                      <button
                        type="submit"
                        disabled={sending || !composerText.trim()}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 ${
                          messageMode === 'INTERNAL_NOTE'
                            ? 'bg-amber-600 hover:bg-amber-500'
                            : 'bg-blue-600 hover:bg-blue-500'
                        }`}
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>
                          {sending
                            ? 'Posting...'
                            : messageMode === 'INTERNAL_NOTE'
                            ? 'Add Private Note'
                            : 'Send Customer Reply'}
                        </span>
                      </button>
                    </div>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <Inbox className="w-12 h-12 text-slate-300 mb-3 stroke-1" />
                <h3 className="font-semibold text-slate-700 text-sm">No conversation selected</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Select a thread from the inbox or start a chat from the public live chat widget.
                </p>
              </div>
            )}
          </div>

          {/* PANE 3: Contextual Customer & Ticket Sidebar (280px) */}
          {activeConv && (
            <div className="w-72 bg-white flex flex-col overflow-y-auto border-l border-slate-200 p-5 space-y-6 flex-shrink-0">
              {/* Customer Profile Card */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Customer Context
                </h4>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-700 font-bold text-sm flex items-center justify-center">
                    {activeConv.customer?.name?.[0] || 'C'}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-slate-900">
                      {activeConv.customer?.name}
                    </div>
                    <div className="text-xs text-slate-500">{activeConv.customer?.email}</div>
                  </div>
                </div>

                {activeConv.customer?.phone && (
                  <div className="text-xs text-slate-600 mb-1">
                    Phone: <span className="font-mono">{activeConv.customer.phone}</span>
                  </div>
                )}
              </div>

              {/* Assignment Controls */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Routing & Assignment
                </h4>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Assignee</label>
                  <select
                    value={activeConv.assigneeId || ''}
                    onChange={(e) => updateAssignee(e.target.value || null)}
                    className="w-full text-xs py-1.5 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Unassigned</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.firstName} {s.lastName} ({s.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Team</label>
                  <select
                    value={activeConv.teamId || ''}
                    onChange={(e) => updateTeam(e.target.value || null)}
                    className="w-full text-xs py-1.5 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="">No Team</option>
                    {teamList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Escalated Tickets */}
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Linked Tickets
                  </h4>
                  <button
                    onClick={() => setShowTicketModal(true)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" /> New
                  </button>
                </div>

                {activeConv.tickets && activeConv.tickets.length > 0 ? (
                  <div className="space-y-2">
                    {activeConv.tickets.map((t: any) => (
                      <div
                        key={t.id}
                        className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-blue-700">TICK-{t.ticketNumber}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 font-semibold text-slate-700">
                            {t.status}
                          </span>
                        </div>
                        <div className="text-slate-800 font-medium truncate">{t.title}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No tickets linked yet.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ticket Escalation Modal */}
      {showTicketModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Escalate to Structured Ticket</h3>
            <p className="text-xs text-slate-500 mb-4">
              Create an engineering or operational ticket linked directly to this conversation.
            </p>

            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Ticket Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 504 Gateway Timeout during ingestion"
                  value={ticketTitle}
                  onChange={(e) => setTicketTitle(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent (SLA Alert)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Details of the issue and reproduction steps..."
                  value={ticketDesc}
                  onChange={(e) => setTicketDesc(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTicketModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingTicket}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md disabled:opacity-50"
                >
                  {creatingTicket ? 'Creating...' : 'Create Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
