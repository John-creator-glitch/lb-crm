import { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import Login from '@/pages/Login';
import Layout, { type Route } from '@/components/Layout';
import type { ClientTarget } from '@/pages/Clients';
import type { Client360Tab } from '@/pages/Client360';
import GlobalSearch from '@/components/GlobalSearch';
import { setPrefill, type Prefill } from '@/lib/prefill';
import { supabase } from '@/lib/supabase';
import { DrillProvider, type Drill } from '@/lib/drill';
import { Spinner } from '@/components/ui';
import { friendlyError } from '@/lib/errors';

import Dashboard from '@/pages/Dashboard';
import CalculatorPage from '@/pages/Calculator';
import QuotationsList from '@/pages/QuotationsList';
import QuotationDetail from '@/pages/QuotationDetail';
import Clients from '@/pages/Clients';
import FeeRules from '@/pages/FeeRules';
import PunjabRates from '@/pages/PunjabRates';
import IctRates from '@/pages/IctRates';
import Hpa from '@/pages/Hpa';
import Cases from '@/pages/Cases';
import CaseDetail from '@/pages/CaseDetail';
import Leads from '@/pages/Leads';
import Expenses from '@/pages/Expenses';
import Vehicles from '@/pages/Vehicles';
import Tasks from '@/pages/Tasks';
import Reminders from '@/pages/Reminders';
import Inventory from '@/pages/Inventory';
import Receipts from '@/pages/Receipts';
import FormF from '@/pages/FormF';
import Transfers from '@/pages/Transfers';
import Reports from '@/pages/Reports';
import SettingsPage from '@/pages/Settings';
import AuditLogPage from '@/pages/AuditLog';
import UsersPage from '@/pages/Users';
import Pending from '@/pages/Pending';
import SetPassword from '@/pages/SetPassword';

function AppContent() {
  const { session, loading, profile, recovery } = useAuth();
  const [route, setRoute] = useState<Route>('dashboard');
  const [selectedQuotation, setSelectedQuotation] = useState<string | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [clientTarget, setClientTarget] = useState<ClientTarget | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl+K / Cmd+K opens the global search from any page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sync route with hash
  useEffect(() => {
    const hash = window.location.hash.slice(1) as Route;
    if (hash && ['dashboard', 'calculator', 'quotations', 'clients', 'cases', 'vehicles', 'tasks', 'reminders', 'inventory', 'receipts', 'reports', 'fee-rules', 'punjab-rates', 'ict-rates', 'hpa', 'settings', 'audit', 'form-f', 'transfers', 'users', 'leads', 'expenses'].includes(hash)) {
      setRoute(hash);
    }
  }, []);

  function navigate(r: Route) {
    setDrill(null);
    setRoute(r);
    window.location.hash = r;
    if (r !== 'quotations') setSelectedQuotation(null);
    if (r !== 'cases') setSelectedCase(null);
    if (r !== 'clients') setClientTarget(null);
  }

  /** Open a client's 360 page (optionally on a tab), from the global search or from another page. */
  function openClient(id: string, tab?: Client360Tab) {
    setClientTarget({ id, tab, nonce: Date.now() });
    setSelectedQuotation(null);
    setRoute('clients'); window.location.hash = 'clients';
    window.scrollTo({ top: 0 });
  }
  /** A dashboard KPI was clicked: ask the database for the records it counted and open that page restricted to them. */
  async function openDrill(kind: string, label: string, route: Route, from: string, to: string) {
    const { data, error } = await supabase.rpc('kpi_ids', { p_kind: kind, p_from: from, p_to: to });
    if (error) { window.alert('Could not open these records: ' + friendlyError(error)); return; }
    const ids = ((data ?? []) as (string | { kpi_ids: string })[]).map(x => typeof x === 'string' ? x : x.kpi_ids);
    navigate(route);
    setDrill({ route, kind, label, ids });
  }
  function openCase(id: string) {
    setSelectedCase(id); setSelectedQuotation(null);
    setRoute('cases'); window.location.hash = 'cases';
    window.scrollTo({ top: 0 });
  }
  /** Start a workflow with the client (and vehicle) already chosen. */
  function startWorkflow(r: Route, prefill?: Prefill) {
    setPrefill(prefill ?? null);
    navigate(r);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spinner label="Loading..." />
      </div>
    );
  }

  if (!session) return <Login />;
  // opened from the reset e-mail, or the owner gave a temporary password: nothing else is shown until a new password is chosen
  if (recovery || profile?.must_change_password) return <SetPassword forced={!recovery} />;
  // Signed in but not approved by the owner yet (or switched off): no data is reachable, so show a waiting screen.
  if (profile && profile.active === false) return <Pending />;

  return (
    <DrillProvider drill={drill} clear={() => setDrill(null)}>
    <Layout current={route} onNavigate={navigate} onSearch={() => setSearchOpen(true)}>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} onOpenClient={openClient} onOpenVehicleOnly={() => navigate('vehicles')} />
      {route === 'dashboard' && <Dashboard onDrill={openDrill} onNavigate={navigate} />}
      {route === 'calculator' && <CalculatorPage onNavigate={navigate} />}
      {route === 'quotations' && !selectedQuotation && (
        <QuotationsList onSelect={id => setSelectedQuotation(id)} />
      )}
      {route === 'quotations' && selectedQuotation && (
        <QuotationDetail quotationId={selectedQuotation} onBack={() => setSelectedQuotation(null)} onOpenCase={openCase} />
      )}
      {route === 'clients' && <Clients onOpenQuotation={id => { navigate('quotations'); setSelectedQuotation(id); }} onOpenCase={openCase} onStart={startWorkflow} target={clientTarget} />}
      {route === 'cases' && !selectedCase && <Cases onOpen={openCase} />}
      {route === 'cases' && selectedCase && <CaseDetail caseId={selectedCase} onBack={() => setSelectedCase(null)} onOpenClient={openClient} onOpenQuotation={id => { navigate('quotations'); setSelectedQuotation(id); }} />}
      {route === 'leads' && <Leads onOpenClient={openClient} />}
      {route === 'expenses' && <Expenses />}
      {route === 'vehicles' && <Vehicles onOpenClient={openClient} />}
      {route === 'receipts' && <Receipts />}
      {route === 'form-f' && <FormF />}
      {route === 'transfers' && <Transfers onNavigate={navigate} />}
      {route === 'tasks' && <Tasks />}
      {route === 'reminders' && <Reminders />}
      {route === 'inventory' && <Inventory />}
      {route === 'reports' && <Reports />}
      {route === 'fee-rules' && <FeeRules />}
      {route === 'punjab-rates' && <PunjabRates />}
      {route === 'ict-rates' && <IctRates />}
      {route === 'hpa' && <Hpa />}
      {route === 'settings' && <SettingsPage />}
      {route === 'audit' && <AuditLogPage />}
      {route === 'users' && <UsersPage />}
    </Layout>
    </DrillProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Spinner label="Loading..." /></div>}>
        <AppContent />
      </Suspense>
    </AuthProvider>
  );
}
