/** Synchronizes authenticated inbox results without sharing preview records. */
export const ENQUIRY_COUNT_EVENT = 'cabms:enquiry-count';
export type EnquiryCountEvent = { workspace: string; userId: string; count: number | null };
export function publishEnquiryCount(value: EnquiryCountEvent): void {
 if (typeof window !== 'undefined') window.dispatchEvent(new window.CustomEvent(ENQUIRY_COUNT_EVENT, {detail:value}));
}
