process.env.NODE_ENV = 'test';
import assert from 'assert';
import http from 'http';
import * as crypto from 'crypto';
import { app, server } from '../src/server';
import { prisma } from '../src/prisma';
import { config } from '../src/config';
import { EmailService, escapeHtml } from '../src/services/email.service';

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
    const activatedAgent = await prisma.user.findFirst({
      where: { id: agentUserId, organizationId: orgId },
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

    // Revoke invitation: record retained with status='DEACTIVATED', token hash cleared
    const revokeRes = await request({
      method: 'DELETE',
      path: `/api/v1/users/${extraUserId}/invitation`,
      headers: ownerHeaders,
    });
    assert.strictEqual(revokeRes.status, 200);

    // Verify user record retained in database with DEACTIVATED status
    const revokedUserDb = await prisma.user.findFirst({ where: { id: extraUserId, organizationId: orgId } });
    assert.ok(revokedUserDb, 'Revoked user record must be retained in DB, not deleted');
    assert.strictEqual(revokedUserDb.status, 'DEACTIVATED', 'User status must transition to DEACTIVATED');
    assert.strictEqual(revokedUserDb.invitationTokenHash, null, 'Invitation token hash must be cleared');
    assert.strictEqual(revokedUserDb.invitationExpiresAt, null, 'Invitation expiry must be cleared');

    // Verify audit trail recorded revocation
    const revokeAudit = await prisma.auditEvent.findFirst({
      where: { entityId: extraUserId, organizationId: orgId, action: 'INVITATION_REVOKED' },
    });
    assert.ok(revokeAudit, 'Audit event INVITATION_REVOKED must be preserved');

    // Attempt to inspect revoked invitation must fail with 404
    const inspectRevokedRes = await request({
      method: 'GET',
      path: `/api/v1/auth/invitations/${rotatedToken}`,
    });
    assert.strictEqual(inspectRevokedRes.status, 404, 'Revoked invitation token must no longer be inspectable');

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

    // Resend on revoked user must be blocked (explicit re-invitation workflow required)
    const blockedResendRes = await request({
      method: 'POST',
      path: `/api/v1/users/${extraUserId}/invitation/resend`,
      headers: ownerHeaders,
    });
    assert.strictEqual(blockedResendRes.status, 400, 'Resend on revoked invitation must be rejected with 400');

    // Explicit re-invitation workflow
    const reinviteRes = await request({
      method: 'POST',
      path: `/api/v1/users/${extraUserId}/invitation/reinvite`,
      headers: ownerHeaders,
    });
    assert.strictEqual(reinviteRes.status, 200, 'Explicit re-invitation must succeed');
    assert.ok(reinviteRes.data.invitationUrl, 'Expected new invitation URL');
    const reinvitedToken = reinviteRes.data.invitationUrl.split('/invite/')[1];

    const reinvitedUserDb = await prisma.user.findFirst({ where: { id: extraUserId, organizationId: orgId } });
    assert.strictEqual(reinvitedUserDb?.status, 'INVITED', 'Re-invited user must transition back to INVITED');
    assert.ok(reinvitedUserDb?.invitationTokenHash, 'New invitation token hash must be set');

    // Verify accepting the re-invited token succeeds
    const acceptReinvitedRes = await request({
      method: 'POST',
      path: '/api/v1/auth/invitations/accept',
      body: {
        token: reinvitedToken,
        firstName: 'Reinvited',
        lastName: 'Agent',
        password: 'ReinvitedPassword123!Secure',
      },
    });
    assert.strictEqual(acceptReinvitedRes.status, 200, 'Accepting re-invited token must succeed');

    console.log('   ✅ Complete invitation lifecycle verified: revocation retains record in DEACTIVATED state with audit trail, blocks resend/inspection/acceptance, and explicit re-invitation workflow succeeds');

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

    // ------------------------------------------------------------------------
    // Scenario 17: Concurrent Invitation Acceptance (Atomic Single-Consumer)
    // ------------------------------------------------------------------------
    console.log('\n17. Testing Concurrent Invitation Acceptance (Atomic Single-Consumer)...');
    const raceEmail = `race.agent.${orgSuffix}@zenithcloud.test`;
    const raceInviteRes = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: ownerHeaders,
      body: {
        email: raceEmail,
        role: 'AGENT',
      },
    });
    assert.strictEqual(raceInviteRes.status, 201);
    const raceToken = raceInviteRes.data.invitationUrl.split('/invite/')[1];

    // Fire 3 simultaneous acceptance requests
    const raceResults = await Promise.all([
      request({
        method: 'POST',
        path: '/api/v1/auth/invitations/accept',
        body: { token: raceToken, firstName: 'Race1', lastName: 'Agent', password: 'RacePassword123!Secure' },
      }),
      request({
        method: 'POST',
        path: '/api/v1/auth/invitations/accept',
        body: { token: raceToken, firstName: 'Race2', lastName: 'Agent', password: 'RacePassword123!Secure' },
      }),
      request({
        method: 'POST',
        path: '/api/v1/auth/invitations/accept',
        body: { token: raceToken, firstName: 'Race3', lastName: 'Agent', password: 'RacePassword123!Secure' },
      }),
    ]);

    const successfulAccepts = raceResults.filter((r) => r.status === 200);
    const rejectedAccepts = raceResults.filter((r) => r.status === 409 || r.status === 400 || r.status === 404);

    assert.strictEqual(successfulAccepts.length, 1, `Exactly ONE concurrent acceptance must succeed, got ${successfulAccepts.length}`);
    assert.strictEqual(rejectedAccepts.length, 2, `Other concurrent acceptance requests must fail, got ${rejectedAccepts.length}`);

    // Verify user in DB is ACTIVE and invitationTokenHash is null
    const raceUserInDb = await prisma.user.findFirst({
      where: { email: raceEmail, organizationId: orgId },
    });
    assert.strictEqual(raceUserInDb?.status, 'ACTIVE');
    assert.strictEqual(raceUserInDb?.invitationTokenHash, null);
    console.log('   ✅ Concurrency verified: exactly 1 request consumed the token, 2 were rejected atomically');

    // ------------------------------------------------------------------------
    // Scenario 18: Regression Defense — Removal of initialPassword Bypass
    // ------------------------------------------------------------------------
    console.log('\n18. Testing Removal of initialPassword Bypass...');
    const bypassEmail = `bypass.agent.${orgSuffix}@zenithcloud.test`;
    const bypassRes = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: ownerHeaders,
      body: {
        email: bypassEmail,
        firstName: 'Hacker',
        lastName: 'Bypass',
        role: 'AGENT',
        initialPassword: 'InsecureBypass123!Password', // Attempt bypass
      },
    });
    assert.strictEqual(bypassRes.status, 201);
    assert.strictEqual(bypassRes.data.user.status, 'INVITED', 'Invited user must remain INVITED even if initialPassword was supplied');

    const bypassUserDb = await prisma.user.findFirst({
      where: { email: bypassEmail, organizationId: orgId },
    });
    assert.strictEqual(bypassUserDb?.status, 'INVITED');
    assert.ok(bypassUserDb?.passwordHash.startsWith('UNSET_INVITATION_'), 'Password hash must be unmatchable random token');

    // Attempt login with supplied initialPassword -> MUST FAIL
    const loginBypassRes = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {
        email: bypassEmail,
        password: 'InsecureBypass123!Password',
      },
    });
    assert.ok(
      [401, 403].includes(loginBypassRes.status),
      `Login attempt with initialPassword must be rejected, got ${loginBypassRes.status}`
    );
    console.log('   ✅ initialPassword bypass neutralized: account remains INVITED with unmatchable hash');

    // ------------------------------------------------------------------------
    // Scenario 19: Secure Invitation Email Rendering & HTML Escaping
    // ------------------------------------------------------------------------
    console.log('\n19. Testing Secure Invitation Email Rendering & HTML Escaping...');
    const maliciousParams = {
      to: 'target@example.com',
      recipientName: '<script>alert("xss")</script>Bob',
      inviterName: 'Alice "Admin" <img src=x onerror=alert(1)>',
      organizationName: 'Acme Corp & Partners <evil>',
      role: 'AGENT <b>bold</b>',
      invitationUrl: `${config.appUrl}/invite/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2`,
      expiresAt: new Date(),
    };

    const renderedHtml = EmailService.renderInvitationHtml(maliciousParams);
    assert.ok(!renderedHtml.includes('<script>'), 'Rendered email must not contain unescaped <script>');
    assert.ok(!renderedHtml.includes('<img'), 'Rendered email must not contain unescaped <img>');
    assert.ok(!renderedHtml.includes('<evil>'), 'Rendered email must not contain unescaped <evil>');
    assert.ok(!renderedHtml.includes('<b>bold</b>'), 'Rendered email must not contain unescaped <b>');
    assert.ok(renderedHtml.includes('&lt;script&gt;'), 'Rendered email must escape <script> to &lt;script&gt;');
    assert.ok(renderedHtml.includes('&amp; Partners'), 'Rendered email must escape & to &amp;');

    // Test invitation URL origin validation
    const badUrlDelivery = await EmailService.sendInvitation({
      ...maliciousParams,
      invitationUrl: 'https://evil-phishing-site.com/invite/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    });
    assert.strictEqual(badUrlDelivery.delivered, false);
    assert.strictEqual(badUrlDelivery.status, 'FAILED');
    assert.ok(badUrlDelivery.error?.includes('Invalid invitation URL origin'));
    console.log('   ✅ HTML injection neutralized with escaping; untrusted invitation URL origins strictly rejected');

    // ------------------------------------------------------------------------
    // Scenario 20: Strict Onboarding Validation Category Tests
    // ------------------------------------------------------------------------
    console.log('\n20. Testing Strict Onboarding & Settings Validation Categories...');

    // A. Step range validation
    const badStepLow = await request({
      method: 'POST',
      path: '/api/v1/organizations/onboarding',
      headers: ownerHeaders,
      body: { step: 0 },
    });
    assert.strictEqual(badStepLow.status, 400);

    const badStepHigh = await request({
      method: 'POST',
      path: '/api/v1/organizations/onboarding',
      headers: ownerHeaders,
      body: { step: 99 },
    });
    assert.strictEqual(badStepHigh.status, 400);

    // B. Timezone validation
    const badTzRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: { timezone: 'Mars/Phobos' },
    });
    assert.strictEqual(badTzRes.status, 400);
    assert.ok(badTzRes.data.message.includes('timezone'));

    // C. Locale validation
    const badLocaleRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: { locale: '123_invalid_locale' },
    });
    assert.strictEqual(badLocaleRes.status, 400);

    // D. Brand color validation
    const badColorRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: { brandColor: '#GGG123' },
    });
    assert.strictEqual(badColorRes.status, 400);

    // E. Logo URL validation
    const badLogoRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: { logoUrl: 'javascript:alert(1)' },
    });
    assert.strictEqual(badLogoRes.status, 400);

    // F. Allowed domains wildcard rejection
    const badDomainRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: { allowedDomains: ['*'] },
    });
    assert.strictEqual(badDomainRes.status, 400);

    // G. Business hours validation: empty schedule
    const emptyScheduleRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        businessHours: { timezone: 'UTC', schedule: {} },
      },
    });
    assert.strictEqual(emptyScheduleRes.status, 400);

    // H. Business hours validation: missing weekdays (only 6 days)
    const missingDaysRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        businessHours: {
          timezone: 'UTC',
          schedule: {
            monday: { enabled: true, start: '09:00', end: '17:00' },
            tuesday: { enabled: true, start: '09:00', end: '17:00' },
            wednesday: { enabled: true, start: '09:00', end: '17:00' },
            thursday: { enabled: true, start: '09:00', end: '17:00' },
            friday: { enabled: true, start: '09:00', end: '17:00' },
            saturday: { enabled: false },
            // missing sunday!
          },
        },
      },
    });
    assert.strictEqual(missingDaysRes.status, 400);

    // I. Business hours validation: invalid day identifier
    const badDayRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        businessHours: {
          timezone: 'UTC',
          schedule: {
            funday: { enabled: true, start: '09:00', end: '17:00' },
          },
        },
      },
    });
    assert.strictEqual(badDayRes.status, 400);

    // J. Business hours validation: invalid boolean for enabled
    const badBoolRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        businessHours: {
          timezone: 'UTC',
          schedule: {
            monday: { enabled: 'yes', start: '09:00', end: '17:00' },
            tuesday: { enabled: false },
            wednesday: { enabled: false },
            thursday: { enabled: false },
            friday: { enabled: false },
            saturday: { enabled: false },
            sunday: { enabled: false },
          },
        },
      },
    });
    assert.strictEqual(badBoolRes.status, 400);

    // K. Business hours validation: invalid time format
    const badTimeFormatRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        businessHours: {
          timezone: 'UTC',
          schedule: {
            monday: { enabled: true, start: '9:00', end: '17:00' },
            tuesday: { enabled: false },
            wednesday: { enabled: false },
            thursday: { enabled: false },
            friday: { enabled: false },
            saturday: { enabled: false },
            sunday: { enabled: false },
          },
        },
      },
    });
    assert.strictEqual(badTimeFormatRes.status, 400);

    // L. Business hours validation: equal start and end times
    const equalTimesRes = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        businessHours: {
          timezone: 'UTC',
          schedule: {
            monday: { enabled: true, start: '09:00', end: '09:00' },
            tuesday: { enabled: false },
            wednesday: { enabled: false },
            thursday: { enabled: false },
            friday: { enabled: false },
            saturday: { enabled: false },
            sunday: { enabled: false },
          },
        },
      },
    });
    assert.strictEqual(equalTimesRes.status, 400);

    // M. Business hours validation: inverted start and end time
    const badHoursInverted = await request({
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      headers: ownerHeaders,
      body: {
        businessHours: {
          timezone: 'UTC',
          schedule: {
            monday: { enabled: true, start: '18:00', end: '09:00' },
            tuesday: { enabled: false },
            wednesday: { enabled: false },
            thursday: { enabled: false },
            friday: { enabled: false },
            saturday: { enabled: false },
            sunday: { enabled: false },
          },
        },
      },
    });
    assert.strictEqual(badHoursInverted.status, 400);
    assert.ok(badHoursInverted.data.message.includes('precede') || badHoursInverted.data.message.includes('equal'));

    // I. Premature onboarding completion rejection without required fields
    const emptyOrgSignup = await request({
      method: 'POST',
      path: '/api/v1/auth/signup',
      body: {
        orgName: `Incomplete Org ${orgSuffix}`,
        firstName: 'Incomplete',
        lastName: 'Owner',
        email: `incomplete.${orgSuffix}@test.com`,
        password: 'Password123!Secure',
      },
    });
    const emptyOrgHeaders = { Authorization: `Bearer ${emptyOrgSignup.data.token}` };
    createdOrgIds.push(emptyOrgSignup.data.organization.id);

    const prematureComplete = await request({
      method: 'POST',
      path: '/api/v1/organizations/onboarding',
      headers: emptyOrgHeaders,
      body: {
        completed: true,
        companyName: '', // Empty!
      },
    });
    assert.strictEqual(prematureComplete.status, 400, 'Premature completion with missing fields must fail with 400');
    console.log('   ✅ Strict validation verified across step ranges, timezones, locales, colors, URLs, domains, and schedules');

    // ------------------------------------------------------------------------
    // Scenario 21: Concurrent Duplicate Invitation Creation Safety
    // ------------------------------------------------------------------------
    console.log('\n21. Testing Concurrent Duplicate Invitation Creation Safety...');
    const dupInviteEmail = `concurrent.dup.${orgSuffix}@zenithcloud.test`;
    const [dupRes1, dupRes2] = await Promise.all([
      request({
        method: 'POST',
        path: '/api/v1/users/invite',
        headers: ownerHeaders,
        body: { email: dupInviteEmail, role: 'AGENT' },
      }),
      request({
        method: 'POST',
        path: '/api/v1/users/invite',
        headers: ownerHeaders,
        body: { email: dupInviteEmail, role: 'AGENT' },
      }),
    ]);

    const createdDups = [dupRes1, dupRes2].filter((r) => r.status === 201);
    const conflictDups = [dupRes1, dupRes2].filter((r) => r.status === 409);
    assert.strictEqual(createdDups.length, 1, `Exactly one duplicate invite must succeed, got ${createdDups.length}`);
    assert.strictEqual(conflictDups.length, 1, `Second duplicate invite must receive 409 Conflict, got ${conflictDups.length}`);
    console.log('   ✅ Concurrent duplicate invites safely handled: 1 created (201), 1 conflict (409), 0 unhandled 500s');

    // ------------------------------------------------------------------------
    // Scenario 22: Concurrent Invitation Seat Quota Enforcement
    // ------------------------------------------------------------------------
    console.log('\n22. Testing Concurrent Invitation Seat Limit Serialization & Race Defense...');
    // Create an organization on the FREE plan (maxAgents: 2)
    const freeOrgSuffix = Math.random().toString(36).substring(2, 8);
    const freeOrgSignup = await request({
      method: 'POST',
      path: '/api/v1/auth/signup',
      body: {
        orgName: `Free Tier Limits ${freeOrgSuffix}`,
        firstName: 'Free',
        lastName: 'Owner',
        email: `free.owner.${freeOrgSuffix}@test.com`,
        password: 'Password123!Secure',
      },
    });
    assert.strictEqual(freeOrgSignup.status, 201);
    const freeOrgHeaders = { Authorization: `Bearer ${freeOrgSignup.data.token}` };
    const freeOrgId = freeOrgSignup.data.organization.id;
    createdOrgIds.push(freeOrgId);

    // Downgrade organization plan to FREE explicitly (max 2 agents)
    await prisma.organization.update({
      where: { id: freeOrgId },
      data: { plan: 'FREE' },
    });

    // Currently 1 owner exists in DB. Exactly 1 additional agent seat is available!
    // Dispatch 4 simultaneous concurrent invite requests with distinct emails:
    const invitePromises = [1, 2, 3, 4].map((i) =>
      request({
        method: 'POST',
        path: '/api/v1/users/invite',
        headers: freeOrgHeaders,
        body: {
          email: `concurrent.seat.${i}.${freeOrgSuffix}@test.com`,
          role: 'AGENT',
        },
      })
    );

    const seatResults = await Promise.all(invitePromises);
    const seatSuccesses = seatResults.filter((r) => r.status === 201);
    const seatExceeded = seatResults.filter((r) => r.status === 403);

    // Exactly 1 request may succeed, and 3 must be blocked with 403
    assert.strictEqual(
      seatSuccesses.length,
      1,
      `Expected exactly 1 concurrent invite to succeed within remaining seat capacity, got ${seatSuccesses.length}`
    );
    assert.strictEqual(
      seatExceeded.length,
      3,
      `Expected exactly 3 concurrent invites to be rejected with 403 seat limit reached, got ${seatExceeded.length}`
    );

    // Verify DB count: strictly 2 agents in ACTIVE or INVITED status
    const finalFreeOrgUserCount = await prisma.user.count({
      where: {
        organizationId: freeOrgId,
        status: { in: ['ACTIVE', 'INVITED'] },
      },
    });
    assert.strictEqual(
      finalFreeOrgUserCount,
      2,
      `Database total seat count must never exceed plan limit (2), got ${finalFreeOrgUserCount}`
    );
    console.log('   ✅ Seat quota serialization verified: under concurrency, exactly 1 seat allocated, 3 blocked with 403, DB quota strictly preserved at 2');

    // ------------------------------------------------------------------------
    // Scenario 23: Email Delivery Semantics & Secret Sanitization Matrix
    // ------------------------------------------------------------------------
    console.log('\n23. Testing Email Delivery Semantics, Acceptance vs Delivery, & Secret Sanitization...');
    // A. Explicit acceptance semantics vs mailbox delivery
    const inviteDeliveryCheck = await request({
      method: 'POST',
      path: '/api/v1/users/invite',
      headers: ownerHeaders,
      body: {
        email: `semantics.check.${orgSuffix}@test.com`,
        role: 'AGENT',
      },
    });
    assert.strictEqual(inviteDeliveryCheck.status, 201);
    const deliveryMeta = inviteDeliveryCheck.data.emailDelivery;
    assert.ok(deliveryMeta, 'Expected emailDelivery payload');
    assert.strictEqual(typeof deliveryMeta.acceptedByProvider, 'boolean', 'Expected acceptedByProvider boolean');
    assert.ok(['SENT', 'BLOCKED_MISSING_CREDENTIALS', 'FAILED'].includes(deliveryMeta.status));
    assert.ok(deliveryMeta.deliveryNote, 'Expected explicit deliveryNote detailing provider acceptance semantics');

    // B. Secret sanitization verification
    const { sanitizeEmailError } = await import('../src/services/email.service');
    const sensitiveLog = 'Error connecting to smtp://admin:superSecretPassword123@smtp.mail.com with key re_1234567890abcdef1234567890';
    const sanitizedLog = sanitizeEmailError(sensitiveLog);
    assert.ok(!sanitizedLog.includes('superSecretPassword123'), 'Sensitive password must be scrubbed');
    assert.ok(!sanitizedLog.includes('re_1234567890abcdef1234567890'), 'Resend API key must be redacted');
    assert.ok(sanitizedLog.includes('[REDACTED]'), 'Expected redacted placeholder');

    // C. Malformed URL rejection in EmailService
    const badUrlTest = await EmailService.sendInvitation({
      to: 'agent@test.com',
      recipientName: 'Agent',
      inviterName: 'Owner',
      organizationName: 'Test Org',
      role: 'AGENT',
      invitationUrl: 'javascript:alert(1)',
      expiresAt: new Date(),
    });
    assert.strictEqual(badUrlTest.status, 'FAILED');
    assert.strictEqual(badUrlTest.acceptedByProvider, false);
    assert.ok(badUrlTest.error?.includes('Invalid invitation URL origin'));
    console.log('   ✅ Email delivery semantics verified: provider acceptance separated from inbox delivery, secrets sanitized, invalid URLs safely rejected');

    console.log('\n🎉 ALL PHASE 1, 1.1 & 1.2 ONBOARDING & ADMINISTRATION TESTS PASSED SUCCESSFULLY!');
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
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        require('fs').appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `\n### ❌ Phase 1 Onboarding & Administration Failure\n\`\`\`\n${err.stack || err.message}\n\`\`\`\n`
        );
      } catch (_) {}
    }
    process.exit(1);
  });
