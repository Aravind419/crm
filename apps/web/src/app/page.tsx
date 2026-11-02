import Link from 'next/link';
import {
  MessageSquare,
  Ticket,
  ShieldCheck,
  Zap,
  Globe,
  Users,
  BarChart,
  ArrowRight,
  CheckCircle,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-blue-600">
      {/* Navigation */}
      <nav className="border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md">
              S
            </div>
            <span className="font-bold text-lg tracking-tight">SupportOS</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm text-slate-300">
            <Link href="#features" className="hover:text-white transition-colors">
              Features
            </Link>
            <Link href="/pricing" className="hover:text-white transition-colors">
              Pricing
            </Link>
            <Link href="/portal/acme" className="hover:text-white transition-colors">
              Help Center
            </Link>
            <Link href="/widget-demo" className="text-blue-400 hover:text-blue-300 transition-colors">
              Live Widget Demo
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium px-4 py-2 text-slate-300 hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-all"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="relative pt-24 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-5xl mx-auto px-6 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-900/40 border border-blue-700/50 text-blue-300 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Independent Enterprise Customer Support SaaS
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-white leading-tight mb-6">
            The modern support operating system built for fast-moving teams.
          </h1>
          <p className="text-lg md:text-xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
            Combine the sub-second responsiveness of live chat with the governance of enterprise ticket lifecycles. Zero vendor lock-in, strict multi-tenant isolation, and affordable pricing.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-white shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2"
            >
              <span>Start Free Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/inbox"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold text-slate-200 border border-slate-700 transition-all"
            >
              View Agent Workspace
            </Link>
          </div>
        </div>
      </header>

      {/* Feature Grid */}
      <section id="features" className="py-20 border-t border-slate-900 bg-slate-950/80">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Architected for Speed & Enterprise Rigor</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              Everything your customer operations, support leads, and technical engineers need in one unified workspace.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center mb-5">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Unified Real-Time Inbox</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Stream messages with sub-second latency via Socket.IO. Toggle effortlessly between public customer replies and private staff notes.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center mb-5">
                <Ticket className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Native Ticket Lifecycle</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Escalate conversations into tickets with sequential IDs (e.g. TICK-1001), severity matrices, SLA tracking, and ownership routing.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center mb-5">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Strict Tenant Isolation</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                PostgreSQL and Prisma compound index tenant partitioning. Zero cross-tenant data leakage guaranteed by automated security test suites.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-amber-600/20 text-amber-400 flex items-center justify-center mb-5">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Zero-Dependency Widget</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Embed supportos.js via a single script tag. Customizable brand colors, pre-chat qualification, and persistent visitor sessions.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center mb-5">
                <Globe className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Public Knowledge Base</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Publish documentation, guides, and FAQs with markdown formatting, instant keyword search, and automatic deflection tracking.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center mb-5">
                <BarChart className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Operations & FRT Analytics</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Monitor real First Response Time (FRT), resolution rates, daily volume spikes, and per-agent productivity leaderboards.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-12 text-center text-xs text-slate-500">
        <p>© 2026 SupportOS Inc. All rights reserved. Clean-room enterprise customer support platform.</p>
      </footer>
    </div>
  );
}
