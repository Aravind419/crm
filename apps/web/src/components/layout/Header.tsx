'use client';

import React from 'react';
import { Search, Bell, CheckCircle2 } from 'lucide-react';
import { apiClient } from '../../lib/api';

export function Header({
  user,
  onUserUpdate,
  title,
  subtitle,
}: {
  user?: any;
  onUserUpdate?: (updated: any) => void;
  title: string;
  subtitle?: string;
}) {
  const isAvailable = user?.isAvailable ?? true;

  async function toggleAvailability() {
    try {
      const res = await apiClient<{ user: { isAvailable: boolean } }>('/api/v1/users/availability', {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: !isAvailable }),
      });
      if (onUserUpdate) {
        onUserUpdate({ ...user, isAvailable: res.user.isAvailable });
      }
    } catch (err) {
      console.error('Failed to update availability:', err);
    }
  }

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between z-10 sticky top-0">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-4">
        {/* Availability Toggle */}
        <button
          onClick={toggleAvailability}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            isAvailable
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
              : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
          }`}
          title="Toggle your availability to accept new chats"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isAvailable ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
            }`}
          />
          <span>{isAvailable ? 'Available' : 'Away'}</span>
        </button>

        {/* Global Quick Search */}
        <div className="relative hidden md:block">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search conversations, tickets (Cmd+K)..."
            className="w-64 pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-700"
          />
        </div>

        {/* Notifications Icon */}
        <button className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg relative transition-colors">
          <Bell className="w-4 h-4" />
          <span className="w-2 h-2 bg-blue-600 rounded-full absolute top-1.5 right-1.5 ring-2 ring-white" />
        </button>
      </div>
    </header>
  );
}
