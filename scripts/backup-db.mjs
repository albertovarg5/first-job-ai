// Makes one database backup now: npm run backup
// On Render, run it from the service's Shell tab (the disk is only reachable there).
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, backupSettings } from '../server/backup.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const settings = backupSettings(process.env);
if (!existsSync(settings.dbPath)) {
  console.error(`No database at ${settings.dbPath}. Check DATABASE_PATH.`);
  process.exit(1);
}
const db = new DatabaseSync(settings.dbPath, { readOnly: true });
try {
  console.log(`Backup written: ${backupDatabase(db, settings)}`);
} finally {
  db.close();
}
