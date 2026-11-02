'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BookOpen, Search, ArrowLeft, Eye, HelpCircle } from 'lucide-react';

export default function PublicHelpCenterPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [org, setOrg] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeArticle, setActiveArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    loadPortal('');
  }, [slug]);

  async function loadPortal(search: string) {
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await fetch(`http://localhost:4000/api/v1/public/portal/${slug}${q}`);
      if (res.ok) {
        const data = await res.json();
        setOrg(data.organization);
        setCategories(data.categories || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function readArticle(articleSlug: string) {
    try {
      const res = await fetch(`http://localhost:4000/api/v1/public/portal/${slug}/articles/${articleSlug}`);
      if (res.ok) {
        const data = await res.json();
        setActiveArticle(data.article);
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-sm">
              {org?.name?.[0] || 'S'}
            </div>
            <div>
              <div className="font-bold text-base text-slate-900">{org?.name || 'Help Center'}</div>
              <div className="text-[11px] text-slate-400">Knowledge Base & Documentation</div>
            </div>
          </div>

          <Link
            href="/"
            className="text-xs font-semibold text-slate-600 hover:text-blue-600 transition-colors"
          >
            Powered by SupportOS
          </Link>
        </div>
      </header>

      {/* Hero Search */}
      <div className="bg-gradient-to-b from-blue-600 to-blue-700 py-16 px-6 text-center text-white">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-extrabold mb-3">How can we help you today?</h1>
          <p className="text-sm text-blue-100 mb-8">
            Search our knowledge base for answers, setup guides, and troubleshooting steps.
          </p>

          <div className="relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
            <input
              type="text"
              placeholder="Search by keywords (e.g. widget, invoice, webhook)..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                loadPortal(e.target.value);
              }}
              className="w-full pl-12 pr-4 py-3 bg-white text-slate-900 rounded-2xl shadow-xl text-sm focus:outline-none ring-2 ring-blue-400/30"
            />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-5xl mx-auto px-6 py-12">
        {activeArticle ? (
          /* Article Reader View */
          <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm max-w-3xl mx-auto">
            <button
              onClick={() => setActiveArticle(null)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to all topics</span>
            </button>

            <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 mb-3">
              {activeArticle.category?.name}
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-3">{activeArticle.title}</h1>
            <div className="flex items-center gap-3 text-xs text-slate-400 border-b border-slate-100 pb-6 mb-6">
              <span>By {activeArticle.author?.firstName} {activeArticle.author?.lastName}</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Eye className="w-3.5 h-3.5" /> {activeArticle.viewCount} views
              </span>
            </div>

            <div className="prose prose-slate text-sm leading-relaxed whitespace-pre-wrap">
              {activeArticle.content}
            </div>
          </div>
        ) : (
          /* Category and Article Listing */
          <div className="space-y-10">
            {categories.map((cat) => (
              <div key={cat.id} className="space-y-4">
                <div className="border-b border-slate-200 pb-2">
                  <h2 className="text-lg font-bold text-slate-900">{cat.name}</h2>
                  {cat.description && <p className="text-xs text-slate-500">{cat.description}</p>}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {cat.articles?.map((art: any) => (
                    <div
                      key={art.id}
                      onClick={() => readArticle(art.slug)}
                      className="bg-white p-5 rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-md cursor-pointer transition-all flex items-start gap-3.5"
                    >
                      <div className="p-2 bg-blue-50 text-blue-600 rounded-lg flex-shrink-0">
                        <BookOpen className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm text-slate-900 hover:text-blue-600 transition-colors">
                          {art.title}
                        </h3>
                        <div className="text-[11px] text-slate-400 mt-1">
                          {art.viewCount} reads
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
