import type { D1Database } from '../../db/d1.ts';

type Listing = { objects: { key: string }[] } & ({ truncated: false } | { truncated: true; cursor: string });
export type EvidenceListing = { list(options: { limit: number; cursor?: string }): Promise<Listing> };
type EvidenceState = 'verified' | 'pending_upload' | 'retained_stage' | 'unreferenced';

/**
 * Compare the private bucket with D1 from a trusted maintenance context.
 * An unreferenced key can belong to an in-flight write. This inventory never modifies storage.
 */
export async function reconcileEvidenceInventory(db: D1Database, bucket: EvidenceListing) {
  const objects: { key: string; state: EvidenceState }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ limit: 50, cursor });
    if (!page.objects.length && !page.truncated) break;
    const states = await db.batch<{ state: EvidenceState }>(page.objects.map(({ key }) => db.prepare(`
      SELECT CASE
        WHEN EXISTS(SELECT 1 FROM compliance_evidence e JOIN compliance_receipts r ON r.operation_id=e.operation_id
          WHERE e.storage_key=?) THEN 'verified'
        WHEN EXISTS(SELECT 1 FROM compliance_uploads u JOIN compliance_evidence e ON e.id=u.id
          JOIN compliance_receipts r ON r.operation_id=e.operation_id WHERE ('stage/' || u.id)=?) THEN 'retained_stage'
        WHEN EXISTS(SELECT 1 FROM compliance_uploads u WHERE ('stage/' || u.id)=?) THEN 'pending_upload'
        ELSE 'unreferenced'
      END AS state`).bind(key,key,key)));
    for (const [index, { key }] of page.objects.entries()) {
      const state = states[index].results[0].state;
      objects.push({ key, state });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const verified = new Set(objects.filter(row => row.state === 'verified').map(row => row.key));
  const expected = await db.prepare(`SELECT e.storage_key FROM compliance_evidence e
    JOIN compliance_receipts r ON r.operation_id=e.operation_id ORDER BY e.id`).all<{storage_key:string}>();
  return { objects, missing_verified_keys: expected.results.map(row=>row.storage_key).filter(key=>!verified.has(key)) };
}
