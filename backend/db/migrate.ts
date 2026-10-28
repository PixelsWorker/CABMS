/**
 * Local D1 Migration Runner
 * Executes local SQL migrations against a D1Database instance.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Database } from './d1.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runLocalMigrations(db: D1Database): Promise<void> {
  const migrationsDir = resolve(__dirname, '../../migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');
    await db.exec(sql);
  }
}
