// Makes one database backup now: npm run backup
// Backs up DATABASE_URL (from the environment or .env), or the local
// development database when it isn't set. Writes a SQLite snapshot file to
// BACKUP_DIR (default data/backups), restorable with npm run db:import.
// Run it on your own computer with DATABASE_URL set to Railway's public
// Postgres address to keep a copy of production outside Railway.
import { existsSync } from 'node:fs';
import { backupDatabase, backupSettings } from '../server/backup.js';
import { describeTarget, openDatabase } from '../server/db.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const target = process.env.DATABASE_URL || 'data/pglite';
console.log(`Database: ${describeTarget(target)}`);
const db = await openDatabase(target);
try {
  console.log(`Backup written: ${await backupDatabase(db, backupSettings(process.env))}`);
} finally {
  await db.close();
}
