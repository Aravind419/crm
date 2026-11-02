import assert from 'assert';
import http from 'http';
import * as crypto from 'crypto';
import { io as ClientIO } from 'socket.io-client';
import { app, server } from '../src/server';
import { prisma } from '../src/prisma';

const TEST_PORT = 4997;

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

async function runSecurityRemediationSuite() {
  console.log('🛡️ Starting SupportOS 14-Point Comprehensive Security Verification Suite...\n');

  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[Remediation Test Server] Bound to http://localhost:${TEST_PORT}`);
      resolve();
    });
  });

  try {
    // 0. Setup: Authenticate Org A (Alex Acme) & Org B (Sarah Starlight)
    const loginA = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'alex@acme.com', password: 'Password123!' },
    });
    assert.strictEqual(loginA.status, 200, 'Org A login must succeed');
    const tokenA = loginA.data.token;
    const headersA = { Authorization: `Bearer ${tokenA}` };

    const loginB = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'maya@starlight.com', password: 'Password123!' },
    });
    assert.strictEqual(loginB.status, 200, 'Org B login must succeed');
    const tokenB = loginB.data.token;
    const headersB = { Authorization: `Bearer ${tokenB}` };
    const agentBId = loginB.data.user.id;

    // Retrieve or create Org A conversation
    const convARes = await request({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: headersA,
    });
    assert.strictEqual(convARes.status, 200);
    const convA = convARes.data.conversations[0];
    assert.ok(convA, 'Org A must have at least one seeded conversation');

    // Retrieve or create Org B conversation
    const convBRes = await request({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: headersB,
    });
    assert.strictEqual(convBRes.status, 200);
    const convB = convBRes.data.conversations[0];
    assert.ok(convB, 'Org B must have at least one seeded conversation');

    // Retrieve Org B Customer & Ticket
    const custBRes = await request({
      method: 'GET',
      path: '/api/v1/customers',
      headers: headersB,
    });
    const custB = custBRes.data.customers[0];

    const ticketBRes = await request({
      method: 'GET',
      path: '/api/v1/tickets',
      headers: headersB,
    });
    const ticketB = ticketBRes.data.tickets[0];

    // Seed Visitor Session for Public Tests
    const visitorRawToken = `vst_audit_${crypto.randomBytes(24).toString('hex')}`;
    const visitorTokenHash = crypto.createHash('sha256').update(visitorRawToken).digest('hex');

    const visitorSession = await prisma.visitorSession.create({
      data: {
        inboxId: convA.inboxId,
        customerId: convA.customerId,
        conversationId: convA.id,
        tokenHash: visitorTokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    console.log('--- TEST CASES 1-6: PUBLIC VISITOR AUTHENTICATION & IDOR DEFENSES ---');

    // Test 1: Public read denied without visitor token
    console.log('1. Testing: Public read denied without visitor token...');
    const test1 = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${convA.id}`,
    });
    assert.strictEqual(test1.status, 403, 'Public read without visitor token must be HTTP 403');
    console.log('   ✅ PASS: Public read denied without visitor token (HTTP 403)');

    // Test 2: Public read allowed with valid visitor token
    console.log('2. Testing: Public read allowed with valid visitor token...');
    const test2 = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${convA.id}`,
      headers: { 'x-visitor-token': visitorRawToken },
    });
    assert.strictEqual(test2.status, 200, 'Public read with valid visitor token must be HTTP 200');
    assert.strictEqual(test2.data.conversation.id, convA.id);
    console.log('   ✅ PASS: Public read allowed with valid visitor token (HTTP 200)');

    // Test 3: Public read denied for expired visitor token
    console.log('3. Testing: Public read denied for expired visitor token...');
    // Create an expired visitor token
    const expiredToken = `vst_expired_${crypto.randomBytes(20).toString('hex')}`;
    const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
    await prisma.visitorSession.create({
      data: {
        inboxId: convA.inboxId,
        customerId: convA.customerId,
        conversationId: convA.id,
        tokenHash: expiredHash,
        expiresAt: new Date(Date.now() - 60 * 1000), // Expired 1 minute ago
      },
    });
    const test3 = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${convA.id}`,
      headers: { 'x-visitor-token': expiredToken },
    });
    assert.strictEqual(test3.status, 403, 'Expired visitor token must be HTTP 403');
    console.log('   ✅ PASS: Public read denied for expired visitor token (HTTP 403)');

    // Test 4: Public write denied without visitor token
    console.log('4. Testing: Public write denied without visitor token...');
    const test4 = await request({
      method: 'POST',
      path: `/api/v1/public/conversations/${convA.id}/messages`,
      body: { message: 'Attempt unauthorized visitor post' },
    });
    assert.strictEqual(test4.status, 403, 'Public write without token must be HTTP 403');
    console.log('   ✅ PASS: Public write denied without visitor token (HTTP 403)');

    // Test 5: Public write denied for invalid visitor token
    console.log('5. Testing: Public write denied for invalid visitor token...');
    const test5 = await request({
      method: 'POST',
      path: `/api/v1/public/conversations/${convA.id}/messages`,
      headers: { 'x-visitor-token': 'invalid_forged_random_token_12345' },
      body: { message: 'Forged visitor token post attempt' },
    });
    assert.strictEqual(test5.status, 403, 'Public write with forged token must be HTTP 403');
    console.log('   ✅ PASS: Public write denied for invalid visitor token (HTTP 403)');

    // Test 6: Public write denied to foreign conversation
    console.log('6. Testing: Public write denied to foreign conversation...');
    const test6 = await request({
      method: 'POST',
      path: `/api/v1/public/conversations/${convB.id}/messages`,
      headers: { 'x-visitor-token': visitorRawToken }, // Token is only valid for convA
      body: { message: 'Cross-conversation spoofing injection' },
    });
    assert.strictEqual(test6.status, 403, 'Visitor token bound to Conv A cannot post to Conv B');
    console.log('   ✅ PASS: Public write denied to foreign conversation (HTTP 403)');

    console.log('\n--- TEST CASES 7-11: TENANT ISOLATION & FOREIGN-KEY TAMPER DEFENSES ---');

    // Test 7: Agent denied cross-tenant conversation read
    console.log('7. Testing: Agent denied cross-tenant conversation read...');
    const test7 = await request({
      method: 'GET',
      path: `/api/v1/conversations/${convB.id}`,
      headers: headersA,
    });
    assert.strictEqual(test7.status, 404, 'Cross-tenant conversation read must return 404');
    console.log('   ✅ PASS: Agent denied cross-tenant conversation read (HTTP 404)');

    // Test 8: Agent denied cross-tenant conversation write
    console.log('8. Testing: Agent denied cross-tenant conversation write...');
    const test8 = await request({
      method: 'POST',
      path: `/api/v1/conversations/${convB.id}/messages`,
      headers: headersA,
      body: { content: 'Cross-tenant message injection', messageType: 'PUBLIC_REPLY' },
    });
    assert.strictEqual(test8.status, 404, 'Cross-tenant message post must return 404');
    console.log('   ✅ PASS: Agent denied cross-tenant conversation write (HTTP 404)');

    // Test 9: Agent denied cross-tenant customer update
    console.log('9. Testing: Agent denied cross-tenant customer update...');
    const test9 = await request({
      method: 'PATCH',
      path: `/api/v1/customers/${custB.id}`,
      headers: headersA,
      body: { name: 'Customer profile compromised by Org A' },
    });
    assert.strictEqual(test9.status, 404, 'Cross-tenant customer update must return 404');
    console.log('   ✅ PASS: Agent denied cross-tenant customer update (HTTP 404)');

    // Test 10: Agent denied cross-tenant ticket modification
    console.log('10. Testing: Agent denied cross-tenant ticket modification...');
    const test10 = await request({
      method: 'PATCH',
      path: `/api/v1/tickets/${ticketB.id}`,
      headers: headersA,
      body: { status: 'RESOLVED', priority: 'LOW' },
    });
    assert.strictEqual(test10.status, 404, 'Cross-tenant ticket modification must return 404');
    console.log('   ✅ PASS: Agent denied cross-tenant ticket modification (HTTP 404)');

    // Test 11: Agent cannot assign foreign tenant agent to conversation
    console.log('11. Testing: Agent cannot assign foreign tenant agent to conversation...');
    const test11 = await request({
      method: 'PATCH',
      path: `/api/v1/conversations/${convA.id}`,
      headers: headersA,
      body: { assigneeId: agentBId }, // Attempting to assign Sarah (Org B) to Acme (Org A)
    });
    assert.strictEqual(test11.status, 400, 'Cross-tenant agent assignment must be blocked with 400 Bad Request');
    console.log('   ✅ PASS: Agent cannot assign foreign tenant agent to conversation (HTTP 400)');

    console.log('\n--- TEST CASES 12-13: REAL-TIME WEBSOCKET SECURITY & ROOM ACCESS ---');

    // Test 12: WebSocket room join rejected without auth
    console.log('12. Testing: WebSocket connection rejected without auth...');
    const unauthSocketResult = await new Promise<string>((res) => {
      const sock = ClientIO(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 2000,
      });

      sock.on('connect', () => {
        sock.disconnect();
        res('CONNECTED');
      });

      sock.on('connect_error', (err) => {
        sock.disconnect();
        res(err.message);
      });
    });
    assert.ok(
      unauthSocketResult.includes('Authentication') || unauthSocketResult.includes('failed') || unauthSocketResult.includes('required'),
      `Unauthenticated socket connection must fail. Got: ${unauthSocketResult}`
    );
    console.log('   ✅ PASS: WebSocket connection rejected without auth');

    // Test 13: Visitor cannot join another visitor's conversation room
    console.log("13. Testing: Visitor cannot join another visitor's conversation room...");
    const unauthorizedRoomJoin = await new Promise<string>((res) => {
      // Connect as verified visitor for convA
      const sock = ClientIO(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        auth: {
          visitorToken: visitorRawToken,
          conversationId: convA.id,
        },
        reconnection: false,
      });

      sock.on('connect', () => {
        // Attempt to join conversation B's room
        sock.emit('join:conversation', convB.id);
      });

      sock.on('error:unauthorized', (data: any) => {
        sock.disconnect();
        res(data.message);
      });

      setTimeout(() => {
        sock.disconnect();
        res('TIMEOUT');
      }, 2000);
    });
    assert.ok(
      unauthorizedRoomJoin.includes('Visitor cannot access other conversations') || unauthorizedRoomJoin.includes('unauthorized'),
      `Visitor must be blocked from joining foreign conversation room. Result: ${unauthorizedRoomJoin}`
    );
    console.log("   ✅ PASS: Visitor cannot join another visitor's conversation room");

    console.log('\n--- TEST CASE 14: SUBSCRIPTION PLAN TAMPERING DEFENSE ---');

    // Test 14: Organization plan tampering rejected on PATCH /organizations/current
    console.log('14. Testing: Organization plan tampering rejected on PATCH /organizations/current...');
    const test14 = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: headersA,
      body: { plan: 'ENTERPRISE' },
    });
    assert.strictEqual(test14.status, 403, 'Direct client plan tampering must be rejected with HTTP 403 Forbidden');
    console.log('   ✅ PASS: Organization plan tampering rejected on PATCH /organizations/current (HTTP 403)');

    console.log('\n================================================================');
    console.log('🏆 ALL 14 CRITICAL SECURITY AUDIT REMEDIATION TEST CASES PASSED!');
    console.log('================================================================');

    process.exit(0);
  } finally {
    server.close();
  }
}

runSecurityRemediationSuite().catch((err) => {
  console.error('\n❌ Security Remediation Test Suite Failed:', err);
  process.exit(1);
});
