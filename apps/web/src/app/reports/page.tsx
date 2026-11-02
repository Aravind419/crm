'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header } from '../../components/layout/Header';
import { apiClient } from '../../lib/api';
import {
  BarChart3,
  Clock,
  CheckCircle2,
  Inbox,
  Ticket,
  TrendingUp,
  Smile,
  Users,
} from 'lucide-react';

export default function ReportsPage() {
  const [user, setUser] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>({});
  const [agents, setAgents] = useState<any[]>([]);
  const [volumeTrends, setVolumeTrends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const me = await apiClient<any>('/api/v1/auth/me');
        setUser(me.user);
        setOrganization(me.organization);

        const repRes = await apiClient<any>('/api/v1/reports/overview');
        setMetrics(repRes.metrics || {});
        setAgents(repRes.agents || []);
        setVolumeTrends(repRes.volumeTrends || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <Sidebar user={user} organization={organization} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          user={user}
          onUserUpdate={setUser}
          title="Reporting & Operational Analytics"
          subtitle="First response times, resolution rates, and team productivity"
        />

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto space-y-8">
            {/* Metric KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Conversations</span>
                  <Inbox className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-2xl font-bold text-slate-900">{metrics.totalConversations ?? 0}</div>
                <div className="text-[11px] text-emerald-600 font-semibold mt-1">
                  {metrics.openConversations ?? 0} active in queue
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Avg First Response</span>
                  <Clock className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  {metrics.avgFirstResponseMinutes !== null && metrics.avgFirstResponseMinutes !== undefined ? (
                    <>
                      {metrics.avgFirstResponseMinutes} <span className="text-sm font-normal text-slate-500">mins</span>
                    </>
                  ) : (
                    <span className="text-lg font-medium text-slate-400">Collecting...</span>
                  )}
                </div>
                <div className="text-[11px] text-emerald-600 font-semibold mt-1">SLA target: &lt; 15 mins</div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Resolved Tickets</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-2xl font-bold text-slate-900">{metrics.totalTickets ?? 0}</div>
                <div className="text-[11px] text-slate-500 mt-1">{metrics.openTickets ?? 0} pending action</div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Customer Satisfaction</span>
                  <Smile className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  {metrics.customerSatisfactionScore !== null && metrics.customerSatisfactionScore !== undefined ? (
                    `${metrics.customerSatisfactionScore}%`
                  ) : (
                    <span className="text-lg font-medium text-slate-400">Pending ratings</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 font-medium mt-1">Post-resolution surveys</div>
              </div>
            </div>

            {/* Conversation Volume Trend Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">7-Day Conversation Volume</h3>
                  <p className="text-xs text-slate-500">Incoming inquiries vs. resolved conversations</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                    <span>Incoming</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span>Resolved</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-4 pt-4 border-t border-slate-100">
                {volumeTrends.map((v) => (
                  <div key={v.day} className="flex flex-col items-center gap-2">
                    <div className="w-full flex items-end justify-center gap-1.5 h-40 bg-slate-50 rounded-lg p-2">
                      <div
                        style={{ height: `${Math.min(100, v.incoming * 3.5)}%` }}
                        className="w-4 bg-blue-600 rounded-t transition-all"
                        title={`${v.incoming} incoming`}
                      />
                      <div
                        style={{ height: `${Math.min(100, v.resolved * 3.5)}%` }}
                        className="w-4 bg-emerald-500 rounded-t transition-all"
                        title={`${v.resolved} resolved`}
                      />
                    </div>
                    <span className="text-xs font-semibold text-slate-600">{v.day}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent Performance Leaderboard */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100">
                <h3 className="font-bold text-slate-900 text-sm">Support Agent Productivity</h3>
                <p className="text-xs text-slate-500">Real-time workload distribution and assignments</p>
              </div>

              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-6">Agent</th>
                    <th className="py-3 px-6">Status</th>
                    <th className="py-3 px-6">Assigned Conversations</th>
                    <th className="py-3 px-6">Assigned Tickets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {agents.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-6 font-semibold text-slate-900 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center">
                          {a.name?.[0]}
                        </div>
                        <span>{a.name}</span>
                      </td>
                      <td className="py-3.5 px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            a.isAvailable
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              a.isAvailable ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          {a.isAvailable ? 'Available' : 'Away'}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 font-mono font-medium text-slate-700">
                        {a.assignedConversations}
                      </td>
                      <td className="py-3.5 px-6 font-mono font-medium text-slate-700">
                        {a.assignedTickets}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
