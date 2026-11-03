import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      current += char;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        current += '*/';
        i++;
        continue;
      }
      current += char;
      continue;
    }

    if (!inDollarQuote) {
      if (char === '-' && next === '-') {
        inLineComment = true;
        current += '--';
        i++;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        current += '/*';
        i++;
        continue;
      }
      if (char === '$' && next === '$') {
        inDollarQuote = true;
        current += '$$';
        i++;
        continue;
      }
      if (char === ';') {
        if (current.trim().length > 0) {
          statements.push(current.trim());
        }
        current = '';
        continue;
      }
    } else {
      if (char === '$' && next === '$') {
        inDollarQuote = false;
        current += '$$';
        i++;
        continue;
      }
    }

    current += char;
  }

  if (current.trim().length > 0) {
    statements.push(current.trim());
  }

  return statements;
}

async function main() {
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!directUrl || !directUrl.startsWith('postgres')) {
    console.error('ERROR: DIRECT_URL or DATABASE_URL must point to a valid PostgreSQL database.');
    process.exit(1);
  }

  const appRolePassword = process.env.APP_ROLE_PASSWORD;
  if (!appRolePassword || !appRolePassword.trim()) {
    console.error('ERROR: APP_ROLE_PASSWORD environment variable is required. Hardcoded or fallback passwords are prohibited.');
    process.exit(1);
  }

  console.log('🛡️ SupportOS Enterprise PostgreSQL Role Provisioning & Security Hardening');
  console.log('Connecting to PostgreSQL using administrative migration role...');

  const prisma = new PrismaClient({
    datasources: { db: { url: directUrl } },
    log: ['error'],
  });

  try {
    // 1. Verify administrative caller identity
    const whoami: any[] = await prisma.$queryRaw`SELECT current_user, session_user;`;
    console.log(`Connected as administrative user: ${whoami[0]?.current_user}`);

    // 2. Read and split SQL policies and helper functions
    const rlsSqlPath = path.join(__dirname, '../prisma/rls_policies.sql');
    const rlsSql = fs.readFileSync(rlsSqlPath, 'utf8');

    const statements = splitSqlStatements(rlsSql);

    console.log(`Executing ${statements.length} policy, function, and privilege statements...`);
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (stmt.trim()) {
        try {
          await prisma.$executeRawUnsafe(stmt);
        } catch (e: any) {
          console.error(`Statement ${i + 1}/${statements.length} failed:\n${stmt}\nError: ${e.message}`);
          throw e;
        }
      }
    }

    // 3. Set or rotate application role password securely using parameterized / escaped query
    console.log('Setting secure password for role "supportos_app"...');
    const escapedPassword = appRolePassword.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`ALTER ROLE supportos_app WITH PASSWORD '${escapedPassword}';`);

    // 4. Verify role attributes in system catalogs
    const roleCheck: any[] = await prisma.$queryRaw`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
      FROM pg_roles 
      WHERE rolname = 'supportos_app';
    `;

    if (roleCheck.length === 0) {
      throw new Error('Verification failed: Role supportos_app was not found in pg_roles.');
    }

    const role = roleCheck[0];
    console.log('✅ Role System Catalog Verification:');
    console.log(`   - Name: ${role.rolname}`);
    console.log(`   - Superuser (rolsuper): ${role.rolsuper} (Must be false)`);
    console.log(`   - Bypass RLS (rolbypassrls): ${role.rolbypassrls} (Must be false)`);
    console.log(`   - Can Login (rolcanlogin): ${role.rolcanlogin} (Must be true)`);
    console.log(`   - Create DB (rolcreatedb): ${role.rolcreatedb} (Must be false)`);
    console.log(`   - Create Role (rolcreaterole): ${role.rolcreaterole} (Must be false)`);

    if (role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) {
      throw new Error('SECURITY VIOLATION: supportos_app possesses elevated superuser, bypassrls, createdb, or createrole privileges!');
    }

    // 4b. Verify CREATE privilege revoked on schema public
    const schemaPriv: any[] = await prisma.$queryRaw`
      SELECT has_schema_privilege('supportos_app', 'public', 'CREATE') AS has_create;
    `;
    const hasCreate = schemaPriv[0]?.has_create;
    console.log(`   - Schema public CREATE privilege: ${hasCreate} (Must be false)`);
    if (hasCreate) {
      throw new Error('SECURITY VIOLATION: supportos_app possesses CREATE privilege on schema public!');
    }

    // 4c. Verify no membership in privileged roles via pg_auth_members
    const roleMemberships: any[] = await prisma.$queryRaw`
      SELECT r.rolname AS parent_role
      FROM pg_auth_members m
      JOIN pg_roles r ON m.roleid = r.oid
      JOIN pg_roles member ON m.member = member.oid
      WHERE member.rolname = 'supportos_app';
    `;
    console.log(`   - Role memberships: ${roleMemberships.length === 0 ? 'None (Clean)' : roleMemberships.map((m: any) => m.parent_role).join(', ')}`);
    if (roleMemberships.length > 0) {
      throw new Error(`SECURITY VIOLATION: supportos_app is granted membership in parent roles: ${roleMemberships.map((m: any) => m.parent_role).join(', ')}`);
    }

    // 5. Verify table ownership
    const tableOwnership: any[] = await prisma.$queryRaw`
      SELECT tablename, tableowner 
      FROM pg_tables 
      WHERE schemaname = 'public' AND tableowner = 'supportos_app';
    `;

    if (tableOwnership.length > 0) {
      throw new Error(`SECURITY VIOLATION: supportos_app owns ${tableOwnership.length} tables in public schema!`);
    }
    console.log('✅ Table Ownership: 0 tables owned by supportos_app (Owned by migration role).');

    // 6. Verify _prisma_migrations is completely inaccessible to supportos_app
    const migrationPrivs: any[] = await prisma.$queryRaw`
      SELECT privilege_type 
      FROM information_schema.table_privileges 
      WHERE table_name = '_prisma_migrations' AND grantee = 'supportos_app';
    `;

    if (migrationPrivs.length > 0) {
      throw new Error(`SECURITY VIOLATION: supportos_app retains privileges on _prisma_migrations: ${migrationPrivs.map((p) => p.privilege_type).join(', ')}`);
    }

    // 7. Effective privilege checks (using built-in PostgreSQL has_*_privilege functions)
    console.log('✅ Effective Privilege Verification:');
    const effectiveMigration: any[] = await prisma.$queryRaw`
      SELECT 
        has_table_privilege('supportos_app', '_prisma_migrations', 'SELECT') AS has_select,
        has_table_privilege('supportos_app', '_prisma_migrations', 'INSERT') AS has_insert,
        has_table_privilege('supportos_app', '_prisma_migrations', 'UPDATE') AS has_update,
        has_table_privilege('supportos_app', '_prisma_migrations', 'DELETE') AS has_delete,
        has_table_privilege('supportos_app', '_prisma_migrations', 'TRUNCATE') AS has_truncate;
    `;
    const em = effectiveMigration[0];
    if (em?.has_select || em?.has_insert || em?.has_update || em?.has_delete || em?.has_truncate) {
      throw new Error(`SECURITY VIOLATION: supportos_app has effective privileges on _prisma_migrations! ${JSON.stringify(em)}`);
    }
    console.log('   - Effective _prisma_migrations privileges: None (0/5 permitted)');

    // Verify no excess TRUNCATE/TRIGGER/REFERENCES on application tables
    const tableExcess: any[] = await prisma.$queryRaw`
      SELECT 
        has_table_privilege('supportos_app', 'tickets', 'TRUNCATE') AS has_truncate,
        has_table_privilege('supportos_app', 'tickets', 'TRIGGER') AS has_trigger,
        has_table_privilege('supportos_app', 'tickets', 'REFERENCES') AS has_references;
    `;
    const te = tableExcess[0];
    if (te?.has_truncate || te?.has_trigger || te?.has_references) {
      throw new Error(`SECURITY VIOLATION: supportos_app has excess table privileges (TRUNCATE/TRIGGER/REFERENCES)! ${JSON.stringify(te)}`);
    }
    console.log('   - Excess table privileges (TRUNCATE/TRIGGER/REFERENCES): None (Clean)');

    // Verify database CREATE privilege
    const dbPriv: any[] = await prisma.$queryRaw`
      SELECT has_database_privilege('supportos_app', current_database(), 'CREATE') AS has_create;
    `;
    if (dbPriv[0]?.has_create) {
      throw new Error('SECURITY VIOLATION: supportos_app possesses CREATE privilege on the current database!');
    }
    console.log('   - Database CREATE privilege: false (Revoked)');

    // Verify no inherited membership in elevated/superuser roles
    const inheritedRoles: any[] = await prisma.$queryRaw`
      SELECT rolname FROM pg_roles
      WHERE (rolsuper = true OR rolbypassrls = true)
        AND pg_has_role('supportos_app', rolname, 'MEMBER');
    `;
    if (inheritedRoles.length > 0) {
      throw new Error(`SECURITY VIOLATION: supportos_app has inherited membership in elevated role(s): ${inheritedRoles.map((r: any) => r.rolname).join(', ')}`);
    }
    console.log('   - Inherited elevated roles: None (Clean)');

    console.log('✅ Migration Table Protection: 0 privileges granted on _prisma_migrations.');

    console.log('\n🎉 Successfully provisioned and verified supportos_app security architecture.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ Provisioning failed:', err);
  process.exit(1);
});