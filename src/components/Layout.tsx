import { Fragment, useState, type ReactNode } from 'react';
import { usePageTitle } from '@/lib/pageTitle';
import { SidebarCollapsedContext } from '@/lib/sidebar';
import { meets, roleLabel, type Role } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import { Car, LogOut, LayoutDashboard, FileText, Users, Calculator, Settings, Shield, Landmark, MoreHorizontal, X, SlidersHorizontal, FolderOpen, ListChecks, Boxes, Receipt, BarChart3, Printer, Repeat, PanelLeftClose, PanelLeftOpen, UserCog, Search, Bell, Target, Wallet } from 'lucide-react';
import { useNotifications } from '@/lib/useNotifications';
import NotificationBell from '@/components/NotificationBell';

export type Route = 'dashboard' | 'calculator' | 'quotations' | 'clients' | 'cases' | 'vehicles' | 'tasks' | 'reminders' | 'inventory' | 'receipts' | 'reports' | 'hpa' | 'fee-rules' | 'punjab-rates' | 'ict-rates' | 'settings' | 'audit' | 'form-f' | 'transfers' | 'users' | 'leads' | 'expenses';

type Item = { route: Route; label: string; short?: string; icon: typeof LayoutDashboard; min?: Role; group?: string };
const NAV_ITEMS: Item[] = [
  { route: 'dashboard', label: 'Dashboard', short: 'Home', icon: LayoutDashboard, group: 'Daily work' },
  { route: 'calculator', label: 'Fee Calculator', short: 'Calculate', icon: Calculator, group: 'Daily work' },
  { route: 'quotations', label: 'Quotations', short: 'Quotes', icon: FileText, group: 'Daily work' },
  { route: 'cases', label: 'Cases', icon: FolderOpen, group: 'Daily work' },
  { route: 'transfers', label: 'Transfers', icon: Repeat, group: 'Daily work' },
  { route: 'hpa', label: 'HPA Tracker', short: 'HPA', icon: Landmark, group: 'Daily work' },
  { route: 'leads', label: 'Leads & Follow-up', icon: Target, group: 'People' },
  { route: 'clients', label: 'Clients', icon: Users, group: 'People' },
  { route: 'vehicles', label: 'Vehicles & Renewals', icon: Car, group: 'People' },
  { route: 'tasks', label: 'Tasks', icon: ListChecks, group: 'People' },
  { route: 'reminders', label: 'Reminders', icon: Bell, group: 'People' },
  { route: 'receipts', label: 'Receipts', icon: Receipt, group: 'Money' },
  { route: 'expenses', label: 'Expenses', icon: Wallet, min: 'manager', group: 'Money' },
  { route: 'reports', label: 'Reports & Profit', icon: BarChart3, min: 'manager', group: 'Money' },
  { route: 'form-f', label: 'Form F', icon: Printer, group: 'More' },
  { route: 'inventory', label: 'Inventory', icon: Boxes, group: 'More' },
  { route: 'punjab-rates', label: 'Punjab Rates', icon: SlidersHorizontal, min: 'admin', group: 'Admin' },
  { route: 'ict-rates', label: 'Islamabad Rates', icon: SlidersHorizontal, min: 'admin', group: 'Admin' },
  { route: 'fee-rules', label: 'Other Fee Rules', icon: Settings, min: 'admin', group: 'Admin' },
  { route: 'settings', label: 'Settings & Messages', icon: Settings, min: 'admin', group: 'Admin' },
  { route: 'audit', label: 'Audit Log', icon: Shield, min: 'admin', group: 'Admin' },
  { route: 'users', label: 'Users & Rights', icon: UserCog, min: 'admin', group: 'Admin' },
];
const TABS: Route[] = ['dashboard', 'calculator', 'quotations', 'hpa'];

function Logo({ size = 40 }: { size?: number }) {
  const s = useSettings();
  return s.logo_data_url ? (
    <img src={s.logo_data_url} alt={s.business_name} style={{ height: size, width: size }} className="object-contain rounded-full flex-shrink-0" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/10 flex-shrink-0">
      <Car className="text-slate-900" style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.5} />
    </div>
  );
}

