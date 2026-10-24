/**
 * Area D: MYOB-Connected Customers
 * Shared synthetic customer master with MYOB Business write-through simulation,
 * duplicate detection and resolution dialog (G00-009, G00-010),
 * recoverable draft handling with retry action, and uncertain reconciliation.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRight,
  faBuilding,
  faCircleCheck,
  faCircleQuestion,
  faCircleXmark,
  faDatabase,
  faEnvelope,
  faLocationDot,
  faMagnifyingGlass,
  faPhone,
  faPlus,
  faRotate,
  faShieldHalved,
  faTriangleExclamation,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import { BrandId, Customer } from '../types/cabms.ts';
import { checkCustomerDuplicate } from '../utils/cabmsLogic.ts';

export const CustomersView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    persona,
    customers,
    simulateCustomerWriteThrough,
    reconcileUncertainCustomer,
    retryFailedCustomerSync,
    brands,
    activeBrandId,
    myobConnection,
    showDemoNotification,
    setActiveTab,
  } = useCabms();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterBrand, setFilterBrand] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
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

  // Duplicate Resolution Dialog State (G00-009, G00-010)
  const [duplicateWarning, setDuplicateWarning] = useState<{
    isOpen: boolean;
    existingCustomer?: Customer;
    field?: string;
  }>({ isOpen: false });

  // Persona boundary check AFTER hooks (G00-008)
  if (persona === 'technician') {
    return (
      <AccessDeniedView
        resourceName="Full Customer Directory & MYOB Records"
        requiredRoleDescription="Super Admin, Admin, or Office Staff"
        customExplanation="Technicians are restricted to viewing only the site contact details for their assigned work orders."
      />
    );
  }

  // Filter customers
  const filteredCustomers = customers.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.myobCustomerId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesBrand =
      filterBrand === 'all' || c.brandAffiliations.includes(filterBrand as BrandId);

    return matchesSearch && matchesBrand;
  });

  const handleFormSubmit = (e: React.FormEvent, forceDistinct = false) => {
    if (e) e.preventDefault();
    if (!newCustName || !newCustEmail) return;

    // FC-15: Check duplicates using actual user phone input before applying demo fallback
    const rawPhone = newCustPhone.trim();

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
      brandAffiliations: newCustBrands,
      notes: newCustNotes,
    };

    simulateCustomerWriteThrough(draft, simOutcome, forceDistinct);

    // Reset and close
    setDuplicateWarning({ isOpen: false });
    setIsAddModalOpen(false);
    setNewCustName('');
    setNewCustContact('');
    setNewCustEmail('');
    setNewCustPhone('');
    setNewCustAddress('');
    setNewCustNotes('');
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
            </div>
            <p className="text-xs text-(--cabms-text-secondary) mt-1">
              Shared cross-brand client records synchronized directly with MYOB Business — Client-Reported Shared Company File (Simulated).
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsAddModalOpen(true)}
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
              MYOB Business — Client-Reported Shared Company File (Simulated)
            </strong>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-slate-500">Status:</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                myobConnection.status === 'CONNECTED'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-red-950 text-red-400 border border-red-800'
              }`}
            >
              {myobConnection.status}
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 cabms-card p-3 rounded-xl">
        <div className="relative w-full sm:w-80">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="w-4 h-4 text-(--cabms-text-secondary) absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by name, email, MYOB Card ID..."
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
                <th className="p-3">MYOB Card ID</th>
                <th className="p-3">Contact</th>
                <th className="p-3">Brand Affiliations</th>
                <th className="p-3">Sync Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--cabms-border-base) bg-transparent">
              {filteredCustomers.length === 0 ? (
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
                        <span>{customer.billingAddress}</span>
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
                    <td className="p-3 text-right">
                      {customer.syncStatus === 'FAILED' && (
                        <button
                          onClick={() => retryFailedCustomerSync(customer.id)}
                          className="px-2.5 py-1 bg-red-900/60 hover:bg-red-800 border border-red-700 text-red-200 rounded text-[11px] font-semibold cursor-pointer"
                        >
                          Retry MYOB Sync
                        </button>
                      )}
                      {customer.syncStatus === 'UNCERTAIN' && (
                        <button
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
              <span>Create Customer (MYOB Write-Through Simulation)</span>
            </h3>

            <p className="text-xs text-(--cabms-text-secondary)">
              New customer records are written directly to the shared MYOB company file. Test deterministic outcomes below.
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

              {/* Simulation Outcome Selector */}
              <div className="cabms-card-subtle p-3 space-y-2">
                <label className="text-(--cabms-text-secondary) block font-semibold text-[11px]">
                  Simulated Write-Through Outcome (Test Resilience)
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
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold transition cursor-pointer"
                >
                  Simulate Write-Through
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
                onClick={e => handleFormSubmit(e as any, true)}
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
              <span>Reconcile Uncertain MYOB Draft</span>
            </h3>

            <p className="text-xs text-(--cabms-text-secondary) leading-relaxed">
              The write-through for customer <strong>{reconcileCustomerTarget.name}</strong> returned an uncertain
              state (timeout / ambiguous response). Verify if the customer card exists in MYOB Business.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => {
                  reconcileUncertainCustomer(reconcileCustomerTarget.id, false);
                  setReconcileCustomerTarget(null);
                }}
                className="px-3.5 py-2 bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-700 rounded font-semibold cursor-pointer"
              >
                Discard / Reject Draft
              </button>
              <button
                type="button"
                onClick={() => {
                  reconcileUncertainCustomer(reconcileCustomerTarget.id, true);
                  setReconcileCustomerTarget(null);
                }}
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
