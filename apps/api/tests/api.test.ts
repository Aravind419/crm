import assert from 'assert';
import http from 'http';
import { app, server } from '../src/server';
import { prisma } from '../src/prisma';

const TEST_PORT = 4999;

function request(options: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = options.body ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        hostname: 'localhost',
        port: TEST_PORT,
        path: options.path,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode || 500, data });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting SupportOS API Integration & Security Test Suite...\n');

  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[Test Server] Running on http://localhost:${TEST_PORT}`);
      resolve();
    });
  });

  try {
    // 1. Health Check
    console.log('1. Testing Health Check...');
    const health = await request({ method: 'GET', path: '/health' });
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.product, 'SupportOS');
    console.log('   ✅ Health Check passed.');

    // 2. Authentication: Login with bcrypt / secure credentials
    console.log('2. Testing Agent Login with secure authentication (alex@acme.com)...');
    const login = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {
        email: 'alex@acme.com',
        password: 'Password123!',
      },
    });
    assert.strictEqual(login.status, 200);
    assert.ok(login.data.token, 'Token should be returned');
    assert.strictEqual(login.data.user.role, 'OWNER');
    const token = login.data.token;
    const authHeaders = { Authorization: `Bearer ${token}` };
    console.log('   ✅ Login passed.');

    // 3. User Session Profile: /api/v1/auth/me
    console.log('3. Testing /api/v1/auth/me...');
    const me = await request({ method: 'GET', path: '/api/v1/auth/me', headers: authHeaders });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.data.user.email, 'alex@acme.com');
    assert.strictEqual(me.data.organization.slug, 'acme');
    console.log('   ✅ User session profile verified.');

    // 4. Conversation Feed
    console.log('4. Testing Conversation Listing & Filters...');
    const convs = await request({ method: 'GET', path: '/api/v1/conversations', headers: authHeaders });
    assert.strictEqual(convs.status, 200);
    assert.ok(Array.isArray(convs.data.conversations));
    assert.ok(convs.data.conversations.length >= 1, 'Should have active conversations');
    const testConvId = convs.data.conversations[0].id;
    console.log(`   ✅ Found ${convs.data.conversations.length} active conversations.`);

    // 5. Post Internal Note & Public Reply
    console.log('5. Testing Dual-Mode Message Posting (Public vs Private Note)...');
    const privateNote = await request({
      method: 'POST',
      path: `/api/v1/conversations/${testConvId}/messages`,
      headers: authHeaders,
      body: {
        content: 'Confidential investigation note: verifying telemetry metrics.',
        messageType: 'INTERNAL_NOTE',
      },
    });
    assert.strictEqual(privateNote.status, 201);
    assert.strictEqual(privateNote.data.message.messageType, 'INTERNAL_NOTE');

    const publicReply = await request({
      method: 'POST',
      path: `/api/v1/conversations/${testConvId}/messages`,
      headers: authHeaders,
      body: {
        content: 'Hi! We have escalated this to our operations team.',
        messageType: 'PUBLIC_REPLY',
      },
    });
    assert.strictEqual(publicReply.status, 201);
    assert.strictEqual(publicReply.data.message.messageType, 'PUBLIC_REPLY');
    console.log('   ✅ Dual-mode messaging verified.');

    // 6. Structured Ticket Creation & Lifecycle
    console.log('6. Testing Ticket Creation & Status Updates...');
    const newTicket = await request({
      method: 'POST',
      path: '/api/v1/tickets',
      headers: authHeaders,
      body: {
        conversationId: testConvId,
        customerId: convs.data.conversations[0].customerId,
        title: 'Audit Verification Ticket',
        description: 'Verifying end-to-end ticket lifecycle post-audit.',
        priority: 'HIGH',
      },
    });
    assert.strictEqual(newTicket.status, 201);
    assert.ok(newTicket.data.ticket.ticketNumber >= 1000);
    const ticketId = newTicket.data.ticket.id;

    const updateTicket = await request({
      method: 'PATCH',
      path: `/api/v1/tickets/${ticketId}`,
      headers: authHeaders,
      body: { status: 'RESOLVED', priority: 'URGENT' },
    });
    assert.strictEqual(updateTicket.status, 200);
    assert.strictEqual(updateTicket.data.ticket.status, 'RESOLVED');
    console.log(`   ✅ Ticket #${newTicket.data.ticket.ticketNumber} created and resolved.`);

    // 7. Public Live Chat Widget Ingestion & Token Defense
    console.log('7. Testing Embeddable Widget Ingestion & IDOR Defenses...');
    const visitorSessionToken = 'vis_test_session_token_' + Date.now();
    const visitorConv = await request({
      method: 'POST',
      path: '/api/v1/public/conversations',
      body: {
        inboxKey: 'inbox_acme_live_49f82d',
        visitorToken: visitorSessionToken,
        name: 'Audit Visitor',
        email: 'audit.visitor@example.com',
        message: 'Hello, testing secure session isolation in widget!',
      },
    });
    assert.strictEqual(visitorConv.status, 201);
    const visitorConvId = visitorConv.data.conversationId;

    // A) Rogue request with NO visitor token MUST be rejected with 403 Forbidden
    const unauthFetch = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${visitorConvId}`,
    });
    assert.strictEqual(unauthFetch.status, 403, 'Unauthorized conversation read without visitor token must be 403');
    console.log('   ✅ IDOR defense verified: Unauthenticated conversation query blocked with 403.');

    // B) Authorized request with correct server-generated visitor token MUST succeed
    const authFetch = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${visitorConvId}`,
      headers: { 'x-visitor-token': visitorConv.data.visitorToken },
    });
    assert.strictEqual(authFetch.status, 200);
    assert.ok(
      authFetch.data.conversation.messages.every((m: any) => m.messageType !== 'INTERNAL_NOTE'),
      'Visitors must never see internal notes'
    );
    console.log('   ✅ Authorized visitor query succeeded & internal note privacy boundary intact.');

    // 8. Public Knowledge Base Portal
    console.log('8. Testing Public Knowledge Base Portal...');
    const portal = await request({
      method: 'GET',
      path: '/api/v1/public/portal/acme',
    });
    assert.strictEqual(portal.status, 200);
    assert.strictEqual(portal.data.organization.name, 'Acme Cloud Technologies');
    assert.ok(portal.data.categories.length >= 1);
    console.log('   ✅ Public Knowledge Base portal verified.');

    // 9. Reporting Overview Metrics
    console.log('9. Testing Operational Reporting Metrics...');
    const reports = await request({ method: 'GET', path: '/api/v1/reports/overview', headers: authHeaders });
    assert.strictEqual(reports.status, 200);
    assert.ok(reports.data.metrics.totalConversations > 0);
    assert.ok(Array.isArray(reports.data.agents));
    console.log(`   ✅ Reporting metrics verified (Total Conversations: ${reports.data.metrics.totalConversations}).`);

    console.log('\n🎉 ALL CORE API & SECURITY REMEDIATION TESTS PASSED!');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      require('fs').appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### ❌ API Test Suite Failure\n\`\`\`\n${err.stack || err.message}\n\`\`\`\n`
      );
    } catch (_) {}
  }
  process.exit(1);
});
