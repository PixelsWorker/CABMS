/**
 * Area D: MYOB-Connected Customers
 * Shared synthetic customer master with MYOB write-through simulation,
 * duplicate detection, recoverable draft handling, and reconciliation.
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
} from 'lucide-react';
import { BrandId, Customer } from '../types/cabms.ts';

export const CustomersView: React.FC = () => {
  const {
    persona,
    customers,
    simulateCustomerWriteThrough,
    reconcileUncertainCustomer,
    brands,
    activeBrandId,
    myobConnection,
  } = useCabms();

  // Persona boundary: Technician cannot browse the full customer directory!
  if (persona === 'technician') {
    return (
      <AccessDeniedView
        resourceName="Full Customer Directory & MYOB Records"
        requiredRoleDescription="Super Admin, Owner / Admin, or Office Staff"
        customExplanation="Technicians are restricted to viewing only the site contact details for their assigned work orders."
      />
    );
  }

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

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName || !newCustEmail) return;

    simulateCustomerWriteThrough(
      {
        name: newCustName,
        contactPerson: newCustContact || newCustName,
        email: newCustEmail,
        phone: newCustPhone || '0400 000 000',
        billingAddress: newCustAddress || '[Fictional] Gold Coast QLD',
        brandAffiliations: newCustBrands,
        notes: newCustNotes,
      },
      simOutcome
    );

    // Reset form
    setNewCustName('');
    setNewCustContact('');
    setNewCustEmail('');
    setNewCustPhone('');
    setNewCustAddress('');
    setNewCustNotes('');
    setIsAddModalOpen(false);
  };

  const getSyncBadge = (status: Customer['syncStatus'], isDraft?: boolean) => {
    switch (status) {
      case 'SYNCED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3" /> MYOB Synced
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 bg-red-950/60 border border-red-800/80 px-2 py-0.5 rounded">
            <XCircle className="w-3 h-3" /> Recoverable Draft (Failed Sync)
          </span>
        );
      case 'UNCERTAIN':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3" /> Uncertain (Needs Reconciliation)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
            <RefreshCw className="w-3 h-3 animate-spin" /> Pending Write
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Context Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-sky-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Customer Directory & Shared MYOB Master
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              One unified MYOB customer identity shared across Solarcell, GC Smart Home Solutions, and GC CCTV.
            </p>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition shadow-sm cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>New Customer (MYOB Write-Through)</span>
          </button>
        </div>

        {/* MYOB Integration Status Banner */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2 text-slate-300">
            <Database className="w-4 h-4 text-sky-400" />
            <span>Target Company File: <strong className="text-white">{myobConnection.companyFile}</strong></span>
            <span className="text-slate-500">•</span>
            <span className="font-mono text-slate-400">{myobConnection.companyId}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-slate-400">Connection Simulation:</span>
            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
              myobConnection.status === 'CONNECTED'
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                : 'bg-red-950 text-red-400 border border-red-800'
            }`}>
              {myobConnection.status}
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by customer name, email, internal ID or MYOB reference..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1">
          <span className="text-slate-400 text-xs">Brand Filter:</span>
          <select
            value={filterBrand}
            onChange={e => setFilterBrand(e.target.value)}
            className="bg-transparent text-white text-xs font-semibold focus:outline-none cursor-pointer"
          >
            <option value="all" className="bg-slate-900">All Brands</option>
            {Object.values(brands).map(b => (
              <option key={b.id} value={b.id} className="bg-slate-900">{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Customers List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredCustomers.map(customer => {
          const isMultiBrand = customer.brandAffiliations.length > 1;

          return (
            <div
              key={customer.id}
              className={`bg-slate-900 border rounded-xl p-5 space-y-3 transition ${
                customer.syncStatus === 'UNCERTAIN'
                  ? 'border-amber-700/80 bg-amber-950/10'
                  : customer.syncStatus === 'FAILED'
                  ? 'border-red-800/80 bg-red-950/10'
                  : 'border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-white text-sm md:text-base">{customer.name}</h3>
                    {isMultiBrand && (
                      <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded font-semibold" title="Shared customer identity across multiple CABMS brands">
                        Shared Customer
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 font-mono text-xs text-slate-400 mt-0.5">
                    <span>{customer.id}</span>
                    <span>•</span>
                    <span className="text-sky-400 font-semibold">{customer.myobCustomerId}</span>
                  </div>
                </div>

                <div>{getSyncBadge(customer.syncStatus, customer.isRecoverableDraft)}</div>
              </div>

              {/* Contact Info */}
              <div className="text-xs text-slate-300 space-y-1.5 border-t border-slate-800/80 pt-2.5">
                <div className="flex items-center space-x-2 text-slate-300">
                  <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{customer.email}</span>
                </div>
                <div className="flex items-center space-x-2 text-slate-300">
                  <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{customer.phone}</span>
                </div>
                <div className="flex items-center space-x-2 text-slate-300">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{customer.billingAddress}</span>
                </div>
              </div>

              {/* Brand Affiliations */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-xs">
                <div className="flex items-center space-x-1">
                  <span className="text-[11px] text-slate-500 mr-1">Brands:</span>
                  {customer.brandAffiliations.map(brandId => (
                    <span
                      key={brandId}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold text-white"
                      style={{ backgroundColor: brands[brandId]?.primaryColor || '#64748b' }}
                    >
                      {brands[brandId]?.name?.split(' ')[0] || brandId}
                    </span>
                  ))}
                </div>

                {/* Reconciliation Action Button for Uncertain Entries */}
                {customer.syncStatus === 'UNCERTAIN' && (
                  <button
                    onClick={() => setReconcileCustomerTarget(customer)}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[11px] rounded transition cursor-pointer"
                  >
                    Reconcile Uncertain Entry
                  </button>
                )}
              </div>

              {customer.notes && (
                <p className="text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded border border-slate-800/80 italic">
                  {customer.notes}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Customer Modal (MYOB Write-through simulation) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  New Customer Entry — MYOB Write-Through Simulation
                </h3>
                <p className="text-xs text-slate-400">
                  Data entered here writes directly to the simulated MYOB AccountRight company file.
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Customer / Business Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Citizen or Apex Logistics"
                  value={newCustName}
                  onChange={e => setNewCustName(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. John Citizen"
                    value={newCustContact}
                    onChange={e => setNewCustContact(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Phone (Fictional)
                  </label>
                  <input
                    type="text"
                    placeholder="0400 000 000"
                    value={newCustPhone}
                    onChange={e => setNewCustPhone(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Email Address (@example.invalid) *
                </label>
                <input
                  type="email"
                  required
                  placeholder="test.user@example.invalid"
                  value={newCustEmail}
                  onChange={e => setNewCustEmail(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Billing Address (Fictional)
                </label>
                <input
                  type="text"
                  placeholder="[Fictional] 123 Sample St, Surfers Paradise QLD 4217"
                  value={newCustAddress}
                  onChange={e => setNewCustAddress(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Brand Affiliation(s)
                </label>
                <div className="flex flex-wrap gap-2">
                  {Object.values(brands).map(b => (
                    <label key={b.id} className="flex items-center space-x-1.5 text-slate-300">
                      <input
                        type="checkbox"
                        checked={newCustBrands.includes(b.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setNewCustBrands([...newCustBrands, b.id]);
                          } else {
                            setNewCustBrands(newCustBrands.filter(id => id !== b.id));
                          }
                        }}
                        className="rounded"
                      />
                      <span>{b.name.split(' ')[0]}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Simulation Outcome Selector */}
              <div className="bg-slate-950 p-3 rounded border border-slate-800">
                <label className="block text-amber-300 font-semibold mb-1">
                  Simulated MYOB Response Outcome:
                </label>
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center space-x-1 text-slate-200">
                    <input
                      type="radio"
                      name="outcome"
                      value="SUCCESS"
                      checked={simOutcome === 'SUCCESS'}
                      onChange={() => setSimOutcome('SUCCESS')}
                    />
                    <span>Success (Assigned MYOB ID)</span>
                  </label>
                  <label className="flex items-center space-x-1 text-slate-200">
                    <input
                      type="radio"
                      name="outcome"
                      value="FAILURE"
                      checked={simOutcome === 'FAILURE'}
                      onChange={() => setSimOutcome('FAILURE')}
                    />
                    <span>Fail (Recoverable Draft)</span>
                  </label>
                  <label className="flex items-center space-x-1 text-slate-200">
                    <input
                      type="radio"
                      name="outcome"
                      value="UNCERTAIN"
                      checked={simOutcome === 'UNCERTAIN'}
                      onChange={() => setSimOutcome('UNCERTAIN')}
                    />
                    <span>Uncertain (Reconcile)</span>
                  </label>
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
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold transition shadow-sm cursor-pointer"
                >
                  Simulate MYOB Write
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reconciliation Dialog for Uncertain Customer Records */}
      {reconcileCustomerTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-2 text-amber-400 font-bold text-base">
              <AlertTriangle className="w-5 h-5" />
              <h3>Reconcile Uncertain MYOB Entry</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Customer <strong className="text-white">{reconcileCustomerTarget.name}</strong> was submitted during an uncertain network acknowledgement. To prevent creating a duplicate customer master in MYOB, verify if the record was committed or discard this entry.
            </p>

            <div className="bg-slate-950 p-3 rounded border border-slate-800 text-xs space-y-1 font-mono text-slate-400">
              <div>Draft ID: {reconcileCustomerTarget.id}</div>
              <div>Email: {reconcileCustomerTarget.email}</div>
              <div>Billing: {reconcileCustomerTarget.billingAddress}</div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => {
                  reconcileUncertainCustomer(reconcileCustomerTarget.id, false);
                  setReconcileCustomerTarget(null);
                }}
                className="px-3 py-1.5 bg-red-900/60 hover:bg-red-800 text-red-200 text-xs font-semibold rounded transition cursor-pointer"
              >
                Discard (Was Duplicate)
              </button>
              <button
                onClick={() => {
                  reconcileUncertainCustomer(reconcileCustomerTarget.id, true);
                  setReconcileCustomerTarget(null);
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded transition cursor-pointer"
              >
                Confirm & Link to MYOB
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
