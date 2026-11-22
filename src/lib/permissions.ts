import { useAuth } from '@/lib/auth';

// Hierarchy: Owner (db role "admin") > Manager > Staff. Higher includes everything below.
// The database enforces the same rules (row level security); this only hides buttons people cannot use.
export type Role = 'admin' | 'manager' | 'staff';
export const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: 'admin', label: 'Owner', blurb: 'Everything, including users, settings, rates and restore' },
  { value: 'manager', label: 'Manager', blurb: 'All business data, can delete, reports and backup' },
  { value: 'staff', label: 'Staff', blurb: 'Daily work: quotations, clients, transfers, record payments' },
];
export const roleLabel = (r?: string | null) => ROLES.find(x => x.value === r)?.label ?? 'Staff';
const RANK: Record<string, number> = { admin: 3, manager: 2, staff: 1 };

export function rankOf(p?: { role?: string | null; active?: boolean | null } | null): number {
  if (!p || p.active === false) return 0; // active is undefined before the roles migration has been run: treated as active
  return RANK[p.role ?? ''] ?? 1;
}
export const meets = (p: Parameters<typeof rankOf>[0], min: Role) => rankOf(p) >= RANK[min];

/** useCan('manager') is true for managers and the owner. */
export function useCan(min: Role): boolean {
  const { profile } = useAuth();
  return meets(profile, min);
}

/** What each role may do. Shown on the Users page. */
export const RIGHTS_MATRIX: { what: string; staff: boolean; manager: boolean; admin: boolean }[] = [
  { what: 'Fee calculator, quotations, send PDF / WhatsApp', staff: true, manager: true, admin: true },
  { what: 'Add and edit clients, vehicles, transfers, cases, tasks, inventory', staff: true, manager: true, admin: true },
  { what: 'Change client status (active / inactive) and archive a client', staff: true, manager: true, admin: true },
  { what: 'Assign a client to a staff member', staff: false, manager: true, admin: true },
  { what: 'Record a payment', staff: true, manager: true, admin: true },
  { what: 'Delete records (clients, vehicles, transfers, cases...)', staff: false, manager: true, admin: true },
  { what: 'Correct or delete a recorded payment', staff: false, manager: true, admin: true },
  { what: 'Reports', staff: false, manager: true, admin: true },
  { what: 'Download backup', staff: false, manager: true, admin: true },
  { what: 'Restore backup', staff: false, manager: false, admin: true },
  { what: 'Rates, fee rules, settings and branding', staff: false, manager: false, admin: true },
  { what: 'Audit log', staff: false, manager: false, admin: true },
  { what: 'Users: approve, change role, switch off', staff: false, manager: false, admin: true },
];
