'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header } from '../../components/layout/Header';
import { apiClient } from '../../lib/api';
import { Ticket, Plus, Search, Filter, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

export default function TicketsPage() {
  const [user, setUser] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const me = await apiClient<any>('/api/v1/auth/me');
        setUser(me.user);
        setOrganization(me.organization);

        const custRes = await apiClient<any>('/api/v1/customers');
        setCustomers(custRes.customers || []);
        if (custRes.customers?.[0]) setSelectedCustomerId(custRes.customers[0].id);

        const staffRes = await apiClient<any>('/api/v1/users');
        setStaff(staffRes.users || []);

        await fetchTickets('ALL', '');
      } catch (err) {
        console.error('Failed to load tickets:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  async function fetchTickets(status: string, search: string) {
    try {
      let q = status !== 'ALL' ? `?status=${status}` : '';
      if (search) q += `${q ? '&' : '?'}search=${encodeURIComponent(search)}`;
      const res = await apiClient<any>(`/api/v1/tickets${q}`);
      setTickets(res.tickets || []);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !description || !selectedCustomerId) return;

    try {
      await apiClient('/api/v1/tickets', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          customerId: selectedCustomerId,
          assigneeId: selectedAssigneeId || undefined,
          priority,
        }),
      });

      setShowModal(false);
      setTitle('');
      setDescription('');
      fetchTickets(statusFilter, searchQuery);
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function updateTicketStatus(id: string, newStatus: string) {
    try {
      await apiClient(`/api/v1/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      fetchTickets(statusFilter, searchQuery);
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <Sidebar user={user} organization={organization} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          user={user}
          onUserUpdate={setUser}
          title="Ticket Management"
          subtitle="SLA tracking and structured issue lifecycle"
        />

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Top Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                {['ALL', 'NEW', 'OPEN', 'PENDING', 'RESOLVED'].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setStatusFilter(s);
                      fetchTickets(s, searchQuery);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      statusFilter === s
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search tickets by title, customer..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      fetchTickets(statusFilter, e.target.value);
                    }}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                <button
                  onClick={() => setShowModal(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Ticket</span>
                </button>
              </div>
            </div>

            {/* Tickets Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Ticket</th>
                      <th className="py-3 px-4">Subject</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Priority</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Assignee</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {tickets.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-slate-400">
                          No tickets found matching this filter.
                        </td>
                      </tr>
                    ) : (
                      tickets.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-blue-600">
                            TICK-{t.ticketNumber}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-slate-900 max-w-xs truncate">
                            {t.title}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600">
                            {t.customer?.name}
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full font-semibold text-[10px] ${
                                t.priority === 'URGENT'
                                  ? 'bg-rose-100 text-rose-700'
                                  : t.priority === 'HIGH'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {t.priority}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <select
                              value={t.status}
                              onChange={(e) => updateTicketStatus(t.id, e.target.value)}
                              className="text-xs py-1 px-2 rounded border border-slate-200 bg-white font-medium text-slate-700 focus:outline-none focus:border-blue-500"
                            >
                              <option value="NEW">NEW</option>
                              <option value="OPEN">OPEN</option>
                              <option value="PENDING">PENDING</option>
                              <option value="RESOLVED">RESOLVED</option>
                              <option value="CLOSED">CLOSED</option>
                            </select>
                          </td>
                          <td className="py-3.5 px-4 text-slate-600">
                            {t.assignee
                              ? `${t.assignee.firstName} ${t.assignee.lastName}`
                              : 'Unassigned'}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {t.status !== 'RESOLVED' && (
                              <button
                                onClick={() => updateTicketStatus(t.id, 'RESOLVED')}
                                className="text-emerald-600 hover:text-emerald-700 font-semibold text-xs flex items-center gap-1 justify-end ml-auto"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Resolve</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New Ticket Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Create Support Ticket</h3>
            <p className="text-xs text-slate-500 mb-4">Assign a task to engineering or billing.</p>

            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  required
                  placeholder="Ticket title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Customer</label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  required
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email || 'No email'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assignee</label>
                  <select
                    value={selectedAssigneeId}
                    onChange={(e) => setSelectedAssigneeId(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Unassigned</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.firstName} {s.lastName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Detailed description..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md"
                >
                  Save Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
