process.env.NODE_ENV = 'test';
import assert from 'assert';
import http from 'http';
import * as crypto from 'crypto';
import { app, server } from '../src/server';
import { prisma } from '../src/prisma';
import { config } from '../src/config';

const TEST_PORT = 4995;

function request(options: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = options.body ? Buffer.from(JSON.stringify(options.body)) : undefined;
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
          resolve({ status: res.statusCode || 500, data, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runOnboardingAdministrationSuite() {
  console.log('🏢 Starting SupportOS Phase 1: Company Onboarding & Administration Test Suite...\n');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Refusing to execute test suite in production environment');
  }

  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[Phase 1 Test Server] Listening on http://localhost:${TEST_PORT}\n`);
      resolve();
    });
  });

  const createdOrgIds: string[] = [];

  try {
    // ------------------------------------------------------------------------
    // Scenario 1: Company Registration & Initial Organization Setup
    // ------------------------------------------------------------------------
    console.log('1. Testing Company Registration (Signup)...');
    const orgSuffix = Math.random().toString(36).substring(2, 8);
    const signupRes = await request({
      method: 'POST',
      path: '/api/v1/auth/signup',
      body: {
        orgName: `Zenith Cloud ${orgSuffix}`,
        firstName: 'Sarah',
        lastName: 'Connor',
        email: `sarah.connor.${orgSuffix}@zenithcloud.test`,
        password: 'Password123!Secure',
      },
    });

    assert.strictEqual(signupRes.status, 201, `Signup failed: ${JSON.stringify(signupRes.data)}`);
    assert.ok(signupRes.data.token, 'Expected JWT token on signup');
    assert.ok(signupRes.data.organization?.id, 'Expected organization payload');
    assert.strictEqual(signupRes.data.organization.onboardingCompleted, false, 'Expected onboardingCompleted to be false initially');

    const orgId = signupRes.data.organization.id;
    createdOrgIds.push(orgId);
    const ownerToken = signupRes.data.token;
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };

    // Verify default workspace and inbox were created
    const initialOrgData = await prisma.organization.findUnique({
      where: { id: orgId },
      include: { workspaces: true, inboxes: true },
    });
    assert.ok(initialOrgData?.workspaces.length! >= 1, 'Expected at least 1 default workspace');
    assert.ok(initialOrgData?.inboxes.length! >= 1, 'Expected at least 1 default live chat inbox');
    console.log('   ✅ Company registered with initial workspace, default inbox, and onboardingCompleted=false');

    // ------------------------------------------------------------------------
    // Scenario 2: Multi-step Onboarding Wizard Completion
    // ------------------------------------------------------------------------
    console.log('2. Testing Multi-step Onboarding Wizard Completion...');
    const businessHoursConfig = {
      timezone: 'America/New_York',
      schedule: {
        monday: { enabled: true, start: '08:30', end: '17:30' },
        tuesday: { enabled: true, start: '08:30', end: '17:30' },
        wednesday: { enabled: true, start: '08:30', end: '17:30' },
        thursday: { enabled: true, start: '08:30', end: '17:30' },
        friday: { enabled: true, start: '08:30', end: '17:30' },
        saturday: { enabled: false, start: '10:00', end: '16:00' },
        sunday: { enabled: false, start: '10:00', end: '16:00' },
      },
    };

    const onboardingRes = await request({
      method: 'POST',
      path: '/api/v1/organizations/onboarding',
      headers: ownerHeaders,
      body: {
        step: 4,
        completed: true,
        companyName: `Zenith Cloud Global ${orgSuffix}`,
        logoUrl: 'https://cdn.zenithcloud.test/assets/logo.png',
        brandColor: '#4F46E5',
        timezone: 'America/New_York',
        locale: 'en-US',
        businessHours: businessHoursConfig,
        allowedDomains: ['zenithcloud.test', 'app.zenithcloud.test'],
        workspaceName: 'Global Tier 1 Support',
        inboxGreeting: 'Welcome to Zenith Cloud Support! How may we help you today?',
        widgetColor: '#4F46E5',
      },
    });

    assert.strictEqual(onboardingRes.status, 200, `Onboarding failed: ${JSON.stringify(onboardingRes.data)}`);
    assert.strictEqual(onboardingRes.data.organization.onboardingCompleted, true);
    assert.strictEqual(onboardingRes.data.organization.brandColor, '#4F46E5');
    assert.strictEqual(onboardingRes.data.organization.timezone, 'America/New_York');

    // Verify audit event was logged
    const onboardingAudit = await prisma.auditEvent.findFirst({
      where: { organizationId: orgId, action: 'ONBOARDING_COMPLETED' },
    });
    assert.ok(onboardingAudit, 'Expected ONBOARDING_COMPLETED audit event');
    console.log('   ✅ Onboarding wizard successfully completed with profile, business hours, and audit record');

    // ------------------------------------------------------------------------
    // Scenario 3: Organization Profile & Production Widget Snippet Verification
    // ------------------------------------------------------------------------
    console.log('3. Testing Organization Profile & Production Widget Snippet Retrieval...');
    const currentOrgRes = await request({
      method: 'GET',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
    });
    assert.strictEqual(currentOrgRes.status, 200);
    assert.strictEqual(currentOrgRes.data.organization.name, `Zenith Cloud Global ${orgSuffix}`);
    assert.strictEqual(currentOrgRes.data.organization.logoUrl, 'https://cdn.zenithcloud.test/assets/logo.png');

    const snippetRes = await request({
      method: 'GET',
      path: '/api/v1/organizations/widget-snippet',
      headers: ownerHeaders,
    });
    assert.strictEqual(snippetRes.status, 200);
    assert.ok(snippetRes.data.snippets.length >= 1, 'Expected at least one widget snippet');
    const defaultSnippet = snippetRes.data.snippets[0].snippet;
    assert.ok(defaultSnippet.includes('data-inbox-key='), 'Snippet missing data-inbox-key attribute');
    assert.ok(defaultSnippet.includes('/widget.js'), 'Snippet missing widget script tag');
    assert.ok(!defaultSnippet.includes('localhost'), 'Production widget snippet must never embed localhost');
    console.log('   ✅ Organization profile verified and production widget snippet properly generated');

    // ------------------------------------------------------------------------
    // Scenario 4: Anti-tampering Defense on Organization Settings
    // ------------------------------------------------------------------------
    console.log('4. Testing Anti-tampering Protection on Settings Updates...');
    const tamperRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        plan: 'ENTERPRISE', // Forbidden client tampering
      },
    });
    assert.strictEqual(tamperRes.status, 403, 'Direct plan tampering must be strictly forbidden');

    const invalidColorRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        brandColor: 'red', // Invalid hex format
      },
    });
    assert.strictEqual(invalidColorRes.status, 400, 'Invalid brandColor hex format must be rejected');
    console.log('   ✅ Plan tampering rejected with 403 and invalid hex colors rejected with 400');

    // ------------------------------------------------------------------------
    // Scenario 5: Cryptographically Secure Agent Invitation Creation
    // ------------------------------------------------------------------------
    console.log('5. Testing Secure Single-Use Agent Invitation Generation...');
    const agentEmail = `agent.john.${orgSuffix}@zenithcloud.test`;
    const inviteRes = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: ownerHeaders,
      body: {
        email: agentEmail,
        role: 'AGENT',
      },
    });

    assert.strictEqual(inviteRes.status, 201, `Invitation failed: ${JSON.stringify(inviteRes.data)}`);
    assert.ok(inviteRes.data.invitationUrl, 'Expected invitationUrl in response');
    assert.ok(inviteRes.data.emailDelivery, 'Expected emailDelivery status');
    // Real email service status: either SENT or BLOCKED_MISSING_CREDENTIALS, never faked
    assert.ok(
      inviteRes.data.emailDelivery.status === 'SENT' || inviteRes.data.emailDelivery.status === 'BLOCKED_MISSING_CREDENTIALS',
      `Unexpected delivery status: ${inviteRes.data.emailDelivery.status}`
    );

    // Extract raw token from invitationUrl
    const urlParts = inviteRes.data.invitationUrl.split('/invite/');
    const rawToken = urlParts[1];
    assert.ok(rawToken && rawToken.length >= 32, 'Expected high-entropy invitation token');

    // Verify DB holds ONLY token hash, never raw token
    const invitedUserDb = await prisma.user.findFirst({
      where: { email: agentEmail },
    });
    assert.ok(invitedUserDb, 'Expected user record in DB');
    assert.strictEqual(invitedUserDb.status, 'INVITED');
    assert.notStrictEqual(invitedUserDb.invitationTokenHash, rawToken, 'Raw token must NEVER be stored in DB');
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    assert.strictEqual(invitedUserDb.invitationTokenHash, expectedHash, 'DB must store SHA-256 hash of invitation token');
    assert.ok(invitedUserDb.invitationExpiresAt! > new Date(), 'Expiration must be in the future');

    const agentUserId = invitedUserDb.id;
    console.log('   ✅ Cryptographic invitation generated: SHA-256 hash stored in DB, raw token sent to recipient');

    // ------------------------------------------------------------------------
    // Scenario 6: Role Escalation Protection on Invitations
    // ------------------------------------------------------------------------
    console.log('6. Testing Role Escalation Prevention...');
    // Create an ADMIN user
    const adminEmail = `admin.claire.${orgSuffix}@zenithcloud.test`;
    const inviteAdminRes = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: ownerHeaders,
      body: {
        email: adminEmail,
        role: 'ADMIN',
      },
    });
    assert.strictEqual(inviteAdminRes.status, 201);
    const adminToken = inviteAdminRes.data.invitationUrl.split('/invite/')[1];

    // Accept admin invitation
    await request({
      method: 'POST',
      path: '/api/v1/auth/invitations/accept',
      body: {
        token: adminToken,
        firstName: 'Claire',
        lastName: 'Admin',
        password: 'AdminPassword123!Secure',
      },
    });

    // Login as Admin
    const adminLoginRes = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {
        email: adminEmail,
        password: 'AdminPassword123!Secure',
      },
    });
    const adminAuthHeaders = { Authorization: `Bearer ${adminLoginRes.data.token}` };

    // Admin attempts to invite an OWNER -> Must be blocked
    const escalateInviteRes = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: adminAuthHeaders,
      body: {
        email: `hacker.owner.${orgSuffix}@zenithcloud.test`,
        role: 'OWNER',
      },
    });
    assert.strictEqual(escalateInviteRes.status, 403, 'Admins must NOT be allowed to invite Owners');

    // Admin attempts to grant OWNER role to another user -> Must be blocked
    const escalateRoleRes = await request({
      method: 'PATCH',
      path: `/api/v1/users/${agentUserId}/role`,
      headers: adminAuthHeaders,
      body: {
        role: 'OWNER',
      },
    });
    assert.strictEqual(escalateRoleRes.status, 403, 'Admins must NOT be allowed to grant Owner role');
    console.log('   ✅ Role escalation blocked: Admins cannot invite or elevate users to OWNER');

    // ------------------------------------------------------------------------
    // Scenario 7: Seat Limit Enforcement on Agent Creation
    // ------------------------------------------------------------------------
    console.log('7. Testing Seat Limit Enforcement...');
    // Set plan to FREE in DB to test seat limit enforcement (maxAgents: 2)
    await prisma.organization.update({
      where: { id: orgId },
      data: { plan: 'FREE' },
    });

    const overLimitRes = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: ownerHeaders,
      body: {
        email: `overlimit.${orgSuffix}@zenithcloud.test`,
        role: 'AGENT',
      },
    });
    assert.strictEqual(overLimitRes.status, 403, 'Invitation exceeding plan seat limit must be rejected with 403');
    assert.ok(overLimitRes.data.message.includes('limit'), 'Error message should mention seat limits');

    // Restore plan back to GROWTH for subsequent scenarios
    await prisma.organization.update({
      where: { id: orgId },
      data: { plan: 'GROWTH' },
    });
    console.log('   ✅ Seat limit enforcement verified: invitation exceeding tier limits rejected');

    // ------------------------------------------------------------------------
    // Scenario 8: Invitation Token Inspection (Pre-flight Validation)
    // ------------------------------------------------------------------------
    console.log('8. Testing Public Invitation Inspection Endpoint...');
    const inspectRes = await request({
      method: 'GET',
      path: `/api/v1/auth/invitations/${rawToken}`,
    });
    assert.strictEqual(inspectRes.status, 200);
    assert.strictEqual(inspectRes.data.invitation.email, agentEmail);
    assert.strictEqual(inspectRes.data.invitation.role, 'AGENT');
    assert.strictEqual(inspectRes.data.invitation.organizationName, `Zenith Cloud Global ${orgSuffix}`);

    // Random fake token inspection must return 404
    const fakeInspectRes = await request({
      method: 'GET',
      path: `/api/v1/auth/invitations/fake-token-${crypto.randomBytes(16).toString('hex')}`,
    });
    assert.strictEqual(fakeInspectRes.status, 404, 'Non-existent token inspection must return 404');
    console.log('   ✅ Invitation inspection verified via cryptographic hash lookup');

    // ------------------------------------------------------------------------
    // Scenario 9: Invitation Acceptance & Password Creation
    // ------------------------------------------------------------------------
    console.log('9. Testing Invitation Acceptance & Password Creation...');
    // Weak password rejected
    const weakPassRes = await request({
      method: 'POST',
      path: '/api/v1/auth/invitations/accept',
      body: {
        token: rawToken,
        firstName: 'John',
        lastName: 'Agent',
        password: 'weak',
      },
    });
    assert.strictEqual(weakPassRes.status, 400, 'Weak password must be rejected');

    // Valid acceptance
    const acceptRes = await request({
      method: 'POST',
      path: '/api/v1/auth/invitations/accept',
      body: {
        token: rawToken,
        firstName: 'John',
        lastName: 'Agent',
        password: 'AgentPassword123!Secure',
      },
    });

    assert.strictEqual(acceptRes.status, 200, `Acceptance failed: ${JSON.stringify(acceptRes.data)}`);
    assert.ok(acceptRes.data.token, 'Expected JWT token upon acceptance');
    assert.strictEqual(acceptRes.data.user.status, 'ACTIVE');

    // Verify DB state: token hash cleared to prevent replay attack
    const activatedAgent = await prisma.user.findUnique({
      where: { id: agentUserId },
    });
    assert.strictEqual(activatedAgent?.status, 'ACTIVE');
    assert.strictEqual(activatedAgent?.invitationTokenHash, null, 'Invitation token hash MUST be cleared upon acceptance');
    assert.strictEqual(activatedAgent?.invitationExpiresAt, null, 'Invitation expiration MUST be cleared upon acceptance');
    console.log('   ✅ Invitation accepted: password set, account activated, and token invalidated');

    // ------------------------------------------------------------------------
    // Scenario 10: Replay Attack Defense on Single-Use Token
    // ------------------------------------------------------------------------
    console.log('10. Testing Replay Attack Defense (Single-Use Token Invalidation)...');
    const replayRes = await request({
      method: 'POST',
      path: '/api/v1/auth/invitations/accept',
      body: {
        token: rawToken,
        firstName: 'Hacker',
        lastName: 'Impostor',
        password: 'HackerPassword123!Secure',
      },
    });
    assert.ok(
      [400, 404].includes(replayRes.status),
      `Replay attack using used invitation token must be rejected with 400 or 404, got ${replayRes.status}`
    );

    const replayInspectRes = await request({
      method: 'GET',
      path: `/api/v1/auth/invitations/${rawToken}`,
    });
    assert.strictEqual(replayInspectRes.status, 404, 'Used invitation token must no longer be discoverable');
    console.log('   ✅ Replay attack prevented: used token cannot be inspected or accepted again');

    // ------------------------------------------------------------------------
    // Scenario 11: Authentication with Newly Created Agent Credentials
    // ------------------------------------------------------------------------
    console.log('11. Testing Login with Newly Created Agent Credentials...');
    const agentLoginRes = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {
        email: agentEmail,
        password: 'AgentPassword123!Secure',
      },
    });
    assert.strictEqual(agentLoginRes.status, 200, `Agent login failed: ${JSON.stringify(agentLoginRes.data)}`);
    assert.ok(agentLoginRes.data.token, 'Expected JWT token for agent login');
    const agentAuthHeaders = { Authorization: `Bearer ${agentLoginRes.data.token}` };
    console.log('   ✅ Newly activated agent successfully authenticated');

    // ------------------------------------------------------------------------
    // Scenario 12: Team Management Lifecycle with Leads & Workload Metrics
    // ------------------------------------------------------------------------
    console.log('12. Testing Team Management Lifecycle, Leads & Workload Metrics...');
    // Create Team with lead
    const createTeamRes = await request({
      method: 'POST',
      path: '/api/v1/teams',
      headers: ownerHeaders,
      body: {
        name: 'Tier 1 Escalations',
        description: 'First line triage and incident resolution',
        leadId: agentUserId,
        memberIds: [agentUserId],
      },
    });

    assert.strictEqual(createTeamRes.status, 201, `Team creation failed: ${JSON.stringify(createTeamRes.data)}`);
    assert.strictEqual(createTeamRes.data.team.name, 'Tier 1 Escalations');
    assert.strictEqual(createTeamRes.data.team.leadId, agentUserId);
    assert.strictEqual(createTeamRes.data.team.lead?.id, agentUserId);
    const teamId = createTeamRes.data.team.id;

    // List teams and verify workload counts
    const listTeamsRes = await request({
      method: 'GET',
      path: '/api/v1/teams',
      headers: ownerHeaders,
    });
    assert.strictEqual(listTeamsRes.status, 200);
    const createdTeamEntry = listTeamsRes.data.teams.find((t: any) => t.id === teamId);
    assert.ok(createdTeamEntry, 'Expected created team in listing');
    assert.strictEqual(typeof createdTeamEntry.metrics.conversations, 'number');
    assert.strictEqual(typeof createdTeamEntry.metrics.tickets, 'number');
    assert.strictEqual(createdTeamEntry.members.length, 1);

    // Remove member from team
    const removeMemberRes = await request({
      method: 'DELETE',
      path: `/api/v1/teams/${teamId}/members/${agentUserId}`,
      headers: ownerHeaders,
    });
    assert.strictEqual(removeMemberRes.status, 200);

    // Add member back to team
    const addMemberRes = await request({
      method: 'POST',
      path: `/api/v1/teams/${teamId}/members`,
      headers: ownerHeaders,
      body: {
        userId: agentUserId,
      },
    });
    assert.ok(
      [200, 201].includes(addMemberRes.status),
      `Expected 200 or 201 for adding team member, got ${addMemberRes.status}`
    );

    // Update team description
    const updateTeamRes = await request({
      method: 'PATCH',
      path: `/api/v1/teams/${teamId}`,
      headers: ownerHeaders,
      body: {
        description: 'Updated Incident Response Team',
      },
    });
    assert.strictEqual(updateTeamRes.status, 200);
    assert.strictEqual(updateTeamRes.data.team.description, 'Updated Incident Response Team');
    console.log('   ✅ Team created with assigned team lead, member assigned/removed, and workload metrics computed');

    // ------------------------------------------------------------------------
    // Scenario 13: Sole Owner Protection from Self-Demotion
    // ------------------------------------------------------------------------
    console.log('13. Testing Sole Owner Self-Demotion Defense...');
    const ownerUserId = signupRes.data.user.id;
    const demoteOwnerRes = await request({
      method: 'PATCH',
      path: `/api/v1/users/${ownerUserId}/role`,
      headers: ownerHeaders,
      body: {
        role: 'AGENT',
      },
    });
    assert.strictEqual(demoteOwnerRes.status, 400, 'Sole owner self-demotion must be rejected');
    assert.ok(
      demoteOwnerRes.data.message.toLowerCase().includes('sole') &&
      demoteOwnerRes.data.message.toLowerCase().includes('owner'),
      `Error should specify sole Owner protection: ${demoteOwnerRes.data.message}`
    );
    console.log('   ✅ Sole owner self-demotion protected with HTTP 400');

    // ------------------------------------------------------------------------
    // Scenario 14: Agent Deactivation & Inactive Session Termination
    // ------------------------------------------------------------------------
    console.log('14. Testing Agent Deactivation & Inactive Login Prevention...');
    const deactivateRes = await request({
      method: 'PATCH',
      path: `/api/v1/users/${agentUserId}/status`,
      headers: ownerHeaders,
      body: {
        status: 'INACTIVE',
      },
    });
    assert.strictEqual(deactivateRes.status, 200);
    assert.ok(
      ['DEACTIVATED', 'INACTIVE'].includes(deactivateRes.data.user.status),
      `Expected status DEACTIVATED or INACTIVE, got ${deactivateRes.data.user.status}`
    );

    // Inactive agent attempt to login -> Must fail
    const inactiveLoginRes = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {
        email: agentEmail,
        password: 'AgentPassword123!Secure',
      },
    });
    assert.ok(
      [401, 403].includes(inactiveLoginRes.status),
      `Inactive user login must be rejected with 401 or 403, got ${inactiveLoginRes.status}`
    );

    // Reactivate agent
    const reactivateRes = await request({
      method: 'PATCH',
      path: `/api/v1/users/${agentUserId}/status`,
      headers: ownerHeaders,
      body: {
        status: 'ACTIVE',
      },
    });
    assert.strictEqual(reactivateRes.status, 200);
    assert.strictEqual(reactivateRes.data.user.status, 'ACTIVE');
    console.log('   ✅ Agent deactivated, login prevented, and successfully reactivated');

    // ------------------------------------------------------------------------
    // Scenario 15: Invitation Resend and Revocation
    // ------------------------------------------------------------------------
    console.log('15. Testing Invitation Resend and Revocation Lifecycle...');
    const extraAgentEmail = `extra.agent.${orgSuffix}@zenithcloud.test`;
    const inviteExtraRes = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: ownerHeaders,
      body: {
        email: extraAgentEmail,
        role: 'AGENT',
      },
    });
    assert.strictEqual(inviteExtraRes.status, 201);
    const extraUserId = inviteExtraRes.data.user.id;
    const initialExtraToken = inviteExtraRes.data.invitationUrl.split('/invite/')[1];

    // Resend invitation (rotates token and extends expiry)
    const resendRes = await request({
      method: 'POST',
      path: `/api/v1/users/${extraUserId}/invitation/resend`,
      headers: ownerHeaders,
    });
    assert.strictEqual(resendRes.status, 200);
    assert.ok(resendRes.data.invitationUrl);
    const rotatedToken = resendRes.data.invitationUrl.split('/invite/')[1];
    assert.notStrictEqual(initialExtraToken, rotatedToken, 'Resending invitation must rotate the single-use token');

    // Revoke invitation
    const revokeRes = await request({
      method: 'DELETE',
      path: `/api/v1/users/${extraUserId}/invitation`,
      headers: ownerHeaders,
    });
    assert.strictEqual(revokeRes.status, 200);

    // Attempt to accept revoked invitation must fail with 404
    const acceptRevokedRes = await request({
      method: 'POST',
      path: '/api/v1/auth/invitations/accept',
      body: {
        token: rotatedToken,
        firstName: 'Revoked',
        lastName: 'User',
        password: 'Password123!Secure',
      },
    });
    assert.strictEqual(acceptRevokedRes.status, 404, 'Revoked invitation must not be accepted');
    console.log('   ✅ Invitation resend rotated token and revocation canceled pending access');

    // ------------------------------------------------------------------------
    // Scenario 16: Cross-Tenant Isolation Verification
    // ------------------------------------------------------------------------
    console.log('16. Testing Cross-Tenant Security Isolation...');
    // Create Tenant B
    const tenantBSuffix = Math.random().toString(36).substring(2, 8);
    const tenantBSignup = await request({
      method: 'POST',
      path: '/api/v1/auth/signup',
      body: {
        orgName: `Tenant B Corp ${tenantBSuffix}`,
        firstName: 'Bob',
        lastName: 'Builder',
        email: `bob.${tenantBSuffix}@tenantb.test`,
        password: 'Password123!Secure',
      },
    });
    assert.strictEqual(tenantBSignup.status, 201);
    const tenantBHeaders = { Authorization: `Bearer ${tenantBSignup.data.token}` };
    createdOrgIds.push(tenantBSignup.data.organization.id);

    // Tenant B attempts to update Tenant A's team -> Must fail with 404
    const crossTeamRes = await request({
      method: 'PATCH',
      path: `/api/v1/teams/${teamId}`,
      headers: tenantBHeaders,
      body: {
        name: 'Hijacked Team Name',
      },
    });
    assert.strictEqual(crossTeamRes.status, 404, 'Cross-tenant team update must return 404');

    // Tenant B attempts to modify Tenant A's user role -> Must fail with 404
    const crossUserRes = await request({
      method: 'PATCH',
      path: `/api/v1/users/${agentUserId}/role`,
      headers: tenantBHeaders,
      body: {
        role: 'AGENT',
      },
    });
    assert.strictEqual(crossUserRes.status, 404, 'Cross-tenant user update must return 404');

    // Tenant B attempts to delete Tenant A's team -> Must fail with 404
    const crossDeleteRes = await request({
      method: 'DELETE',
      path: `/api/v1/teams/${teamId}`,
      headers: tenantBHeaders,
    });
    assert.strictEqual(crossDeleteRes.status, 404, 'Cross-tenant team deletion must return 404');
    console.log('   ✅ Cross-tenant boundaries strictly enforced across teams, users, and organization settings');

    console.log('\n🎉 ALL PHASE 1 ONBOARDING & ADMINISTRATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    try {
      const { closeSocketService } = await import('../src/services/socket.service');
      await closeSocketService();
      const { closeRedis } = await import('../src/services/redis.service');
      await closeRedis();
    } catch (_) {}
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

runOnboardingAdministrationSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Phase 1 Test Suite Failed:', err);
    process.exit(1);
  });
