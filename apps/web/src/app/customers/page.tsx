'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header } from '../../components/layout/Header';
import { apiClient } from '../../lib/api';
import { Users, Search, Mail, Phone, MessageSquare, Ticket } from 'lucide-react';

export default function CustomersPage() {
  const [user, setUser] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const me = await apiClient<any>('/api/v1/auth/me');
        setUser(me.user);
        setOrganization(me.organization);
        await fetchCustomers('');
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function fetchCustomers(search: string) {
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await apiClient<any>(`/api/v1/customers${q}`);
      setCustomers(res.customers || []);
      if (res.customers?.[0] && !selectedCustomer) {
        loadCustomerDetail(res.customers[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadCustomerDetail(id: string) {
    try {
      const res = await apiClient<any>(`/api/v1/customers/${id}`);
      setSelectedCustomer(res.customer);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <Sidebar user={user} organization={organization} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          user={user}
          onUserUpdate={setUser}
          title="Customer CRM"
          subtitle="Directory of customer profiles, custom attributes, and touchpoint timelines"
        />

        <div className="flex-1 flex overflow-hidden">
          {/* Customers Table Pane */}
          <div className="w-1/2 border-r border-slate-200 bg-white flex flex-col">
            <div className="p-4 border-b border-slate-200">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search by customer name, email, or company..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    fetchCustomers(e.target.value);
                  }}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {customers.map((c) => {
                const isSelected = selectedCustomer?.id === c.id;
                let parsedAttrs: any = {};
                try {
                  parsedAttrs = c.customAttributes ? JSON.parse(c.customAttributes) : {};
                } catch (e) {}

                return (
                  <div
                    key={c.id}
                    onClick={() => loadCustomerDetail(c.id)}
                    className={`p-4 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50/70 border-l-4 border-l-blue-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm text-slate-900">{c.name}</span>
                      {parsedAttrs.plan && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-700">
                          {parsedAttrs.plan}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mb-2">{c.email || 'No email registered'}</div>
                    <div className="flex items-center gap-4 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 text-slate-400" />
                        {c._count?.conversations || 0} conversations
                      </span>
                      <span className="flex items-center gap-1">
                        <Ticket className="w-3 h-3 text-slate-400" />
                        {c._count?.tickets || 0} tickets
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Customer Profile & Interaction Timeline Pane */}
          <div className="w-1/2 bg-slate-50 p-6 overflow-y-auto">
            {selectedCustomer ? (
              <div className="space-y-6 max-w-xl">
                {/* Profile Card */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white font-bold text-xl flex items-center justify-center shadow-md">
                      {selectedCustomer.name?.[0] || 'C'}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{selectedCustomer.name}</h3>
                      <div className="text-xs text-slate-500">{selectedCustomer.email}</div>
                    </div>
                  </div>

                  {selectedCustomer.phone && (
                    <div className="flex items-center gap-2 text-xs text-slate-600 mt-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      <span>{selectedCustomer.phone}</span>
                    </div>
                  )}

                  {/* Custom Metadata Attributes */}
                  {selectedCustomer.customAttributes && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        CRM Attributes & Metadata
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {Object.entries(
                          JSON.parse(selectedCustomer.customAttributes || '{}')
                        ).map(([k, v]) => (
                          <div key={k} className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                            <span className="text-slate-400 capitalize block text-[10px]">{k}</span>
                            <span className="font-semibold text-slate-800">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Conversation History */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Conversation Timeline
                  </h4>
                  <div className="space-y-2">
                    {selectedCustomer.conversations?.map((conv: any) => (
                      <div
                        key={conv.id}
                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold text-xs text-slate-900">
                            Conversation #{conv.id.substring(0, 8)}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Last active: {new Date(conv.lastMessageAt).toLocaleString()}
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-700">
                          {conv.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                Select a customer to view profile.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
