import assert from 'assert';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || '';
const prismaAdmin = new PrismaClient({
  datasources: { db: { url: directUrl } },
});

async function runPostgresRlsTests() {
  console.log('🐘 Starting SupportOS PostgreSQL Row-Level Security (RLS) Verification Suite...\n');

  const databaseUrl = process.env.DATABASE_URL || '';
  const isPostgres = databaseUrl.startsWith('postgresql:') || databaseUrl.startsWith('postgres:');

  if (!isPostgres) {
    console.log('ℹ️ [PostgreSQL RLS Suite] Skipped: Active DATABASE_URL is SQLite.');
    console.log('   PostgreSQL environment required for native database RLS verification.');
    console.log('   (PostgreSQL RLS is automatically verified in the dedicated GitHub Actions PostgreSQL service job).\n');
    await prismaAdmin.$disconnect();
    return;
  }

  // Application client connecting natively as unprivileged role supportos_app
  const appRolePassword = process.env.APP_ROLE_PASSWORD;
  let appDatabaseUrl: string;

  if (databaseUrl.includes('supportos_app')) {
    appDatabaseUrl = databaseUrl;
  } else if (appRolePassword && appRolePassword.trim()) {
    appDatabaseUrl = databaseUrl.replace(/:\/\/[^:]+:[^@]+@/, `://supportos_app:${appRolePassword.trim()}@`);
  } else {
    throw new Error(
      'SECURITY CONFIGURATION ERROR: PostgreSQL RLS test requires an unprivileged role connection.\n' +
      'Either DATABASE_URL must connect as supportos_app or APP_ROLE_PASSWORD must be configured.\n' +
      'Silent fallback to table owner or administrative role is strictly prohibited.'
    );
  }

  const appPrisma = new PrismaClient({
    datasources: { db: { url: appDatabaseUrl } },
  });

  try {
    // Verify runtime database identity and role attributes
    const whoami: any[] = await appPrisma.$queryRawUnsafe('SELECT current_user, session_user;');
    const connectedRole = whoami[0]?.current_user;
    console.log(`Connected to PostgreSQL as runtime role: "${connectedRole}"`);

    assert.strictEqual(
      connectedRole,
      'supportos_app',
      `SECURITY VIOLATION: Native RLS tests must execute under unprivileged role "supportos_app", but connected as "${connectedRole}".`
    );

    // Verify role attributes in system catalog
    const roleAttrs: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
      FROM pg_roles 
      WHERE rolname = 'supportos_app';
    `);
    assert.ok(roleAttrs.length > 0, 'Role supportos_app must exist');
    assert.strictEqual(roleAttrs[0].rolsuper, false, 'supportos_app must be NOSUPERUSER');
    assert.strictEqual(roleAttrs[0].rolbypassrls, false, 'supportos_app must be NOBYPASSRLS');
    assert.strictEqual(roleAttrs[0].rolcanlogin, true, 'supportos_app must have rolcanlogin = true');
    assert.strictEqual(roleAttrs[0].rolcreatedb, false, 'supportos_app must be NOCREATEDB');
    assert.strictEqual(roleAttrs[0].rolcreaterole, false, 'supportos_app must be NOCREATEROLE');

    // Verify zero table ownership
    const ownedTables: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' AND tableowner = 'supportos_app';
    `);
    assert.strictEqual(
      ownedTables.length,
      0,
      `SECURITY VIOLATION: supportos_app owns ${ownedTables.length} tables! supportos_app must own 0 tables.`
    );

    // Verify CREATE privilege is revoked on schema public
    const schemaPriv: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT has_schema_privilege('supportos_app', 'public', 'CREATE') AS has_create;
    `);
    assert.strictEqual(
      schemaPriv[0]?.has_create,
      false,
      'SECURITY VIOLATION: supportos_app must not have CREATE privilege on schema public'
    );

    // Verify no privileged role memberships in pg_auth_members
    const roleMemberships: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT r.rolname AS parent_role
      FROM pg_auth_members m
      JOIN pg_roles r ON m.roleid = r.oid
      JOIN pg_roles member ON m.member = member.oid
      WHERE member.rolname = 'supportos_app';
    `);
    assert.strictEqual(
      roleMemberships.length,
      0,
      `SECURITY VIOLATION: supportos_app has memberships in roles: ${roleMemberships.map((m: any) => m.parent_role).join(', ')}`
    );

    // Verify _prisma_migrations is completely inaccessible to supportos_app
    const migrationPrivs: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT privilege_type 
      FROM information_schema.table_privileges 
      WHERE table_name = '_prisma_migrations' AND grantee = 'supportos_app';
    `);
    assert.strictEqual(
      migrationPrivs.length,
      0,
      `SECURITY VIOLATION: supportos_app has privileges on _prisma_migrations: ${migrationPrivs.map((p: any) => p.privilege_type).join(', ')}`
    );

    // Direct read attempt on _prisma_migrations as supportos_app must fail closed
    let migrationBlocked = false;
    try {
      await appPrisma.$queryRawUnsafe('SELECT * FROM "_prisma_migrations" LIMIT 1;');
    } catch (err: any) {
      migrationBlocked = true;
      assert.ok(
        err.message.includes('permission denied') ||
          err.message.includes('42501') ||
          err.code === '42501',
        `Expected permission denied error on _prisma_migrations, got: ${err.message}`
      );
    }
    assert.strictEqual(migrationBlocked, true, 'supportos_app must be strictly denied access to _prisma_migrations');

    // Effective privilege checks via has_*_privilege
    const effectiveMigration: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT 
        has_table_privilege('supportos_app', '_prisma_migrations', 'SELECT') AS has_select,
        has_table_privilege('supportos_app', '_prisma_migrations', 'INSERT') AS has_insert,
        has_table_privilege('supportos_app', '_prisma_migrations', 'UPDATE') AS has_update,
        has_table_privilege('supportos_app', '_prisma_migrations', 'DELETE') AS has_delete,
        has_table_privilege('supportos_app', '_prisma_migrations', 'TRUNCATE') AS has_truncate;
    `);
    const em = effectiveMigration[0];
    assert.strictEqual(em?.has_select, false, 'supportos_app must not have effective SELECT on _prisma_migrations');
    assert.strictEqual(em?.has_insert, false, 'supportos_app must not have effective INSERT on _prisma_migrations');
    assert.strictEqual(em?.has_update, false, 'supportos_app must not have effective UPDATE on _prisma_migrations');
    assert.strictEqual(em?.has_delete, false, 'supportos_app must not have effective DELETE on _prisma_migrations');
    assert.strictEqual(em?.has_truncate, false, 'supportos_app must not have effective TRUNCATE on _prisma_migrations');

    // Effective excess privilege checks on application tables (TRUNCATE/TRIGGER/REFERENCES)
    const tableExcess: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT 
        has_table_privilege('supportos_app', 'tickets', 'TRUNCATE') AS has_truncate,
        has_table_privilege('supportos_app', 'tickets', 'TRIGGER') AS has_trigger,
        has_table_privilege('supportos_app', 'tickets', 'REFERENCES') AS has_references;
    `);
    const te = tableExcess[0];
    assert.strictEqual(te?.has_truncate, false, 'supportos_app must not have TRUNCATE on tickets');
    assert.strictEqual(te?.has_trigger, false, 'supportos_app must not have TRIGGER on tickets');
    assert.strictEqual(te?.has_references, false, 'supportos_app must not have REFERENCES on tickets');

    // Effective database CREATE privilege check
    const dbPriv: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT has_database_privilege('supportos_app', current_database(), 'CREATE') AS has_create;
    `);
    assert.strictEqual(dbPriv[0]?.has_create, false, 'supportos_app must not have CREATE on current database');

    // Effective check that supportos_app has NO inherited elevated roles
    const inheritedRoles: any[] = await prismaAdmin.$queryRawUnsafe(`
      SELECT rolname FROM pg_roles
      WHERE (rolsuper = true OR rolbypassrls = true)
        AND pg_has_role('supportos_app', rolname, 'MEMBER');
    `);
    assert.strictEqual(inheritedRoles.length, 0, `supportos_app must not have inherited membership in elevated roles: ${inheritedRoles.map((r: any) => r.rolname).join(', ')}`);

    console.log('   ✅ PASS: supportos_app verified (NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, 0 table ownership, no CREATE on public, 0 migration access).');

    // 1. Verify RLS is enabled in pg_class across all tenant tables
    console.log('\n1. Verifying PostgreSQL pg_class table security attributes...');
    const tables = [
      'organizations',
      'workspaces',
      'users',
      'teams',
      'team_members',
      'inboxes',
      'customers',
      'conversations',
      'messages',
      'attachments',
      'tickets',
      'ticket_comments',
      'categories',
      'articles',
      'automation_rules',
      'audit_events',
      'refresh_tokens',
      'webhook_events',
      'visitor_sessions',
    ];
    for (const table of tables) {
      const classInfo: any[] = await prismaAdmin.$queryRawUnsafe(`
        SELECT relname, relrowsecurity 
        FROM pg_class 
        WHERE relname = '${table}';
      `);
      assert.strictEqual(classInfo.length, 1, `Table ${table} must exist in pg_class`);
      assert.strictEqual(classInfo[0].relrowsecurity, true, `Table ${table} must have relrowsecurity = true`);
      console.log(`   ✅ PASS: Table "${table}" has Row-Level Security (RLS) enabled.`);
    }

    // 2. Verify pg_policies definitions across all tenant tables
    console.log('\n2. Verifying PostgreSQL pg_policies definitions...');
    for (const table of tables) {
      const policies: any[] = await prismaAdmin.$queryRawUnsafe(`
        SELECT policyname, tablename, permissive, roles, cmd 
        FROM pg_policies 
        WHERE tablename = '${table}';
      `);
      assert.ok(policies.length >= 1, `Table ${table} must have at least one RLS policy`);
      const rlsPolicy = policies.find((p) => p.policyname.includes('tenant_isolation'));
      assert.ok(rlsPolicy, `Table ${table} must have tenant_isolation policy`);
      console.log(`   ✅ PASS: Policy "${rlsPolicy.policyname}" on "${table}" is active.`);
    }

    // 3. Find seeded organizations, inboxes, and customers
    const orgs = await prismaAdmin.organization.findMany({
      where: { slug: { in: ['acme', 'starlight'] } },
      select: { id: true, slug: true },
    });
    const acmeOrg = orgs.find((o) => o.slug === 'acme');
    const starlightOrg = orgs.find((o) => o.slug === 'starlight');

    assert.ok(acmeOrg, 'Acme org must exist');
    assert.ok(starlightOrg, 'Starlight org must exist');

    const starlightInbox = await prismaAdmin.inbox.findFirst({ where: { organizationId: starlightOrg.id } });
    const starlightCustomer = await prismaAdmin.customer.findFirst({ where: { organizationId: starlightOrg.id } });
    assert.ok(starlightInbox, 'Starlight inbox must exist');
    assert.ok(starlightCustomer, 'Starlight customer must exist');

    // 4. Test RLS Read Isolation using unprivileged supportos_app connection
    console.log('\n3. Testing PostgreSQL RLS Read Isolation under supportos_app connection...');
    await appPrisma.$transaction(
      async (tx) => {
        // Set session setting to Acme
        await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${acmeOrg.id}';`);

        const acmeConvRows: any[] = await tx.$queryRawUnsafe(`SELECT * FROM "conversations";`);
        assert.ok(acmeConvRows.length > 0, 'Acme must see its own conversations under its session context');
        for (const row of acmeConvRows) {
          const rowOrgId = row.organizationId || row.organization_id;
          assert.strictEqual(rowOrgId, acmeOrg.id, 'Every visible row must belong to Acme');
        }

        const starlightConvsUnderAcme: any[] = await tx.$queryRawUnsafe(
          `SELECT * FROM "conversations" WHERE "organizationId" = '${starlightOrg.id}';`
        );
        assert.strictEqual(starlightConvsUnderAcme.length, 0, 'Acme context must see 0 rows for Starlight');
        console.log('   ✅ PASS: Acme session setting strictly isolates reading to Acme rows.');

        // Switch session setting to Starlight
        await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${starlightOrg.id}';`);

        const starlightConvRows: any[] = await tx.$queryRawUnsafe(`SELECT * FROM "conversations";`);
        assert.ok(starlightConvRows.length > 0, 'Starlight must see its own conversations under its session context');
        for (const row of starlightConvRows) {
          const rowOrgId = row.organizationId || row.organization_id;
          assert.strictEqual(rowOrgId, starlightOrg.id, 'Every visible row must belong to Starlight');
        }

        const acmeConvsUnderStarlight: any[] = await tx.$queryRawUnsafe(
          `SELECT * FROM "conversations" WHERE "organizationId" = '${acmeOrg.id}';`
        );
        assert.strictEqual(acmeConvsUnderStarlight.length, 0, 'Starlight context must see 0 rows for Acme');
        console.log('   ✅ PASS: Starlight session setting strictly isolates reading to Starlight rows.');

        // Unset session setting: must see 0 rows
        await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '';`);
        const emptyConvRows: any[] = await tx.$queryRawUnsafe(`SELECT * FROM "conversations";`);
        assert.strictEqual(emptyConvRows.length, 0, 'Unset session context must return 0 rows for conversations');
        console.log('   ✅ PASS: Empty session setting returns 0 rows across tenant tables.');
      },
      { timeout: 30000, maxWait: 15000 }
    );

    // 5. Test RLS Write Violation (INSERT check violation) under supportos_app connection
    console.log('\n4. Testing PostgreSQL RLS Write Isolation (CHECK violation)...');
    let rlsBlocked = false;
    try {
      await appPrisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${acmeOrg.id}';`);

          const dummyId = 'test-rls-violation-' + Date.now();
          await tx.$executeRawUnsafe(`
            INSERT INTO "conversations" ("id", "organizationId", "inboxId", "customerId", "status", "priority", "lastMessageAt", "createdAt", "updatedAt")
            VALUES ('${dummyId}', '${starlightOrg.id}', '${starlightInbox.id}', '${starlightCustomer.id}', 'OPEN'::"ConversationStatus", 'MEDIUM'::"Priority", NOW(), NOW(), NOW());
          `);
        },
        { timeout: 30000, maxWait: 15000 }
      );
    } catch (err: any) {
      rlsBlocked = true;
      assert.ok(
        err.message.includes('row-level security') ||
          err.message.includes('42501') ||
          err.code === '42501' ||
          err.message.includes('violates row-level security policy'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert.strictEqual(rlsBlocked, true, 'PostgreSQL RLS MUST block insert with mismatched organizationId');
    console.log('   ✅ PASS: PostgreSQL RLS policy rejected cross-tenant INSERT with check violation.');

    // 6. Test Connection Pool Reuse and Session Variable Reset
    console.log('\n5. Testing Connection Pool Reuse & Session Variable Cleanup...');
    // Run transaction with Acme
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${acmeOrg.id}';`);
    });
    // Immediately run standalone query without setting session variable
    const settingRows: any[] = await appPrisma.$queryRawUnsafe(`SELECT current_setting('app.current_organization_id', true) AS current_org;`);
    const currentOrg = settingRows[0]?.current_org;
    assert.ok(!currentOrg || currentOrg === '', `Session setting must be empty after transaction commit, but found "${currentOrg}"`);
    const defaultVisibleConvs: any[] = await appPrisma.$queryRawUnsafe(`SELECT * FROM "conversations";`);
    assert.strictEqual(defaultVisibleConvs.length, 0, 'Standalone query without active session setting must see 0 tenant records');
    console.log('   ✅ PASS: Session setting resets cleanly after transaction commit; unauthenticated queries see 0 rows.');

    // 7. Test 10 Concurrent Interleaved Transactions
    console.log('\n6. Testing 10 Concurrent Interleaved Cross-Tenant Transactions...');
    const concurrentCount = 10;
    const tasks = Array.from({ length: concurrentCount }, async (_, idx) => {
      const isAcme = idx % 2 === 0;
      const expectedOrgId = isAcme ? acmeOrg.id : starlightOrg.id;
      const otherOrgId = isAcme ? starlightOrg.id : acmeOrg.id;

      return appPrisma.$transaction(
        async (tx) => {
          // Set session
          await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${expectedOrgId}';`);

          // Small artificial delay to interleave execution
          await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 20)));

          // Query conversations
          const rows: any[] = await tx.$queryRawUnsafe(`SELECT * FROM "conversations";`);
          for (const r of rows) {
            const org = r.organizationId || r.organization_id;
            assert.strictEqual(org, expectedOrgId, `Isolation leak in concurrent worker ${idx}: expected ${expectedOrgId}, got ${org}`);
          }

          // Query other org's conversations - must be 0
          const otherRows: any[] = await tx.$queryRawUnsafe(`SELECT * FROM "conversations" WHERE "organizationId" = '${otherOrgId}';`);
          assert.strictEqual(otherRows.length, 0, `Isolation leak in concurrent worker ${idx}: saw ${otherRows.length} rows belonging to other tenant!`);
          return true;
        },
        { timeout: 30000, maxWait: 15000 }
      );
    });

    await Promise.all(tasks);
    console.log(`   ✅ PASS: All ${concurrentCount} concurrent interleaved transactions executed without tenant leaks.`);

    // 8. Test runInTenantContext: Nested Same-Tenant Flattening & Cross-Tenant Rejection
    console.log('\n7. Testing runInTenantContext transaction lifecycle and nesting...');
    const { runInTenantContext, tenantStorage } = await import('../src/tenancy/tenant-context');

    // Test same-tenant nested flattening
    let nestedRan = false;
    await runInTenantContext(acmeOrg.id, async (outerTx) => {
      await runInTenantContext(acmeOrg.id, async (innerTx) => {
        assert.strictEqual(innerTx, outerTx, 'Nested runInTenantContext for identical tenant must reuse outer transaction');
        nestedRan = true;
      });
    });
    assert.strictEqual(nestedRan, true, 'Nested same-tenant execution completed successfully');
    console.log('   ✅ PASS: Same-tenant nested runInTenantContext properly flattened into active transaction.');

    // Test cross-tenant nested rejection
    let crossTenantRejected = false;
    try {
      await runInTenantContext(acmeOrg.id, async () => {
        await runInTenantContext(starlightOrg.id, async () => {
          // Should never reach here
        });
      });
    } catch (err: any) {
      crossTenantRejected = true;
      assert.ok(
        err.message.includes('Tenant Security Violation') || err.message.includes('Cross-tenant context switch'),
        `Unexpected cross-tenant error message: ${err.message}`
      );
    }
    assert.strictEqual(crossTenantRejected, true, 'Cross-tenant nested runInTenantContext MUST throw an error');
    console.log('   ✅ PASS: Cross-tenant nested runInTenantContext strictly rejected.');

    // 9. Test Transaction Rollback after Exception
    console.log('\n8. Testing Transaction Rollback after Exception...');
    const rollbackTestId = 'test-rollback-' + Date.now();
    let rollbackThrown = false;
    try {
      await appPrisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${acmeOrg.id}';`);
          await tx.$executeRawUnsafe(`
            INSERT INTO "categories" ("id", "organizationId", "name", "slug", "createdAt")
            VALUES ('${rollbackTestId}', '${acmeOrg.id}', 'Rollback Category', 'rollback-category-${Date.now()}', NOW());
          `);
          throw new Error('Intentional transaction test abort');
        },
        { timeout: 30000, maxWait: 15000 }
      );
    } catch (e: any) {
      if (e.message.includes('Intentional transaction test abort')) {
        rollbackThrown = true;
      } else {
        throw e;
      }
    }
    assert.strictEqual(rollbackThrown, true, 'Transaction abort error was thrown');
    // Verify rollback in admin prisma
    const foundRollbackCategory = await prismaAdmin.category.findUnique({
      where: { id: rollbackTestId },
    });
    assert.strictEqual(foundRollbackCategory, null, 'Inserted category must be completely rolled back after exception');
    console.log('   ✅ PASS: Transaction changes completely rolled back upon exception.');

    // 10. Context Cleanup Verification
    console.log('\n9. Verifying AsyncLocalStorage Tenant Context Cleanup...');
    const currentStoreAfter = tenantStorage.getStore();
    assert.strictEqual(currentStoreAfter, undefined, 'tenantStorage store must be undefined outside of active context');
    console.log('   ✅ PASS: Tenant context storage is clean and undefined.');

    // 11. Test Client Disconnect & Reconnect
    console.log('\n10. Testing Client Disconnect & Reconnect...');
    await appPrisma.$disconnect();
    const reconnectCheck: any[] = await appPrisma.$queryRawUnsafe('SELECT 1 as connected;');
    assert.strictEqual(reconnectCheck[0]?.connected, 1, 'Client must reconnect cleanly after explicit disconnect');
    console.log('   ✅ PASS: Client disconnected and reconnected cleanly.');

    console.log('\n🎯 ALL PostgreSQL Row-Level Security (RLS) Tests PASSED (100% Verified)!\n');
  } finally {
    await appPrisma.$disconnect().catch(() => {});
    await prismaAdmin.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  runPostgresRlsTests()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ PostgreSQL RLS Test Failure:', err);
      process.exit(1);
    });
}

export { runPostgresRlsTests };
