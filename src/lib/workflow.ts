// Quotation and case workflow rules. PURE (no database). The database enforces the same rules (migration 20261118090000);
// this copy only decides which buttons to show, and is tested with the same cases as supabase/tests/M3_workflow_tests.sql.
import type { QuotationStatus, CaseStage, CasePriority, CaseStatus } from '@/lib/supabase';

export const QUOTATION_FLOW: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ['pending', 'rejected'],
  pending: ['approved', 'rejected', 'draft'],
  approved: ['completed', 'pending', 'rejected'],
  rejected: ['pending'],
  completed: [],
};
export const ALL_QUOTATION_STATUSES: QuotationStatus[] = ['draft', 'pending', 'approved', 'rejected', 'completed'];

/** Moves a person may make from the current status. Manager / owner (rank >= 2) may correct to any other status; it is still logged. */
export function allowedQuotationMoves(from: QuotationStatus, rank: number): QuotationStatus[] {
  return rank >= 2 ? ALL_QUOTATION_STATUSES.filter(s => s !== from) : QUOTATION_FLOW[from] ?? [];
}

/** "Expired" is derived, never stored: only a pending quotation whose validity date has passed. */
export function isQuotationExpired(q: { status: string; validity_date: string | null }, today: string): boolean {
  return q.status === 'pending' && !!q.validity_date && q.validity_date < today;
}
export type FollowUp = 'none' | 'overdue' | 'today' | 'upcoming';
export function followUpState(date: string | null | undefined, status: string, today: string): FollowUp {
  if (!date || status === 'completed' || status === 'rejected') return 'none';
  return date < today ? 'overdue' : date === today ? 'today' : 'upcoming';
}

export const CASE_STAGES: { value: CaseStage; label: string; hint: string }[] = [
  { value: 'new', label: 'New', hint: 'Case opened' },
  { value: 'documents', label: 'Documents', hint: 'Collecting papers from the client' },
  { value: 'submitted', label: 'Submitted', hint: 'File sent to the Excise office' },
  { value: 'processing', label: 'In process', hint: 'Waiting for the Excise office' },
  { value: 'ready', label: 'Ready', hint: 'Ready to hand over to the client' },
  { value: 'delivered', label: 'Delivered', hint: 'Handed over, case complete' },
];
export const stageLabel = (s: string | null | undefined) => CASE_STAGES.find(x => x.value === s)?.label ?? s ?? '';
export function nextStage(s: CaseStage | null | undefined): CaseStage | null {
  const i = CASE_STAGES.findIndex(x => x.value === (s ?? 'new'));
  return i >= 0 && i < CASE_STAGES.length - 1 ? CASE_STAGES[i + 1].value : null;
}
export const CASE_PRIORITIES: { value: CasePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-slate-100 text-slate-600' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-100 text-blue-700' },
  { value: 'high', label: 'High', color: 'bg-amber-100 text-amber-700' },
  { value: 'urgent', label: 'Urgent', color: 'bg-rose-100 text-rose-700' },
];

/** The stage a case should show once its status is known (mirrors what the database does when status is set directly). */
export const isClosed = (status: CaseStatus | string | undefined) => status === 'completed' || status === 'cancelled';

export function docProgress(docs: { required: boolean; received: boolean }[]): { required: number; received: number; missing: number; complete: boolean } {
  const req = docs.filter(d => d.required);
  const got = req.filter(d => d.received).length;
  return { required: req.length, received: got, missing: req.length - got, complete: req.length > 0 && got === req.length };
}
export function caseOverdue(c: { status: string; due_date?: string | null }, today: string): boolean {
  return !isClosed(c.status) && !!c.due_date && c.due_date < today;
}

export const FIELD_LABEL: Record<string, string> = { status: 'Status', stage: 'Stage', assigned_to: 'Assigned to' };
