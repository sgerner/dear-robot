import { createBackup } from '../src/lib/server/backup';

async function main() {
  const backup = await createBackup();
  console.log(JSON.stringify({ ok: true, backup }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

