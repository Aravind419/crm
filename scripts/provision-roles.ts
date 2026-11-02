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
    for (const stmt of statements) {
      if (stmt.trim()) {
        await prisma.$executeRawUnsafe(stmt);
      }
    }

    // 3. Set or rotate application role password securely using parameterized / escaped query
    console.log('Setting secure password for role "supportos_app"...');
    const escapedPassword = appRolePassword.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`ALTER ROLE supportos_app WITH PASSWORD '${escapedPassword}';`);

    // 4. Verify role attributes in system catalogs
    const roleCheck: any[] = await prisma.$queryRaw`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin 
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

    if (role.rolsuper || role.rolbypassrls) {
      throw new Error('SECURITY VIOLATION: supportos_app possesses superuser or bypassrls privileges!');
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