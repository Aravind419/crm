'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Inbox,
  Ticket,
  Users,
  BookOpen,
  BarChart3,
  Settings,
  LogOut,
  HelpCircle,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { clearAuthToken } from '../../lib/api';

const navigation = [
  { name: 'Shared Inbox', href: '/inbox', icon: Inbox, badge: 'Live' },
  { name: 'Tickets', href: '/tickets', icon: Ticket },
  { name: 'Customers', href: '/customers', icon: Users },
  { name: 'Knowledge Base', href: '/knowledge-base', icon: BookOpen },
  { name: 'Reporting', href: '/reports', icon: BarChart3 },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ user, organization }: { user?: any; organization?: any }) {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    clearAuthToken();
    router.push('/login');
  }

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 select-none flex-shrink-0 h-screen sticky top-0">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
        <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
          S
        </div>
        <div>
          <div className="font-semibold text-white text-base tracking-tight leading-tight">SupportOS</div>
          <div className="text-xs text-slate-400 font-medium truncate max-w-[140px]">
            {organization?.name || 'Enterprise Cloud'}
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          WORKSPACE
        </div>
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.name}</span>
              </div>
              {item.badge && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  isActive ? 'bg-blue-700 text-white' : 'bg-slate-800 text-blue-400 border border-slate-700'
                }`}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

        <div className="pt-6 px-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          CHANNELS & PORTALS
        </div>
        <Link
          href="/widget-demo"
          target="_blank"
          className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Live Chat Widget</span>
          </div>
          <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
        </Link>
        <Link
          href={`/portal/${organization?.slug || 'acme'}`}
          target="_blank"
          className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <div className="flex items-center gap-3">
            <HelpCircle className="w-4 h-4 text-purple-400" />
            <span>Public Help Center</span>
          </div>
          <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
        </Link>
      </nav>

      {/* User Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between px-2 py-1.5 rounded-lg">
          <div className="flex items-center gap-2.5 truncate">
            <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center">
              {user?.firstName?.[0] || 'A'}
            </div>
            <div className="truncate">
              <div className="text-xs font-medium text-white truncate">
                {user?.firstName ? `${user.firstName} ${user.lastName}` : 'Support Agent'}
              </div>
              <div className="text-[11px] text-slate-400 font-mono capitalize">
                {user?.role?.toLowerCase() || 'agent'}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
