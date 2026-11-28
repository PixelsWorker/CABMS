/**
 * Area D: MYOB-Connected Customers
 * Shared customer master with D1 persistence (when authenticated) and
 * CabmsContext preview fallback, multi-brand affiliations, duplicate detection
 * and resolution dialog (G00-009, G00-010), recoverable draft handling with
 * retry action, and uncertain reconciliation. All MYOB operations are
 * explicitly labeled as Sandbox / Synthetic.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { useG01Session } from '../context/G01Session.tsx';
import { buildApiUrl } from '../services/g01Client.ts';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faCircleXmark,
  faDatabase,
  faEnvelope,
  faLocationDot,
  faMagnifyingGlass,
  faPenToSquare,
  faPhone,
  faPlus,
  faRotate,
  faTriangleExclamation,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import type { BrandId, Customer } from '../types/cabms.ts';
import { checkCustomerDuplicate } from '../utils/cabmsLogic.ts';

interface ApiCustomerRecord {
  id: string;
  workspace_id: string;
  myob_customer_id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  billing_address: string;
  brand_affiliations: string[];
  sync_status: 'SYNCED' | 'FAILED' | 'UNCERTAIN' | 'PENDING';
  is_recoverable_draft: boolean;
  notes: string | null;
  myob_sandbox_mode: boolean;
  sandbox_label: string;
  created_at: string;
  activity_history?: Array<{ timestamp: string; action: string; actor: string; notes?: string }>;
}

function mapApiCustomer(row: ApiCustomerRecord): Customer {
  return {
    id: row.id,
    myobCustomerId: row.myob_customer_id,
    name: row.name,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    billingAddress: row.billing_address,
    brandAffiliations: row.brand_affiliations as BrandId[],
    syncStatus: row.sync_status === 'PENDING' ? 'UNCERTAIN' : row.sync_status,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    isRecoverableDraft: row.is_recoverable_draft,
    activityHistory: row.activity_history,
  };
}

const ALL_BRANDS: BrandId[] = ['solarcell', 'smart_home', 'cctv'];

export const CustomersView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    persona,
    customers: contextCustomers,
    simulateCustomerWriteThrough,
    reconcileUncertainCustomer,
    retryFailedCustomerSync,
    brands,
    activeBrandId,
    myobConnection,
    showDemoNotification,
    setActiveTab,
  } = useCabms();

  const session = useG01Session();
  const workspaceId = session?.workspaceId ?? '';
  const sessionRole = session?.profile?.memberships.find(m => m.workspace_id === workspaceId)?.role;
  const isPersistentMode = Boolean(session && workspaceId && session.profile && sessionRole && sessionRole !== 'technician');

  const [apiCustomers, setApiCustomers] = useState<Customer[] | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<Customer>>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const [filterBrand, setFilterBrand] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [reconcileCustomerTarget, setReconcileCustomerTarget] = useState<Customer | null>(null);

  // New Customer Form State
  const [newCustName, setNewCustName] = useState('');
  const [newCustContact, setNewCustContact] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustBrands, setNewCustBrands] = useState<BrandId[]>([activeBrandId]);
  const [newCustNotes, setNewCustNotes] = useState('');
  const [simOutcome, setSimOutcome] = useState<'SUCCESS' | 'FAILURE' | 'UNCERTAIN'>('SUCCESS');

  // Edit Customer Form State
  const [editName, setEditName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editBrands, setEditBrands] = useState<BrandId[]>([]);
  const [editNotes, setEditNotes] = useState('');

  // Duplicate Resolution Dialog State (G00-009, G00-010)
  const [duplicateWarning, setDuplicateWarning] = useState<{
    isOpen: boolean;
    existingCustomer?: Customer;
    field?: string;
  }>({ isOpen: false });

  const loadCustomersFromApi = useCallback(async () => {
    if (!isPersistentMode || !session) return;
    setApiLoading(true);
    setApiError(null);
    try {
      const token = await session.token();
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (filterBrand !== 'all') params.set('brand', filterBrand);
      const qs = params.toString();
      const res = await fetch(
        buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customers${qs ? `?${qs}` : ''}`),
        {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!res.ok) {
        const problem = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(problem.detail || `Failed to load customers (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { customers: ApiCustomerRecord[] };
      setApiCustomers(data.customers.map(mapApiCustomer));
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Unable to load persisted customers');
    } finally {
      setApiLoading(false);
    }
  }, [isPersistentMode, session, workspaceId, searchQuery, filterBrand]);

  useEffect(() => {
    if (isPersistentMode) {
      void loadCustomersFromApi();
    }
  }, [isPersistentMode, loadCustomersFromApi]);

  const customers = useMemo(() => {
    const base = isPersistentMode && apiCustomers !== null ? apiCustomers : contextCustomers;
    if (isPersistentMode) return base;
    return base.map(c => (localEdits[c.id] ? { ...c, ...localEdits[c.id] } : c));
  }, [isPersistentMode, apiCustomers, contextCustomers, localEdits]);

  // Persona boundary check AFTER hooks (G00-008)
  if (persona === 'technician' || (isPersistentMode && sessionRole === 'technician')) {
    return (
      <AccessDeniedView
        resourceName="Full Customer Directory & MYOB Records"
        requiredRoleDescription="Super Admin, Admin, or Office Staff"
        customExplanation="Technicians are restricted to viewing only the site contact details for their assigned work orders."
      />
    );
  }

  // Filter customers (also applied client-side in preview mode)
  const filteredCustomers = isPersistentMode && apiCustomers !== null
    ? customers
    : customers.filter(c => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.contactPerson.toLowerCase().includes(q) ||
          c.myobCustomerId.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q);

        const matchesBrand =
          filterBrand === 'all' || c.brandAffiliations.includes(filterBrand as BrandId);

        return matchesSearch && matchesBrand;
      });

  const toggleBrandSelection = (
    brandId: BrandId,
    current: BrandId[],
    setter: React.Dispatch<React.SetStateAction<BrandId[]>>
  ) => {
    if (current.includes(brandId)) {
      if (current.length > 1) {
        setter(current.filter(b => b !== brandId));
      }
    } else {
      setter([...current, brandId]);
    }
  };

  const resetCreateForm = () => {
    setDuplicateWarning({ isOpen: false });
    setIsAddModalOpen(false);
    setNewCustName('');
    setNewCustContact('');
    setNewCustEmail('');
    setNewCustPhone('');
    setNewCustAddress('');
    setNewCustNotes('');
  };

  const handleFormSubmit = (e: React.FormEvent, forceDistinct = false) => {
    if (e) e.preventDefault();
    if (!newCustName || !newCustEmail) return;

    const rawPhone = newCustPhone.trim();
    const effectiveBrands = newCustBrands.length > 0 ? newCustBrands : [activeBrandId];

    if (isPersistentMode && session) {
      void (async () => {
        setApiBusy(true);
        setApiError(null);
        try {
          const token = await session.token();
          const res = await fetch(
            buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customers`),
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `ui-create-${workspaceId}-${newCustEmail.trim().toLowerCase()}-${forceDistinct ? 'distinct' : 'std'}-${Date.now()}`,
              },
              body: JSON.stringify({
                name: newCustName.trim(),
                contact_person: (newCustContact || newCustName).trim(),
                email: newCustEmail.trim(),
                phone: rawPhone || '0400 000 000',
                billing_address: newCustAddress.trim() || '[Fictional] Gold Coast QLD',
                brand_affiliations: effectiveBrands,
                notes: newCustNotes.trim() || undefined,
                simulated_outcome: simOutcome,
                force_distinct: forceDistinct,
              }),
            }
          );

          if (res.status === 409) {
            const checkRes = await fetch(
              buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customers/check-duplicate`),
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newCustName.trim(), email: newCustEmail.trim(), phone: rawPhone }),
              }
            );
            const dupData = (await checkRes.json().catch(() => ({}))) as {
              is_duplicate?: boolean;
              field?: string;
              matched_customer?: ApiCustomerRecord;
            };
            if (dupData.is_duplicate && dupData.matched_customer) {
              setDuplicateWarning({
                isOpen: true,
                existingCustomer: mapApiCustomer(dupData.matched_customer),
                field: dupData.field,
              });
              return;
            }
          }

          if (!res.ok) {
            const problem = (await res.json().catch(() => ({}))) as { detail?: string };
            throw new Error(problem.detail || `Failed to save customer (HTTP ${res.status})`);
          }

          const created = (await res.json()) as { customer: ApiCustomerRecord; myob_result?: { message?: string } };
          showDemoNotification(
            created.myob_result?.message || `[SANDBOX] Saved customer ${created.customer.name} (${created.customer.myob_customer_id}).`,
            created.customer.sync_status === 'SYNCED' ? 'success' : created.customer.sync_status === 'FAILED' ? 'error' : 'warning'
          );
          resetCreateForm();
          await loadCustomersFromApi();
        } catch (err) {
          setApiError(err instanceof Error ? err.message : 'Failed to create customer');
        } finally {
          setApiBusy(false);
        }
      })();
      return;
    }

    // Preview / CabmsContext synchronous path (used by demo mode & Layer 4 tests)
    if (!forceDistinct) {
      const candidateForCheck = {
        name: newCustName,
        email: newCustEmail,
        phone: rawPhone,
      };
      const dupCheck = checkCustomerDuplicate(candidateForCheck, customers);
      if (dupCheck.isDuplicate && dupCheck.matchedCustomer) {
        setDuplicateWarning({
          isOpen: true,
          existingCustomer: dupCheck.matchedCustomer,
          field: dupCheck.field,
        });
        return;
      }
    }

    const draft = {
      name: newCustName,
      contactPerson: newCustContact || newCustName,
      email: newCustEmail,
      phone: rawPhone || '0400 000 000',
      billingAddress: newCustAddress || '[Fictional] Gold Coast QLD',
      brandAffiliations: effectiveBrands,
      notes: newCustNotes,
    };

    simulateCustomerWriteThrough(draft, simOutcome, forceDistinct);
    resetCreateForm();
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setEditName(customer.name);
    setEditContact(customer.contactPerson);
    setEditEmail(customer.email);
    setEditPhone(customer.phone);
    setEditAddress(customer.billingAddress);
    setEditBrands(customer.brandAffiliations.length > 0 ? [...customer.brandAffiliations] : [activeBrandId]);
    setEditNotes(customer.notes || '');
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !editName.trim() || !editEmail.trim()) return;
    const effectiveBrands = editBrands.length > 0 ? editBrands : [activeBrandId];

    if (isPersistentMode && session) {
      void (async () => {
        setApiBusy(true);
        setApiError(null);
        try {
          const token = await session.token();
          const res = await fetch(
            buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customers/${encodeURIComponent(editingCustomer.id)}`),
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: editName.trim(),
                contact_person: (editContact || editName).trim(),
                email: editEmail.trim(),
                phone: editPhone.trim(),
                billing_address: editAddress.trim(),
                brand_affiliations: effectiveBrands,
                notes: editNotes.trim() || null,
              }),
            }
          );
          if (!res.ok) {
            const problem = (await res.json().catch(() => ({}))) as { detail?: string };
            throw new Error(problem.detail || `Update failed (HTTP ${res.status})`);
          }
          showDemoNotification(`Updated customer ${editName.trim()} and brand affiliations.`, 'success');
          setEditingCustomer(null);
          await loadCustomersFromApi();
        } catch (err) {
          setApiError(err instanceof Error ? err.message : 'Failed to update customer');
        } finally {
          setApiBusy(false);
        }
      })();
      return;
    }

    setLocalEdits(prev => ({
      ...prev,
      [editingCustomer.id]: {
        name: editName.trim(),
        contactPerson: (editContact || editName).trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
        billingAddress: editAddress.trim(),
        brandAffiliations: effectiveBrands,
        notes: editNotes.trim() || undefined,
      },
    }));
    showDemoNotification(`Updated customer ${editName.trim()} (Preview Mode).`, 'success');
    setEditingCustomer(null);
  };

  const handleRetrySync = (customerId: string) => {
    if (isPersistentMode && session) {
      void (async () => {
        setApiBusy(true);
        try {
          const token = await session.token();
          const res = await fetch(
            buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customers/${encodeURIComponent(customerId)}/retry-sync`),
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `ui-retry-${customerId}-${Date.now()}`,
              },
              body: JSON.stringify({ simulated_outcome: 'SUCCESS' }),
            }
          );
          if (!res.ok) {
            const problem = (await res.json().catch(() => ({}))) as { detail?: string };
            throw new Error(problem.detail || `Retry failed (HTTP ${res.status})`);
          }
          showDemoNotification(`[SANDBOX] Customer ${customerId} synced to MYOB Sandbox.`, 'success');
          await loadCustomersFromApi();
        } catch (err) {
          setApiError(err instanceof Error ? err.message : 'Retry sync failed');
        } finally {
          setApiBusy(false);
        }
      })();
      return;
    }
    retryFailedCustomerSync(customerId);
  };

  const handleReconcile = (customerId: string, confirmSynced: boolean) => {
    if (isPersistentMode && session) {
      void (async () => {
        setApiBusy(true);
        try {
          const token = await session.token();
          const res = await fetch(
            buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/customers/${encodeURIComponent(customerId)}/reconcile`),
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ confirm_synced: confirmSynced }),
            }
          );
          if (!res.ok) {
            const problem = (await res.json().catch(() => ({}))) as { detail?: string };
            throw new Error(problem.detail || `Reconciliation failed (HTTP ${res.status})`);
          }
          showDemoNotification(
            confirmSynced ? '[SANDBOX] Customer reconciled and linked to MYOB Sandbox.' : '[SANDBOX] Uncertain draft rejected.',
            'info'
          );
          setReconcileCustomerTarget(null);
          await loadCustomersFromApi();
        } catch (err) {
          setApiError(err instanceof Error ? err.message : 'Reconciliation failed');
        } finally {
          setApiBusy(false);
        }
      })();
      return;
    }
    reconcileUncertainCustomer(customerId, confirmSynced);
    setReconcileCustomerTarget(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="cabms-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <FontAwesomeIcon icon={faUsers} className="w-5 h-5 text-sky-400" />
              <h1 className="text-xl font-bold text-(--cabms-text-primary) tracking-tight">
                Customer Directory & MYOB Business Master
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                MYOB SANDBOX
              </span>
            </div>
            <p className="text-xs text-(--cabms-text-secondary) mt-1">
              {isPersistentMode
                ? 'D1-persisted workspace client records with multi-brand affiliations and MYOB Sandbox write-through.'
                : 'Shared cross-brand client records with multi-brand affiliations and local preview synchronization.'}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setNewCustBrands([activeBrandId]);
                setIsAddModalOpen(true);
              }}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition shadow-md cursor-pointer"
            >
              <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
              <span>New Customer (MYOB Write-Through)</span>
            </button>
          </div>
        </div>

        {/* MYOB Shared Connection Info Bar (G00-035) */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <FontAwesomeIcon icon={faDatabase} className="w-4 h-4 text-emerald-400" />
            <span className="text-(--cabms-text-secondary)">Connection:</span>
            <strong className="text-(--cabms-text-primary) font-mono">
              MYOB Business Sandbox — Synthetic Company File (No Live Credentials)
            </strong>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-slate-500">Status:</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                isPersistentMode || myobConnection.status === 'CONNECTED'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-red-950 text-red-400 border border-red-800'
              }`}
            >
              {isPersistentMode ? 'SANDBOX_CONNECTED' : myobConnection.status}
            </span>
          </div>
        </div>
      </div>

      {apiError && (
        <div role="alert" className="cabms-card border-red-800 bg-red-950/50 p-3 text-xs text-red-200 flex items-center justify-between">
          <span>{apiError}</span>
          <button onClick={() => setApiError(null)} className="text-red-300 underline cursor-pointer">Dismiss</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 cabms-card p-3 rounded-xl">
        <div className="relative w-full sm:w-80">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="w-4 h-4 text-(--cabms-text-secondary) absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by name, email, phone, MYOB Card ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full cabms-card-subtle pl-9 pr-3 py-1.5 text-xs text-(--cabms-text-primary) placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <span className="text-xs text-(--cabms-text-secondary)">Brand:</span>
          <select
            value={filterBrand}
            onChange={e => setFilterBrand(e.target.value)}
            className="cabms-card-subtle rounded px-2.5 py-1 text-xs text-(--cabms-text-primary) cursor-pointer"
          >
            <option value="all">All Brand Affiliations</option>
            <option value="solarcell">Solarcell</option>
            <option value="smart_home">Gold Coast Smart Home</option>
            <option value="cctv">Gold Coast CCTV</option>
          </select>
        </div>
      </div>

      {/* Customers Table */}
      <div className="cabms-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-(--cabms-text-secondary)">
            <thead className="cabms-surface-subtle text-(--cabms-text-secondary) text-[11px] uppercase border-b cabms-border">
              <tr>
                <th className="p-3">Customer / Company</th>
                <th className="p-3">MYOB Card ID (Sandbox)</th>
                <th className="p-3">Contact</th>
                <th className="p-3">Brand Affiliations</th>
                <th className="p-3">Sync Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--cabms-border-base) bg-transparent">
              {apiLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Loading workspace customers...
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    No customers found matching the search criteria.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map(customer => (
                  <tr key={customer.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3">
                      <div className="font-bold text-(--cabms-text-primary) text-sm">{customer.name}</div>
                      <div className="text-[11px] text-(--cabms-text-secondary) flex items-center space-x-1 mt-0.5">
                        <FontAwesomeIcon icon={faLocationDot} className="w-3 h-3 text-slate-500" />
                        <span>{customer.billingAddress || 'No address recorded'}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-sky-400 bg-sky-950/80 border border-sky-900 px-2 py-0.5 rounded font-bold">
                        {customer.myobCustomerId}
                      </span>
                    </td>
                    <td className="p-3 space-y-0.5">
                      <div className="flex items-center space-x-1 text-(--cabms-text-secondary)">
                        <FontAwesomeIcon icon={faEnvelope} className="w-3 h-3 text-slate-500" />
                        <span>{customer.email}</span>
                      </div>
                      <div className="flex items-center space-x-1 text-(--cabms-text-secondary)">
                        <FontAwesomeIcon icon={faPhone} className="w-3 h-3 text-slate-500" />
                        <span>{customer.phone}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {customer.brandAffiliations.map(b => (
                          <span
                            key={b}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold cabms-surface-subtle border cabms-border text-(--cabms-text-secondary)"
                          >
                            {brands[b]?.name || b}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          customer.syncStatus === 'SYNCED'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : customer.syncStatus === 'FAILED'
                            ? 'bg-red-950 text-red-400 border border-red-800'
                            : 'bg-amber-950 text-amber-400 border border-amber-800'
                        }`}
                      >
                        {customer.syncStatus === 'SYNCED' && <FontAwesomeIcon icon={faCircleCheck} className="w-3 h-3" />}
                        {customer.syncStatus === 'FAILED' && <FontAwesomeIcon icon={faCircleXmark} className="w-3 h-3" />}
                        {customer.syncStatus === 'UNCERTAIN' && <FontAwesomeIcon icon={faTriangleExclamation} className="w-3 h-3" />}
                        <span>{customer.syncStatus}</span>
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-1.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(customer)}
                        className="px-2 py-1 cabms-surface-subtle hover:bg-slate-700 border cabms-border text-(--cabms-text-secondary) rounded text-[11px] font-semibold cursor-pointer"
                      >
                        <FontAwesomeIcon icon={faPenToSquare} className="w-3 h-3 mr-1" />
                        Edit
                      </button>
                      {customer.syncStatus === 'FAILED' && (
                        <button
                          type="button"
                          disabled={apiBusy}
                          onClick={() => handleRetrySync(customer.id)}
                          className="px-2.5 py-1 bg-red-900/60 hover:bg-red-800 border border-red-700 text-red-200 rounded text-[11px] font-semibold cursor-pointer"
                        >
                          Retry MYOB Sync
                        </button>
                      )}
                      {customer.syncStatus === 'UNCERTAIN' && (
                        <button
                          type="button"
                          disabled={apiBusy}
                          onClick={() => setReconcileCustomerTarget(customer)}
                          className="px-2.5 py-1 bg-amber-900/60 hover:bg-amber-800 border border-amber-700 text-amber-200 rounded text-[11px] font-semibold cursor-pointer"
                        >
                          Reconcile Draft
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Customer Write-Through Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-(--cabms-text-primary) flex items-center space-x-2">
              <FontAwesomeIcon icon={faPlus} className="w-5 h-5 text-sky-400" />
              <span>Create Customer (MYOB Sandbox Write-Through)</span>
            </h3>

            <p className="text-xs text-(--cabms-text-secondary)">
              New customer records are written to the synthetic MYOB Sandbox company file. Test deterministic outcomes below.
            </p>

            <form onSubmit={e => handleFormSubmit(e, false)} className="space-y-3 text-xs">
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Customer / Business Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oceanic Resort Group"
                  value={newCustName}
                  onChange={e => setNewCustName(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    required
                    placeholder="accounts@example.com"
                    value={newCustEmail}
                    onChange={e => setNewCustEmail(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                  />
                </div>
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Phone</label>
                  <input
                    type="tel"
                    placeholder="0400 123 456"
                    value={newCustPhone}
                    onChange={e => setNewCustPhone(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                  />
                </div>
              </div>

              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Billing Address</label>
                <input
                  type="text"
                  placeholder="[Fictional] 120 Marine Parade, Southport QLD 4215"
                  value={newCustAddress}
                  onChange={e => setNewCustAddress(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                />
              </div>

              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Brand Affiliations</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_BRANDS.map(b => (
                    <label key={b} className="inline-flex items-center space-x-1.5 cabms-card-subtle px-2.5 py-1 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newCustBrands.includes(b)}
                        onChange={() => toggleBrandSelection(b, newCustBrands, setNewCustBrands)}
                      />
                      <span>{brands[b]?.name || b}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Simulation Outcome Selector */}
              <div className="cabms-card-subtle p-3 space-y-2">
                <label className="text-(--cabms-text-secondary) block font-semibold text-[11px]">
                  Write-Through Test Outcome (Sandbox Resilience)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSimOutcome('SUCCESS')}
                    className={`py-1.5 px-2 rounded font-bold text-center border cursor-pointer ${
                      simOutcome === 'SUCCESS'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-600'
                        : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary)'
                    }`}
                  >
                    Success
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimOutcome('FAILURE')}
                    className={`py-1.5 px-2 rounded font-bold text-center border cursor-pointer ${
                      simOutcome === 'FAILURE'
                        ? 'bg-red-950 text-red-400 border-red-600'
                        : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary)'
                    }`}
                  >
                    Sync Failure
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimOutcome('UNCERTAIN')}
                    className={`py-1.5 px-2 rounded font-bold text-center border cursor-pointer ${
                      simOutcome === 'UNCERTAIN'
                        ? 'bg-amber-950 text-amber-400 border-amber-600'
                        : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary)'
                    }`}
                  >
                    Uncertain
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) rounded font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={apiBusy}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold transition cursor-pointer"
                >
                  {isPersistentMode ? 'Save Customer (MYOB Sandbox)' : 'Save Customer (Preview Mode)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-(--cabms-text-primary) flex items-center space-x-2">
              <FontAwesomeIcon icon={faPenToSquare} className="w-5 h-5 text-sky-400" />
              <span>Edit Customer & Brand Affiliations</span>
            </h3>

            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Customer / Business Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={editContact}
                    onChange={e => setEditContact(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                  />
                </div>
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Phone</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                  />
                </div>
              </div>
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                />
              </div>
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Billing Address</label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={e => setEditAddress(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                />
              </div>
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Brand Affiliations</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_BRANDS.map(b => (
                    <label key={b} className="inline-flex items-center space-x-1.5 cabms-card-subtle px-2.5 py-1 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editBrands.includes(b)}
                        onChange={() => toggleBrandSelection(b, editBrands, setEditBrands)}
                      />
                      <span>{brands[b]?.name || b}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) rounded font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={apiBusy}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DUPLICATE CONFLICT RESOLUTION MODAL (G00-009, G00-010) */}
      {duplicateWarning.isOpen && duplicateWarning.existingCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card border-amber-900/80 max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-(--cabms-text-primary) flex items-center space-x-2">
              <FontAwesomeIcon icon={faTriangleExclamation} className="w-5 h-5 text-amber-400 shrink-0" />
              <span>Potential Customer Duplicate Detected</span>
            </h3>

            <p className="text-xs text-(--cabms-text-secondary) leading-relaxed">
              A customer record matching the provided {duplicateWarning.field || 'contact details'} already exists in the system.
            </p>

            <div className="cabms-card-subtle p-3 text-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Existing Match:</span>
              <div className="font-bold text-(--cabms-text-primary) text-sm">{duplicateWarning.existingCustomer.name}</div>
              <div className="text-(--cabms-text-secondary) font-mono">
                MYOB Card ID: {duplicateWarning.existingCustomer.myobCustomerId}
              </div>
              <div className="text-(--cabms-text-secondary)">{duplicateWarning.existingCustomer.email}</div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-3 border-t border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => {
                  const existing = duplicateWarning.existingCustomer!;
                  setDuplicateWarning({ isOpen: false });
                  setIsAddModalOpen(false);
                  setSearchQuery(existing.name);
                  showDemoNotification(`Selected existing customer: ${existing.name} (${existing.myobCustomerId}). Linked for operations.`, 'success');
                }}
                className="w-full sm:w-auto px-3.5 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) rounded font-semibold cursor-pointer"
              >
                Use Existing Record
              </button>
              <button
                type="button"
                onClick={() => {
                  const existing = duplicateWarning.existingCustomer!;
                  setDuplicateWarning({ isOpen: false });
                  setIsAddModalOpen(false);
                  showDemoNotification(`Selected customer ${existing.name}. Switching to Job Creation workflow.`, 'info');
                  setActiveTab('jobs');
                }}
                className="w-full sm:w-auto px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold cursor-pointer"
              >
                Use & Create Job
              </button>
              <button
                type="button"
                onClick={e => handleFormSubmit(e as unknown as React.FormEvent, true)}
                className="w-full sm:w-auto px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 rounded font-bold cursor-pointer"
              >
                Confirm Distinct Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNCERTAIN RECONCILIATION MODAL */}
      {reconcileCustomerTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-(--cabms-text-primary) flex items-center space-x-2">
              <FontAwesomeIcon icon={faRotate} className="w-5 h-5 text-amber-400" />
              <span>Reconcile Uncertain MYOB Sandbox Draft</span>
            </h3>

            <p className="text-xs text-(--cabms-text-secondary) leading-relaxed">
              The write-through for customer <strong>{reconcileCustomerTarget.name}</strong> returned an uncertain
              state (timeout / ambiguous response). Verify if the customer card exists in MYOB Sandbox.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800 text-xs">
              <button
                type="button"
                disabled={apiBusy}
                onClick={() => handleReconcile(reconcileCustomerTarget.id, false)}
                className="px-3.5 py-2 bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-700 rounded font-semibold cursor-pointer"
              >
                Discard / Reject Draft
              </button>
              <button
                type="button"
                disabled={apiBusy}
                onClick={() => handleReconcile(reconcileCustomerTarget.id, true)}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold cursor-pointer"
              >
                Confirm Synced in MYOB
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
