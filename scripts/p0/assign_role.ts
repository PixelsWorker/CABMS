/**
 * CABMS — Role & Identity Assignment CLI Tool
 *
 * Assigns Google/Firebase Auth identities to user roles in Cloudflare D1.
 * Respects all immutability triggers and append-only audit constraints.
 *
 * Usage:
 *   Interactive:    npx tsx scripts/assign_role.ts [--remote | --local]
 *   Check status:   npx tsx scripts/assign_role.ts --check [--remote | --local]
 *   Direct:         npx tsx scripts/assign_role.ts --email <e> --uid <u> --role <r> [--remote | --local]
 */

import readline from 'node:readline';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

// ─── Constants ───────────────────────────────────────────────────────────────

const WORKSPACES = ['solarcell', 'smart_home', 'cctv'] as const;
type Role = 'super_admin' | 'owner_admin' | 'office_staff' | 'technician';

const ROLE_ALIASES: Record<string, Role> = {
  'super_admin': 'super_admin', 'super admin': 'super_admin', 'superadmin': 'super_admin', '1': 'super_admin', 'super': 'super_admin',
  'owner_admin': 'owner_admin', 'admin': 'owner_admin', 'owner': 'owner_admin', '2': 'owner_admin',
  'office_staff': 'office_staff', 'staff': 'office_staff', '3': 'office_staff',
  'technician': 'technician', 'tech': 'technician', '4': 'technician',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

function parseWranglerJson(stdout: string): any {
  // wrangler --json output may have banner text before the JSON array
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start !== -1 && end > start) return JSON.parse(stdout.slice(start, end + 1));
  throw new Error('Could not parse wrangler JSON output');
}

function wranglerExec(db: string, remote: boolean, sql: string): any[] {
  const flag = remote ? '--remote' : '--local';
  const tmpFile = path.join(process.cwd(), `.tmp_sql_${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, sql, 'utf8');
  try {
    const out = execSync(`npx wrangler d1 execute ${db} ${flag} --file "${tmpFile}" --json`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return parseWranglerJson(out);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function wranglerCmd(db: string, remote: boolean, sql: string): any[] {
  const flag = remote ? '--remote' : '--local';
  const flat = sql.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const escaped = flat.replace(/"/g, '\\"');
  const out = execSync(`npx wrangler d1 execute ${db} ${flag} --command "${escaped}" --json`, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  return parseWranglerJson(out);
}

function getDbName(remote: boolean): string {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'wrangler.jsonc'), 'utf8');
    const matches = raw.match(/"database_name"\s*:\s*"([^"]+)"/g) || [];
    if (remote && matches.length > 1) {
      return matches[matches.length - 1]!.replace(/.*"database_name"\s*:\s*"([^"]+)".*/, '$1');
    }
    if (matches.length > 0) return matches[0]!.replace(/.*"database_name"\s*:\s*"([^"]+)".*/, '$1');
  } catch { /* fallback */ }
  return remote ? 'cavmspanal' : 'cabms-d1';
}

// ─── Status Check ────────────────────────────────────────────────────────────

function showStatus(db: string, remote: boolean) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🔍  DATABASE: ${db}  (${remote ? 'REMOTE' : 'LOCAL'})`);
  console.log(`${'═'.repeat(70)}`);

  try {
    const r = wranglerCmd(db, remote,
      `SELECT u.id, u.email, u.display_name, ` +
      `COALESCE(m.provider_subject_id,'(none)') AS firebase_uid, ` +
      `COALESCE((SELECT GROUP_CONCAT(wm.workspace_id||':'||wm.role,', ') FROM workspace_memberships wm WHERE wm.user_id=u.id),'(none)') AS memberships, ` +
      `(SELECT COUNT(*) FROM privileged_identity_approvals a WHERE a.user_id=u.id AND a.revoked_at IS NULL) AS active_approvals ` +
      `FROM users u LEFT JOIN user_identity_mappings m ON u.id=m.user_id AND m.provider_id='firebase';`
    );
    const rows = r[0]?.results ?? [];
    if (rows.length === 0) console.log('  (no users)');
    else console.table(rows);
  } catch (e: any) { console.error('  Query error:', e.message); }

  console.log(`${'═'.repeat(70)}\n`);
}

