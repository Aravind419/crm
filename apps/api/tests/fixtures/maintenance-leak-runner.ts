import { runInAdminMode, disconnectAdminClient } from '../../src/admin-prisma';

async function main() {
  await runInAdminMode(
    async () => {
      throw new Error('Database error at postgresql://supportos_app:SuperSecretPassword123!@localhost:5432/crm');
    },
    { reason: 'Credential leakage test harness' }
  );
  await disconnectAdminClient();
}

main().catch((err) => {
  console.log('SANITIZED_OUTPUT:' + err.message);
  process.exit(0);
});
