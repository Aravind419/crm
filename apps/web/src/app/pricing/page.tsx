import Link from 'next/link';
import { Check, ArrowRight } from 'lucide-react';

export default function PricingPage() {
  const plans = [
    {
      name: 'Team',
      price: '₹799',
      period: 'per agent / month',
      description: 'Ideal for early-stage companies and growing support teams.',
      features: [
        'Up to 5 Inboxes',
        'Real-Time Shared Inbox',
        'Website Live Chat Widget',
        'Private Internal Notes & Mentions',
        'Customer Profile CRM',
        'Public Knowledge Base Portal',
        'Standard Email & In-App Support',
      ],
      cta: 'Start with Team',
      popular: false,
    },
    {
      name: 'Business',
      price: '₹1,499',
      period: 'per agent / month',
      description: 'Built for scaling mid-market businesses requiring advanced routing.',
      features: [
        'Unlimited Inboxes & Channels',
        'Structured Ticket Lifecycle (TICK-XXXX)',
        'SLA Policies & Breach Tracking',
        'Automated Trigger-Condition-Action Routing',
        'Operational Metrics & FRT Analytics',
        'Agent Productivity Leaderboard',
        'Priority Phone & Slack Support',
      ],
      cta: 'Start with Business',
      popular: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: 'annual contract',
      description: 'Dedicated infrastructure, compliance guarantees, and 24/7 SLAs.',
      features: [
        'Custom Dedicated DB or Single-Tenant Cluster',
        'SAML 2.0 / OIDC Enterprise SSO & SCIM',
        'Full Audit Logging & Compliance Exports',
        'Custom Business Hours & Global Calendars',
        'Dedicated Technical Account Manager',
        '99.99% Uptime SLA Guarantee',
        'Enterprise Security & DPDP Compliance',
      ],
      cta: 'Contact Enterprise Sales',
      popular: false,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-blue-600">
      <nav className="border-b border-slate-800 bg-slate-950/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md">
              S
            </div>
            <span className="font-bold text-lg tracking-tight">SupportOS</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white">
              Sign In
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4">
            Predictable, transparent SaaS pricing
          </h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Choose the tier that fits your support operations. No hidden usage fees or surprises.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-8 flex flex-col justify-between border ${
                plan.popular
                  ? 'bg-slate-900 border-blue-500 ring-2 ring-blue-500/20 shadow-xl'
                  : 'bg-slate-900/40 border-slate-800'
              }`}
            >
              <div>
                {plan.popular && (
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-blue-600 text-white mb-4">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                <p className="text-xs text-slate-400 mt-1 mb-6">{plan.description}</p>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-xs text-slate-400">{plan.period}</span>
                </div>

                <div className="space-y-3 border-t border-slate-800 pt-6">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-center gap-3 text-xs text-slate-300">
                      <Check className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-8 mt-6 border-t border-slate-800/80">
                <Link
                  href="/signup"
                  className={`w-full py-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all ${
                    plan.popular
                      ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  <span>{plan.cta}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
