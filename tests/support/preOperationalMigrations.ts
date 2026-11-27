import {isDisposableInMemoryD1,type D1Database} from '../../backend/db/d1.ts';
import {loadVerifiedMigrations,planLocalMigrations} from '../../backend/db/migrate.ts';

export function loadPreOperationalMigrations() {
  const migrations=loadVerifiedMigrations();
  const baseline=migrations.slice(0,13);
  if(baseline.at(-1)?.name!=='0013_form_catalog_and_job_forms.sql')throw new Error('Expected the verified 0013 fixture baseline');
  return baseline;
}

export async function initializePreOperationalDatabase(db:D1Database) {
  if(!isDisposableInMemoryD1(db))throw new Error('Pre-operational fixtures require a disposable in-memory database');
  const {before,pair,after}=planLocalMigrations(loadPreOperationalMigrations());
  for(const migration of before)await db.exec(migration.bytes.toString('utf8'));
  await db.exec('BEGIN TRANSACTION;\n'+pair.map(file=>file.bytes.toString('utf8')).join('\n')+'\nCOMMIT;');
  for(const migration of after)await db.exec(migration.bytes.toString('utf8'));
}