// ─── SQL Builders ────────────────────────────────────────────────────────────
// IMPORTANT: These respect the immutability triggers on the remote DB.
//   - g01_protected_super_admin: no reinsert, no update, no delete
//   - g01_bootstrap_completion: no reinsert, no update, no delete
//   - privileged_identity_approvals: no delete, update only to revoke once
//   - user_identity_mappings: no delete triggers (safe to delete+reinsert)
// Strategy: INSERT OR IGNORE for singletons, INSERT for approvals (append-only).

function buildSuperAdminSql(email: string, uid: string): string[] {
  const userId = 'usr_primary_super_admin';
  const stmts: string[] = [];

  // 1. Upsert user record
  stmts.push(`INSERT INTO users (id, email, display_name, disabled, created_at, updated_at)
VALUES ('${userId}', '${email}', 'Primary Super Admin', 0, datetime('now'), datetime('now'))
ON CONFLICT(id) DO UPDATE SET email='${email}', display_name='Primary Super Admin', disabled=0, updated_at=datetime('now');`);

  // 2. Identity mapping — delete any old mapping for this user, then insert fresh
  stmts.push(`DELETE FROM user_identity_mappings WHERE user_id='${userId}';`);
  stmts.push(`DELETE FROM user_identity_mappings WHERE provider_id='firebase' AND provider_subject_id='${uid}';`);
  stmts.push(`INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at)
VALUES ('map_primary_super_admin', '${userId}', 'firebase', '${uid}', datetime('now'));`);

  // 3. Workspace memberships — upsert
  for (const ws of WORKSPACES) {
    stmts.push(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
VALUES ('mem_sa_primary_${ws}', '${ws}', '${userId}', 'super_admin', datetime('now'), datetime('now'))
ON CONFLICT(id) DO UPDATE SET role='super_admin', updated_at=datetime('now');`);
  }

  // 4. Protected singleton — INSERT OR IGNORE (trigger blocks reinsert, IGNORE is safe)
  stmts.push(`INSERT OR IGNORE INTO g01_protected_super_admin (singleton, user_id, provider_id, provider_subject_id, assigned_at, assigned_by)
VALUES (1, '${userId}', 'firebase', '${uid}', datetime('now'), 'operator_bootstrap');`);

  // 5. Privileged approvals — only insert if no active approval exists for this workspace
  for (const ws of WORKSPACES) {
    const apprId = `appr_sa_primary_${ws}_${Date.now()}`;
    stmts.push(`INSERT INTO privileged_identity_approvals (id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by)
SELECT '${apprId}', '${userId}', 'firebase', '${uid}', '${ws}', 'super_admin', datetime('now'), 'operator_bootstrap'
WHERE NOT EXISTS (
  SELECT 1 FROM privileged_identity_approvals
  WHERE user_id='${userId}' AND workspace_id='${ws}' AND role='super_admin' AND revoked_at IS NULL
);`);
  }

  // 6. Bootstrap completion — INSERT OR IGNORE (trigger blocks reinsert)
  const opId = `op_boot_${crypto.randomUUID()}`;
  const reqId = `req_boot_${crypto.randomUUID()}`;
  const auditRef = `audit_boot_${crypto.randomUUID()}`;
  stmts.push(`INSERT OR IGNORE INTO g01_bootstrap_completion (singleton, original_firebase_uid, completed_at, completed_by, operation_id, request_id, audit_reference)
VALUES (1, '${uid}', datetime('now'), 'operator_bootstrap', '${opId}', '${reqId}', '${auditRef}');`);

  return stmts;
}

function buildAdminSql(email: string, uid: string, role: Role): string[] {
  const slug = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const userId = `usr_${slug}`;
  const displayName = slug.replace(/_/g, ' ');
  const stmts: string[] = [];

  // 1. Upsert user
  stmts.push(`INSERT INTO users (id, email, display_name, disabled, created_at, updated_at)
VALUES ('${userId}', '${email}', '${displayName}', 0, datetime('now'), datetime('now'))
ON CONFLICT(id) DO UPDATE SET email='${email}', display_name='${displayName}', disabled=0, updated_at=datetime('now');`);

  // 2. Identity mapping
  stmts.push(`DELETE FROM user_identity_mappings WHERE user_id='${userId}';`);
  stmts.push(`DELETE FROM user_identity_mappings WHERE provider_id='firebase' AND provider_subject_id='${uid}';`);
  stmts.push(`INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at)
VALUES ('map_${slug}_firebase', '${userId}', 'firebase', '${uid}', datetime('now'));`);

  // 3. Workspace memberships
  for (const ws of WORKSPACES) {
    stmts.push(`INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
VALUES ('mem_${slug}_${ws}', '${ws}', '${userId}', '${role}', datetime('now'), datetime('now'))
ON CONFLICT(id) DO UPDATE SET role='${role}', updated_at=datetime('now');`);
  }

  // 4. Privileged approvals for owner_admin (append-only, guard duplicates)
  if (role === 'owner_admin') {
    for (const ws of WORKSPACES) {
      const apprId = `appr_${slug}_${ws}_${Date.now()}`;
      stmts.push(`INSERT INTO privileged_identity_approvals (id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by)
SELECT '${apprId}', '${userId}', 'firebase', '${uid}', '${ws}', 'owner_admin', datetime('now'), 'usr_primary_super_admin'
WHERE NOT EXISTS (
  SELECT 1 FROM privileged_identity_approvals
  WHERE user_id='${userId}' AND workspace_id='${ws}' AND role='owner_admin' AND revoked_at IS NULL
);`);
    }
  }

  return stmts;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const hasRemote = argv.includes('--remote');
  const hasLocal = argv.includes('--local');
  const hasCheck = argv.includes('--check');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    let remote = hasRemote || !hasLocal;  // default remote
    let db = getDbName(remote);

    // ── Check mode ──
    if (hasCheck) {
      if (!hasRemote && !hasLocal) {
        const c = await ask(rl, 'Check (1) Remote or (2) Local? [default 1]: ');
        remote = c !== '2';
        db = getDbName(remote);
      }
      showStatus(db, remote);
      return;
    }

    // ── Gather assignment info ──
    const eIdx = argv.indexOf('--email');
    const uIdx = argv.indexOf('--uid');
    const rIdx = argv.indexOf('--role');
    const hasCli = eIdx !== -1 && uIdx !== -1 && rIdx !== -1;

    let email: string, uid: string, roleStr: string;

    if (hasCli) {
      email = argv[eIdx + 1]; uid = argv[uIdx + 1]; roleStr = argv[rIdx + 1];
    } else {
      console.log(`\n${'═'.repeat(55)}`);
      console.log(`🔑  CABMS Firebase Auth — Role Assignment`);
      console.log(`${'═'.repeat(55)}\n`);

      if (!hasRemote && !hasLocal) {
        const t = await ask(rl, 'Target:\n  1) Remote D1 (Cloudflare)\n  2) Local D1\nSelect [1/2, default 1]: ');
        remote = t !== '2';
        db = getDbName(remote);
      }
      console.log(`\n  → Database: ${db} (${remote ? 'REMOTE' : 'LOCAL'})\n`);

      email = await ask(rl, 'Email: ');
      while (!email.includes('@')) { email = await ask(rl, 'Invalid. Email: '); }

      uid = await ask(rl, 'Firebase UID: ');
      while (uid.length < 5) { uid = await ask(rl, 'Invalid. Firebase UID: '); }

      console.log(`\nRoles:\n  1) super_admin   2) admin (owner_admin)\n  3) office_staff  4) technician`);
      roleStr = await ask(rl, 'Select [1-4 or name]: ');
    }

    const role = ROLE_ALIASES[roleStr.toLowerCase()];
    if (!role) { console.error(`Unknown role: "${roleStr}"`); process.exit(1); }

    console.log(`\n  Email:  ${email}`);
    console.log(`  UID:    ${uid}`);
    console.log(`  Role:   ${role}`);
    console.log(`  Target: ${db} (${remote ? 'REMOTE' : 'LOCAL'})`);
    console.log(`  Workspaces: ${WORKSPACES.join(', ')}\n`);

    if (!hasCli) {
      const ok = await ask(rl, 'Proceed? (y/N): ');
      if (ok.toLowerCase() !== 'y' && ok.toLowerCase() !== 'yes') { console.log('Cancelled.'); return; }
    }

    // ── Build and execute ──
    const stmts = role === 'super_admin'
      ? buildSuperAdminSql(email, uid)
      : buildAdminSql(email, uid, role);

    const fullSql = stmts.join('\n');
    console.log('\nExecuting...');
    wranglerExec(db, remote, fullSql);
    console.log('✅  Done!\n');

    showStatus(db, remote);
  } catch (e: any) {
    console.error(`\n❌  Failed: ${e.message || e}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
