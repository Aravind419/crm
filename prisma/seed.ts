import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

// Simple, secure SHA-256 password hash for test/seed consistency
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'supportos_salt_2026').digest('hex');
}

async function main() {
  console.log('🌱 Starting SupportOS database seeding...');

  // Clean existing records in reverse dependency order
  await prisma.auditEvent.deleteMany({});
  await prisma.automationRule.deleteMany({});
  await prisma.ticketComment.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.attachment.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.article.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.inbox.deleteMany({});
  await prisma.teamMember.deleteMany({});
  await prisma.team.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.workspace.deleteMany({});
  await prisma.organization.deleteMany({});

  // 1. Create Primary Organization: Acme Cloud Technologies
  const acmeOrg = await prisma.organization.create({
    data: {
      name: 'Acme Cloud Technologies',
      slug: 'acme',
      plan: 'BUSINESS',
      status: 'ACTIVE',
    },
  });

  // 2. Create Second Organization for Tenant Isolation Verification: Starlight Retail
  const starlightOrg = await prisma.organization.create({
    data: {
      name: 'Starlight Retail',
      slug: 'starlight',
      plan: 'TEAM',
      status: 'ACTIVE',
    },
  });

  // 3. Workspaces
  const acmeWorkspace = await prisma.workspace.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Primary Support',
      slug: 'primary',
    },
  });

  // 4. Users & Staff for Acme
  const defaultPassword = hashPassword('Password123!');

  const alexOwner = await prisma.user.create({
    data: {
      organizationId: acmeOrg.id,
      email: 'alex@acme.com',
      passwordHash: defaultPassword,
      firstName: 'Alex',
      lastName: 'Chen',
      role: 'OWNER',
      isAvailable: true,
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
    },
  });

  const sarahAdmin = await prisma.user.create({
    data: {
      organizationId: acmeOrg.id,
      email: 'sarah@acme.com',
      passwordHash: defaultPassword,
      firstName: 'Sarah',
      lastName: 'Jenkins',
      role: 'ADMIN',
      isAvailable: true,
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    },
  });

  const vikramAgent = await prisma.user.create({
    data: {
      organizationId: acmeOrg.id,
      email: 'vikram@acme.com',
      passwordHash: defaultPassword,
      firstName: 'Vikram',
      lastName: 'Rao',
      role: 'AGENT',
      isAvailable: true,
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
    },
  });

  // User for Starlight Retail (Tenant Isolation verification)
  const mayaStarlight = await prisma.user.create({
    data: {
      organizationId: starlightOrg.id,
      email: 'maya@starlight.com',
      passwordHash: defaultPassword,
      firstName: 'Maya',
      lastName: 'Patel',
      role: 'OWNER',
      isAvailable: true,
    },
  });

  // 5. Teams
  const tier1Team = await prisma.team.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Tier 1 Support',
      description: 'First response team for live chat and triage.',
    },
  });

  const billingTeam = await prisma.team.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Billing & Invoicing',
      description: 'Resolving invoices, payment methods, and subscriptions.',
    },
  });

  const engineeringTeam = await prisma.team.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Platform Engineering',
      description: 'Escalations for platform outages and API issues.',
    },
  });

  // Team Members
  await prisma.teamMember.create({ data: { teamId: tier1Team.id, userId: vikramAgent.id } });
  await prisma.teamMember.create({ data: { teamId: tier1Team.id, userId: sarahAdmin.id } });
  await prisma.teamMember.create({ data: { teamId: billingTeam.id, userId: sarahAdmin.id } });
  await prisma.teamMember.create({ data: { teamId: engineeringTeam.id, userId: alexOwner.id } });

  // 6. Inboxes
  const liveChatInbox = await prisma.inbox.create({
    data: {
      organizationId: acmeOrg.id,
      workspaceId: acmeWorkspace.id,
      name: 'Website Live Chat',
      channelType: 'WEB_WIDGET',
      inboxKey: 'inbox_acme_live_49f82d',
      widgetColor: '#2563EB',
      greeting: 'Welcome to Acme Support! How can we help you today?',
    },
  });

  // Starlight Inbox (for isolation)
  await prisma.inbox.create({
    data: {
      organizationId: starlightOrg.id,
      name: 'Starlight Storefront Support',
      channelType: 'WEB_WIDGET',
      inboxKey: 'inbox_starlight_live_83ba91',
      widgetColor: '#10B981',
      greeting: 'Hello from Starlight! What are you shopping for?',
    },
  });

  // 7. Customers
  const customerRohan = await prisma.customer.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Rohan Verma',
      email: 'rohan.verma@fintechone.in',
      phone: '+91 98765 43210',
      customAttributes: JSON.stringify({
        company: 'FintechOne India',
        plan: 'Enterprise',
        mrr: '$1,499',
        region: 'IN-WEST',
      }),
    },
  });

  const customerEmily = await prisma.customer.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Emily Watson',
      email: 'emily@growthscale.co',
      phone: '+1 415 555 0192',
      customAttributes: JSON.stringify({
        company: 'GrowthScale Inc.',
        plan: 'Business',
        mrr: '$499',
        seats: 25,
      }),
    },
  });

  const customerDavid = await prisma.customer.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'David Miller',
      email: 'david@quickflow.dev',
      customAttributes: JSON.stringify({
        company: 'QuickFlow Dev',
        plan: 'Team',
        mrr: '$199',
      }),
    },
  });

  // 8. Conversations & Messages
  // Conversation 1: High Priority API Latency
  const conv1 = await prisma.conversation.create({
    data: {
      organizationId: acmeOrg.id,
      workspaceId: acmeWorkspace.id,
      inboxId: liveChatInbox.id,
      customerId: customerRohan.id,
      assigneeId: vikramAgent.id,
      teamId: engineeringTeam.id,
      status: 'OPEN',
      priority: 'HIGH',
      lastMessageAt: new Date(),
    },
  });

  await prisma.message.create({
    data: {
      organizationId: acmeOrg.id,
      conversationId: conv1.id,
      senderType: 'CUSTOMER',
      senderId: customerRohan.id,
      senderName: customerRohan.name,
      messageType: 'PUBLIC_REPLY',
      content: 'Hello, our data ingestion jobs are encountering 504 Gateway Timeouts on the v2 webhook endpoint since 12:30 PM. Can you investigate?',
      createdAt: new Date(Date.now() - 3600000),
    },
  });

  await prisma.message.create({
    data: {
      organizationId: acmeOrg.id,
      conversationId: conv1.id,
      senderType: 'AGENT',
      senderId: vikramAgent.id,
      senderName: 'Vikram Rao',
      messageType: 'INTERNAL_NOTE',
      content: 'Checked Redis queue depth; looks like worker pod autoscale was throttled. Escalating ticket to Platform Engineering.',
      createdAt: new Date(Date.now() - 3000000),
    },
  });

  await prisma.message.create({
    data: {
      organizationId: acmeOrg.id,
      conversationId: conv1.id,
      senderType: 'AGENT',
      senderId: vikramAgent.id,
      senderName: 'Vikram Rao',
      messageType: 'PUBLIC_REPLY',
      content: 'Hi Rohan! We see the latency on the ingestion cluster and our engineering team is increasing worker pod capacity right now. I have opened Ticket TICK-1001 for tracking.',
      createdAt: new Date(Date.now() - 2500000),
    },
  });

  // Conversation 2: Emily Watson - Workspace Seats
  const conv2 = await prisma.conversation.create({
    data: {
      organizationId: acmeOrg.id,
      workspaceId: acmeWorkspace.id,
      inboxId: liveChatInbox.id,
      customerId: customerEmily.id,
      assigneeId: sarahAdmin.id,
      teamId: billingTeam.id,
      status: 'OPEN',
      priority: 'MEDIUM',
      lastMessageAt: new Date(Date.now() - 1800000),
    },
  });

  await prisma.message.create({
    data: {
      organizationId: acmeOrg.id,
      conversationId: conv2.id,
      senderType: 'CUSTOMER',
      senderId: customerEmily.id,
      senderName: customerEmily.name,
      messageType: 'PUBLIC_REPLY',
      content: 'Hi! We would like to add 5 more agent seats to our workspace. Can you enable the prorated billing?',
      createdAt: new Date(Date.now() - 1800000),
    },
  });

  // Conversation 3: David Miller - Unassigned
  const conv3 = await prisma.conversation.create({
    data: {
      organizationId: acmeOrg.id,
      workspaceId: acmeWorkspace.id,
      inboxId: liveChatInbox.id,
      customerId: customerDavid.id,
      status: 'OPEN',
      priority: 'LOW',
      lastMessageAt: new Date(Date.now() - 900000),
    },
  });

  await prisma.message.create({
    data: {
      organizationId: acmeOrg.id,
      conversationId: conv3.id,
      senderType: 'CUSTOMER',
      senderId: customerDavid.id,
      senderName: customerDavid.name,
      messageType: 'PUBLIC_REPLY',
      content: 'Hi team, could you please resend the GST invoice PDF for the month of October?',
      createdAt: new Date(Date.now() - 900000),
    },
  });

  // 9. Structured Tickets
  await prisma.ticket.create({
    data: {
      ticketNumber: 1001,
      organizationId: acmeOrg.id,
      conversationId: conv1.id,
      customerId: customerRohan.id,
      assigneeId: alexOwner.id,
      teamId: engineeringTeam.id,
      title: 'Batch Ingestion API 504 Gateway Timeouts',
      description: 'Webhook queue saturation causing latency spike for enterprise tenants.',
      status: 'OPEN',
      priority: 'HIGH',
      dueAt: new Date(Date.now() + 14400000), // 4 hours from now
    },
  });

  await prisma.ticket.create({
    data: {
      ticketNumber: 1002,
      organizationId: acmeOrg.id,
      customerId: customerDavid.id,
      assigneeId: sarahAdmin.id,
      teamId: billingTeam.id,
      title: 'October GST Invoice PDF Generation',
      description: 'Customer requested manual invoice re-dispatch with GSTIN breakdown.',
      status: 'NEW',
      priority: 'MEDIUM',
      dueAt: new Date(Date.now() + 86400000),
    },
  });

  // 10. Knowledge Base Categories & Articles
  const catGettingStarted = await prisma.category.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Getting Started',
      slug: 'getting-started',
      description: 'Learn the essentials of using the Acme platform.',
      orderIndex: 1,
    },
  });

  const catBilling = await prisma.category.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Billing & Invoicing',
      slug: 'billing-invoicing',
      description: 'Details about subscription tiers, GST invoices, and payment methods.',
      orderIndex: 2,
    },
  });

  await prisma.article.create({
    data: {
      organizationId: acmeOrg.id,
      categoryId: catGettingStarted.id,
      authorId: alexOwner.id,
      title: 'Quick Setup: Embedding the Live Chat Widget',
      slug: 'quick-setup-live-chat-widget',
      content: `## Embedding SupportOS Live Chat

To install the SupportOS live chat widget on your web application, add the following script before your closing \`</body>\` tag:

\`\`\`html
<script 
  src="https://cdn.supportos.dev/widget.js" 
  data-inbox-key="inbox_acme_live_49f82d" 
  async>
</script>
\`\`\`

### Identity Verification
For logged-in users, compute an HMAC-SHA256 signature using your secret inbox token to authenticate visitor profiles securely.`,
      status: 'PUBLISHED',
      viewCount: 142,
    },
  });

  await prisma.article.create({
    data: {
      organizationId: acmeOrg.id,
      categoryId: catBilling.id,
      authorId: sarahAdmin.id,
      title: 'Managing Seats and Prorated Invoicing',
      slug: 'managing-seats-prorated-invoicing',
      content: `## Seat Management

When you add team members during an active billing cycle, SupportOS automatically calculates a prorated charge for the remaining days of your monthly subscription.

- **Team Tier**: ₹799 / agent / month
- **Business Tier**: ₹1,499 / agent / month
- **Enterprise**: Custom contract

All invoices include GST details formatted for Indian business tax filing.`,
      status: 'PUBLISHED',
      viewCount: 88,
    },
  });

  // 11. Automation Rules
  await prisma.automationRule.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Auto-Route Invoices to Billing',
      description: 'Automatically routes any conversation containing billing keywords to the Billing team.',
      isActive: true,
      triggerEvent: 'conversation.created',
      conditions: JSON.stringify({
        match: 'any',
        keywords: ['invoice', 'billing', 'refund', 'gst', 'payment'],
      }),
      actions: JSON.stringify({
        assignTeamId: billingTeam.id,
        setPriority: 'HIGH',
        addTags: ['billing-inquiry'],
      }),
    },
  });

  console.log('✅ SupportOS database successfully seeded!');
  console.log('Credentials:');
  console.log('  Admin: alex@acme.com / Password123!');
  console.log('  Agent: vikram@acme.com / Password123!');
  console.log('  Starlight Org (Isolation Test): maya@starlight.com / Password123!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
