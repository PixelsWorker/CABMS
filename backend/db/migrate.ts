/**
 * Local D1 Migration Runner
 * Executes local SQL migrations against a D1Database instance.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Database } from './d1.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runLocalMigrations(db: D1Database): Promise<void> {
  const migrationsDir = resolve(__dirname, '../../migrations');
  const migration01 = readFileSync(resolve(migrationsDir, '0001_g01_initial_schema.sql'), 'utf-8');
  const migration02 = readFileSync(resolve(migrationsDir, '0002_g01_seed_synthetic_data.sql'), 'utf-8');

  await db.exec(migration01);
  await db.exec(migration02);
}
