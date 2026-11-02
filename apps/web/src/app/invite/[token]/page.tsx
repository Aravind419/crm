'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiClient, setAuthToken } from '../../../lib/api';
import { CheckCircle2, Lock, User, AlertTriangle, ShieldCheck, ArrowRight } from 'lucide-react';

interface InvitationDetails {
  email: string;
  role: string;
  organizationName: string;
  inviterName: string;
  expiresAt: string;
}

export default function InviteAcceptancePage() {
  const params = useParams();
  const router = useRouter();
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedSuccess, setAcceptedSuccess] = useState(false);

  useEffect(() => {
    async function fetchInvitation() {
      if (!token) {
        setLoadError('No invitation token provided');
        setLoading(false);
        return;
      }

      try {
        const res = await apiClient<{ invitation: InvitationDetails }>(`/api/v1/auth/invitations/${encodeURIComponent(token)}`);
        setInvitation(res.invitation);
      } catch (err: any) {
        setLoadError(err.message || 'This invitation is invalid, expired, or has already been used.');
      } finally {
        setLoading(false);
      }
    }

    fetchInvitation();
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);

    if (password !== confirmPassword) {
      setActionError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setActionError('Password must be at least 8 characters long');
      return;
    }

    // Password complexity check
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setActionError('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient<{
        token: string;
        user: any;
        organization: any;
      }>('/api/v1/auth/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({
          token,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          password,
        }),
      });

      setAuthToken(res.token);
      localStorage.setItem('supportos_user', JSON.stringify(res.user));
      localStorage.setItem('supportos_org', JSON.stringify(res.organization));

      setAcceptedSuccess(true);
      setTimeout(() => {
        router.push('/inbox');
      }, 1500);
    } catch (err: any) {
      setActionError(err.message || 'Failed to accept invitation. The invitation may have expired or been revoked.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>Validating your invitation...</span>
        </div>
      </div>
    );
  }

  if (loadError || !invitation) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-6 text-center">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Invitation Invalid or Expired</h2>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            {loadError || 'This invitation link is not valid. It may have expired, been revoked by an administrator, or already been accepted.'}
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (acceptedSuccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-6 text-center">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-white">Welcome to {invitation.organizationName}!</h2>
          <p className="text-xs text-slate-400">Your account is active. Redirecting you to your inbox...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-6 selection:bg-blue-600">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg">
              S
            </div>
            <span className="font-extrabold text-2xl text-white tracking-tight">SupportOS</span>
          </div>
          <h2 className="text-xl font-bold text-slate-100 mt-4">Join {invitation.organizationName}</h2>
          <p className="text-xs text-slate-400 mt-1">
            Invited by <span className="text-slate-200 font-medium">{invitation.inviterName}</span> as a{' '}
            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono text-[11px] font-semibold">
              {invitation.role}
            </span>
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          {actionError && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center justify-between">
              <span>{actionError}</span>
              <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-300 font-bold ml-2">
                ×
              </button>
            </div>
          )}

          <div className="mb-5 p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="text-xs">
              <span className="text-slate-400">Accepting invitation for: </span>
              <span className="font-medium text-slate-200 font-mono">{invitation.email}</span>
            </div>
          </div>

          <form onSubmit={handleAccept} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">First Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Last Name</label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Create Secure Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Min. 8 chars with uppercase, lowercase, number & symbol.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg transition"
            >
              {submitting ? 'Setting up Account...' : 'Set Password & Join Workspace'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
