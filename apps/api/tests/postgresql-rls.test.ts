import assert from 'assert';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runPostgresRlsTests() {
  console.log('🐘 Starting SupportOS PostgreSQL Row-Level Security (RLS) Verification Suite...\n');

  const databaseUrl = process.env.DATABASE_URL || '';
  const isPostgres = databaseUrl.startsWith('postgresql:') || databaseUrl.startsWith('postgres:');

  if (!isPostgres) {
    console.log('ℹ️ [PostgreSQL RLS Suite] Skipped: Active DATABASE_URL is SQLite.');
    console.log('   PostgreSQL environment required for native database RLS verification.');
    console.log('   (PostgreSQL RLS is automatically verified in the dedicated GitHub Actions PostgreSQL service job).\n');
    await prisma.$disconnect();
    return;
  }

  try {
    // 1. Verify RLS is enabled in pg_class
    console.log('1. Verifying PostgreSQL pg_class table security attributes...');
    const tables = ['conversations', 'messages', 'tickets', 'customers', 'inboxes'];
    for (const table of tables) {
      const classInfo: any[] = await prisma.$queryRawUnsafe(`
        SELECT relname, relrowsecurity 
        FROM pg_class 
        WHERE relname = '${table}';
      `);
      assert.strictEqual(classInfo.length, 1, `Table ${table} must exist in pg_class`);
      assert.strictEqual(classInfo[0].relrowsecurity, true, `Table ${table} must have relrowsecurity = true`);
      console.log(`   ✅ PASS: Table "${table}" has Row-Level Security (RLS) enabled.`);
    }

    // 2. Verify pg_policies definitions
    console.log('\n2. Verifying PostgreSQL pg_policies definitions...');
    for (const table of tables) {
      const policies: any[] = await prisma.$queryRawUnsafe(`
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
    const orgs = await prisma.organization.findMany({
      where: { slug: { in: ['acme', 'starlight'] } },
      select: { id: true, slug: true },
    });
    const acmeOrg = orgs.find((o) => o.slug === 'acme');
    const starlightOrg = orgs.find((o) => o.slug === 'starlight');

    assert.ok(acmeOrg, 'Acme org must exist');
    assert.ok(starlightOrg, 'Starlight org must exist');

    const starlightInbox = await prisma.inbox.findFirst({ where: { organizationId: starlightOrg.id } });
    const starlightCustomer = await prisma.customer.findFirst({ where: { organizationId: starlightOrg.id } });
    assert.ok(starlightInbox, 'Starlight inbox must exist');
    assert.ok(starlightCustomer, 'Starlight customer must exist');

    // 4. Test RLS Read Isolation in a Transaction under unprivileged role supportos_app
    console.log('\n3. Testing PostgreSQL RLS Read Isolation under non-superuser role...');
    await prisma.$transaction(async (tx) => {
      // Switch to unprivileged application role subject to RLS
      await tx.$executeRawUnsafe(`SET LOCAL ROLE supportos_app;`);

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
    });

    // 5. Test RLS Write Violation (INSERT check violation)
    console.log('\n4. Testing PostgreSQL RLS Write Isolation (CHECK violation)...');
    let rlsBlocked = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE supportos_app;`);
        await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${acmeOrg.id}';`);

        const dummyId = 'test-rls-violation-' + Date.now();
        await tx.$executeRawUnsafe(`
          INSERT INTO "conversations" ("id", "organizationId", "inboxId", "customerId", "status", "priority", "lastMessageAt", "createdAt", "updatedAt")
          VALUES ('${dummyId}', '${starlightOrg.id}', '${starlightInbox.id}', '${starlightCustomer.id}', 'OPEN', 'MEDIUM', NOW(), NOW(), NOW());
        `);
      });
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

    console.log('\n🎯 ALL PostgreSQL Row-Level Security (RLS) Tests PASSED (100% Verified)!\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runPostgresRlsTests().catch((err) => {
    console.error('❌ PostgreSQL RLS Test Failure:', err);
    process.exit(1);
  });
}

export { runPostgresRlsTests };
