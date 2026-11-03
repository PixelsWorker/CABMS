/** Synchronizes authenticated inbox results without sharing preview records. */
export const ENQUIRY_COUNT_EVENT = 'cabms:enquiry-count';
export type EnquiryCountEvent = { workspace: string; userId: string; count: number | null };
export function publishEnquiryCount(value: EnquiryCountEvent): void {
 if (typeof window !== 'undefined') window.dispatchEvent(new window.CustomEvent(ENQUIRY_COUNT_EVENT, {detail:value}));
}

/** Notify other tabs to re-fetch under their own authorized session; no count is broadcast. */
export const ENQUIRY_COUNT_CHANNEL = 'cabms:enquiry-count-invalidated';
export function invalidateOtherTabs(workspace: string): void {
 if (typeof window === 'undefined' || !window.BroadcastChannel) return;
 try { const channel = new window.BroadcastChannel(ENQUIRY_COUNT_CHANNEL); channel.postMessage({workspace}); channel.close(); } catch { /* focus refresh remains available */ }
}
