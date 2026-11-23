# Mode B environment and rehearsal proposal

Status: **DRAFT — not approved for cloud execution or configuration changes.**

The account and database identifiers below were supplied by the cloud-side reviewer. They must be independently resolved again before any operation. A name, an editable local configuration file, or a successful read alone does not attest a D1 binding.

| Environment | Intended D1 name | Intended UUID | Account ID |
| --- | --- | --- | --- |
| Development | `cabms-d1-dev` | `bd4b58de-1c1c-4cad-a9bc-a34757546081` | `724c6a202c06d17d91e8b029a1796c75` |
| Client non-production | `cavmspanal` | `121a3d01-11d2-4c72-b158-d9cbd4448b29` | `724c6a202c06d17d91e8b029a1796c75` |

Proposed Wrangler source configuration has distinct `dev` and `nonprod` environments, each with its own Worker deployment target and D1 binding above. Do not add a remote default or infer a target from environment order. Keep credentials outside version control. Verify the authenticated Cloudflare account, database UUID, deployed binding and release before any authorized write. The existing `wrangler.jsonc` has not been changed; its development D1 ID is a local placeholder, not the cloud UUID above.

## Remote rehearsal prerequisites

1. Obtain separate authorization for a named throwaway remote D1 target, its creation if necessary, its migration execution and destruction policy. Do not use either named database for rehearsal writes.
2. Resolve and document the trusted signing-key custodian and authenticate the public-key fingerprint through a protected reviewed release or equivalent independent channel. A local editable file alone is insufficient. Determine whether the key is required for recovery before retirement. Do not create or rotate a real key as part of rehearsal.
3. Review a complete, target-attested Mode B operator command. No current command is approved or ready for remote execution. Confirm backups and recovery, clock bounds, migration ledger, schema objects and clean existing-user baseline before testing.
4. With fixture identities and keys, demonstrate atomic rollback, remote error classification, request-response loss and read-only reconciliation, replay rejection, target mismatch, clock skew and audit receipt consistency on the actual chosen transport. Record resource IDs, command versions, outputs and teardown result without recording private keys, Firebase UIDs or signed manifest contents.

The preliminary clock check uses a 30-second safety margin plus the measured round trip. A newly issued manifest must already be at least that old according to D1's clock, and it must have more than that margin remaining before expiry. Recheck immediately before any approved batch; a successful earlier check cannot guarantee when the batch will arrive.

## Client non-production historical bootstrap

The cloud-side review reports a protected bootstrap on 18 November 2026 before migration 0011 was applied on 19 November, with no signed bootstrap audit row. This is an externally reported finding, not a local execution receipt. Do not bootstrap the database again or invent an audit record.

- **Option A: accept a historical exception.** Independently verify and retain the timeline and current protected identity evidence, document limitations and obtain the owner's explicit exception decision.
- **Option B: rebuild non-production.** First inventory actual client-entered data and retention requirements, design and verify a safe replacement and recovery plan, and obtain separate approval. A replacement must use a genuinely signed enrollment chain.

Neither option authorizes a write or deletion. Preserve the existing client non-production database until its data and retention status are established.

## Migration 0013

The two published-metadata guards use nullable `!=` comparisons. `IS NOT` comparisons require a regression-tested correction. The cloud-side reviewer reports that both named databases stop at 0011, but an earlier local preview applied 0013; inventory all relevant environments and obtain exact-file approval before selecting either amendment or a forward-only corrective migration. Do not apply migrations to either cloud database under this proposal.

Proposed ordering, subject to review: register the null-safe policy/template guards and published required-form insert guard as 0014 first; register a separately reviewed job-forms migration as 0015 after its data contract is approved. The two existing `0014` filenames under `proposals/` are drafts only; neither is registered or applied, and no renumbering has been performed.
