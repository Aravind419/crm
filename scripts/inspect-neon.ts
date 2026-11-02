import { PrismaClient } from '@prisma/client';

async function main() {
  const neonUrl = process.env.NEON_DATABASE_URL;
  if (!neonUrl) {
    console.error('NEON_DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: neonUrl } },
    log: ['error'],
  });

  try {
    console.log('--- READ-ONLY NEON DATABASE DISCOVERY ---');
    
    // 1. Connectivity and version
    const versionResult: any[] = await prisma.$queryRawUnsafe('SELECT version(), current_database(), current_schema(), current_user;');
    console.log('Connected successfully!');
    console.log('PostgreSQL Version:', versionResult[0]?.version);
    console.log('Current Database:', versionResult[0]?.current_database);
    console.log('Current Schema:', versionResult[0]?.current_schema);
    console.log('Current User:', versionResult[0]?.current_user);

    // 2. Installed Extensions
    const extResult: any[] = await prisma.$queryRawUnsafe('SELECT extname, extversion FROM pg_extension;');
    console.log('\nInstalled Extensions:', extResult.map(e => `${e.extname} (${e.extversion})`).join(', '));

    // 3. Existing Tables in public schema
    const tablesResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT table_name, table_type 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('\nExisting Tables in public schema (count: ' + tablesResult.length + '):');
    for (const t of tablesResult) {
      console.log(`  - ${t.table_name} (${t.table_type})`);
    }

    // 4. Migration history tables
    const hasPrismaMigrations = tablesResult.some(t => t.table_name === '_prisma_migrations');
    if (hasPrismaMigrations) {
      const migrations: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
        FROM _prisma_migrations
        ORDER BY started_at;
      `);
      console.log('\nPrisma Migrations History (count: ' + migrations.length + '):');
      for (const m of migrations) {
        console.log(`  - [${m.finished_at ? 'APPLIED' : 'PENDING/FAILED'}] ${m.migration_name} (steps: ${m.applied_steps_count})`);
      }
    } else {
      console.log('\nNo _prisma_migrations table found.');
    }

    // 5. Existing columns and record counts for any tables
    if (tablesResult.length > 0) {
      console.log('\nTable Record Counts:');
      for (const t of tablesResult) {
        if (t.table_type === 'BASE TABLE') {
          const countRes: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::text as cnt FROM "${t.table_name}";`);
          console.log(`  - ${t.table_name}: ${countRes[0]?.cnt} rows`);
        }
      }
    }

    // 6. Existing custom types/enums
    const enumsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT t.typname as enum_name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as enum_values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      GROUP BY t.typname;
    `);
    console.log('\nCustom Enums in public schema (count: ' + enumsResult.length + '):');
    for (const en of enumsResult) {
      console.log(`  - ${en.enum_name}: [${en.enum_values}]`);
    }

    // 7. Existing RLS policies
    const policiesResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd
      FROM pg_policies
      WHERE schemaname = 'public';
    `);
    console.log('\nExisting RLS Policies in public schema (count: ' + policiesResult.length + '):');
    for (const p of policiesResult) {
      console.log(`  - ${p.tablename}: ${p.policyname} (${p.cmd})`);
    }

    // 8. Classification
    console.log('\n--- CLASSIFICATION ASSESSMENT ---');
    if (tablesResult.length === 0 && enumsResult.length === 0) {
      console.log('Category: A. EMPTY DATABASE (no application tables or user data exist)');
    } else {
      const knownSupportOSTables = [
        'organizations', 'users', 'workspaces', 'teams', 'team_members',
        'inboxes', 'customers', 'conversations', 'messages', 'tickets'
      ];
      const foundSupportOSTables = tablesResult.filter(t => knownSupportOSTables.includes(t.table_name));
      if (foundSupportOSTables.length === 0) {
        console.log('Category: D. UNRELATED DATABASE');
      } else if (foundSupportOSTables.length === knownSupportOSTables.length) {
        console.log('Category: B. EXISTING SUPPORTOS DATABASE');
      } else {
        console.log('Category: C. PARTIALLY INITIALIZED SUPPORTOS DATABASE');
      }
    }

  } catch (err: any) {
    console.error('Database connection or query failed:', err.message);
    console.log('Category: E. UNKNOWN OR UNSAFE STATE');
  } finally {
    await prisma.$disconnect();
  }
}

main();
