# Local-only Mode B wrapper proposal

Status: **proposal; not implemented or approved for execution**. This does not enable cloud Mode B or alter Mode A.

Goal: exercise the same Mode B statement builder against the persistent local Wrangler D1 under `/home/rockson/Projects/Projects/CABMS/DB`, and support an explicitly selected local development identity. This is development authorization data only; it must never be copied into a cloud database or represented as a real cloud approval.

Proposed safeguards:

1. Require explicit `--local`, the exact canonical persistence path and the expected local database ID; no remote/default target. Refuse symlinks or unexpected existing configuration and verify the resolved path immediately before opening. Construct a dedicated temporary Wrangler config with local bindings and fail closed if remote binding or an unexpected database is present.
2. Use a separate local-only trusted binding factory and a loopback-only process boundary. Establish and test the binding identity using the factory, rather than accepting an arbitrary injected database or merely trusting a caller-provided name. Keep Mode A's in-memory-only guard unchanged. Do not reuse the current cloud-execution function by weakening its guard.
3. Require a confirmed development user and Firebase UID with a single matching mapping. Creating that baseline, if absent, needs explicit scope and a separately reviewed local-only operation; a Firebase UID in a free-text argument is not proof of ownership. Do not delete or replace existing identities.
4. Use an ephemeral fixture Ed25519 key and a domain-separated, time-limited local-development approval. Mark the resulting ledger and receipt as local test data. This key is never a cloud trust root. Protect the private key in memory and do not export it.
5. Snapshot the local SQLite database with a recovery procedure before persistent writes. Confirm migration ledger and schema match the repository; do not apply draft migrations. Require a clean bootstrap baseline, run the actual Mode B builder as one D1 batch, and reconcile all records before reporting success. Unknown transport outcomes must not cause an automatic retry.
6. Verify wrong paths, symlinks, remote bindings, account mismatches, unexpected roles, failed batch, clock boundaries and lost responses with isolated local Worker/D1 tests. Demonstrate that the same command refuses both named cloud databases and cannot issue a remote write.

The proposed local wrapper, binding proof, real identity enrollment and persisted test audit have not been implemented or run. Any later cloud enrollment separately requires approved trust custody, remote rehearsal, target attestation and exact execution authorization.
