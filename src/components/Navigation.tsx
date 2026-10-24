/** Shared ten-area navigation policy and presentation-only sidebar/drawer shell. */
import React from 'react';
import { createPortal } from 'react-dom';
import { useCabms } from '../context/CabmsContext.tsx';
import { Persona } from '../types/cabms.ts';
import {
  LayoutDashboard, Users, Briefcase, Calendar, FileCheck2, FileText,
  MessageSquare, Inbox, Settings, Sliders, Menu, X, LogOut,
  PanelLeftClose, PanelLeftOpen, type LucideIcon, ChevronDown, Check,
} from 'lucide-react';

type Destination = {
  id: string; label: string; icon: LucideIcon;
  roles: readonly Persona[]; section: 'Operations' | 'Administration';
};
const everyone: readonly Persona[] = ['super_admin', 'owner_admin', 'office_staff', 'technician'];
const office: readonly Persona[] = ['super_admin', 'owner_admin', 'office_staff'];

export const CORE_DESTINATIONS: readonly Destination[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: everyone, section: 'Operations' },
  { id: 'jobs', label: 'Jobs & Operations', icon: Briefcase, roles: everyone, section: 'Operations' },
  { id: 'schedule', label: 'Schedule & Calendar', icon: Calendar, roles: everyone, section: 'Operations' },
  { id: 'compliance', label: 'Compliance & Forms', icon: FileCheck2, roles: everyone, section: 'Operations' },
  { id: 'customers', label: 'Customers (MYOB)', icon: Users, roles: office, section: 'Operations' },
  { id: 'quotes', label: 'Quotations & Terms', icon: FileText, roles: office, section: 'Operations' },
  { id: 'communications', label: 'Communications & Reviews', icon: MessageSquare, roles: office, section: 'Operations' },
  { id: 'website_inbox', label: 'Website Enquiries', icon: Inbox, roles: office, section: 'Operations' },
  { id: 'templates', label: 'Templates & Content', icon: Sliders, roles: ['super_admin', 'owner_admin'], section: 'Administration' },
  { id: 'super_admin_setup', label: 'Integration Settings', icon: Settings, roles: ['super_admin'], section: 'Administration' },
];

export function canAccessDestination(persona: Persona, destinationId: string): boolean {
  return CORE_DESTINATIONS.some(item => item.id === destinationId && item.roles.includes(persona));
}

const personaLabels: Record<Persona, string> = {
  super_admin: 'Super Admin', owner_admin: 'Admin',
  office_staff: 'Office Staff', technician: 'Technician (Dave Miller)',
};

