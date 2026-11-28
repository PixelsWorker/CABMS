const problems = {
  AUTHENTICATION_REQUIRED: [401, 'Sign in to continue.'],
  ACTION_DENIED: [403, 'Your current role cannot perform this action.'],
  RESOURCE_NOT_FOUND: [404, 'This record is unavailable in this workspace.'],
  POLICY_UNAVAILABLE: [409, 'Refresh the job type and choose its current published policy.'],
  LEGACY_MAPPING_REQUIRED: [409, 'Map every required legacy form before creating this job.'],
  HISTORY_IMMUTABLE: [409, 'This version is locked. Create a revision or correction.'],
  FORM_RULE_INVALID: [422, 'Select a published form allowed by this job policy.'],
  FORM_IN_USE: [409, 'Replace the listed policy or template references before archiving.'],
  ASSIGNEE_INELIGIBLE: [422, 'Choose an active technician from this business.'],
  VISIT_ASSIGNEE_MISMATCH: [422, 'Schedule the visit for the technician currently assigned to the work order.'],
  SCHEDULED_VISIT_ASSIGNMENT_CONFLICT: [409, 'Cancel the scheduled visits before changing the assigned technician.'],
  JOB_STATE_CONFLICT: [409, "This action is unavailable in the job's current state."],
  FORM_ALREADY_ASSIGNED: [409, 'This form is already assigned for that visit or circuit.'],
  RECORD_CONFLICT: [500, 'The change could not be confirmed. Check its operation status.'],
  IDEMPOTENCY_KEY_REUSED: [409, 'This operation reference belongs to another request.'],
  VERSION_REQUIRED: [428, 'Reload the saved version and review your changes.'],
  VERSION_CONFLICT: [412, 'Reload the saved version and review your changes.'],
  INVALID_FIELD: [422, 'Correct the highlighted field before continuing.'],
  REFERENCE_INVALID: [422, 'Refresh the available choices and select again.'],
  EXCEPTION_DENIED: [403, 'This change needs an eligible independent approver or is prohibited by policy.'],
  FINDING_RESOLUTION_REQUIRED: [409, 'Resolve the open findings before approving this withdrawal.'],
  EVIDENCE_INVALID: [422, 'Check the file type, size and remaining attachment allowance.'],
  UPLOAD_TOO_LARGE: [413, 'Check the file type, size and remaining attachment allowance.'],
  SIGNOFF_BLOCKED: [409, 'Review the current answers, evidence and signing requirements.'],
  COMPLETION_BLOCKED: [409, 'Complete the items listed before closing this job.'],
  TEMPORARILY_UNAVAILABLE: [503, 'Check saved status and try again when the service is available.'],
  OPERATIONAL_STORAGE_NOT_READY: [503, 'This environment needs the CABMS operational database migrations before it can show jobs or visits.'],
  RATE_LIMITED: [429, 'Check saved status and try again when the service is available.'],
  OPERATION_UNCONFIRMED: [500, 'Check operation status using this reference.'],
} as const;

export type ComplianceProblemCode = keyof typeof problems;

export function complianceProblem(code: ComplianceProblemCode, requestId: string): Response {
  const [status, detail] = problems[code];
  return Response.json({ type: 'about:blank', title: code.replaceAll('_', ' '), status,
    code, detail, request_id: requestId }, { status, headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': requestId } });
}

/** Accept only exact tokens emitted by our reviewed triggers. Unknown errors are uncertain. */
export function complianceStorageProblem(error: unknown): ComplianceProblemCode {
  if (!(error instanceof Error)) return 'OPERATION_UNCONFIRMED';
  const match = /^(?:D1_ERROR: )?([A-Z_]+)(?:: SQLITE_CONSTRAINT(?:_TRIGGER)?(?: \(extended: SQLITE_CONSTRAINT_TRIGGER\))?)?$/.exec(error.message);
  const code = match?.[1];
  return code && Object.hasOwn(problems, code) ? code as ComplianceProblemCode : 'OPERATION_UNCONFIRMED';
}
