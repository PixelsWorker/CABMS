/** Synthetic demo only: assignment, provider sync and business policies are not implemented. */
export interface DemoAppointment {
 id: string; workspace_id: string; job_id: string; starts_at: string; ends_at: string;
 status: 'scheduled' | 'cancelled'; version: number;
}
export type DemoAppointmentChange = { version: number; starts_at: string; ends_at: string } | { version: number; status: 'cancelled' };

export function validDemoAppointmentRange(start: unknown, end: unknown): start is string {
 const valid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
 return valid(start) && valid(end) && Date.parse(start) < Date.parse(end);
}
