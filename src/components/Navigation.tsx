/**
 * Application Navigation & Brand Header
 * Responsive desktop & mobile navigation with persona-aware tabs
 */

import React from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Calendar,
  FileCheck2,
  FileText,
  MessageSquare,
  Inbox,
  Settings,
  Sliders,
  ShieldAlert,
  Menu,
  X,
} from 'lucide-react';

export const Navigation: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    activeBrand,
    persona,
    websiteEnquiries,
    demoNotification,
    clearDemoNotification,
  } = useCabms();

  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  // Compute pending website inbox count
  const pendingEnquiriesCount = websiteEnquiries.filter(e => e.status === 'PENDING_REVIEW').length;

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin', 'owner_admin', 'office_staff', 'technician'] },
    { id: 'jobs', label: 'Jobs & Operations', icon: Briefcase, roles: ['super_admin', 'owner_admin', 'office_staff', 'technician'] },
    { id: 'schedule', label: 'Schedule & Calendar', icon: Calendar, roles: ['super_admin', 'owner_admin', 'office_staff', 'technician'] },
    { id: 'compliance', label: 'Compliance & Forms', icon: FileCheck2, roles: ['super_admin', 'owner_admin', 'office_staff', 'technician'] },
    { id: 'customers', label: 'Customers (MYOB)', icon: Users, roles: ['super_admin', 'owner_admin', 'office_staff'] }, // Not technician!
    { id: 'quotes', label: 'Quotations & Terms', icon: FileText, roles: ['super_admin', 'owner_admin', 'office_staff'] },
    { id: 'communications', label: 'Communications & Reviews', icon: MessageSquare, roles: ['super_admin', 'owner_admin', 'office_staff'] },
    { id: 'website_inbox', label: 'Website Enquiries', icon: Inbox, badge: pendingEnquiriesCount > 0 ? pendingEnquiriesCount : undefined, roles: ['super_admin', 'owner_admin', 'office_staff'] },
    { id: 'templates', label: 'Templates & Content', icon: Sliders, roles: ['super_admin', 'owner_admin'] },
    { id: 'super_admin_setup', label: 'Integration Settings', icon: Settings, roles: ['super_admin'] },
  ];

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    setMobileMenuOpen(false);
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
      {/* Brand & Role Header Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
        {/* Brand Logo & Identifier */}
        <div className="flex items-center space-x-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-white text-lg shadow-md"
            style={{ backgroundColor: activeBrand.primaryColor }}
          >
            {activeBrand.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-base md:text-lg text-white tracking-tight">
                {activeBrand.name}
              </span>
              <span
                className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded text-white"
                style={{ backgroundColor: activeBrand.primaryColor }}
              >
                CABMS
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              {activeBrand.tagline}
            </p>
          </div>
        </div>

        {/* Persona Badge & Mobile Menu Toggle */}
        <div className="flex items-center space-x-3">
          <div className="text-right hidden sm:block">
            <span className="text-[11px] text-slate-400 block">Current Persona</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700">
              {persona === 'super_admin' && 'Super Admin'}
              {persona === 'owner_admin' && 'Owner / Admin'}
              {persona === 'office_staff' && 'Office Staff'}
              {persona === 'technician' && 'Technician (Dave Miller)'}
            </span>
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Desktop Navigation Tabs */}
      <nav className="hidden md:block bg-slate-950/70 border-t border-slate-800/80 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex space-x-1 overflow-x-auto scrollbar-none py-1">
          {navItems.map(item => {
            const hasAccess = item.roles.includes(persona);
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap transition cursor-pointer ${
                  isActive
                    ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                    : hasAccess
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                    : 'text-slate-600 hover:text-red-400 hover:bg-red-950/20'
                }`}
                title={!hasAccess ? `Access Denied for ${persona}` : item.label}
              >
                <item.icon className={`w-3.5 h-3.5 ${isActive ? 'text-amber-400' : hasAccess ? 'text-slate-400' : 'text-slate-600'}`} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="bg-amber-500 text-slate-950 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                    {item.badge}
                  </span>
                )}
                {!hasAccess && (
                  <span className="text-[10px] text-red-400 bg-red-950/60 px-1 rounded">
                    Denied
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-950 border-t border-slate-800 px-4 py-3 space-y-1">
          {navItems.map(item => {
            const hasAccess = item.roles.includes(persona);
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition ${
                  isActive
                    ? 'bg-slate-800 text-white font-semibold'
                    : hasAccess
                    ? 'text-slate-300 hover:bg-slate-900'
                    : 'text-slate-600 hover:text-red-400'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className="bg-amber-500 text-slate-950 text-xs font-bold px-2 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
                {!hasAccess && (
                  <span className="text-xs text-red-400 bg-red-950/60 px-1.5 py-0.5 rounded">
                    Role Denied
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Global Interactive Demo Notification / Feedback Toast */}
      {demoNotification && (
        <div
          className={`px-4 py-2 text-xs flex items-center justify-between ${
            demoNotification.type === 'error'
              ? 'bg-red-950 border-b border-red-800 text-red-200'
              : demoNotification.type === 'warning'
              ? 'bg-amber-950 border-b border-amber-800 text-amber-200'
              : demoNotification.type === 'success'
              ? 'bg-emerald-950 border-b border-emerald-800 text-emerald-200'
              : 'bg-sky-950 border-b border-sky-800 text-sky-200'
          }`}
        >
          <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
            <span className="font-medium">{demoNotification.message}</span>
            <button
              onClick={clearDemoNotification}
              className="text-xs hover:underline ml-4 font-bold"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
