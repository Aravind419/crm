'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Shield, Zap, Sparkles } from 'lucide-react';

export default function WidgetDemoPage() {
  useEffect(() => {
    // Dynamically inject the widget script onto the demo page
    const existing = document.getElementById('supportos-demo-script');
    if (!existing) {
      const script = document.createElement('script');
      script.id = 'supportos-demo-script';
      script.src = '/widget.js';
      script.setAttribute('data-inbox-key', 'inbox_acme_live_49f82d');
      script.setAttribute('data-api-url', 'http://localhost:4000');
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between selection:bg-blue-600">
      {/* Top Demo Header */}
      <div className="bg-slate-950/80 border-b border-slate-800 p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/inbox"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Agent Workspace</span>
            </Link>
            <span className="text-slate-600">|</span>
            <span className="text-xs font-semibold text-blue-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Interactive Live Chat Widget Testbed
            </span>
          </div>

          <div className="text-xs text-slate-400">
            Inbox Key: <code className="bg-slate-900 px-2 py-0.5 rounded text-blue-300">inbox_acme_live_49f82d</code>
          </div>
        </div>
      </div>

      {/* Mock Storefront Body */}
      <div className="max-w-4xl mx-auto px-6 py-20 text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-900/30 border border-blue-700/50 text-blue-300 text-xs font-semibold">
          <Zap className="w-3.5 h-3.5 text-blue-400" />
          <span>Customer Storefront Simulation</span>
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
          Apex Cloud & Enterprise Infrastructure
        </h1>

        <p className="text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
          This simulated customer storefront demonstrates how the standalone SupportOS widget attaches to any website. Look at the bottom-right corner of your screen!
        </p>

        <div className="p-6 bg-slate-950 rounded-2xl border border-slate-800 text-left max-w-lg mx-auto space-y-3 text-xs">
          <div className="font-bold text-white text-sm mb-1">Widget Verification Checklist:</div>
          <div className="flex items-center gap-2 text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Click the floating blue chat button at bottom-right.</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Enter your name and test message.</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Open <Link href="/inbox" target="_blank" className="text-blue-400 underline font-semibold">Agent Workspace</Link> in another tab to reply live!</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Witness real-time bi-directional message synchronization.</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="py-6 border-t border-slate-800 text-center text-xs text-slate-500">
        Simulated Customer Website • SupportOS Embeddable Widget v0.1.0
      </div>
    </div>
  );
}
