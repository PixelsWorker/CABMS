/**
 * Area D: MYOB-Connected Customers
 * Shared synthetic customer master with MYOB Business write-through simulation,
 * duplicate detection and resolution dialog (G00-009, G00-010),
 * recoverable draft handling with retry action, and uncertain reconciliation.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import {
  Users,
  Search,
  Plus,
  Database,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Building2,
  RefreshCw,
  Mail,
  Phone,
  MapPin,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
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
        requiredRoleDescription="Super Admin, Owner / Admin, or Office Staff"
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

    const draft = {
      name: newCustName,
      contactPerson: newCustContact || newCustName,
      email: newCustEmail,
      phone: newCustPhone || '0400 000 000',
      billingAddress: newCustAddress || '[Fictional] Gold Coast QLD',
      brandAffiliations: newCustBrands,
      notes: newCustNotes,
    };

    // Check for duplicates first if not forcing distinct
    if (!forceDistinct) {
      const dupCheck = checkCustomerDuplicate(draft, customers);
      if (dupCheck.isDuplicate && dupCheck.matchedCustomer) {
        setDuplicateWarning({
          isOpen: true,
          existingCustomer: dupCheck.matchedCustomer,
          field: dupCheck.field,
        });
        return;
      }
    }

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
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-sky-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Customer Directory & MYOB Business Master
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Shared cross-brand client records synchronized directly with MYOB Business — Client-Reported Shared Company File (Simulated).
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition shadow-md cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Customer (MYOB Write-Through)</span>
            </button>
          </div>
        </div>

        {/* MYOB Shared Connection Info Bar (G00-035) */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400">Connection:</span>
            <strong className="text-white font-mono">
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
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by name, email, MYOB Card ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400">Brand:</span>
          <select
            value={filterBrand}
            onChange={e => setFilterBrand(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-white cursor-pointer"
          >
            <option value="all">All Brand Affiliations</option>
            <option value="solarcell">Solarcell</option>
            <option value="smart_home">Gold Coast Smart Home</option>
            <option value="cctv">Gold Coast CCTV</option>
          </select>
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
              <tr>
                <th className="p-3">Customer / Company</th>
                <th className="p-3">MYOB Card ID</th>
                <th className="p-3">Contact</th>
                <th className="p-3">Brand Affiliations</th>
                <th className="p-3">Sync Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
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
                      <div className="font-bold text-white text-sm">{customer.name}</div>
                      <div className="text-[11px] text-slate-400 flex items-center space-x-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-500" />
                        <span>{customer.billingAddress}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-sky-400 bg-sky-950/80 border border-sky-900 px-2 py-0.5 rounded font-bold">
                        {customer.myobCustomerId}
                      </span>
                    </td>
                    <td className="p-3 space-y-0.5">
                      <div className="flex items-center space-x-1 text-slate-300">
                        <Mail className="w-3 h-3 text-slate-500" />
                        <span>{customer.email}</span>
                      </div>
                      <div className="flex items-center space-x-1 text-slate-400">
                        <Phone className="w-3 h-3 text-slate-500" />
                        <span>{customer.phone}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {customer.brandAffiliations.map(b => (
                          <span
                            key={b}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700"
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
                        {customer.syncStatus === 'SYNCED' && <CheckCircle2 className="w-3 h-3" />}
                        {customer.syncStatus === 'FAILED' && <XCircle className="w-3 h-3" />}
                        {customer.syncStatus === 'UNCERTAIN' && <AlertTriangle className="w-3 h-3" />}
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Plus className="w-5 h-5 text-sky-400" />
              <span>Create Customer (MYOB Write-Through Simulation)</span>
            </h3>

            <p className="text-xs text-slate-400">
              New customer records are written directly to the shared MYOB company file. Test deterministic outcomes below.
            </p>

            <form onSubmit={e => handleFormSubmit(e, false)} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block font-semibold mb-1">Customer / Business Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oceanic Resort Group"
                  value={newCustName}
                  onChange={e => setNewCustName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    required
                    placeholder="accounts@example.com"
                    value={newCustEmail}
                    onChange={e => setNewCustEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block font-semibold mb-1">Phone</label>
                  <input
                    type="tel"
                    placeholder="0400 123 456"
                    value={newCustPhone}
                    onChange={e => setNewCustPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 block font-semibold mb-1">Billing Address</label>
                <input
                  type="text"
                  placeholder="[Fictional] 120 Marine Parade, Southport QLD 4215"
                  value={newCustAddress}
                  onChange={e => setNewCustAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                />
              </div>

              {/* Simulation Outcome Selector */}
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
                <label className="text-slate-300 block font-semibold text-[11px]">
                  Simulated Write-Through Outcome (Test Resilience)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSimOutcome('SUCCESS')}
                    className={`py-1.5 px-2 rounded font-bold text-center border cursor-pointer ${
                      simOutcome === 'SUCCESS'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-600'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
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
                        : 'bg-slate-900 text-slate-400 border-slate-800'
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
                        : 'bg-slate-900 text-slate-400 border-slate-800'
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
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold transition cursor-pointer"
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
          <div className="bg-slate-900 border border-amber-900/80 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <span>Potential Customer Duplicate Detected</span>
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed">
              A customer record matching the provided {duplicateWarning.field || 'contact details'} already exists in the system.
            </p>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Existing Match:</span>
              <div className="font-bold text-white text-sm">{duplicateWarning.existingCustomer.name}</div>
              <div className="text-slate-400 font-mono">
                MYOB Card ID: {duplicateWarning.existingCustomer.myobCustomerId}
              </div>
              <div className="text-slate-400">{duplicateWarning.existingCustomer.email}</div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-3 border-t border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setDuplicateWarning({ isOpen: false })}
                className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold cursor-pointer"
              >
                Use Existing Record
              </button>
              <button
                type="button"
                onClick={e => handleFormSubmit(e as any, true)}
                className="w-full sm:w-auto px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 rounded font-bold cursor-pointer"
              >
                Confirm Distinct Entry & Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNCERTAIN RECONCILIATION MODAL */}
      {reconcileCustomerTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <RefreshCw className="w-5 h-5 text-amber-400" />
              <span>Reconcile Uncertain MYOB Draft</span>
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed">
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
