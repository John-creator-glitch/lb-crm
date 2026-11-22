import { useEffect, useState, useMemo } from 'react';
import { useSidebarCollapsed } from '@/lib/sidebar';
import { takePrefill } from '@/lib/prefill';
import { useDuplicates, useDupAck } from '@/lib/useDuplicates';
import DuplicateWarning from '@/components/DuplicateWarning';
import { supabase, PROVINCES, TRANSACTION_TYPES, VEHICLE_CATEGORIES, FILER_STATUSES, ORIGINS, FUEL_TYPES, type FeeRule, type Province, type TransactionType, type VehicleCategory, type FilerStatus, type Origin, type FuelType, type Client } from '@/lib/supabase';
import { punjabMissing } from '@/lib/punjab';
import { isIctCar, ictMissing } from '@/lib/ict';
import { usePunjabRates, useIctRates } from '@/lib/ratesStore';
import { rateReminders } from '@/lib/punjabRates';
import { parseCard, missingFromCard, type CardData } from '@/lib/cardParser';
import { readCardText } from '@/lib/cardReader';
import { parseInvoice, type InvoiceData } from '@/lib/invoiceParser';
import { isPunjabCar, calculate, recalcTotals, type CalcResult, type CalculationBreakdown } from '@/lib/calc';
import { formatPKR } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { customChargeItems, newField, FIELD_KIND_LABEL, type CustomField, type CustomFieldKind } from '@/lib/customFields';
import { PageHeader, Card, Field, Input, Select, Button, Spinner, EmptyState } from '@/components/ui';
import { Calculator as CalcIcon, Plus, AlertTriangle, Save, Edit3, Search, Car, Info, CheckCircle2, X, MessageCircle, Download, Image as ImageIcon } from 'lucide-react';
import { buildQuotationPdf } from '@/lib/quotationPdf';
import { shareFile, downloadBlob, pdfToPng } from '@/lib/share';
import type { Quotation, QuotationLineItem, Vehicle } from '@/lib/supabase';

interface ServiceCharge { label: string; amount: number; }
interface AdditionalExpense { label: string; amount: number; }

interface VehicleLookup {
  registrationNumber: string;
  verified: boolean;
  source: string | null;
  verifiedAt: string | null;
}