export const Navigation: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { activeTab, setActiveTab, activeBrand, activeBrandId, setActiveBrandId, brands, persona, websiteEnquiries,
    demoNotification, clearDemoNotification, simulateSignOut, myobConnection } = useCabms();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [brandDropdownOpen, setBrandDropdownOpen] = React.useState(false);
  const brandDropdownRef = React.useRef<HTMLDivElement>(null);
  const brandTriggerRef = React.useRef<HTMLButtonElement>(null);

  const closeBrandDropdown = (restoreFocus: boolean) => {
    setBrandDropdownOpen(false);
    if (restoreFocus) brandTriggerRef.current?.focus();
  };

  React.useEffect(() => {
    if (!brandDropdownOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const isFocusInside = brandDropdownRef.current?.contains(document.activeElement);
        closeBrandDropdown(Boolean(isFocusInside));
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (brandDropdownRef.current && !brandDropdownRef.current.contains(e.target as Node)) {
        closeBrandDropdown(false);
      }
    };
    const handleFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && brandDropdownRef.current && !brandDropdownRef.current.contains(next)) {
        closeBrandDropdown(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [brandDropdownOpen]);
  const [hint, setHint] = React.useState<{ label: string; top: number; left: number } | null>(null);
  const openerRef = React.useRef<HTMLButtonElement>(null);
  const collapseRef = React.useRef<HTMLButtonElement>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const permitted = CORE_DESTINATIONS.filter(item => item.roles.includes(persona));
  const pendingEnquiries = websiteEnquiries.filter(e => e.status === 'PENDING_REVIEW').length;
  const activeDestination = CORE_DESTINATIONS.find(item => item.id === activeTab);

  React.useEffect(() => {
    // A changed persona or externally selected page must not leave an obsolete drawer open.
    setMobileOpen(false);
    setHint(null);
  }, [persona, activeTab]);

  React.useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1024px)');
    const onDesktop = () => {
      setHint(null);
      if (media?.matches) setMobileOpen(false);
    };
    media?.addEventListener('change', onDesktop);
    return () => media?.removeEventListener('change', onDesktop);
  }, []);

  React.useEffect(() => {
    if (!mobileOpen || !drawerRef.current || !layerRef.current) return;
    const drawer = drawerRef.current;
    const savedOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children)
      .filter(element => element !== layerRef.current)
      .map(element => ({ element, wasInert: element.hasAttribute('inert') }));
    background.forEach(({ element }) => element.setAttribute('inert', ''));
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const focusable = () => Array.from(drawer.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.closest('[hidden]'));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMobileOpen(false);
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!drawer.contains(event.target as Node)) closeRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      background.forEach(({ element, wasInert }) => { if (!wasInert) element.removeAttribute('inert'); });
      document.body.style.overflow = savedOverflow;
      const target = window.matchMedia?.('(min-width: 1024px)').matches ? collapseRef.current : openerRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [mobileOpen]);

  const selectDestination = (id: string) => {
    if (!canAccessDestination(persona, id)) return;
    setActiveTab(id);
    setMobileOpen(false);
    setHint(null);
  };
  const showHint = (button: HTMLButtonElement, label: string) => {
    if (!collapsed) return;
    const rect = button.getBoundingClientRect();
    setHint({ label, top: rect.top + rect.height / 2, left: rect.right + 8 });
  };
  const links = (isDrawer: boolean) => (['Operations', 'Administration'] as const).map(section => {
    const items = permitted.filter(item => item.section === section);
    if (!items.length) return null;
    return <section className="cabms-nav-section" key={section} aria-label={section}>
      <h2 className={`cabms-nav-section-title ${!isDrawer && collapsed ? 'cabms-sr-only' : ''}`}>{section}</h2>
      {items.map(item => <button
        key={item.id} type="button" className="cabms-nav-link"
        aria-label={
          item.id === 'website_inbox' && pendingEnquiries > 0
            ? `${item.label} (${pendingEnquiries} pending ${pendingEnquiries === 1 ? 'enquiry' : 'enquiries'})`
            : item.label
        } aria-current={activeTab === item.id ? 'page' : undefined}
        title={item.label} onClick={() => selectDestination(item.id)}
        onFocus={event => { if (!isDrawer) showHint(event.currentTarget, item.label); }}
        onBlur={() => setHint(null)}
        onMouseEnter={event => { if (!isDrawer) showHint(event.currentTarget, item.label); }}
        onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setHint(null); }}
      >
        <item.icon aria-hidden="true" className="cabms-nav-icon" />
        <span className={!isDrawer && collapsed ? 'cabms-sr-only' : 'cabms-nav-label'}>{item.label}</span>
        {item.id === 'website_inbox' && pendingEnquiries > 0 &&
          <span className="cabms-nav-badge" aria-hidden="true">{pendingEnquiries}</span>}
      </button>)}
    </section>;
  });

  return <div className="cabms-shell" data-sidebar-collapsed={collapsed}>
    <a className="cabms-skip-link" href="#cabms-main-content" onClick={() => document.getElementById('cabms-main-content')?.focus()}>Skip to main content</a>
    <aside className="cabms-sidebar" aria-label="Desktop sidebar">
      <div className="cabms-sidebar-heading">
        {!collapsed && <span className="cabms-sidebar-wordmark">CABMS<span>Business operations</span></span>}
        <button ref={collapseRef} type="button" className="cabms-icon-button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed} aria-controls="cabms-desktop-navigation"
          onClick={() => { setCollapsed(value => !value); setHint(null); }}>
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>
      <nav id="cabms-desktop-navigation" aria-label="Main navigation" className="cabms-nav-scroll" onScroll={() => setHint(null)}>{links(false)}</nav>
      <p className={`cabms-sidebar-disclosure ${collapsed ? 'cabms-sr-only' : ''}`}>Demo workspace<br />No live integrations</p>
    </aside>
    <div className="cabms-workspace">
      <header className="cabms-topbar">
        <button ref={openerRef} type="button" className="cabms-icon-button cabms-mobile-toggle"
          aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="cabms-mobile-drawer"
          onClick={() => setMobileOpen(true)}><Menu aria-hidden="true" /></button>
        <div className="cabms-brand-switcher-wrapper" ref={brandDropdownRef}>
          <button
            ref={brandTriggerRef}
            type="button"
            className="cabms-brand-mark-btn"
            aria-label={`Current business: ${activeBrand.name}. Switch business context`}
            aria-expanded={brandDropdownOpen}
            aria-controls="cabms-brand-dropdown-menu"
            onClick={() => setBrandDropdownOpen(open => !open)}
          >
            <div className="cabms-brand-mark" style={{ backgroundColor: activeBrand.primaryColor }} aria-hidden="true">
              {activeBrand.name.charAt(0)}
            </div>
            <ChevronDown className="cabms-brand-chevron" aria-hidden="true" />
          </button>
          {brandDropdownOpen && (
            <div
              id="cabms-brand-dropdown-menu"
              className="cabms-brand-dropdown-menu"
              role="group"
              aria-label="Switch business"
            >
              <div className="cabms-brand-dropdown-header">Switch Business</div>
              <div className="cabms-brand-dropdown-list">
                {Object.values(brands).map(b => (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={activeBrandId === b.id}
                    aria-label={`Switch business to ${b.name || 'unnamed business'}`}
                    title={b.name || 'Unnamed business'}
                    onClick={() => {
                      setActiveBrandId(b.id);
                      closeBrandDropdown(true);
                    }}
                    className={`cabms-brand-dropdown-option ${activeBrandId === b.id ? 'is-active' : ''}`}
                  >
                    <span className="cabms-brand-option-mark" style={{ backgroundColor: b.primaryColor }} aria-hidden="true">
                      {b.name.charAt(0)}
                    </span>
                    <div className="cabms-brand-option-info">
                      <span className="cabms-brand-option-name">
                        {b.name || 'Unnamed business'}
                      </span>
                      <span className="cabms-brand-option-abn">{b.abnPlaceholder}</span>
                    </div>
                    {activeBrandId === b.id && <Check className="cabms-brand-option-check" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="cabms-topbar-identity">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="cabms-business-name">{activeBrand.name}</h1>
            <span className="cabms-topbar-abn">{activeBrand.abnPlaceholder}</span>
            <span className="cabms-active-area">• {activeDestination?.label || 'Restricted destination'}</span>
          </div>
          <p className="cabms-topbar-tagline">{activeBrand.tagline}</p>
          <div className="cabms-topbar-meta">
            <span>Licence: <strong className="text-[var(--cabms-text-primary)]">{activeBrand.electricalLicencePlaceholder}</strong></span>
            <span className="cabms-meta-sep">•</span>
            <span>Cabler: <strong className="text-[var(--cabms-text-primary)]">{activeBrand.acmaCablerPlaceholder}</strong></span>
            <span className="cabms-meta-sep">•</span>
            <span>MYOB File: <strong className="cabms-myob-id">{myobConnection.companyId}</strong></span>
          </div>
        </div>
        <span className="cabms-persona">{personaLabels[persona]}</span>
        <button type="button" className="cabms-icon-button" aria-label="Sign out"
          title="Simulate signing out of the current demo session" onClick={simulateSignOut}>
          <LogOut aria-hidden="true" /><span className="cabms-sr-only">Sign out</span>
        </button>
      </header>
      {demoNotification && <div className="cabms-notification" data-tone={demoNotification.type} role="status" aria-live="polite">
        <span>{demoNotification.message}</span>
        <button type="button" onClick={clearDemoNotification}>Dismiss</button>
      </div>}
      {children}
    </div>
    {hint && collapsed && typeof document !== 'undefined' && createPortal(
      <div className="cabms-nav-tooltip" role="tooltip" style={{ top: hint.top, left: hint.left }}>{hint.label}</div>, document.body
    )}
    {mobileOpen && typeof document !== 'undefined' && createPortal(
      <div ref={layerRef} className="cabms-drawer-layer">
        <div className="cabms-drawer-backdrop" aria-hidden="true" onClick={() => setMobileOpen(false)} />
        <div ref={drawerRef} id="cabms-mobile-drawer" className="cabms-mobile-drawer" role="dialog" aria-modal="true" aria-labelledby="cabms-drawer-title">
          <div className="cabms-drawer-heading">
            <h2 id="cabms-drawer-title">CABMS navigation</h2>
            <button ref={closeRef} type="button" className="cabms-icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X aria-hidden="true" /></button>
          </div>
          <p className="cabms-drawer-identity">{activeBrand.name}<br /><span>{personaLabels[persona]}</span></p>
          <nav aria-label="Mobile navigation" className="cabms-nav-scroll">{links(true)}</nav>
          <p className="cabms-sidebar-disclosure">Demo workspace · No live integrations</p>
        </div>
      </div>, document.body
    )}
  </div>;
};
