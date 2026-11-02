import assert from 'assert';
import http from 'http';
import * as crypto from 'crypto';
import { io as ClientIO } from 'socket.io-client';
import { app, server } from '../src/server';
import { prisma } from '../src/prisma';
import { config, validateSecurityConfig } from '../src/config';
import { disconnectVisitorSockets, disconnectUserSockets } from '../src/services/socket.service';
import { rateLimiter } from '../src/middleware/rate-limiter';

const TEST_PORT = 4996;

function request(options: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: any;
  rawBody?: Buffer;
}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = options.rawBody || (options.body ? Buffer.from(JSON.stringify(options.body)) : undefined);
    const req = http.request(
      {
        hostname: 'localhost',
        port: TEST_PORT,
        path: options.path,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
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
  console.log('🛡️ Starting SupportOS Rigorous Comprehensive Security Verification Suite...\n');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Refusing to execute test suite in production environment (NODE_ENV=production)');
  }
  if (
    process.env.DATABASE_URL &&
    process.env.DATABASE_URL.includes('prod') &&
    !process.env.DATABASE_URL.includes('prod_test')
  ) {
    throw new Error('FATAL: Refusing to execute test suite against production database URL');
  }

  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[Remediation Test Server] Bound to http://localhost:${TEST_PORT}`);
      resolve();
    });
  });

  const createdSessionIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdWebhookEventIds: string[] = [];

  try {
    // 0. Setup: Authenticate Org A (Alex Acme) & Org B (Maya Starlight)
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

    // Retrieve Org A conversation
    const convARes = await request({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: headersA,
    });
    assert.strictEqual(convARes.status, 200);
    const convA = convARes.data.conversations[0];
    assert.ok(convA, 'Org A must have at least one seeded conversation');
    const inboxA = await prisma.inbox.findUnique({ where: { id: convA.inboxId } });
    const inboxAKey = inboxA?.inboxKey || 'inbox_acme_web';

    // Retrieve Org B conversation
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

    // Seed Isolated Visitor Session for Public Tests
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
    createdSessionIds.push(visitorSession.id);

    console.log('--- SECTION 1: VISITOR SESSION AUTHENTICATION & IDOR DEFENSES ---');

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
    const expiredToken = `vst_expired_${crypto.randomBytes(20).toString('hex')}`;
    const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
    const expiredSession = await prisma.visitorSession.create({
      data: {
        inboxId: convA.inboxId,
        customerId: convA.customerId,
        conversationId: convA.id,
        tokenHash: expiredHash,
        expiresAt: new Date(Date.now() - 60 * 1000), // Expired 1 minute ago
      },
    });
    createdSessionIds.push(expiredSession.id);

    const test3 = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${convA.id}`,
      headers: { 'x-visitor-token': expiredToken },
    });
    assert.strictEqual(test3.status, 403, 'Expired visitor token must be HTTP 403');
    console.log('   ✅ PASS: Public read denied for expired visitor token (HTTP 403)');

    // Test 4: Public read denied for revoked visitor token
    console.log('4. Testing: Public read denied for revoked visitor token...');
    const revokedToken = `vst_revoked_${crypto.randomBytes(20).toString('hex')}`;
    const revokedHash = crypto.createHash('sha256').update(revokedToken).digest('hex');
    const revokedSession = await prisma.visitorSession.create({
      data: {
        inboxId: convA.inboxId,
        customerId: convA.customerId,
        conversationId: convA.id,
        tokenHash: revokedHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revokedAt: new Date(), // Revoked immediately
      },
    });
    createdSessionIds.push(revokedSession.id);

    const test4 = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${convA.id}`,
      headers: { 'x-visitor-token': revokedToken },
    });
    assert.strictEqual(test4.status, 403, 'Revoked visitor token must be HTTP 403');
    console.log('   ✅ PASS: Public read denied for revoked visitor token (HTTP 403)');

    // Test 5: Legacy plaintext token stored in customer.customAttributes cannot authenticate
    console.log('5. Testing: Legacy plaintext token in customer.customAttributes rejected (no fallback)...');
    const legacyPlaintextToken = `legacy_plain_${crypto.randomBytes(16).toString('hex')}`;
    const origCustomer = await prisma.customer.findUnique({ where: { id: convA.customerId } });
    const originalCustomAttributes = origCustomer?.customAttributes || null;

    // Inject into customer custom attributes
    await prisma.customer.update({
      where: { id: convA.customerId },
      data: { customAttributes: JSON.stringify({ visitorToken: legacyPlaintextToken }) },
    });

    const test5 = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${convA.id}`,
      headers: { 'x-visitor-token': legacyPlaintextToken },
    });
    assert.strictEqual(test5.status, 403, 'Plaintext token in customAttributes must be rejected with 403');
    console.log('   ✅ PASS: Legacy plaintext token rejected without SHA-256 VisitorSession record (HTTP 403)');

    // Restore original customer customAttributes immediately
    await prisma.customer.update({
      where: { id: convA.customerId },
      data: { customAttributes: originalCustomAttributes },
    });

    // Test 6: Public write denied without visitor token
    console.log('6. Testing: Public write denied without visitor token...');
    const test6 = await request({
      method: 'POST',
      path: `/api/v1/public/conversations/${convA.id}/messages`,
      body: { message: 'Attempt unauthorized visitor post' },
    });
    assert.strictEqual(test6.status, 403, 'Public write without token must be HTTP 403');
    console.log('   ✅ PASS: Public write denied without visitor token (HTTP 403)');

    // Test 7: Public write denied for invalid visitor token
    console.log('7. Testing: Public write denied for invalid visitor token...');
    const test7 = await request({
      method: 'POST',
      path: `/api/v1/public/conversations/${convA.id}/messages`,
      headers: { 'x-visitor-token': 'invalid_forged_random_token_12345' },
      body: { message: 'Forged visitor token post attempt' },
    });
    assert.strictEqual(test7.status, 403, 'Public write with forged token must be HTTP 403');
    console.log('   ✅ PASS: Public write denied for invalid visitor token (HTTP 403)');

    // Test 8: Public write denied to foreign conversation (cross-conversation binding defense)
    console.log('8. Testing: Public write denied to foreign conversation...');
    const test8 = await request({
      method: 'POST',
      path: `/api/v1/public/conversations/${convB.id}/messages`,
      headers: { 'x-visitor-token': visitorRawToken }, // Token is only valid for convA
      body: { message: 'Cross-conversation spoofing injection' },
    });
    assert.strictEqual(test8.status, 403, 'Visitor token bound to Conv A cannot post to Conv B');
    console.log('   ✅ PASS: Public write denied to foreign conversation (HTTP 403)');

    // Test 9: Visitor session with null conversationId strictly denied
    console.log('9. Testing: Visitor session with null conversationId strictly denied...');
    const unboundToken = `vst_unbound_${crypto.randomBytes(20).toString('hex')}`;
    const unboundHash = crypto.createHash('sha256').update(unboundToken).digest('hex');
    const unboundSession = await prisma.visitorSession.create({
      data: {
        inboxId: convA.inboxId,
        customerId: convA.customerId,
        conversationId: null, // Null conversation binding
        tokenHash: unboundHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    createdSessionIds.push(unboundSession.id);

    const test9 = await request({
      method: 'GET',
      path: `/api/v1/public/conversations/${convA.id}`,
      headers: { 'x-visitor-token': unboundToken },
    });
    assert.strictEqual(test9.status, 403, 'Unbound visitor session with null conversationId must be HTTP 403');
    console.log('   ✅ PASS: Visitor session with null conversationId strictly denied (HTTP 403)');

    console.log('\n--- SECTION 2: TENANT ISOLATION & FOREIGN-KEY TAMPER DEFENSES ---');

    // Test 10: Agent denied cross-tenant conversation read
    console.log('10. Testing: Agent denied cross-tenant conversation read...');
    const test10 = await request({
      method: 'GET',
      path: `/api/v1/conversations/${convB.id}`,
      headers: headersA,
    });
    assert.strictEqual(test10.status, 404, 'Cross-tenant conversation read must return 404');
    console.log('   ✅ PASS: Agent denied cross-tenant conversation read (HTTP 404)');

    // Test 11: Agent denied cross-tenant conversation write
    console.log('11. Testing: Agent denied cross-tenant conversation write...');
    const test11 = await request({
      method: 'POST',
      path: `/api/v1/conversations/${convB.id}/messages`,
      headers: headersA,
      body: { content: 'Cross-tenant message injection', messageType: 'PUBLIC_REPLY' },
    });
    assert.strictEqual(test11.status, 404, 'Cross-tenant message post must return 404');
    console.log('   ✅ PASS: Agent denied cross-tenant conversation write (HTTP 404)');

    // Test 12: Agent denied cross-tenant customer update
    console.log('12. Testing: Agent denied cross-tenant customer update...');
    const test12 = await request({
      method: 'PATCH',
      path: `/api/v1/customers/${custB.id}`,
      headers: headersA,
      body: { name: 'Customer profile compromised by Org A' },
    });
    assert.strictEqual(test12.status, 404, 'Cross-tenant customer update must return 404');
    console.log('   ✅ PASS: Agent denied cross-tenant customer update (HTTP 404)');

    // Test 13: Agent denied cross-tenant ticket modification
    console.log('13. Testing: Agent denied cross-tenant ticket modification...');
    const test13 = await request({
      method: 'PATCH',
      path: `/api/v1/tickets/${ticketB.id}`,
      headers: headersA,
      body: { status: 'RESOLVED', priority: 'LOW' },
    });
    assert.strictEqual(test13.status, 404, 'Cross-tenant ticket modification must return 404');
    console.log('   ✅ PASS: Agent denied cross-tenant ticket modification (HTTP 404)');

    // Test 14: Agent cannot assign foreign tenant agent to conversation
    console.log('14. Testing: Agent cannot assign foreign tenant agent to conversation...');
    const test14 = await request({
      method: 'PATCH',
      path: `/api/v1/conversations/${convA.id}`,
      headers: headersA,
      body: { assigneeId: agentBId }, // Attempting to assign Maya (Org B) to Acme (Org A)
    });
    assert.strictEqual(test14.status, 400, 'Cross-tenant agent assignment must be blocked with 400 Bad Request');
    console.log('   ✅ PASS: Agent cannot assign foreign tenant agent to conversation (HTTP 400)');

    console.log('\n--- SECTION 3: REAL-TIME WEBSOCKET ORIGIN & ROOM SECURITY ---');

    // Test 15: WebSocket connection rejected without auth
    console.log('15. Testing: WebSocket connection rejected without auth...');
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

    // Test 16: Agent WebSocket connection rejected from unauthorized origin
    console.log('16. Testing: Agent WebSocket rejected from unauthorized third-party origin...');
    const unauthorizedOriginResult = await new Promise<string>((res) => {
      const sock = ClientIO(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        auth: { token: tokenA },
        extraHeaders: { origin: 'https://malicious-attacker-site.com' },
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
      unauthorizedOriginResult.includes('unauthorized origin') || unauthorizedOriginResult.includes('Authentication failed'),
      `Agent socket from unauthorized origin must be rejected. Got: ${unauthorizedOriginResult}`
    );
    console.log('   ✅ PASS: Agent WebSocket connection rejected from unauthorized origin');

    // Test 17: Visitor cannot join another visitor's conversation room
    console.log("17. Testing: Visitor cannot join another visitor's conversation room...");
    const unauthorizedRoomJoin = await new Promise<string>((res) => {
      const sock = ClientIO(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        auth: {
          visitorToken: visitorRawToken,
          conversationId: convA.id,
        },
        reconnection: false,
      });

      sock.on('connect', () => {
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

    // Test 18: Active visitor WebSocket immediately severed upon session revocation
    console.log('18. Testing: Active visitor WebSocket immediately severed on session revocation...');
    const liveConvRes = await request({
      method: 'POST',
      path: '/api/v1/public/conversations',
      body: {
        inboxKey: inboxAKey,
        customerEmail: `visitor_live_${Date.now()}@example.com`,
        customerName: 'Live Visitor',
        message: 'Hello, need real-time support',
      },
    });
    assert.strictEqual(liveConvRes.status, 201);
    const liveConvId = liveConvRes.data.conversationId;
    const liveVisitorToken = liveConvRes.data.visitorToken;

    let receivedMessagesAfterRevoke = 0;
    let receivedRevokeEvent = false;

    const liveSocket = ClientIO(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      auth: {
        visitorToken: liveVisitorToken,
        conversationId: liveConvId,
      },
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Live socket connection timed out')), 3000);
      liveSocket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      liveSocket.on('connect_error', reject);
    });

    liveSocket.on('error:session_revoked', () => {
      receivedRevokeEvent = true;
    });

    liveSocket.on('message:created', () => {
      receivedMessagesAfterRevoke++;
    });

    // Call POST /api/v1/public/sessions/revoke
    const revokeRes = await request({
      method: 'POST',
      path: '/api/v1/public/sessions/revoke',
      headers: { 'x-visitor-token': liveVisitorToken },
    });
    assert.strictEqual(revokeRes.status, 200);

    // Allow time for server disconnection propagation
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(liveSocket.connected, false, 'Socket must be disconnected after session revocation');
    assert.ok(receivedRevokeEvent, 'Socket must receive error:session_revoked event');

    // Agent sends a new message to this conversation
    await request({
      method: 'POST',
      path: `/api/v1/conversations/${liveConvId}/messages`,
      headers: headersA,
      body: {
        content: 'Confidential agent message after visitor revoked',
        messageType: 'PUBLIC_REPLY',
      },
    });

    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(receivedMessagesAfterRevoke, 0, 'Revoked visitor socket must receive zero messages');

    // Attempting to reconnect with revoked token must fail
    const reconnectAttempt = await new Promise<string>((res) => {
      const sock = ClientIO(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        auth: {
          visitorToken: liveVisitorToken,
          conversationId: liveConvId,
        },
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
      reconnectAttempt.includes('revoked') || reconnectAttempt.includes('Authentication failed'),
      `Reconnection with revoked token must fail. Got: ${reconnectAttempt}`
    );
    console.log('   ✅ PASS: Active visitor socket severed immediately on revocation & blocked from re-connecting');

    // Test 19: Deactivated agent account severed from WebSocket in real-time
    console.log('19. Testing: Deactivated agent account severed from WebSocket in real-time...');
    const deactAgentEmail = `deact_agent_${Date.now()}@acme.com`;
    const deactAgentRes = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: headersA,
      body: {
        email: deactAgentEmail,
        firstName: 'Deact',
        lastName: 'Agent',
        role: 'AGENT',
        initialPassword: 'TempPassword123!',
      },
    });
    assert.strictEqual(deactAgentRes.status, 201);
    const deactAgentId = deactAgentRes.data.user.id;
    createdUserIds.push(deactAgentId);

    const deactAgentLogin = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: deactAgentEmail, password: 'TempPassword123!' },
    });
    assert.strictEqual(deactAgentLogin.status, 200);
    const deactAgentToken = deactAgentLogin.data.token;

    let receivedDeactEvent = false;
    const deactAgentSocket = ClientIO(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      auth: { token: deactAgentToken },
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Deact agent socket connection timed out')), 3000);
      deactAgentSocket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      deactAgentSocket.on('connect_error', reject);
    });

    deactAgentSocket.on('error:account_deactivated', () => {
      receivedDeactEvent = true;
    });

    // Admin deactivates the agent
    const deactRes = await request({
      method: 'PATCH',
      path: `/api/v1/users/${deactAgentId}/status`,
      headers: headersA,
      body: { status: 'DEACTIVATED' },
    });
    assert.strictEqual(deactRes.status, 200);

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(deactAgentSocket.connected, false, 'Deactivated agent socket must be severed immediately');
    assert.ok(receivedDeactEvent, 'Agent must receive error:account_deactivated event');

    // Deactivated agent cannot log in again
    const deactLoginAttempt = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: deactAgentEmail, password: 'TempPassword123!' },
    });
    assert.strictEqual(deactLoginAttempt.status, 403, 'Deactivated agent login must be rejected with 403 Forbidden');
    console.log('   ✅ PASS: Deactivated agent severed from WebSocket and subsequent logins rejected (HTTP 403)');

    console.log('\n--- SECTION 4: AUTHENTICATION IMPROVEMENTS & ATOMIC REFRESH TOKENS ---');

    // Test 20: Organization plan tampering rejected on PATCH /organizations/current
    console.log('20. Testing: Organization plan tampering rejected on PATCH /organizations/current...');
    const test20 = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: headersA,
      body: { plan: 'ENTERPRISE' },
    });
    assert.strictEqual(test20.status, 403, 'Direct client plan tampering must be rejected with HTTP 403 Forbidden');
    console.log('   ✅ PASS: Organization plan tampering rejected on PATCH /organizations/current (HTTP 403)');

    // Test 21: Dynamic legacy SHA-256 hash upgrade to bcrypt on login
    console.log('21. Testing: Dynamic legacy SHA-256 hash upgrade to bcrypt on login...');
    const legacyEmail = `legacy_${Date.now()}@example.com`;
    const legacyPass = 'LegacyPassword123!';
    const legacySha256Hash = crypto.createHash('sha256').update(legacyPass + 'supportos_salt_2026').digest('hex');

    const legacyUser = await prisma.user.create({
      data: {
        organizationId: convA.organizationId,
        email: legacyEmail,
        passwordHash: legacySha256Hash, // Seeded with old SHA-256 hash
        firstName: 'Legacy',
        lastName: 'Account',
        role: 'AGENT',
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(legacyUser.id);

    const legacyLogin = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: legacyEmail, password: legacyPass },
    });
    assert.strictEqual(legacyLogin.status, 200, 'Legacy login must succeed');

    const upgradedUser = await prisma.user.findUnique({ where: { id: legacyUser.id } });
    assert.ok(
      upgradedUser?.passwordHash.startsWith('$2a$') || upgradedUser?.passwordHash.startsWith('$2b$'),
      'Password hash must be dynamically upgraded to bcrypt ($2a$/$2b$)'
    );
    console.log('   ✅ PASS: Legacy password hash successfully upgraded to bcrypt automatically');

    // Test 22: Atomic refresh token rotation & concurrent reuse rejection
    console.log('22. Testing: Atomic refresh token rotation prevents concurrent reuse...');
    const initialRefresh = legacyLogin.data.refreshToken;
    assert.ok(initialRefresh, 'Login must yield a valid refresh token');

    // Create an unrelated second device session for the same user
    const secondDeviceRefresh = await (await import('../src/routes/auth.routes')).createRefreshToken(legacyUser.id);

    // Fire 2 concurrent refresh requests with the EXACT SAME refresh token
    const [refreshRes1, refreshRes2] = await Promise.all([
      request({
        method: 'POST',
        path: '/api/v1/auth/refresh',
        body: { refreshToken: initialRefresh },
      }),
      request({
        method: 'POST',
        path: '/api/v1/auth/refresh',
        body: { refreshToken: initialRefresh },
      }),
    ]);

    // Exactly one must succeed (200) and the other must be rejected (401)
    const statuses = [refreshRes1.status, refreshRes2.status].sort();
    assert.deepStrictEqual(statuses, [200, 401], 'Exactly one concurrent refresh must succeed; the other must fail (CAS)');

    // Winning replacement token remains completely usable!
    const winningToken = refreshRes1.status === 200 ? refreshRes1.data.refreshToken : refreshRes2.data.refreshToken;
    const winningRefreshAttempt = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: winningToken },
    });
    assert.strictEqual(winningRefreshAttempt.status, 200, 'Winning replacement token must remain usable');

    // Unrelated device session remains completely valid!
    const secondDeviceAttempt = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: secondDeviceRefresh },
    });
    assert.strictEqual(secondDeviceAttempt.status, 200, 'Unrelated device session must remain completely valid');
    console.log('   ✅ PASS: Atomic CAS refresh token rotation protects concurrent winners and unrelated device sessions');

    // Test 23: Revoked refresh token cannot be refreshed
    console.log('23. Testing: Revoked refresh token cannot be refreshed...');
    const activeRefresh = winningRefreshAttempt.data.refreshToken;
    // Explicitly logout / revoke
    await request({
      method: 'POST',
      path: '/api/v1/auth/logout',
      body: { refreshToken: activeRefresh },
    });

    const revokedRefreshAttempt = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: activeRefresh },
    });
    assert.strictEqual(revokedRefreshAttempt.status, 401, 'Revoked refresh token must be rejected with 401');
    console.log('   ✅ PASS: Revoked refresh token rejected on refresh attempt (HTTP 401)');

    // Test 24: Token family tracking & targeted invalidation on genuine reuse attack
    console.log('24. Testing: Stolen refresh token reuse revokes ONLY compromised family, preserving other devices...');
    const tfUserEmail = `tf_user_${Date.now()}@example.com`;
    const tfUserPass = 'SecurePass123!';
    const tfHash = await (await import('bcryptjs')).default.hash(tfUserPass, 10);
    const tfUser = await prisma.user.create({
      data: {
        organizationId: convA.organizationId,
        email: tfUserEmail,
        passwordHash: tfHash,
        firstName: 'Family',
        lastName: 'TokenUser',
        role: 'AGENT',
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(tfUser.id);

    // Device Session 1 (Device A)
    const tfLoginA = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: tfUserEmail, password: tfUserPass },
    });
    assert.strictEqual(tfLoginA.status, 200);
    const tokenA1 = tfLoginA.data.refreshToken;

    // Device Session 2 (Device B - Unrelated session)
    const tfLoginB = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: tfUserEmail, password: tfUserPass },
    });
    assert.strictEqual(tfLoginB.status, 200);
    const tokenB1 = tfLoginB.data.refreshToken;

    // Device A rotates: A1 -> A2
    const rotateA = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: tokenA1 },
    });
    assert.strictEqual(rotateA.status, 200);
    const tokenA2 = rotateA.data.refreshToken;

    // Simulate elapsed time outside grace window (> 10 seconds) on token A1 to simulate genuine theft replay
    const tokenA1Hash = crypto.createHash('sha256').update(tokenA1.trim()).digest('hex');
    await prisma.refreshToken.update({
      where: { tokenHash: tokenA1Hash },
      data: { rotatedAt: new Date(Date.now() - 30000) }, // Rotated 30 seconds ago
    });

    // Attacker attempts to replay old token A1!
    const attackerReuse = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: tokenA1 },
    });
    assert.strictEqual(attackerReuse.status, 401, 'Reused refresh token must be rejected');

    // Legitimate Device A attempts to use token A2 - MUST FAIL because Device A's family was revoked!
    const legitA2Attempt = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: tokenA2 },
    });
    assert.strictEqual(legitA2Attempt.status, 401, 'Compromised Device A family must be revoked');

    // Legitimate Device B attempts to use token B1 - MUST SUCCEED because Device B is an unrelated family!
    const legitB1Attempt = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: tokenB1 },
    });
    assert.strictEqual(legitB1Attempt.status, 200, 'Unrelated Device B session MUST remain valid and usable');
    console.log('   ✅ PASS: Token reuse detected & ONLY compromised family revoked; unrelated device preserved');

    console.log('\n--- SECTION 5: STRICT BILLING WEBHOOK PROTOCOL & ATOMIC IDEMPOTENCY ---');

    const testEventId = `evt_billing_${Date.now()}`;
    createdWebhookEventIds.push(testEventId);
    const webhookPayload = JSON.stringify({
      id: testEventId,
      event: 'subscription.updated',
      organizationId: convA.organizationId,
      plan: 'BUSINESS',
      status: 'ACTIVE',
    });
    const webhookRawBuffer = Buffer.from(webhookPayload, 'utf-8');
    const currentTimestamp = Math.floor(Date.now() / 1000).toString();

    // Canonical timestamp-bound signature: HMAC(secret, timestamp + "." + rawBody)
    const validSignature = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(Buffer.concat([Buffer.from(`${currentTimestamp}.`), webhookRawBuffer]))
      .digest('hex');

    // Test 25: Missing timestamp header rejected
    console.log('25. Testing: Billing webhook rejects missing timestamp header...');
    const missingTimestampRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': validSignature,
        'x-billing-event-id': testEventId,
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(missingTimestampRes.status, 400, 'Missing timestamp must return HTTP 400');
    console.log('   ✅ PASS: Missing x-billing-timestamp header rejected with HTTP 400 Bad Request');

    // Test 26: Missing event ID header rejected
    console.log('26. Testing: Billing webhook rejects missing event ID header...');
    const payloadWithoutId = JSON.stringify({
      event: 'subscription.updated',
      organizationId: convA.organizationId,
      plan: 'BUSINESS',
      status: 'ACTIVE',
    });
    const rawWithoutId = Buffer.from(payloadWithoutId, 'utf-8');
    const sigWithoutId = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(Buffer.concat([Buffer.from(`${currentTimestamp}.`), rawWithoutId]))
      .digest('hex');

    const missingEventIdRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': sigWithoutId,
        'x-billing-timestamp': currentTimestamp,
      },
      rawBody: rawWithoutId,
    });
    assert.strictEqual(missingEventIdRes.status, 400, 'Missing event ID must return HTTP 400');
    console.log('   ✅ PASS: Missing unique event ID rejected with HTTP 400 Bad Request');

    // Test 27: Malformed timestamp rejected
    console.log('27. Testing: Billing webhook rejects malformed timestamp...');
    const malformedTimestampRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': validSignature,
        'x-billing-timestamp': 'not-a-number-abc',
        'x-billing-event-id': testEventId,
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(malformedTimestampRes.status, 400, 'Malformed timestamp must return HTTP 400');
    console.log('   ✅ PASS: Malformed timestamp rejected with HTTP 400 Bad Request');

    // Test 28: Expired timestamp (> 300s) rejected
    console.log('28. Testing: Billing webhook rejects expired timestamp outside tolerance...');
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 400s old
    const expiredSig = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(Buffer.concat([Buffer.from(`${expiredTimestamp}.`), webhookRawBuffer]))
      .digest('hex');

    const expiredTimestampRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': expiredSig,
        'x-billing-timestamp': expiredTimestamp,
        'x-billing-event-id': testEventId,
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(expiredTimestampRes.status, 401, 'Expired timestamp must return HTTP 401');
    console.log('   ✅ PASS: Expired webhook timestamp rejected with HTTP 401 Unauthorized');

    // Test 29: Direct-payload signature bypass attempt strictly rejected
    console.log('29. Testing: Direct-payload signature bypass attempt strictly rejected...');
    const directPayloadOnlySig = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(webhookRawBuffer) // Missing canonical timestamp binding!
      .digest('hex');

    const directBypassRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': directPayloadOnlySig,
        'x-billing-timestamp': currentTimestamp,
        'x-billing-event-id': testEventId,
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(directBypassRes.status, 401, 'Direct payload signature must be rejected');
    console.log('   ✅ PASS: Direct payload signature without timestamp binding rejected (HTTP 401)');

    // Test 30: Forged signature rejected
    console.log('30. Testing: Billing webhook rejects forged signature...');
    const forgedRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': 'forged_fake_signature_aabbccddeeff',
        'x-billing-timestamp': currentTimestamp,
        'x-billing-event-id': testEventId,
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(forgedRes.status, 401, 'Forged signature must be rejected');
    console.log('   ✅ PASS: Forged billing webhook signature rejected (HTTP 401)');

    // Test 31: Valid timestamp-bound signature succeeds
    console.log('31. Testing: Valid timestamp-bound webhook processed successfully...');
    const validRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': validSignature,
        'x-billing-timestamp': currentTimestamp,
        'x-billing-event-id': testEventId,
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(validRes.status, 200, 'Valid webhook must return HTTP 200');
    console.log('   ✅ PASS: Valid timestamp-bound webhook processed atomically (HTTP 200)');

    // Verify WebhookEvent uniqueness record stored in database
    const storedWebhookEvent = await prisma.webhookEvent.findUnique({
      where: { eventId: testEventId },
    });
    assert.ok(storedWebhookEvent, 'WebhookEvent row must exist in database with unique eventId');

    // Test 32: Duplicate event rejected via database-level idempotency constraint
    console.log('32. Testing: Duplicate event processed idempotently via database uniqueness...');
    const duplicateRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': validSignature,
        'x-billing-timestamp': currentTimestamp,
        'x-billing-event-id': testEventId, // Reusing same eventId
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(duplicateRes.status, 200);
    assert.strictEqual(duplicateRes.data.idempotent, true, 'Duplicate must return idempotent marker');
    console.log('   ✅ PASS: Duplicate event intercepted via database constraint; processed idempotently');

    // Test 33: Concurrent duplicate requests handled safely and idempotently
    console.log('33. Testing: Concurrent duplicate webhook deliveries handled safely and idempotently...');
    const concurrentEventId = `evt_concurrent_${Date.now()}`;
    createdWebhookEventIds.push(concurrentEventId);
    const concurrentPayload = JSON.stringify({
      id: concurrentEventId,
      event: 'subscription.updated',
      organizationId: convA.organizationId,
      plan: 'BUSINESS',
      status: 'ACTIVE',
    });
    const concurrentRawBuffer = Buffer.from(concurrentPayload, 'utf-8');
    const concurrentTimestamp = Math.floor(Date.now() / 1000).toString();
    const concurrentSig = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(Buffer.concat([Buffer.from(`${concurrentTimestamp}.`), concurrentRawBuffer]))
      .digest('hex');

    const [cRes1, cRes2] = await Promise.all([
      request({
        method: 'POST',
        path: '/api/v1/organizations/billing/webhook',
        headers: {
          'x-billing-signature': concurrentSig,
          'x-billing-timestamp': concurrentTimestamp,
          'x-billing-event-id': concurrentEventId,
        },
        rawBody: concurrentRawBuffer,
      }),
      request({
        method: 'POST',
        path: '/api/v1/organizations/billing/webhook',
        headers: {
          'x-billing-signature': concurrentSig,
          'x-billing-timestamp': concurrentTimestamp,
          'x-billing-event-id': concurrentEventId,
        },
        rawBody: concurrentRawBuffer,
      }),
    ]);

    assert.strictEqual(cRes1.status, 200);
    assert.strictEqual(cRes2.status, 200);
    const hasIdempotent = cRes1.data.idempotent || cRes2.data.idempotent;
    assert.ok(hasIdempotent, 'One of the concurrent duplicate deliveries must return idempotent duplicate');
    console.log('   ✅ PASS: Concurrent duplicate deliveries handled safely without duplicate writes');

    // Test 34: Billing webhook rejects unallowed subscription plan
    console.log('34. Testing: Billing webhook rejects unallowed subscription plan...');
    const invalidPlanPayload = JSON.stringify({
      id: `evt_invalid_${Date.now()}`,
      event: 'subscription.updated',
      organizationId: convA.organizationId,
      plan: 'UNAUTHORIZED_CUSTOM_TIER',
    });
    const invalidPlanRaw = Buffer.from(invalidPlanPayload, 'utf-8');
    const invalidSig = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(Buffer.concat([Buffer.from(`${currentTimestamp}.`), invalidPlanRaw]))
      .digest('hex');

    const invalidPlanRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': invalidSig,
        'x-billing-timestamp': currentTimestamp,
        'x-billing-event-id': `evt_invalid_${Date.now()}`,
      },
      rawBody: invalidPlanRaw,
    });
    assert.strictEqual(invalidPlanRes.status, 400, 'Unallowed plan must return HTTP 400');
    console.log('   ✅ PASS: Billing webhook strictly rejects unallowed subscription plan (HTTP 400)');

    console.log('\n--- SECTION 6: DISTRIBUTED RATE LIMITING & SAFE CLIENT IP DEFENSES ---');

    // Test 35: Client IP resolution ignores spoofed X-Forwarded-For when trustProxy is disabled
    console.log('35. Testing: Client IP resolution ignores spoofed X-Forwarded-For when trustProxy=false...');
    const { resolveClientIp } = await import('../src/middleware/rate-limiter');
    const fakeReq = {
      headers: { 'x-forwarded-for': '203.0.113.195, 198.51.100.1' },
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1',
    } as any;

    const resolvedIpUntrusted = resolveClientIp(fakeReq);
    assert.strictEqual(resolvedIpUntrusted, '127.0.0.1', 'Spoofed X-Forwarded-For must be ignored when trustProxy=false');
    console.log('   ✅ PASS: Spoofed X-Forwarded-For header strictly ignored under default zero-trust proxy setting');

    // Test 36: Distributed rate limiter shares atomic counter state across multiple simulated API instances
    console.log('36. Testing: Distributed rate limiter shares state across multiple simulated API instances...');
    // Create shared in-memory mock Redis to simulate two API nodes connecting to the exact same Redis cluster
    const sharedRedisStore = new Map<string, { value: number; expireMs: number }>();
    const mockRedisClient = {
      status: 'ready',
      async eval(_script: string, _numkeys: number, key: string, windowMsStr: string) {
        const windowMs = parseInt(windowMsStr, 10);
        const existing = sharedRedisStore.get(key);
        if (!existing || Date.now() > existing.expireMs) {
          sharedRedisStore.set(key, { value: 1, expireMs: Date.now() + windowMs });
          return 1;
        }
        existing.value += 1;
        return existing.value;
      },
    };

    const { rateLimiter } = await import('../src/middleware/rate-limiter');
    // Instance 1 & Instance 2 share the same Redis client
    const instance1Limiter = rateLimiter({ windowMs: 10000, max: 2, prefix: 'shared_test', redisClientOverride: mockRedisClient });
    const instance2Limiter = rateLimiter({ windowMs: 10000, max: 2, prefix: 'shared_test', redisClientOverride: mockRedisClient });

    let inst1CallCount = 0;
    let inst2CallCount = 0;
    let inst2Blocked = false;

    const dummyReq = { headers: {}, socket: { remoteAddress: '198.51.100.99' } } as any;
    const dummyRes1 = { setHeader: () => {}, status: () => ({ json: () => {} }) } as any;
    const dummyRes2 = {
      setHeader: () => {},
      status: (code: number) => {
        if (code === 429) inst2Blocked = true;
        return { json: () => {} };
      },
    } as any;

    // Instance 1 receives Request 1
    await instance1Limiter(dummyReq, dummyRes1, () => { inst1CallCount++; });
    // Instance 2 receives Request 2
    await instance2Limiter(dummyReq, dummyRes1, () => { inst2CallCount++; });
    // Instance 2 receives Request 3 -> MUST BE BLOCKED BY SHARED STATE (max: 2)
    await instance2Limiter(dummyReq, dummyRes2, () => {});

    assert.strictEqual(inst1CallCount, 1, 'Instance 1 must have allowed request 1');
    assert.strictEqual(inst2CallCount, 1, 'Instance 2 must have allowed request 2');
    assert.strictEqual(inst2Blocked, true, 'Instance 2 must have blocked request 3 via shared Redis state');
    console.log('   ✅ PASS: Distributed rate limiter correctly synchronizes state across multiple API instances');

    // Test 37: Distributed rate limiter fails safely with 503 when Redis is required but unavailable
    console.log('37. Testing: Distributed rate limiter fails safely with 503 when Redis is required but down...');
    const failedRedisClient = {
      status: 'ready',
      async eval() {
        throw new Error('Connection to Redis lost');
      },
    };

    config.requireRedis = true;
    let serviceUnavailableReturned = false;
    const failSafeLimiter = rateLimiter({
      windowMs: 10000,
      max: 5,
      prefix: 'failsafe_test',
      redisClientOverride: failedRedisClient,
    });

    const failRes = {
      setHeader: () => {},
      status: (code: number) => {
        if (code === 503) serviceUnavailableReturned = true;
        return { json: () => {} };
      },
    } as any;

    await failSafeLimiter(dummyReq, failRes, () => {});
    assert.strictEqual(serviceUnavailableReturned, true, 'Must return 503 Service Unavailable when required Redis fails');
    config.requireRedis = false; // Reset to default
    console.log('   ✅ PASS: Distributed rate limiter fails safely with HTTP 503 when required Redis is unavailable');

    // Test 38: WebSocket room-based distributed disconnection for revoked visitor session
    console.log('\n38. Testing: WebSocket room-based distributed disconnection for revoked visitor session...');
    const liveVisitorRes = await request({
      method: 'POST',
      path: '/api/v1/public/conversations',
      body: {
        inboxKey: inboxAKey,
        customerEmail: `visitor_room_${Date.now()}@example.com`,
        customerName: 'Room Visitor',
        message: 'Hello room test',
      },
    });
    assert.strictEqual(liveVisitorRes.status, 201);
    const roomVisitorToken = liveVisitorRes.data.visitorToken;
    const roomConvId = liveVisitorRes.data.conversationId;
    const roomTokenHash = crypto.createHash('sha256').update(roomVisitorToken).digest('hex');
    createdSessionIds.push(liveVisitorRes.data.sessionId);

    const roomVisitorSocket = ClientIO(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      auth: { visitorToken: roomVisitorToken, conversationId: roomConvId },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 4000);
      roomVisitorSocket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      roomVisitorSocket.on('connect_error', reject);
    });

    let visitorRevokedReceived = false;
    roomVisitorSocket.on('error:session_revoked', () => {
      visitorRevokedReceived = true;
    });

    // Invoke distributed room disconnection
    disconnectVisitorSockets(roomTokenHash);
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(roomVisitorSocket.connected, false, 'Socket must be disconnected via room disconnection');
    assert.ok(visitorRevokedReceived, 'Must receive error:session_revoked event');
    console.log('   ✅ PASS: Distributed room disconnection terminated visitor socket');

    // Test 39: WebSocket room-based distributed disconnection for agent user
    console.log('39. Testing: WebSocket room-based distributed disconnection for agent user...');
    const agentSocket = ClientIO(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      auth: { token: tokenA },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent socket connection timed out')), 4000);
      agentSocket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      agentSocket.on('connect_error', reject);
    });

    let agentDeactivatedReceived = false;
    agentSocket.on('error:account_deactivated', () => {
      agentDeactivatedReceived = true;
    });

    // Invoke distributed user disconnection
    disconnectUserSockets(loginA.data.user.id);
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(agentSocket.connected, false, 'Agent socket must be disconnected via room disconnection');
    assert.ok(agentDeactivatedReceived, 'Must receive error:account_deactivated event');
    console.log('   ✅ PASS: Distributed room disconnection terminated agent user socket');

    // Test 40: Legacy SHA-256 password hash migration on login
    console.log('40. Testing: Legacy SHA-256 password hash migration dynamically upgrades to bcrypt...');
    const migratedPass = 'LegacyPass123!';
    const migratedSha256Hash = crypto.createHash('sha256').update(migratedPass + 'supportos_salt_2026').digest('hex');
    const migratedUserEmail = `legacy_user_${Date.now()}@acme.com`;
    const migratedUser = await prisma.user.create({
      data: {
        organizationId: convA.organizationId,
        email: migratedUserEmail,
        passwordHash: migratedSha256Hash,
        firstName: 'Legacy',
        lastName: 'User',
        role: 'AGENT',
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(migratedUser.id);

    // Initial state: legacy SHA-256
    assert.strictEqual(migratedUser.passwordHash.startsWith('$2b$'), false);

    // Login with correct password
    const legacyLoginRes = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: migratedUserEmail, password: migratedPass },
    });
    assert.strictEqual(legacyLoginRes.status, 200, 'Legacy user login must succeed');

    // Verify passwordHash in database is now upgraded to bcrypt ($2b$)
    const migratedUpgradedUser = await prisma.user.findUnique({ where: { id: migratedUser.id } });
    assert.ok(migratedUpgradedUser?.passwordHash.startsWith('$2b$'), 'Password hash must be upgraded to bcrypt in database');
    console.log('   ✅ PASS: Legacy SHA-256 user authenticated & password hash dynamically upgraded to bcrypt');

    // Test 41: Upgraded account logs in with modern bcrypt verification on second login
    console.log('41. Testing: Upgraded user logs in with modern bcrypt verification on second login...');
    const secondLoginRes = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: migratedUserEmail, password: migratedPass },
    });
    assert.strictEqual(secondLoginRes.status, 200, 'Upgraded user second login must succeed via bcrypt');
    console.log('   ✅ PASS: Upgraded user logs in via bcrypt successfully');

    // Test 42: Legacy account rejects invalid password and does NOT upgrade
    console.log('42. Testing: Legacy account rejects invalid password and does NOT upgrade...');
    const migratedUser2Email = `legacy_user2_${Date.now()}@acme.com`;
    const migratedUser2 = await prisma.user.create({
      data: {
        organizationId: convA.organizationId,
        email: migratedUser2Email,
        passwordHash: migratedSha256Hash,
        firstName: 'Legacy2',
        lastName: 'User2',
        role: 'AGENT',
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(migratedUser2.id);

    const badLoginRes = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: migratedUser2Email, password: 'WrongPassword123!' },
    });
    assert.strictEqual(badLoginRes.status, 401, 'Invalid password must return 401');
    const user2AfterBadLogin = await prisma.user.findUnique({ where: { id: migratedUser2.id } });
    assert.strictEqual(user2AfterBadLogin?.passwordHash, migratedSha256Hash, 'Password hash must NOT be upgraded on failed attempt');
    console.log('   ✅ PASS: Invalid password for legacy account rejected with 401 and hash remains unchanged');

    // Test 43: Production config validation fails if REQUIRE_REDIS=true but REDIS_URL missing
    console.log('43. Testing: Production config validation rejects missing REDIS_URL when REQUIRE_REDIS=true...');
    assert.throws(
      () => {
        validateSecurityConfig({
          nodeEnv: 'production',
          jwtSecret: 'a'.repeat(35),
          billingWebhookSecret: 'b'.repeat(35),
          requireRedis: true,
          redisUrl: null,
          corsOrigins: ['https://app.supportos.io'],
        } as any);
      },
      /REQUIRE_REDIS=true is set in production, but REDIS_URL is not configured/
    );
    console.log('   ✅ PASS: Startup validation rejects missing REDIS_URL in production');

    // Test 44: Production config validation fails if CORS_ORIGIN contains wildcard '*'
    console.log('44. Testing: Production config validation rejects wildcard "*" in CORS_ORIGIN...');
    assert.throws(
      () => {
        validateSecurityConfig({
          nodeEnv: 'production',
          jwtSecret: 'a'.repeat(35),
          billingWebhookSecret: 'b'.repeat(35),
          requireRedis: false,
          redisUrl: null,
          corsOrigins: ['*'],
        } as any);
      },
      /CORS_ORIGIN cannot contain wildcard "\*"/
    );
    console.log('   ✅ PASS: Startup validation rejects wildcard "*" in production CORS_ORIGIN');

    // Test 45: Rate limiter middleware unexpected error fails closed with 503 when requireRedis/production
    console.log('45. Testing: Rate limiter middleware fails closed on unexpected error when requireRedis is active...');
    config.requireRedis = true;
    const brokenReq = {
      headers: {},
      socket: {
        get remoteAddress(): string {
          throw new Error('Unexpected physical socket descriptor read error');
        },
      },
    } as any;
    let service503Returned = false;
    const brokenLimiter = rateLimiter({ windowMs: 1000, max: 10 });
    const brokenRes = {
      setHeader: () => {},
      status: (code: number) => {
        if (code === 503) service503Returned = true;
        return { json: () => {} };
      },
    } as any;
    await brokenLimiter(brokenReq, brokenRes, () => {});
    assert.strictEqual(service503Returned, true, 'Unexpected rate limiter error must fail closed with 503');
    config.requireRedis = false;
    console.log('   ✅ PASS: Rate limiter fails closed with 503 on unexpected middleware errors');

    console.log('\n================================================================');
    console.log('🏆 ALL 45 RIGOROUS SECURITY & RECOVERY TEST CASES PASSED!');
    console.log('================================================================');
  } finally {
    // Isolated test data cleanup
    if (createdSessionIds.length > 0) {
      await prisma.visitorSession.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
    }
    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    }
    if (createdWebhookEventIds.length > 0) {
      await prisma.webhookEvent.deleteMany({ where: { eventId: { in: createdWebhookEventIds } } }).catch(() => {});
    }

    // Reliable server & connection teardown
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

runSecurityRemediationSuite().catch((err) => {
  console.error('\n❌ Security Remediation Test Suite Failed:', err);
  process.exit(1);
});
