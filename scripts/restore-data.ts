import { restoreBackup } from '../src/lib/server/backup';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: npm run backup:restore -- <backup-id>');
    process.exit(1);
  }
  const result = restoreBackup(id);
  console.log(JSON.stringify({ ok: true, id, result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
