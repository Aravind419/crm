'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient, setAuthToken } from '../../lib/api';
import { ShieldCheck, ArrowRight, Lock, Mail } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('alex@acme.com');
  const [password, setPassword] = useState('Password123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await apiClient<{
        token: string;
        user: any;
        organization: any;
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      setAuthToken(res.token);
      localStorage.setItem('supportos_user', JSON.stringify(res.user));
      localStorage.setItem('supportos_org', JSON.stringify(res.organization));

      router.push('/inbox');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(presetEmail: string) {
    setEmail(presetEmail);
    setPassword('Password123!');
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-6 selection:bg-blue-600">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg">
              S
            </div>
            <span className="font-extrabold text-2xl text-white tracking-tight">SupportOS</span>
          </Link>
          <h2 className="text-xl font-bold text-slate-100 mt-4">Sign in to your support workspace</h2>
          <p className="text-xs text-slate-400 mt-1">Multi-tenant agent workspace & ticketing engine</p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="agent@company.com"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Preset Selector for Easy Testing */}
          <div className="mt-6 pt-6 border-t border-slate-800">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase mb-3">
              One-Click Evaluation Credentials
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => applyPreset('alex@acme.com')}
                className="text-left p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-blue-500 transition-colors"
              >
                <div className="text-xs font-semibold text-white">Alex Chen</div>
                <div className="text-[10px] text-slate-400">Acme (Owner)</div>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('vikram@acme.com')}
                className="text-left p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-blue-500 transition-colors"
              >
                <div className="text-xs font-semibold text-white">Vikram Rao</div>
                <div className="text-[10px] text-slate-400">Acme (Agent)</div>
              </button>
            </div>
            <button
              type="button"
              onClick={() => applyPreset('maya@starlight.com')}
              className="w-full mt-2 text-left p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-emerald-500 transition-colors"
            >
              <div className="text-xs font-semibold text-emerald-400">Maya Patel (Starlight Retail)</div>
              <div className="text-[10px] text-slate-400">Test Multi-Tenant Isolation (Isolated Tenant)</div>
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Don't have a workspace?{' '}
          <Link href="/signup" className="text-blue-400 hover:underline font-semibold">
            Create an organization
          </Link>
        </p>
      </div>
    </div>
  );
}
