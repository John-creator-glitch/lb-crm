// "Selecting a client pre-fills related workflows."
// Client 360 puts the chosen client (and vehicle) here, then opens the Calculator / Cases / Transfers page, which takes it once on start.
// Held in memory only (not saved anywhere): a page refresh simply starts empty.
export interface Prefill { clientId?: string; vehicleId?: string }
let pending: Prefill | null = null;

export function setPrefill(p: Prefill | null): void { pending = p && (p.clientId || p.vehicleId) ? { ...p } : null; }
/** Returns the waiting prefill and clears it, so a later visit to the page does not reuse it. */
export function takePrefill(): Prefill | null { const p = pending; pending = null; return p; }
export const peekPrefill = (): Prefill | null => (pending ? { ...pending } : null);
