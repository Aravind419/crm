import assert from 'assert';
import http from 'http';
import * as crypto from 'crypto';
import { io as ClientIO } from 'socket.io-client';
import { app, server } from '../src/server';
import { prisma } from '../src/prisma';
import { config } from '../src/config';

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

  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[Remediation Test Server] Bound to http://localhost:${TEST_PORT}`);
      resolve();
    });
  });

  const createdSessionIds: string[] = [];
  const createdUserIds: string[] = [];

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
    console.log('   ✅ PASS: Atomic CAS refresh token rotation prevents token reuse and race conditions');

    // Test 23: Revoked refresh token cannot be refreshed
    console.log('23. Testing: Revoked refresh token cannot be refreshed...');
    const activeRefresh = refreshRes1.status === 200 ? refreshRes1.data.refreshToken : refreshRes2.data.refreshToken;
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

    // Test 24: Re-use of revoked refresh token triggers token family revocation (RFC 6819)
    console.log('24. Testing: Stolen refresh token reuse triggers immediate token family revocation...');
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

    const tfLogin = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: tfUserEmail, password: tfUserPass },
    });
    assert.strictEqual(tfLogin.status, 200);
    const tokenR1 = tfLogin.data.refreshToken;

    // Normal rotation: R1 -> R2
    const rotate1 = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: tokenR1 },
    });
    assert.strictEqual(rotate1.status, 200);
    const tokenR2 = rotate1.data.refreshToken;

    // Attacker attempts to reuse old token R1!
    const attackerReuse = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: tokenR1 },
    });
    assert.strictEqual(attackerReuse.status, 401, 'Reused refresh token must be rejected');

    // Legitimate client attempts to use token R2 - MUST FAIL because token family was revoked!
    const legitR2Attempt = await request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: tokenR2 },
    });
    assert.strictEqual(legitR2Attempt.status, 401, 'Token R2 must be revoked as part of token family revocation');
    console.log('   ✅ PASS: Token reuse detected & entire token family invalidated (RFC 6819 compliance)');

    console.log('\n--- SECTION 5: BILLING WEBHOOK IDEMPOTENCY & RAW SIGNATURE DEFENSES ---');

    // Test 25: Billing webhook signature verified with raw body
    console.log('25. Testing: Billing webhook signature verified with authentic raw body...');
    const testEventId = `evt_billing_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      id: testEventId,
      event: 'subscription.updated',
      organizationId: convA.organizationId,
      plan: 'BUSINESS',
      status: 'ACTIVE',
    });
    const webhookRawBuffer = Buffer.from(webhookPayload, 'utf-8');
    const validSignature = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(webhookRawBuffer)
      .digest('hex');

    const webhookRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': validSignature,
        'x-billing-event-id': testEventId,
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(webhookRes.status, 200, 'Valid signed webhook must return HTTP 200');
    console.log('   ✅ PASS: Billing webhook signature verified over raw request buffer (HTTP 200)');

    // Test 26: Billing webhook replay attack rejected (idempotency)
    console.log('26. Testing: Billing webhook replay attack rejected via event idempotency...');
    const replayRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': validSignature,
        'x-billing-event-id': testEventId, // Reusing same signature & event
      },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(replayRes.status, 200);
    assert.strictEqual(replayRes.data.idempotent, true, 'Replayed webhook must return idempotent marker');
    console.log('   ✅ PASS: Replay attack intercepted; duplicate webhook processed idempotently');

    // Test 27: Billing webhook rejects unallowed plan
    console.log('27. Testing: Billing webhook rejects unallowed plan value...');
    const invalidPlanPayload = JSON.stringify({
      id: `evt_invalid_plan_${Date.now()}`,
      event: 'subscription.updated',
      organizationId: convA.organizationId,
      plan: 'ULTRA_HACKED_TIER',
    });
    const invalidPlanRaw = Buffer.from(invalidPlanPayload, 'utf-8');
    const invalidPlanSig = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(invalidPlanRaw)
      .digest('hex');

    const invalidPlanRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: { 'x-billing-signature': invalidPlanSig },
      rawBody: invalidPlanRaw,
    });
    assert.strictEqual(invalidPlanRes.status, 400, 'Unallowed plan must be rejected with 400 Bad Request');
    console.log('   ✅ PASS: Billing webhook strictly rejects unallowed subscription tier values (HTTP 400)');

    // Test 28: Billing webhook rejects forged signature
    console.log('28. Testing: Billing webhook rejects forged signature...');
    const forgedWebhookRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: { 'x-billing-signature': 'forged_fake_signature_aabbccddeeff' },
      rawBody: webhookRawBuffer,
    });
    assert.strictEqual(forgedWebhookRes.status, 401, 'Forged signature must be rejected with HTTP 401 Unauthorized');
    console.log('   ✅ PASS: Forged billing webhook signature rejected (HTTP 401)');

    // Test 29: Billing webhook timestamp cryptographically bound to HMAC payload
    console.log('29. Testing: Billing webhook timestamp cryptographically bound to HMAC payload...');
    const timestampBoundEventId = `evt_bound_${Date.now()}`;
    const boundPayload = JSON.stringify({
      id: timestampBoundEventId,
      event: 'subscription.updated',
      organizationId: convA.organizationId,
      plan: 'ENTERPRISE',
      status: 'ACTIVE',
    });
    const boundRawBuffer = Buffer.from(boundPayload, 'utf-8');
    const currentTimestamp = Math.floor(Date.now() / 1000).toString();
    const boundSignature = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(Buffer.concat([Buffer.from(`${currentTimestamp}.`), boundRawBuffer]))
      .digest('hex');

    const boundRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/billing/webhook',
      headers: {
        'x-billing-signature': boundSignature,
        'x-billing-timestamp': currentTimestamp,
        'x-billing-event-id': timestampBoundEventId,
      },
      rawBody: boundRawBuffer,
    });
    assert.strictEqual(boundRes.status, 200, 'Timestamp-bound signature must be accepted');
    console.log('   ✅ PASS: Billing webhook timestamp cryptographically bound to payload in HMAC verification');

    console.log('\n================================================================');
    console.log('🏆 ALL 29 RIGOROUS SECURITY REMEDIATION TEST CASES PASSED!');
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

    // Reliable server & connection teardown
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

runSecurityRemediationSuite().catch((err) => {
  console.error('\n❌ Security Remediation Test Suite Failed:', err);
  process.exit(1);
});
