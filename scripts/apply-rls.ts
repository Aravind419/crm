import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

async function main() {
  const neonUrl = process.env.DATABASE_URL || process.env.NEON_DIRECT_URL;
  if (!neonUrl) {
    console.error('DATABASE_URL or NEON_DIRECT_URL is missing.');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: neonUrl } },
    log: ['error'],
  });

  try {
    console.log('--- Applying SupportOS RLS Policies to PostgreSQL ---');
    const sqlPath = path.join(__dirname, '..', 'prisma', 'rls_policies.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split SQL by semicolons while respecting DO $$ ... $$ blocks
    const statements: string[] = [];
    let current = '';
    let inDollarBlock = false;

    const lines = sqlContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('--') || trimmed.length === 0) continue;

      if (trimmed.includes('$$')) {
        inDollarBlock = !inDollarBlock;
      }

      current += line + '\n';

      if (!inDollarBlock && trimmed.endsWith(';')) {
        statements.push(current.trim());
        current = '';
      }
    }
    if (current.trim().length > 0) {
      statements.push(current.trim());
    }

    console.log(`Parsed ${statements.length} SQL statements from rls_policies.sql.`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const preview = stmt.split('\n')[0].substring(0, 60);
      try {
        await prisma.$executeRawUnsafe(stmt);
        console.log(`[${i + 1}/${statements.length}] Applied: ${preview}...`);
      } catch (err: any) {
        console.error(`Error executing statement [${i + 1}]:\n${stmt}\nError: ${err.message}`);
        throw err;
      }
    }

    console.log('✅ ALL Row-Level Security policies applied successfully!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal RLS application error:', err);
  process.exit(1);
});
