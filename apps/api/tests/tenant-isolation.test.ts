import assert from 'assert';
import http from 'http';
import { app, server } from '../src/server';
import { prisma } from '../src/prisma';

const TEST_PORT = 4998;

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

async function runTenantIsolationTests() {
  console.log('🔒 Starting SupportOS Multi-Tenant Isolation Security Test Suite...\n');

  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[Security Test Server] Running on http://localhost:${TEST_PORT}`);
      resolve();
    });
  });

  let starlightConv: any = null;
  let starlightTicket: any = null;

  try {
    // 1. Authenticate Org A (Alex from Acme)
    const loginA = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'alex@acme.com', password: 'Password123!' },
    });
    assert.strictEqual(loginA.status, 200);
    const tokenA = loginA.data.token;
    const headersA = { Authorization: `Bearer ${tokenA}` };

    // 2. Authenticate Org B (Maya from Starlight Retail)
    const loginB = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'maya@starlight.com', password: 'Password123!' },
    });
    assert.strictEqual(loginB.status, 200);
    const tokenB = loginB.data.token;
    const headersB = { Authorization: `Bearer ${tokenB}` };

    // Find Starlight's Org ID
    const starlightOrg = await prisma.organization.findUnique({ where: { slug: 'starlight' } });
    assert.ok(starlightOrg, 'Starlight organization must exist');

    // Create a private conversation belonging to Starlight
    const starlightInbox = await prisma.inbox.findFirst({ where: { organizationId: starlightOrg.id } });
    assert.ok(starlightInbox, 'Starlight inbox must exist');

    const starlightCustomer =
      (await prisma.customer.findFirst({
        where: { organizationId: starlightOrg.id, email: 'secret@starlight-shopper.com' },
      })) ||
      (await prisma.customer.create({
        data: {
          organizationId: starlightOrg.id,
          name: 'Starlight Confidential Customer',
          email: `secret_${Date.now()}@starlight-shopper.com`,
        },
      }));

    starlightConv = await prisma.conversation.create({
      data: {
        organizationId: starlightOrg.id,
        inboxId: starlightInbox.id,
        customerId: starlightCustomer.id,
        status: 'OPEN',
      },
    });

    const randomTicketNum = Math.floor(Math.random() * 800000) + 10000;
    starlightTicket = await prisma.ticket.create({
      data: {
        ticketNumber: randomTicketNum,
        organizationId: starlightOrg.id,
        customerId: starlightCustomer.id,
        title: 'Starlight Confidential Internal Ticket',
        description: 'Restricted financial data',
      },
    });

    console.log('1. Testing Unauthenticated Request Rejection...');
    const unauth = await request({ method: 'GET', path: '/api/v1/conversations' });
    assert.strictEqual(unauth.status, 401);
    console.log('   ✅ Unauthenticated request blocked with 401.');

    console.log('2. Testing Cross-Tenant Conversation Read Isolation (Org A -> Org B Conversation)...');
    const crossConvRead = await request({
      method: 'GET',
      path: `/api/v1/conversations/${starlightConv.id}`,
      headers: headersA,
    });
    assert.strictEqual(crossConvRead.status, 404, 'Org A must receive 404 when requesting Org B conversation');
    console.log('   ✅ Org A strictly denied access to Org B conversation (404 Not Found returned).');

    console.log('3. Testing Cross-Tenant Message Posting Prevention...');
    const crossMsgPost = await request({
      method: 'POST',
      path: `/api/v1/conversations/${starlightConv.id}/messages`,
      headers: headersA,
      body: { content: 'Malicious injected message from Org A' },
    });
    assert.strictEqual(crossMsgPost.status, 404, 'Org A cannot post messages to Org B conversation');
    console.log('   ✅ Org A strictly blocked from posting messages into Org B conversation.');

    console.log('4. Testing Cross-Tenant Customer Profile Isolation...');
    const crossCustomerRead = await request({
      method: 'GET',
      path: `/api/v1/customers/${starlightCustomer.id}`,
      headers: headersA,
    });
    assert.strictEqual(crossCustomerRead.status, 404, 'Org A cannot view Org B customer profile');
    console.log('   ✅ Org A strictly blocked from viewing Org B customer profile.');

    console.log('5. Testing Cross-Tenant Ticket Modification Prevention...');
    const crossTicketUpdate = await request({
      method: 'PATCH',
      path: `/api/v1/tickets/${starlightTicket.id}`,
      headers: headersA,
      body: { status: 'RESOLVED', title: 'Tampered by Org A' },
    });
    assert.strictEqual(crossTicketUpdate.status, 404, 'Org A cannot modify Org B ticket');
    console.log('   ✅ Org A strictly blocked from modifying Org B ticket.');

    console.log('6. Verifying List Queries Exclude Foreign Tenant Records...');
    const listA = await request({ method: 'GET', path: '/api/v1/conversations', headers: headersA });
    assert.strictEqual(listA.status, 200);
    const hasStarlightConvInA = listA.data.conversations.some((c: any) => c.id === starlightConv.id);
    assert.strictEqual(hasStarlightConvInA, false, 'Org A conversation feed must contain ZERO Org B conversations');

    const listB = await request({ method: 'GET', path: '/api/v1/conversations', headers: headersB });
    assert.strictEqual(listB.status, 200);
    const hasStarlightConvInB = listB.data.conversations.some((c: any) => c.id === starlightConv.id);
    assert.strictEqual(hasStarlightConvInB, true, 'Org B must see its own conversation');
    console.log('   ✅ List queries proven strictly partitioned by tenant boundary.');

    console.log('\n🛡️ ALL TENANT ISOLATION SECURITY TESTS PASSED! ZERO DATA LEAKAGE DETECTED.');
  } finally {
    if (starlightTicket?.id) {
      await prisma.ticket.delete({ where: { id: starlightTicket.id } }).catch(() => {});
    }
    if (starlightConv?.id) {
      await prisma.conversation.delete({ where: { id: starlightConv.id } }).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

runTenantIsolationTests().catch((err) => {
  console.error('\n❌ Tenant Isolation Security Tests Failed:', err);
  process.exit(1);
});
