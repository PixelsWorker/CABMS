# G02 job model ? draft, not production approval

Source: job-model.xlsx. This is a design direction; only the synthetic demo job and first checklist step are implemented. MYOB remains the source of truth for customer contacts, quotations, invoices and payments. IDs and display snapshots are references, not a second accounting system.

All job-owned records carry a workspace boundary and a job reference enforced together; all reads and writes require current identity, membership and role checks. Cross-workspace references are invalid. Do not infer production readiness from the demo schema.

| Entity | Design direction |
| --- | --- |
| brand | Workspace branding and document identity. |
| job | Workspace, enquiry, site, scope and optional MYOB references. |
| job_party | Job-scoped party and role; avoid duplicating the MYOB contact master. |
| job_step | Key, label, required flag, state, owner and timestamps; required is independent of state. |
| job_item | Work line and pass/fail result. |
| job_document | Form type, version, data, status, signer, file reference and retention. |
| acceptance | Accepted document version, actor, time and method. |
| photo | Job-scoped file reference and metadata. |
| appointment | Time, staff and optional calendar event references. |
| staff | Staff and licence references subject to workspace authorization. |
| message_log | Message type and delivery state; no simulated send is a real delivery. |
| complaint | Job reference, deadlines, status and outcome. |
| audit_log | Actor, action, target and time. |

The workbook also lists job steps, parties, documents, photos, appointments, staff, messages, complaints and audit history alongside brand and job: these 13 entities are draft design, not a migration plan. Retention, immutable document handling, concurrency, external synchronization and privileged access require separate decisions. R2 and remote services are outside this milestone.