export default function Layout({ current, onNavigate, onSearch, children }: { current: Route; onNavigate: (r: Route) => void; onSearch?: () => void; children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const s = useSettings();
  const [more, setMore] = useState(false);
  const notif = useNotifications();
  const visibleItems = NAV_ITEMS.filter(i => !i.min || meets(profile, i.min));
  // Desktop menu: full or icon-only. The person chooses with the button at the bottom of the menu, and it is remembered.
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('lb_sidebar') === 'collapsed'; } catch { return false; } });
  const toggleCompact = () => setCompact(c => { const n = !c; try { localStorage.setItem('lb_sidebar', n ? 'collapsed' : 'open'); } catch { /* ignore */ } return n; });
  const label = NAV_ITEMS.find(i => i.route === current)?.label;
  usePageTitle(label);
  const go = (r: Route) => { setMore(false); onNavigate(r); window.scrollTo({ top: 0 }); };

  return (
    <SidebarCollapsedContext.Provider value={compact}>
    <div className="min-h-screen bg-slate-50">
      <a href="#main" className="skip-link">Skip to content</a>
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex ${compact ? 'w-16' : 'w-64'} bg-slate-900 text-slate-300 flex-col fixed inset-y-0 left-0 z-30`}>
        <div className={`${compact ? 'px-2 justify-center flex' : 'px-5'} py-5 border-b border-slate-800`}>
          <div className="flex items-center gap-3">
            <Logo />
            <div className={`min-w-0 ${compact ? 'hidden' : ''}`}>
              <p className="font-bold text-white text-sm leading-tight truncate">{s.business_name}</p>
              <p className="text-[11px] text-slate-500 truncate">{s.tagline}</p>
            </div>
          </div>
        </div>
        {onSearch && (
          <div className={`${compact ? 'px-2' : 'px-3'} pt-3`}>
            <button onClick={onSearch} title="Search clients and vehicles (Ctrl+K)" aria-label="Search clients and vehicles" className={`w-full flex items-center ${compact ? 'justify-center' : 'gap-2 px-3'} py-2 rounded-lg text-sm text-slate-400 bg-slate-800/60 hover:text-white hover:bg-slate-800 transition`}>
              <Search className="w-4 h-4 flex-shrink-0" />{!compact && <><span className="flex-1 text-left">Search</span><kbd className="text-[10px] text-slate-500 border border-slate-700 rounded px-1">Ctrl K</kbd></>}
            </button>
            {notif.ready && <NotificationBell items={notif.items} unread={notif.unread} onOpenAll={() => go('reminders')} onMarkRead={notif.markRead} label={compact ? undefined : <span className="flex-1 text-left ml-2">Notifications</span>} className={`mt-2 w-full flex items-center ${compact ? 'justify-center' : 'gap-0 px-3'} py-2 rounded-lg text-sm text-slate-400 bg-slate-800/60 hover:text-white hover:bg-slate-800 transition`} />}
          </div>
        )}
        <nav className={`flex-1 py-4 ${compact ? 'px-2' : 'px-3'} space-y-1 overflow-y-auto`}>
          {visibleItems.map((item, i) => {
            const Icon = item.icon;
            const active = current === item.route;
            const head = item.group && item.group !== visibleItems[i - 1]?.group;
            return (
              <Fragment key={item.route}>
              {head && (compact ? <div className="border-t border-slate-800 my-2" /> : <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.group}</p>)}
              <button key={item.route} title={item.label} aria-label={item.label} onClick={() => go(item.route)} className={`w-full flex items-center ${compact ? 'justify-center px-0' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm font-medium transition ${active ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'}`}>
                <Icon className="w-4 h-4 flex-shrink-0" />{!compact && item.label}
              </button>
              </Fragment>
            );
          })}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <div className={`flex items-center gap-3 px-3 py-2 mb-2 ${compact ? 'justify-center px-0' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-white">{(profile?.full_name || '?').charAt(0).toUpperCase()}</div>
            <div className={`flex-1 min-w-0 ${compact ? 'hidden' : ''}`}><p className="text-sm font-medium text-white truncate">{profile?.full_name || 'User'}</p><p className="text-[11px] text-slate-500 ">{roleLabel(profile?.role)}</p></div>
          </div>
          <button onClick={toggleCompact} title={compact ? 'Expand menu' : 'Collapse menu'} aria-label={compact ? 'Expand menu' : 'Collapse menu'} className={`w-full flex items-center ${compact ? 'justify-center' : 'gap-2 px-3'} py-2 mb-1 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition`}>{compact ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}{!compact && 'Collapse menu'}</button>
          <button onClick={signOut} title="Sign Out" aria-label="Sign Out" className={`w-full flex items-center ${compact ? 'justify-center' : 'gap-2 px-3'} py-2 text-sm text-slate-400 hover:text-rose-400 hover:bg-slate-800/50 rounded-lg transition`}><LogOut className="w-4 h-4" />{!compact && 'Sign Out'}</button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 bg-slate-900 text-white flex items-center gap-3 px-4 h-14 pt-[env(safe-area-inset-top)] box-content">
        <Logo size={32} />
        <div className="min-w-0 flex-1"><p className="font-bold text-sm leading-tight truncate">{s.business_name}</p><p className="text-[11px] text-slate-400 truncate">{s.tagline}</p></div>
        {notif.ready && <NotificationBell items={notif.items} unread={notif.unread} onOpenAll={() => go('reminders')} onMarkRead={notif.markRead} className="p-2.5 text-slate-300 hover:text-white" />}
        {onSearch && <button onClick={onSearch} className="p-2.5 -mr-2 text-slate-300 hover:text-white" aria-label="Search clients and vehicles"><Search className="w-5 h-5" /></button>}
      </header>

      <div className={`${compact ? 'lg:ml-16' : 'lg:ml-64'} min-w-0`}>
        <main id="main" tabIndex={-1} className={current === 'calculator' ? 'p-4 pb-20 sm:p-5 lg:p-6 lg:pb-8 w-full' : 'p-4 pb-20 sm:p-5 lg:p-6 lg:pb-8 w-full'}>{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 grid grid-cols-5 pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        {TABS.map(r => {
          const item = NAV_ITEMS.find(i => i.route === r)!; const Icon = item.icon; const active = current === r;
          return (
            <button key={r} onClick={() => go(r)} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-medium ${active ? 'text-amber-600' : 'text-slate-500'}`}>
              <Icon className="w-5 h-5" />{item.short}
            </button>
          );
        })}
        <button onClick={() => setMore(true)} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-medium ${!TABS.includes(current) ? 'text-amber-600' : 'text-slate-500'}`}><MoreHorizontal className="w-5 h-5" />More</button>
      </nav>

      {/* Mobile "More" sheet */}
      {more && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setMore(false)}>
          <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2"><p className="font-semibold text-slate-900">More</p><button onClick={() => setMore(false)} className="p-2 -m-2 text-slate-400" aria-label="Close"><X className="w-5 h-5" /></button></div>
            <div className="divide-y divide-slate-100">
              {visibleItems.filter(i => !TABS.includes(i.route)).map((item, idx, arr) => { const Icon = item.icon; return (
                <Fragment key={item.route}>
                {item.group !== arr[idx - 1]?.group && <p className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{item.group}</p>}
                <button onClick={() => go(item.route)} className="w-full flex items-center gap-3 py-3.5 text-slate-700"><Icon className="w-5 h-5 text-slate-400" />{item.label}</button>
                </Fragment>
              ); })}
              <button onClick={signOut} className="w-full flex items-center gap-3 py-3.5 text-rose-600"><LogOut className="w-5 h-5" />Sign out ({profile?.full_name || 'User'})</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </SidebarCollapsedContext.Provider>
  );
}