export default function CalculatorPage({ onNavigate }: { onNavigate: (r: any) => void }) {
  const settings = useSettings();
  // 3 panels need width: at 1280px when the menu is collapsed, at 1536px when it is open
  const wide = useSidebarCollapsed();
  const L = wide
    ? { grid: 'xl:grid-cols-3', contents: 'xl:contents', panel: 'xl:h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1 xl:pb-4 xl:[&_input:not([type=checkbox])]:!py-1.5 xl:[&_select]:!py-1.5 xl:[&_label]:!mb-1' }
    : { grid: '2xl:grid-cols-3', contents: '2xl:contents', panel: '2xl:h-[calc(100vh-2rem)] 2xl:overflow-y-auto 2xl:pr-1 2xl:pb-4 2xl:[&_input:not([type=checkbox])]:!py-1.5 2xl:[&_select]:!py-1.5 2xl:[&_label]:!mb-1' };
  const [rules, setRules] = useState<FeeRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);

  // Step 1 — Service selection
  const [province, setProvince] = useState<Province>('punjab');
  const [transactionType, setTransactionType] = useState<TransactionType>('new_registration');

  // Step 2 — Vehicle info
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>('car');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [engineCc, setEngineCc] = useState<number | ''>('');
  const [invoiceValue, setInvoiceValue] = useState<number | ''>('');
  const [manufacturingYear, setManufacturingYear] = useState<number | ''>('');
  const [lateFee, setLateFee] = useState<number | ''>('');
  const [cvtValue, setCvtValue] = useState<number | ''>('');
  const [transferWht, setTransferWht] = useState<number | ''>('');
  const [firstRegDate, setFirstRegDate] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [hirePurchase, setHirePurchase] = useState(false);
  const [manualLines, setManualLines] = useState<{ label: string; amount: number | '' }[]>([]);
  const [mvtManual, setMvtManual] = useState<number | ''>('');
  const [numberPlateFee, setNumberPlateFee] = useState<number | ''>('');
  const [regFeeManual, setRegFeeManual] = useState<number | ''>('');
  const [vehicleClass, setVehicleClass] = useState<'car' | 'double_cabin'>('car');
  const [saleDate, setSaleDate] = useState('');
  const [inv, setInv] = useState<InvoiceData | null>(null);
  const [invBusy, setInvBusy] = useState(false);
  const [invError, setInvError] = useState('');
  async function handleInvoiceUpload(file: File | undefined) {
    if (!file) return;
    setInvBusy(true); setInvError(''); setInv(null);
    try {
      const d = parseInvoice(await readCardText(file));
      setInv(d);
      if (d.price_candidates[0]) setInvoiceValue(d.price_candidates[0].value);
      if (d.invoice_date) setPurchaseDate(d.invoice_date);
      if (d.engine_cc) setEngineCc(d.engine_cc);
      if (d.manufacturing_year) setManufacturingYear(d.manufacturing_year);
      if (d.make) setCompany(d.make);
      if (d.model) setModel(d.model);
      if (d.fuel_type) setFuelType(d.fuel_type);
    } catch (e: any) {
      setInvError(e?.message || 'Could not read this file. Enter the details manually.');
    } finally { setInvBusy(false); }
  }
  const [card, setCard] = useState<CardData | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState('');

  // Punjab car/jeep is calculated by the built-in engine. Every other combination (ICT, Sindh, KPK, buses, trucks, ...)
  // is calculated from admin fee rules if some exist; when none exist yet, the calculator falls back to entering the e-pay challan lines
  // so it always works instead of returning an empty quotation.
  const pbEngine = isPunjabCar({ province, vehicle_category: vehicleCategory, transaction_type: transactionType });
  const hasRules = rules.some(r => r.is_active && r.province === province && r.transaction_type === transactionType && r.vehicle_category === vehicleCategory);
  const ictEngine = isIctCar({ province, vehicle_category: vehicleCategory, transaction_type: transactionType });
  const manualMode = !pbEngine && !ictEngine && !hasRules;
  useEffect(() => {
    // Re-seed the lines whenever province / transaction type changes, so token tax never shows registration lines
    if (manualMode) {
      setManualLines(transactionType === 'token_tax'
        ? [{ label: 'Annual Token Tax (Motor Vehicle Tax)', amount: '' }, { label: 'Arrears / Penalty (if any)', amount: '' }, { label: 'Govt. Platform Charges', amount: '' }]
        : province === 'punjab'
        ? [{ label: 'Registration Fee', amount: '' }, { label: 'Motor Vehicle Tax', amount: '' }, { label: 'Income Tax', amount: '' },
           { label: 'Additional Reg Mark Fee', amount: '' }, { label: 'Automated Registration Card Fee', amount: 1300 }, { label: 'Professional Tax', amount: '' }, { label: 'Govt. Platform Charges', amount: 15 }]
        : [{ label: 'Registration Fee', amount: '' }, { label: 'Token Tax', amount: '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualMode, province, transactionType]);

  async function handleCardUpload(file: File | undefined) {
    if (!file) return;
    setCardBusy(true); setCardError(''); setCard(null);
    try {
      const d = parseCard(await readCardText(file));
      setCard(d);
      if (d.engine_cc) setEngineCc(d.engine_cc);
      if (d.manufacturing_year) setManufacturingYear(d.manufacturing_year);
      if (d.registration_date) setFirstRegDate(d.registration_date);
      if (d.registration_number) setRegistrationNumber(d.registration_number);
      if (d.make) setCompany(d.make);
      if (d.model) setModel(d.model);
    } catch (e: any) {
      setCardError(e?.message || 'Could not read this file. Enter the details manually.');
    } finally { setCardBusy(false); }
  }
  const [vehicleValue, setVehicleValue] = useState<number | ''>('');
  const [filerStatus, setFilerStatus] = useState<FilerStatus>('filer');
  const [fuelType, setFuelType] = useState<FuelType | ''>('');
  const [origin, setOrigin] = useState<Origin | ''>('');
  const [company, setCompany] = useState('');
  const [model, setModel] = useState('');

  // Vehicle lookup state (existing vehicles)
  const [lookup, setLookup] = useState<VehicleLookup | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  // Step 3 — Service charges
  const [serviceCharges, setServiceCharges] = useState<ServiceCharge[]>([{ label: 'Service Charges', amount: 5000 }]);
  const [svcTouched, setSvcTouched] = useState(false);
  useEffect(() => { if (!svcTouched && settings.service_presets[0]) setServiceCharges([{ ...settings.service_presets[0] }]); }, [settings.service_presets, svcTouched]);
  const [additionalExpenses, setAdditionalExpenses] = useState<AdditionalExpense[]>([]);

  // Client
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  // M2: warn (never block) when the new client's phone already belongs to somebody
  const calcDup = useDuplicates(newClientName.trim() ? { phone: newClientPhone } : {});
  const calcAck = useDupAck(calcDup.result);
  // M2: a vehicle chosen from Client 360 is linked by id instead of being saved again
  const [existingVehicle, setExistingVehicle] = useState<Vehicle | null>(null);

  // Calculation
  const [breakdown, setBreakdown] = useState<CalculationBreakdown | null>(null);
  const [lineItems, setLineItems] = useState<CalcResult[]>([]);
  const [overrideModal, setOverrideModal] = useState<{ index: number; item: CalcResult } | null>(null);
  const [overrideAmount, setOverrideAmount] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [clientErr, setClientErr] = useState('');
  const [missingInfo, setMissingInfo] = useState<string[]>([]);
  // Quick send: share the calculation as a PDF/image right away. Nothing is saved to the database and no client record is needed.
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickBusy, setQuickBusy] = useState('');
  const [quickNote, setQuickNote] = useState('');
  function makeQuickPdf() {
    const d = new Date(); const now = d.toISOString();
    const num = `EST-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const quotation = { id: 'draft', quotation_number: num, client_id: null, vehicle_id: null, transaction_type: transactionType, status: 'pending',
      calculation_snapshot: null, subtotal_govt: breakdown!.subtotal_govt, subtotal_service: breakdown!.subtotal_service, subtotal_additional: breakdown!.subtotal_additional,
      grand_total: breakdown!.grand_total, validity_date: null, payment_terms: settings.payment_terms || null, notes: null, created_at: now, updated_at: now } as unknown as Quotation;
    const vehicle = { province, company: company || null, model: model || null, engine_cc: engineCc ? Number(engineCc) : null, manufacturing_year: manufacturingYear ? Number(manufacturingYear) : null,
      registration_number: registrationNumber || null, fuel_type: fuelType || null, filer_status: filerStatus } as unknown as Vehicle;
    const client = quickName.trim() || quickPhone.trim() ? ({ name: quickName.trim(), phone: quickPhone.trim() || null } as any) : null;
    return buildQuotationPdf({ quotation, items: lineItems as unknown as QuotationLineItem[], client, vehicle, settings, customFields: customFields.filter(f => f.label.trim()), hirePurchase });
  }
  async function quickSend(kind: 'share-pdf' | 'share-png' | 'download') {
    if (!breakdown) return;
    setQuickBusy(kind); setQuickNote('');
    try {
      const pdf = makeQuickPdf();
      if (kind === 'download') { downloadBlob(pdf.blob, pdf.filename); return; }
      const png = kind === 'share-png';
      const blob = png ? await pdfToPng(pdf.blob) : pdf.blob;
      const file = new File([blob], png ? pdf.filename.replace(/\.pdf$/, '.png') : pdf.filename, { type: png ? 'image/png' : 'application/pdf' });
      const r = await shareFile(file, { title: `${settings.business_name} ${pdf.filename}`, phone: quickPhone });
      setQuickNote(r.message);
    } catch (e: any) { setQuickNote(e?.message || 'Could not prepare the file.'); }
    finally { setQuickBusy(''); }
  }

  const isExistingVehicle = transactionType === 'transfer' || transactionType === 'token_tax';
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const ict = useIctRates(); // Islamabad rates in force today (admin-managed, falls back to built-in defaults)
  const pb = usePunjabRates(); // Punjab rates in force today (admin-managed, falls back to built-in defaults)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('fee_rules').select('*').eq('is_active', true);
      setRules((data as FeeRule[]) ?? []);
      setLoadingRules(false);
    })();
  }, []);

  // When transaction type changes, reset vehicle-specific fields
  function handleTransactionChange(t: TransactionType) {
    setTransactionType(t);
    if (!existingVehicle) setRegistrationNumber('');   // a saved vehicle keeps its number
    setLookup(null);
    setBreakdown(null);
    setLineItems([]);
    setMissingInfo([]);
  }

  function handleProvinceChange(p: Province) {
    setProvince(p);
    setBreakdown(null);
    setLineItems([]);
    setMissingInfo([]);
  }

  function handleCategoryChange(c: VehicleCategory) {
    setVehicleCategory(c);
    setBreakdown(null);
    setLineItems([]);
    setMissingInfo([]);
  }

  // Client search
  useEffect(() => {
    if (!clientSearch.trim()) { setClientResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .or(`name.ilike.%${clientSearch}%,phone.ilike.%${clientSearch}%`)
        .limit(12);
      setClientResults(((data as Client[]) ?? []).filter(c => !c.archived_at).slice(0, 5));
    }, 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  // Opened from Client 360: client (and vehicle) are already chosen, so nothing is typed twice
  useEffect(() => {
    const p = takePrefill();
    if (!p) return;
    (async () => {
      if (p.clientId) {
        const { data } = await supabase.from('clients').select('*').eq('id', p.clientId).maybeSingle();
        if (data) setSelectedClient(data as Client);
      }
      if (p.vehicleId) {
        const { data } = await supabase.from('vehicles').select('*').eq('id', p.vehicleId).maybeSingle();
        const v = data as Vehicle | null;
        if (v) {
          setExistingVehicle(v);
          if (v.province) setProvince(v.province);
          if (v.vehicle_category) setVehicleCategory(v.vehicle_category);
          if (v.registration_number) setRegistrationNumber(v.registration_number);
          if (v.company) setCompany(v.company);
          if (v.model) setModel(v.model);
          if (v.engine_cc) setEngineCc(v.engine_cc);
          if (v.manufacturing_year) setManufacturingYear(v.manufacturing_year);
          if (v.invoice_value) setInvoiceValue(v.invoice_value);
          if (v.filer_status) setFilerStatus(v.filer_status);
          if (v.origin) setOrigin(v.origin);
          if (v.fuel_type) setFuelType(v.fuel_type);
        }
      }
    })();
  }, []);

  // Determine which fields are required based on fee rules for this combination
  const requiredFields = useMemo(() => {
    const matching = rules.filter(r =>
      r.province === province &&
      r.transaction_type === transactionType &&
      r.vehicle_category === vehicleCategory
    );
    const compTypes = new Set(matching.map(r => r.computation_type));
    const feeTypes = new Set(matching.map(r => r.fee_type));

    return {
      engineCc: compTypes.has('slab_cc') || compTypes.has('per_cc'),
      invoiceValue: compTypes.has('percent_of_value') || compTypes.has('percent_of_value_capped') || compTypes.has('slab_value'),
      filerStatus: feeTypes.has('withholding_tax_filer') || feeTypes.has('withholding_tax_nonfiler'),
      vehicleCategory: true,
      registrationNumber: isExistingVehicle,
    };
  }, [rules, province, transactionType, vehicleCategory, isExistingVehicle]);

  const pbMode = isPunjabCar({ province, vehicle_category: vehicleCategory, transaction_type: transactionType });

  // Check for missing info before calculating
  function checkMissingInfo(): string[] {
    const missing: string[] = [];
    if (manualMode) {
      if (!manualLines.some(l => Number(l.amount) > 0)) missing.push('At least one government fee line from the e-pay challan');
      return missing;
    }
    const fuelMissing = (pbMode || ictEngine) && transactionType === 'new_registration' && !fuelType ? ['Fuel Type (Petrol, Diesel, Hybrid or Electric). Electric vehicles get government discounts'] : [];
    if (ictEngine) {
      return [...fuelMissing, ...ictMissing({
        engine_cc: engineCc ? Number(engineCc) : null, invoice_value: invoiceValue ? Number(invoiceValue) : null,
        filer_status: filerStatus, fuel_type: fuelType || null, token_manual: mvtManual === '' ? null : Number(mvtManual),
      }, ict.rates)];
    }
    if (pbMode) {
      if (!engineCc) missing.push('Engine Capacity (CC)');
      if (transactionType === 'new_registration') {
        return [...fuelMissing, ...punjabMissing({
          transaction_type: 'new_registration', engine_cc: engineCc ? Number(engineCc) : null, invoice_value: invoiceValue ? Number(invoiceValue) : null,
          filer_status: filerStatus, mvt_manual: mvtManual === '' ? null : Number(mvtManual),
      reg_fee_manual: regFeeManual === '' ? null : Number(regFeeManual),
      vehicle_class: vehicleClass,
        }, pb.rates)];
      } else {
        return punjabMissing({
          transaction_type: 'transfer', engine_cc: engineCc ? Number(engineCc) : null, invoice_value: null, filer_status: filerStatus,
          first_registration_date: firstRegDate || null, cvt_assessed_value: cvtValue === '' ? null : Number(cvtValue),
          vehicle_value: vehicleValue === '' ? null : Number(vehicleValue),
        }, pb.rates);
      }
      return missing;
    }
    if (requiredFields.registrationNumber && !registrationNumber.trim()) missing.push('Vehicle Registration Number');
    if (requiredFields.engineCc && !engineCc) missing.push('Engine Capacity (CC)');
    if (requiredFields.invoiceValue && !invoiceValue) missing.push('Invoice / Purchase Value');
    if (isExistingVehicle && !lookup?.verified) {
      // Not a blocker, but we note it
    }
    return missing;
  }

  function handleCalculate() {
    const missing = checkMissingInfo();
    setMissingInfo(missing);
    if (missing.length > 0) return;

    const manualResult = manualMode ? {
      lineItems: manualLines.filter(l => l.label.trim() && Number(l.amount) !== 0 && l.amount !== '').map((l, i) => ({
        fee_type: 'manual_epay', label: l.label.trim(), category: 'government' as const, amount: Number(l.amount),
        formula: 'Entered from the e-pay challan', source: 'e-pay challan', rule_version: 'MANUAL', is_override: false, override_reason: null, sort_order: i,
      })),
      warnings: ['This vehicle class is not calculated by the app. Government fees are the lines you copied from e-pay, so the quotation is only as exact as those numbers.'],
    } : null;
    const result = manualResult ? {
      lineItems: manualResult.lineItems, warnings: manualResult.warnings, rule_version: 'MANUAL', calculated_at: new Date().toISOString(),
      subtotal_govt: 0, subtotal_service: 0, subtotal_additional: 0, grand_total: 0,
    } : calculate(rules, {
      province,
      transaction_type: transactionType,
      vehicle_category: vehicleCategory,
      engine_cc: engineCc ? Number(engineCc) : null,
      invoice_value: invoiceValue ? Number(invoiceValue) : null,
      manufacturing_year: manufacturingYear ? Number(manufacturingYear) : null,
      filer_status: filerStatus,
      fuel_type: fuelType || null,
      origin: origin || null,
      late_fee: lateFee === '' ? null : Number(lateFee),
      cvt_assessed_value: cvtValue === '' ? null : Number(cvtValue),
      transfer_wht: transferWht === '' ? null : Number(transferWht),
      first_registration_date: firstRegDate || null,
      purchase_date: purchaseDate || null,
      hire_purchase: hirePurchase,
      mvt_manual: mvtManual === '' ? null : Number(mvtManual),
      reg_fee_manual: regFeeManual === '' ? null : Number(regFeeManual),
      vehicle_class: vehicleClass,
      sale_date: saleDate || null,
      vehicle_value: vehicleValue === '' ? null : Number(vehicleValue),
      number_plate_fee: numberPlateFee === '' ? null : Number(numberPlateFee),
    }, pb.rates, ict.rates);

    const items: CalcResult[] = [
      ...result.lineItems,
      ...serviceCharges.filter(s => s.amount > 0).map((s, i) => ({
        fee_type: 'service_charge', label: s.label, category: 'service' as const, amount: s.amount,
        formula: 'Agency service charge', source: null, rule_version: null, is_override: false, override_reason: null, sort_order: 100 + i,
      })),
      ...additionalExpenses.filter(a => a.amount > 0).map((a, i) => ({
        fee_type: 'additional', label: a.label, category: 'additional' as const, amount: a.amount,
        formula: 'Additional expense', source: null, rule_version: null, is_override: false, override_reason: null, sort_order: 200 + i,
      })),
      ...customChargeItems(customFields, 300),
    ];

    setLineItems(items);
    setBreakdown({ ...result, ...recalcTotals(items) });
  }

  // Vehicle "lookup" — since no official API is available, this is a manual verification step
  function handleVehicleLookup() {
    if (!registrationNumber.trim()) return;
    setLookupBusy(true);
    // No official API exists — this is a manual verification placeholder
    // The admin verifies on the official portal and fills in details themselves
    setTimeout(() => {
      setLookup({
        registrationNumber: registrationNumber.trim(),
        verified: false,
        source: null,
        verifiedAt: null,
      });
      setLookupBusy(false);
    }, 600);
  }

  function applyOverride() {
    if (!overrideModal || !breakdown) return;
    const newAmount = Number(overrideAmount);
    if (isNaN(newAmount) || !overrideReason.trim()) return;
    const updated = [...lineItems];
    updated[overrideModal.index] = { ...updated[overrideModal.index], amount: newAmount, is_override: true, override_reason: overrideReason };
    setLineItems(updated);
    setBreakdown({ ...breakdown, ...recalcTotals(updated) });
    setOverrideModal(null);
    setOverrideAmount('');
    setOverrideReason('');
  }

  async function saveQuotation() {
    if (!breakdown || !selectedClient) return;
    setSaving(true);

    // One database call = one transaction: vehicle + quotation + line items + audit entry are saved together or not at all.
    setClientErr('');
    const { data, error } = await supabase.rpc('create_quotation_atomic', {
      p_client_id: selectedClient.id,
      p_vehicle: {
        id: existingVehicle?.id,   // saved vehicle from Client 360: linked, not inserted again (database function, migration 20261117090000)
        province, registration_type: transactionType, vehicle_category: vehicleCategory,
        company: company || null, model: model || null, engine_cc: engineCc ? Number(engineCc) : null,
        manufacturing_year: manufacturingYear ? Number(manufacturingYear) : null, invoice_value: invoiceValue ? Number(invoiceValue) : null,
        registration_number: registrationNumber || null, filer_status: filerStatus, origin: origin || null, fuel_type: fuelType || null,
      },
      p_quotation: {
        transaction_type: transactionType,
        calculation_snapshot: { breakdown, custom_fields: customFields.filter(f => f.label.trim()), hire_purchase: hirePurchase },
        subtotal_govt: breakdown.subtotal_govt, subtotal_service: breakdown.subtotal_service,
        subtotal_additional: breakdown.subtotal_additional, grand_total: breakdown.grand_total,
        validity_days: settings.validity_days || 15, payment_terms: settings.payment_terms || null,
      },
      p_items: lineItems.map(li => ({
        fee_type: li.fee_type, label: li.label, category: li.category, amount: li.amount, formula: li.formula,
        source: li.source, rule_version: li.rule_version, is_override: li.is_override, override_reason: li.override_reason, sort_order: li.sort_order,
      })),
    });
    setSaving(false);
    if (error || !data) { setClientErr('Quotation save nahi hui, kuch bhi save nahi kiya gaya. ' + (error?.message ?? 'Server ne jawab nahi diya.') + ' Dobara koshish karein.'); return; }
    onNavigate('quotations');
  }

  if (loadingRules) return <Spinner label="Loading fee rules..." />;

  return (
    <>
      <div className="lg:hidden"><PageHeader title="Fee Calculator" subtitle="Select a service, enter vehicle details, and calculate government fees" /></div>
      {pbMode && (pb.problems.length > 0 || rateReminders(pb.rates).length > 0) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
          {pb.problems.length > 0 && <p>The saved Punjab rate set has errors, so the built-in rates are being used: {pb.problems[0]}</p>}
          {rateReminders(pb.rates).map(r => <p key={r}>{r} Ask an admin to review the Punjab Rates page.</p>)}
        </div>
      )}

      {/* Laptop (xl+): 3 panels, each scrolls on its own so no page scrolling. Below xl: form on the left, result on the right (lg) or stacked (phone). */}
      <div className={`grid grid-cols-1 lg:grid-cols-2 ${L.grid} gap-4 lg:gap-5 items-start`}>
        <div className={`space-y-4 lg:space-y-5 ${L.contents}`}>
        {/* Panel 1: Service + Vehicle */}
        <div className={`space-y-4 ${L.panel}`}>
          {/* Step 1 — Service selection */}
          <Card className="p-4">
            <StepHeader step={1} title="Select Service" />
            <Field label="Province / Excise Authority" required>
              <Select value={province} onChange={e => handleProvinceChange(e.target.value as Province)}>
                {PROVINCES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </Field>
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Transaction type">
              {TRANSACTION_TYPES.map(t => (
                <button key={t.value} type="button" role="tab" aria-selected={transactionType === t.value} onClick={() => handleTransactionChange(t.value)}
                  className={`px-2 py-2.5 text-sm font-medium rounded-md transition ${transactionType === t.value ? 'bg-white text-amber-700 shadow-sm ring-1 ring-amber-300' : 'text-slate-500 hover:text-slate-800'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {transactionType === 'new_registration' && 'New vehicle: no registration number yet.'}
              {transactionType === 'transfer' && 'Existing vehicle: starts with the registration number.'}
              {transactionType === 'token_tax' && 'Existing vehicle: annual token tax renewal.'}
            </p>
          </Card>

          {/* Step 2 — Vehicle information */}
          <Card className="p-4">
            <StepHeader step={2} title="Vehicle Information" subtitle={isExistingVehicle ? 'Enter registration number, then fill required details' : 'Enter only the details required by the selected authority'} />
            {existingVehicle && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                <span>Using saved vehicle <b>{[existingVehicle.registration_number, existingVehicle.company, existingVehicle.model].filter(Boolean).join(' ') || 'vehicle'}</b>. The quotation is linked to it; changes you make here are not written to the vehicle record.</span>
                <button type="button" className="font-medium underline" onClick={() => setExistingVehicle(null)}>Use as a new vehicle instead</button>
              </div>
            )}

            {/* Registration number: required for existing vehicles, optional (but saved on the quotation) for new registrations */}
            {(
              <div className="mb-4">
                <Field label={isExistingVehicle ? 'Vehicle Registration Number' : 'Vehicle Registration Number (optional)'} required={isExistingVehicle}>
                  <div className="flex gap-2">
                    <Input
                      value={registrationNumber}
                      onChange={e => { setRegistrationNumber(e.target.value); setLookup(null); }}
                      placeholder={isExistingVehicle ? 'e.g. LEA-1234' : 'If already allotted, e.g. LEA-1234'}
                      className="flex-1 uppercase"
                    />
                    {isExistingVehicle && (
                    <Button variant="secondary" onClick={handleVehicleLookup} disabled={!registrationNumber.trim() || lookupBusy}>
                      {lookupBusy ? <Spinner label="" /> : <Search className="w-4 h-4" />}
                      Verify
                    </Button>)}
                  </div>
                </Field>

                {/* Lookup result */}
                {lookup && (
                  <div className="mt-3 rounded-lg border p-3 bg-blue-50 border-blue-200">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-blue-800 space-y-1">
                        <p className="font-medium">Automated lookup unavailable</p>
                        <p>
                          Official excise portals don't expose public APIs for vehicle verification.
                          Please look up <span className="font-semibold">{lookup.registrationNumber}</span> on the{' '}
                          <a href={getOfficialPortalUrl(province)} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                            {PROVINCES.find(p => p.value === province)?.label} excise portal
                          </a>{' '}
                          and fill in the details below.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Vehicle category — always required */}
            {pbMode && transactionType === 'new_registration' && (
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-medium text-slate-700">Auto-fill from the dealer invoice</div>
                <p className="text-xs text-slate-500 mt-1">Upload the invoice the client gave you (PDF or photo). It is read in your browser only. The government fees are calculated on the invoice price and date.</p>
                <input type="file" accept="application/pdf,image/*" disabled={invBusy} className="mt-2 text-sm"
                  onChange={e => handleInvoiceUpload(e.target.files?.[0])} />
                {invBusy && <p className="text-xs text-slate-500 mt-2">Reading invoice...</p>}
                {invError && <p className="text-xs text-red-600 mt-2">{invError}</p>}
                {inv && (
                  <div className="mt-2 text-xs text-slate-700">
                    <div>Read: {inv.make ?? '-'} {inv.model ?? ''} | {inv.engine_cc ?? '-'}cc | {inv.fuel_type ?? 'fuel ?'} | invoice date {inv.invoice_date ?? '-'} | chassis {inv.chassis_number ?? '-'} | engine {inv.engine_number ?? '-'} | {inv.colour ?? 'colour ?'}</div>
                    {inv.price_candidates.length > 1 && (
                      <div className="mt-1">Several amounts found. Choose the one that is the vehicle's total invoice price:
                        <select className="ml-2 border rounded px-1 py-0.5" value={String(invoiceValue)} onChange={e => setInvoiceValue(Number(e.target.value))}>
                          {inv.price_candidates.map(c => <option key={c.label + c.value} value={c.value}>{c.label}: {c.value.toLocaleString()}</option>)}
                        </select>
                      </div>
                    )}
                    {inv.price_candidates.length === 0 && <div className="text-amber-700 mt-1">No invoice price found. Enter it manually.</div>}
                    <div className="text-amber-700 mt-1">Please check these against the invoice before calculating.</div>
                  </div>
                )}
              </div>
            )}
            {pbMode && transactionType === 'transfer' && (
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-medium text-slate-700">Auto-fill from e-registration card</div>
                <p className="text-xs text-slate-500 mt-1">Download the card free from vrcentpunjab.com/card (registration + chassis number), then upload the PDF or a photo here. The file is read in your browser only.</p>
                <input type="file" accept="application/pdf,image/*" disabled={cardBusy} className="mt-2 text-sm"
                  onChange={e => handleCardUpload(e.target.files?.[0])} />
                {cardBusy && <p className="text-xs text-slate-500 mt-2">Reading card...</p>}
                {cardError && <p className="text-xs text-red-600 mt-2">{cardError}</p>}
                {card && (
                  <div className="mt-2 text-xs text-slate-700">
                    <div>Read: {card.registration_number ?? 'no reg no.'} | {card.make ?? '-'} {card.model ?? ''} | {card.engine_cc ?? '-'}cc | registered {card.registration_date ?? '-'} | chassis {card.chassis_number ?? '-'}</div>
                    {missingFromCard(card).length > 0
                      ? <div className="text-amber-700 mt-1">Not found on the card, enter manually: {missingFromCard(card).join(', ')}</div>
                      : <div className="text-amber-700 mt-1">Please check these against the card before calculating.</div>}
                  </div>
                )}
              </div>
            )}
            <Field label="Vehicle Category" required>
              <Select value={vehicleCategory} onChange={e => handleCategoryChange(e.target.value as VehicleCategory)}>
                {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>

            {/* Conditional fields based on what fee rules need */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {(requiredFields.engineCc || pbMode || ictEngine) && (
                <Field label="Engine Capacity (CC)" required>
                  <Input type="number" value={engineCc} onChange={e => setEngineCc(e.target.value ? Number(e.target.value) : '')} placeholder="e.g. 1300" />
                </Field>
              )}

              {((requiredFields.invoiceValue && !pbMode) || ictEngine || (pbMode && transactionType === 'new_registration')) && (
                <Field label="Invoice / Purchase Value (PKR)" required hint={transactionType === 'new_registration' ? 'Vehicle purchase price' : 'Current vehicle value for fee calculation'}>
                  <Input type="number" value={invoiceValue} onChange={e => setInvoiceValue(e.target.value ? Number(e.target.value) : '')} placeholder="e.g. 3500000" />
                </Field>
              )}

              {(requiredFields.filerStatus || pbMode || ictEngine) && (
                <Field label="Filer Status" required>
                  <Select value={filerStatus} onChange={e => setFilerStatus(e.target.value as FilerStatus)}>
                    {FILER_STATUSES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </Select>
                </Field>
              )}
              {(pbMode || ictEngine) && transactionType === 'new_registration' && (
                <Field label="Fuel Type" required hint={
                  fuelType === 'electric' ? (ictEngine ? 'Electric: registration fee exempt in Islamabad (not yet confirmed on an ICT challan). Enter the ICT token tax' : 'Electric: 95% off registration fee and 99% off motor vehicle tax, shown as discount lines')
                  : fuelType === 'hybrid' ? 'Hybrid / plug-in hybrid: no government discount (matches the Tank 500 PHEV challan)'
                  : 'Petrol and diesel: no discount. Choose Electric or Hybrid if it applies'}>
                  <Select value={fuelType} onChange={e => setFuelType(e.target.value as FuelType)}>
                    <option value="">Select...</option>
                    {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </Select>
                </Field>
              )}
              {(pbMode || ictEngine) && transactionType === 'new_registration' && (
                <Field label="Invoice / purchase date" hint="Used to add the late registration fine automatically">
                  <Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
                </Field>
              )}
              {(pbMode || ictEngine) && transactionType === 'new_registration' && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={hirePurchase} onChange={e => setHirePurchase(e.target.checked)} />
                  Bank financed (Hire Purchase Agreement)
                </label>
              )}
              {pbMode && transactionType === 'new_registration' && (
                <Field label="Vehicle class" required hint="As printed on the challan class line">
                  <select className="w-full border rounded px-2 py-2 text-sm" value={vehicleClass} onChange={e => setVehicleClass(e.target.value as 'car' | 'double_cabin')}>
                    <option value="car">Passenger car (4 to 9 seats)</option>
                    <option value="double_cabin">Double cabin goods vehicle (up to 2500cc)</option>
                  </select>
                </Field>
              )}
              {pbMode && transactionType === 'new_registration' && vehicleClass === 'car' && Number(engineCc) > 2000 && Number(engineCc) <= 2500 && (
                <Field label="Registration Fee (PKR)" required hint="2001 to 2500cc rate not verified. Copy from e-pay">
                  <Input type="number" value={regFeeManual} onChange={e => setRegFeeManual(e.target.value === '' ? '' : Number(e.target.value))} />
                </Field>
              )}
              {pbMode && transactionType === 'new_registration' && vehicleClass === 'car' && ((Number(engineCc) > 1000 && Number(engineCc) <= 1300) || (Number(engineCc) > 2000 && Number(engineCc) <= 2500)) && (
                <Field label="Motor Vehicle Tax (PKR)" required hint="Rate for this CC band not verified. Copy from e-pay">
                  <Input type="number" value={mvtManual} onChange={e => setMvtManual(e.target.value === '' ? '' : Number(e.target.value))} />
                </Field>
              )}
              {pbMode && transactionType === 'transfer' && (
                <Field label="Date of sale" hint="When the buyer took the car. Late transfer penalty after 30 days">
                  <Input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} />
                </Field>
              )}
              {ictEngine && (
                <>
                  <Field label="Motor Vehicle Tax (PKR)" hint="Optional. Only to override the calculated figure with the ICT amount">
                    <Input type="number" value={mvtManual} onChange={e => setMvtManual(e.target.value === '' ? '' : Number(e.target.value))} />
                  </Field>
                  <Field label="Number Plate Fee (PKR)" hint="Optional. Standard fee 1,000 is added automatically">
                    <Input type="number" value={numberPlateFee} onChange={e => setNumberPlateFee(e.target.value === '' ? '' : Number(e.target.value))} />
                  </Field>
                </>
              )}
              {(pbMode || ictEngine) && transactionType === 'new_registration' && (
                <Field label="Late Registration Fee (PKR)" hint="Optional. Only if registered late (copy from e-pay)">
                  <Input type="number" value={lateFee} onChange={e => setLateFee(e.target.value === '' ? '' : Number(e.target.value))} placeholder="e.g. 3000" />
                </Field>
              )}
              {pbMode && transactionType === 'transfer' && (
                <>
                  <Field label="First registration date" required hint="From registration card. Needed for age based tax">
                    <Input type="date" value={firstRegDate} onChange={e => setFirstRegDate(e.target.value)} />
                  </Field>
                  <Field label="CVT assessed value (PKR)" hint="Exact: from e-pay (CVT x 100). Leave empty to estimate">
                    <Input type="number" value={cvtValue} onChange={e => setCvtValue(e.target.value === '' ? '' : Number(e.target.value))} placeholder="e.g. 8021600" />
                  </Field>
                  <Field label="Approx. vehicle value (PKR)" hint="Only for a CVT estimate when e-pay value is unknown">
                    <Input type="number" value={vehicleValue} onChange={e => setVehicleValue(e.target.value === '' ? '' : Number(e.target.value))} placeholder="e.g. 8900000" />
                  </Field>
                  <Field label="Withholding Tax override (PKR)" hint="Optional. Only if e-pay shows a different amount">
                    <Input type="number" value={transferWht} onChange={e => setTransferWht(e.target.value === '' ? '' : Number(e.target.value))} />
                  </Field>
                </>
              )}
            </div>

            {manualMode && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-sm font-medium text-slate-800">Government fees from the e-pay challan</div>
                <p className="text-xs text-slate-600 mt-1">No fee rules are saved yet for this province, vehicle type and transaction, so enter the government fee lines from the official challan (e-pay / excise office), one per line. Quotation, PDF and WhatsApp work exactly the same. To have the app calculate this automatically, an admin can add rules under Other Fee Rules.</p>
                <div className="mt-2 space-y-2">
                  {manualLines.map((l, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input className="flex-1 border rounded px-2 py-1.5 text-sm" value={l.label} placeholder="Fee name"
                        onChange={e => setManualLines(manualLines.map((x, j) => j === idx ? { ...x, label: e.target.value } : x))} />
                      <input type="number" className="w-36 border rounded px-2 py-1.5 text-sm" value={l.amount} placeholder="PKR"
                        onChange={e => setManualLines(manualLines.map((x, j) => j === idx ? { ...x, amount: e.target.value === '' ? '' : Number(e.target.value) } : x))} />
                      <button type="button" className="text-slate-500 px-2" onClick={() => setManualLines(manualLines.filter((_, j) => j !== idx))}>x</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="mt-2 text-sm text-blue-700" onClick={() => setManualLines([...manualLines, { label: '', amount: '' }])}>+ Add fee line</button>
                <div className="mt-2 text-sm text-slate-700">Total: Rs {manualLines.reduce((t, l) => t + (Number(l.amount) || 0), 0).toLocaleString()}</div>
              </div>
            )}

            {/* Optional details — collapsible */}
            <details className="mt-4 group">
              <summary className="text-sm font-medium text-slate-500 cursor-pointer hover:text-slate-700 flex items-center gap-1.5 list-none">
                <Plus className="w-3.5 h-3.5 transition group-open:rotate-45" />
                Additional vehicle details (optional)
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <Field label="Company">
                  <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Toyota" />
                </Field>
                <Field label="Model">
                  <Input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. Corolla GLi" />
                </Field>
                <Field label="Manufacturing Year">
                  <Input type="number" value={manufacturingYear} onChange={e => setManufacturingYear(e.target.value ? Number(e.target.value) : '')} placeholder="e.g. 2023" />
                </Field>
                <Field label="Fuel Type">
                  <Select value={fuelType} onChange={e => setFuelType(e.target.value as FuelType)}>
                    <option value="">Select...</option>
                    {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </Select>
                </Field>
                <Field label="Origin">
                  <Select value={origin} onChange={e => setOrigin(e.target.value as Origin)}>
                    <option value="">Select...</option>
                    {ORIGINS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </Field>
              </div>
            </details>

            {/* Missing info warning */}
            {missingInfo.length > 0 && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-rose-800">
                    <p className="font-medium mb-1">Required information missing:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {missingInfo.map(m => <li key={m}>{m}</li>)}
                    </ul>
                    <p className="mt-1.5">Please fill in these fields to calculate fees accurately. The system never calculates with assumed values.</p>
                  </div>
                </div>
              </div>
            )}
          </Card>

        </div>
        {/* Panel 2: Service charges + Custom fields + Calculate */}
        <div className={`space-y-4 ${L.panel}`}>
          {/* Step 3 — Service charges */}
          <Card className="p-4">
            <StepHeader step={3} title="Service Charges" />
            <div className="space-y-3">
              {serviceCharges.map((sc, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={sc.label} onChange={e => { const a = [...serviceCharges]; a[i] = { ...a[i], label: e.target.value }; setServiceCharges(a); }} placeholder="Label" className="flex-1 min-w-0" />
                  <Input type="number" value={sc.amount || ''} onChange={e => { const a = [...serviceCharges]; a[i] = { ...a[i], amount: Number(e.target.value) || 0 }; setServiceCharges(a); }} placeholder="Amount" inputMode="numeric" className="!w-28 flex-none" />
                  {serviceCharges.length > 1 && <Button variant="ghost" size="sm" onClick={() => setServiceCharges(serviceCharges.filter((_, idx) => idx !== i))}><X className="w-4 h-4" /></Button>}
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                {settings.service_presets.filter(p => !serviceCharges.some(c => c.label === p.label)).map(p => (
                  <button key={p.label} type="button" onClick={() => { setSvcTouched(true); setServiceCharges([...serviceCharges.filter(c => c.label || c.amount), { ...p }]); }} className="px-3 py-2 rounded-full border border-slate-300 text-xs text-slate-600 active:border-amber-500 hover:border-amber-500 hover:text-amber-700">+ {p.label}{p.amount ? ` (${p.amount.toLocaleString()})` : ''}</button>
                ))}
                <button type="button" onClick={() => { setSvcTouched(true); setServiceCharges([...serviceCharges, { label: '', amount: 0 }]); }} className="px-3 py-2 rounded-full border border-dashed border-slate-300 text-xs text-slate-500 hover:border-amber-500"><Plus className="inline w-3 h-3" /> Other</button>
              </div>
            </div>

            <div className="border-t border-slate-100 mt-4 pt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-slate-600">Additional Expenses (optional)</p>
                <Button variant="ghost" size="sm" onClick={() => setAdditionalExpenses([...additionalExpenses, { label: '', amount: 0 }])}>
                  <Plus className="w-4 h-4" /> Add
                </Button>
              </div>
              {additionalExpenses.length === 0 ? (
                <p className="text-sm text-slate-500">No additional expenses added.</p>
              ) : (
                <div className="space-y-3">
                  {additionalExpenses.map((ae, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={ae.label} onChange={e => { const a = [...additionalExpenses]; a[i] = { ...a[i], label: e.target.value }; setAdditionalExpenses(a); }} placeholder="Label" className="flex-1 min-w-0" />
                      <Input type="number" value={ae.amount || ''} onChange={e => { const a = [...additionalExpenses]; a[i] = { ...a[i], amount: Number(e.target.value) || 0 }; setAdditionalExpenses(a); }} placeholder="Amount" inputMode="numeric" className="!w-28 flex-none" />
                      <Button variant="ghost" size="sm" onClick={() => setAdditionalExpenses(additionalExpenses.filter((_, idx) => idx !== i))}><X className="w-4 h-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <StepHeader step={4} title="Custom Fields & Remarks" subtitle="Token tax status, extra charges (added to totals), pending documents, instructions (notes are for your records)" />
            <div className="space-y-4">
              {customFields.map(f => (
                <div key={f.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input value={f.label} onChange={e => setCustomFields(customFields.map(x => (x.id === f.id ? { ...x, label: e.target.value } : x)))} placeholder="Field name" className="flex-1" />
                    <button type="button" className="text-slate-500 hover:text-rose-600 px-2" onClick={() => setCustomFields(customFields.filter(x => x.id !== f.id))} aria-label="Remove field"><X className="w-4 h-4" /></button>
                  </div>
                  <Select value={f.kind} onChange={e => { const k = e.target.value as CustomFieldKind; setCustomFields(customFields.map(x => (x.id === f.id ? { ...x, kind: k, options: k === 'choice' ? (x.options?.length ? x.options : ['Paid', 'Unpaid']) : x.options, value: k === 'choice' ? (x.options?.[0] ?? 'Paid') : x.value } : x))); }}>
                    {(Object.keys(FIELD_KIND_LABEL) as CustomFieldKind[]).map(k => <option key={k} value={k}>{FIELD_KIND_LABEL[k]}</option>)}
                  </Select>
                  {(f.kind === 'charge_govt' || f.kind === 'charge_other') && (
                    <Input type="number" inputMode="numeric" value={f.amount ?? ''} onChange={e => setCustomFields(customFields.map(x => (x.id === f.id ? { ...x, amount: e.target.value === '' ? undefined : Number(e.target.value) } : x)))} placeholder="Amount (Rs)" />
                  )}
                  {f.kind === 'choice' && (
                    <>
                      <Select value={f.value ?? ''} onChange={e => setCustomFields(customFields.map(x => (x.id === f.id ? { ...x, value: e.target.value } : x)))}>
                        {(f.options?.length ? f.options : ['Yes', 'No']).map(o => <option key={o}>{o}</option>)}
                      </Select>
                      <Input value={(f.options ?? []).join(', ')} onChange={e => setCustomFields(customFields.map(x => (x.id === f.id ? { ...x, options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) } : x)))} placeholder="Options, separated by commas" />
                    </>
                  )}
                  {f.kind === 'text' && (
                    <>
                      <Input value={f.value ?? ''} onChange={e => setCustomFields(customFields.map(x => (x.id === f.id ? { ...x, value: e.target.value } : x)))} placeholder="Note (saved with the quotation, not printed on the PDF)" />
                    </>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {settings.field_presets.filter(p => !customFields.some(f => f.label === p.label)).map(p => (
                  <button key={p.label} type="button" onClick={() => setCustomFields([...customFields, newField(p)])} className="px-3 py-2 rounded-full border border-slate-300 text-xs text-slate-600 hover:border-amber-500 hover:text-amber-700">+ {p.label}</button>
                ))}
                <button type="button" onClick={() => setCustomFields([...customFields, newField()])} className="px-3 py-2 rounded-full border border-dashed border-slate-300 text-xs text-slate-500 hover:border-amber-500"><Plus className="inline w-3 h-3" /> Custom field</button>
              </div>
              {customFields.some(f => f.kind.startsWith('charge')) && <p className="text-xs text-slate-500">Charges are added to the totals when you press Calculate Fees.</p>}
            </div>
          </Card>

          <Button onClick={handleCalculate} className="w-full" size="md">
            <CalcIcon className="w-4 h-4" /> Calculate Fees
          </Button>

        </div>
        </div>

        {/* Panel 3: Calculate + Result + Client (stays in view on laptop) */}
        <div id="calc-result" className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1 scroll-mt-16">
          {!breakdown ? (
            <Card className="p-4">
              <EmptyState icon={CalcIcon} title="No calculation yet" subtitle="Fill the required fields and click Calculate Fees to see the breakdown." />
            </Card>
          ) : (
            <>
              {breakdown.warnings.length > 0 && (
                <Card className="p-3 bg-amber-50 border-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      {breakdown.warnings.map((w, i) => <p key={i} className="text-xs leading-snug text-amber-800">{w}</p>)}
                    </div>
                  </div>
                </Card>
              )}

              <Card className="overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900 text-sm">Fee Breakdown</h2>
                  {lineItems.some(li => li.source) && <span className="text-[10px] text-slate-500">Source: excise.punjab.gov.pk</span>}
                </div>
                <div className="divide-y divide-slate-100">
                  {lineItems.map((li, i) => ({ li, i })).filter(({ li }) => li.amount !== 0 || li.is_override).map(({ li, i }) => (
                    <div key={i} className="px-4 py-1.5 group flex items-center justify-between gap-2" title={[li.formula, li.source && `Source: ${li.source}`].filter(Boolean).join('\n')}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[9px] font-medium px-1 py-0.5 rounded uppercase flex-shrink-0 ${
                          li.category === 'government' ? 'bg-blue-100 text-blue-700' :
                          li.category === 'service' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                        }`}>{li.category === 'government' ? 'Govt' : li.category === 'service' ? 'Svc' : 'Add'}</span>
                        <span className="text-[13px] text-slate-900 truncate">{li.label}</span>
                        {li.category === 'government' && li.formula && <span className="text-[10px] text-slate-500 truncate">{li.formula}</span>}
                        {li.category === 'government' && li.formula && <span className="text-[10.5px] text-slate-500 truncate min-w-0">{li.formula}</span>}
                        {li.is_override && <span className="text-[9px] text-rose-600 font-medium" title={li.override_reason ?? ''}>OVERRIDDEN</span>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[13px] font-semibold text-slate-900 tabular-nums">{formatPKR(li.amount)}</span>
                        {li.category === 'government' && (
                          <button onClick={() => { setOverrideModal({ index: i, item: li }); setOverrideAmount(String(li.amount)); }} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-amber-600 transition" title="Override amount">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 space-y-1">
                  <div className="flex justify-between text-[13px]"><span className="text-slate-600">Government Fees</span><span className="font-medium text-slate-900 tabular-nums">{formatPKR(breakdown.subtotal_govt)}</span></div>
                  {lineItems.filter(li => li.category === 'service' && li.amount !== 0).length > 1 && <div className="flex justify-between text-[13px]"><span className="text-slate-600">Service Charges</span><span className="font-medium text-slate-900 tabular-nums">{formatPKR(breakdown.subtotal_service)}</span></div>}
                  {lineItems.filter(li => li.category === 'additional' && li.amount !== 0).length > 1 && <div className="flex justify-between text-[13px]"><span className="text-slate-600">Additional Expenses</span><span className="font-medium text-slate-900 tabular-nums">{formatPKR(breakdown.subtotal_additional)}</span></div>}
                  <div className="flex justify-between pt-1.5 border-t border-slate-200">
                    <span className="font-bold text-slate-900">Grand Total</span>
                    <span className="font-bold text-amber-600 text-lg tabular-nums">{formatPKR(breakdown.grand_total)}</span>
                  </div>
                </div>
              </Card>
            </>
          )}

          {/* Quick send — no client needed, nothing saved */}
          {breakdown && (
            <Card className="p-4">
              <h2 className="font-semibold text-slate-900">Send now (without saving)</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">Nothing is saved and no client is needed. Name and phone are optional: the name is printed on the PDF, the phone opens that WhatsApp chat on a computer.</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <Input value={quickName} onChange={e => setQuickName(e.target.value)} placeholder="Name (optional)" />
                <Input value={quickPhone} onChange={e => setQuickPhone(e.target.value)} placeholder="03xx-xxxxxxx" inputMode="tel" />
              </div>
              <div className="space-y-2">
                <Button onClick={() => quickSend('share-pdf')} disabled={!!quickBusy} className="w-full !bg-emerald-500 !text-white hover:!bg-emerald-600">
                  <MessageCircle className="w-5 h-5" /> {quickBusy === 'share-pdf' ? 'Preparing...' : 'Send PDF on WhatsApp'}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => quickSend('share-png')} disabled={!!quickBusy}><ImageIcon className="w-4 h-4" /> {quickBusy === 'share-png' ? '...' : 'As image'}</Button>
                  <Button variant="secondary" onClick={() => quickSend('download')} disabled={!!quickBusy}><Download className="w-4 h-4" /> PDF</Button>
                </div>
              </div>
              {quickNote && <p className="text-xs text-slate-600 mt-2">{quickNote}</p>}
              <p className="text-[11px] text-slate-500 mt-2">The number printed is an estimate number (EST-...). It cannot be looked up later. To keep a record, use Save Quotation below.</p>
            </Card>
          )}

          {/* Client selection — appears after calculation */}
          {breakdown && (
            <Card className="p-4">
              <h2 className="font-semibold text-slate-900 mb-4">Client</h2>
              {selectedClient ? (
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-900">{selectedClient.name}</p>
                    <p className="text-sm text-slate-500">{selectedClient.phone ?? 'No phone'}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>Change</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <Input placeholder="Search existing clients by name or phone..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
                    {clientResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {clientResults.map(c => (
                          <button key={c.id} onClick={() => { setSelectedClient(c); setClientSearch(''); setClientResults([]); }} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                            <p className="text-sm font-medium text-slate-900">{c.name}</p>
                            <p className="text-xs text-slate-500">{c.phone ?? 'No phone'}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                    <Field label="New client name"><Input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Full name" /></Field>
                    <Field label="Phone"><Input value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} placeholder="03xx-xxxxxxx" /></Field>
                  </div>
                  {clientErr && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{clientErr}</p>}
                  {newClientName.trim() && <DuplicateWarning result={calcDup.result} checking={calcDup.checking} acknowledged={!calcAck.needsConfirm} openLabel="Use this client"
                    onOpenClient={async id => { const { data } = await supabase.from('clients').select('*').eq('id', id).maybeSingle(); if (data) { setSelectedClient(data as Client); setNewClientName(''); setNewClientPhone(''); } }} />}
                  {newClientName.trim() && (
                    <Button size="sm" onClick={async () => {
                      if (calcAck.needsConfirm) { calcAck.confirm(); return; }
                      setClientErr('');
                      const { data, error } = await supabase.from('clients').insert({ name: newClientName.trim(), phone: newClientPhone.trim() || null }).select().maybeSingle();
                      if (error || !data) { setClientErr('Client save nahi hua: ' + (error?.message ?? 'no row returned. Check that your account is approved (Users & Rights) and the database setup is complete.')); return; }
                      setSelectedClient(data as Client); setNewClientName(''); setNewClientPhone('');
                    }}>
                      <Plus className="w-4 h-4" /> {calcAck.needsConfirm ? 'Add Client (I checked the duplicate)' : 'Add Client'}
                    </Button>
                  )}
                </div>
              )}

              {selectedClient && (
                <>
                {clientErr && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-3">{clientErr}</p>}
                <Button onClick={saveQuotation} disabled={saving} className="w-full mt-4">
                  {saving ? <Spinner label="" /> : <Save className="w-4 h-4" />}
                  Save Quotation
                </Button>
                </>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Phone: total always visible above the bottom tabs */}
      {breakdown && (
        <button type="button" onClick={() => document.getElementById('calc-result')?.scrollIntoView({ behavior: 'smooth' })}
          className="lg:hidden fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between text-sm shadow-lg">
          <span className="text-slate-300">Grand Total</span>
          <span className="font-bold text-amber-400 tabular-nums">{formatPKR(breakdown.grand_total)}</span>
        </button>
      )}

      {/* Override modal */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOverrideModal(null)}>
          <Card className="p-6 max-w-md w-full mx-4">
            <div onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-slate-900 mb-1">Override Fee Amount</h3>
              <p className="text-sm text-slate-500 mb-4">Override: {overrideModal.item.label}</p>
              <div className="space-y-4">
                <Field label="New Amount (PKR)" required>
                  <Input type="number" value={overrideAmount} onChange={e => setOverrideAmount(e.target.value)} />
                </Field>
                <Field label="Reason for Override" required>
                  <Input value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="e.g. Special discount per management approval" />
                </Field>
                <div className="flex gap-3 justify-end">
                  <Button variant="secondary" onClick={() => setOverrideModal(null)}>Cancel</Button>
                  <Button onClick={applyOverride} disabled={!overrideReason.trim() || !overrideAmount}>Apply Override</Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-7 h-7 rounded-full bg-amber-500 text-slate-900 flex items-center justify-center text-sm font-bold flex-shrink-0">{step}</div>
      <div>
        <h2 className="font-semibold text-slate-900 leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function getOfficialPortalUrl(province: Province): string {
  switch (province) {
    case 'punjab': return 'https://excise.punjab.gov.pk/index.php/motortax';
    case 'sindh': return 'https://excise.gos.pk/tax-calculator';
    case 'islamabad': return 'https://www.islamabadexcise.gov.pk/';
    case 'kpk': return 'https://kpexcise.gov.pk/taxcalculator/';
  }
}
