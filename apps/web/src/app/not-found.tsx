import React from 'react';
import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 selection:bg-blue-600">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto mb-5">
          <FileQuestion className="w-7 h-7" />
        </div>

        <h1 className="text-4xl font-extrabold text-white mb-2">404</h1>
        <h2 className="text-lg font-semibold text-slate-200 mb-2">Page Not Found</h2>
        <p className="text-sm text-slate-400 mb-6 leading-relaxed">
          The page or resource you are looking for does not exist or has been moved.
        </p>

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-white text-xs transition-all shadow-sm"
        >
          <Home className="w-3.5 h-3.5" />
          <span>Return Home</span>
        </Link>
      </div>
    </div>
  );
}
