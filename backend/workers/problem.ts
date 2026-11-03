/**
 * CABMS RFC 9457 Problem Details Response Builders
 * Conforms strictly to ARCHITECTURE.md §10.4 error registry.
 */

import type { ProblemDetails } from '../../contracts/settings.ts';

const PROBLEM_BASE_URI = 'https://api.cabms.example.invalid/errors';

export function createProblemResponse(
  status: number,
  code: string,
  typeSlug: string,
  title: string,
  detail: string,
  requestId: string,
  instance?: string,
  errors?: Array<{ pointer: string; code: string; message: string }>,
  headers?: Record<string, string>
): Response {
  const body: ProblemDetails = {
    type: `${PROBLEM_BASE_URI}/${typeSlug}`,
    title,
    status,
    detail,
    instance,
    code,
    retryable: status === 429 || status === 503,
    request_id: requestId,
    ...(errors && errors.length > 0 ? { errors } : {}),
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/problem+json',
      'X-Request-Id': requestId,
      ...(headers || {}),
    },
  });
}

export function validationErrorResponse(
  detail: string,
  errors: Array<{ pointer: string; code: string; message: string }>,
  requestId: string,
  instance?: string
): Response {
  return createProblemResponse(
    422,
    'VALIDATION_FAILED',
    'validation-failed',
    'Validation Failed',
    detail,
    requestId,
    instance,
    errors
  );
}

export function authenticationRequiredResponse(
  detail: string,
  requestId: string,
  instance?: string
): Response {
  return createProblemResponse(
    401,
    'AUTHENTICATION_REQUIRED',
    'authentication-required',
    'Authentication Required',
    detail,
    requestId,
    instance,
    undefined,
    { 'WWW-Authenticate': 'Bearer error="invalid_token"' }
  );
}

export function accessDeniedResponse(
  detail: string,
  requestId: string,
  instance?: string
): Response {
  return createProblemResponse(
    403,
    'ACCESS_DENIED',
    'access-denied',
    'Access Denied',
    detail,
    requestId,
    instance
  );
}

export function resourceNotFoundResponse(
  detail: string,
  requestId: string,
  instance?: string
): Response {
  return createProblemResponse(
    404,
    'RESOURCE_NOT_FOUND',
    'resource-not-found',
    'Resource Not Found',
    detail,
    requestId,
    instance
  );
}

export function preconditionRequiredResponse(
  detail: string,
  requestId: string,
  instance?: string
): Response {
  return createProblemResponse(
    428,
    'PRECONDITION_REQUIRED',
    'precondition-required',
    'Precondition Required',
    detail,
    requestId,
    instance
  );
}

export function preconditionFailedResponse(
  detail: string,
  requestId: string,
  instance?: string
): Response {
  return createProblemResponse(
    412,
    'PRECONDITION_FAILED',
    'precondition-failed',
    'Precondition Failed',
    detail,
    requestId,
    instance
  );
}

export function internalErrorResponse(
  detail: string,
  requestId: string,
  instance?: string
): Response {
  return createProblemResponse(
    500,
    'INTERNAL_ERROR',
    'internal-error',
    'Internal Server Error',
    detail,
    requestId,
    instance
  );
}
