import { runInAdminMode, disconnectAdminClient } from '../../src/admin-prisma';

async function main() {
  const result = await runInAdminMode(
    async (client) => {
      return client.organization.findFirst({ select: { id: true, name: true } });
    },
    { reason: 'Dedicated maintenance subprocess test verification' }
  );
  await disconnectAdminClient();
  console.log('MAINTENANCE_SUCCESS:' + (result ? result.name : 'empty'));
}

main().catch((err) => {
  console.error('MAINTENANCE_FAILURE:', err);
  process.exit(1);
});
