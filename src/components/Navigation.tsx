/** Shared ten-area navigation policy and presentation-only sidebar/drawer shell. */
import React from 'react';
import { createPortal } from 'react-dom';
import { useCabms } from '../context/CabmsContext.tsx';
import { Persona } from '../types/cabms.ts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faTableCellsLarge,
  faUsers,
  faBriefcase,
  faCalendar,
  faFileCircleCheck,
  faFileLines,
  faComment,
  faInbox,
  faGear,
  faSliders,
  faBars,
  faXmark,
  faRightFromBracket,
  faAnglesLeft,
  faAnglesRight,
  faChevronDown,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
import { BrandLogo } from './BrandLogo.tsx';

type Destination = {
  id: string; label: string; icon: IconDefinition;
  roles: readonly Persona[]; section: 'Operations' | 'Administration';
};
const everyone: readonly Persona[] = ['super_admin', 'owner_admin', 'office_staff', 'technician'];
const office: readonly Persona[] = ['super_admin', 'owner_admin', 'office_staff'];

export const CORE_DESTINATIONS: readonly Destination[] = [
  { id: 'dashboard', label: 'Dashboard', icon: faTableCellsLarge, roles: everyone, section: 'Operations' },
  { id: 'jobs', label: 'Jobs & Operations', icon: faBriefcase, roles: everyone, section: 'Operations' },
  { id: 'schedule', label: 'Schedule & Calendar', icon: faCalendar, roles: everyone, section: 'Operations' },
  { id: 'compliance', label: 'Compliance & Forms', icon: faFileCircleCheck, roles: everyone, section: 'Operations' },
  { id: 'customers', label: 'Customers (MYOB)', icon: faUsers, roles: office, section: 'Operations' },
  { id: 'quotes', label: 'Quotations & Terms', icon: faFileLines, roles: office, section: 'Operations' },
  { id: 'communications', label: 'Communications & Reviews', icon: faComment, roles: office, section: 'Operations' },
  { id: 'website_inbox', label: 'Website Enquiries', icon: faInbox, roles: office, section: 'Operations' },
  { id: 'templates', label: 'Templates & Content', icon: faSliders, roles: ['super_admin', 'owner_admin'], section: 'Administration' },
  { id: 'super_admin_setup', label: 'System & Workspace Settings', icon: faGear, roles: ['super_admin', 'owner_admin'], section: 'Administration' },
];

export function getDestinationLabel(item: Destination, persona: Persona): string {
  if (item.id === 'super_admin_setup') {
    return persona === 'super_admin' ? 'System & Workspace Settings' : 'Workspace Settings';
  }
  return item.label;
}
export function canAccessDestination(persona: Persona, destinationId: string): boolean {
  return CORE_DESTINATIONS.some(item => item.id === destinationId && item.roles.includes(persona));
}

const personaLabels: Record<Persona, string> = {
  super_admin: 'Super Admin', owner_admin: 'Admin',
  office_staff: 'Office Staff', technician: 'Technician (Dave Miller)',
};

export const Navigation: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { activeTab, setActiveTab, activeBrand, activeBrandId, setActiveBrandId, brands, persona, websiteEnquiries,
    demoNotification, clearDemoNotification, simulateSignOut } = useCabms();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [brandDropdownOpen, setBrandDropdownOpen] = React.useState(false);
  const brandDropdownRef = React.useRef<HTMLDivElement>(null);
  const brandTriggerRef = React.useRef<HTMLButtonElement>(null);

  const closeBrandDropdown = (restoreFocus: boolean) => {
    setBrandDropdownOpen(false);
    if (restoreFocus) {
      brandTriggerRef.current?.focus();
    }
  };

  React.useEffect(() => {
    if (!brandDropdownOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (brandDropdownRef.current && !brandDropdownRef.current.contains(target)) {
        closeBrandDropdown(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeBrandDropdown(true);
        return;
      }

      if (event.key === 'Tab') {
        const optionButtons = Array.from(
          brandDropdownRef.current?.querySelectorAll<HTMLButtonElement>('.cabms-brand-dropdown-option') ?? []
        );
        const active = document.activeElement;
        const leavingForward = !event.shiftKey && active === optionButtons.at(-1);
        const leavingBackward = event.shiftKey && active === brandTriggerRef.current;
        if (leavingForward || leavingBackward) {
          closeBrandDropdown(false);
        }
        return;
      }

      const menu = brandDropdownRef.current?.querySelector<HTMLDivElement>('#cabms-brand-dropdown-menu');
      if (!menu) return;
      if (!brandDropdownRef.current?.contains(document.activeElement)) return;
      const options = Array.from(menu.querySelectorAll<HTMLButtonElement>('.cabms-brand-dropdown-option'));
      if (!options.length) return;

      const activeIndex = options.findIndex(btn => btn === document.activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = activeIndex < options.length - 1 ? activeIndex + 1 : 0;
        options[nextIndex]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prevIndex = activeIndex > 0 ? activeIndex - 1 : options.length - 1;
        options[prevIndex]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        options[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        options[options.length - 1]?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [brandDropdownOpen]);

  const [hint, setHint] = React.useState<{ label: string; top: number; left: number } | null>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const openerRef = React.useRef<HTMLButtonElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const collapseRef = React.useRef<HTMLButtonElement>(null);

  const pendingEnquiries = websiteEnquiries.filter(e => e.status === 'PENDING_REVIEW').length;
  const permitted = CORE_DESTINATIONS.filter(item => item.roles.includes(persona));
  const activeDestination = CORE_DESTINATIONS.find(item => item.id === activeTab);

  React.useEffect(() => {
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
    const layer = layerRef.current;
    if (!drawer || !layer) return;

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
      {items.map(item => {
        const displayLabel = getDestinationLabel(item, persona);
        return (
          <button
            key={item.id}
            type="button"
            className="cabms-nav-link"
            aria-label={
              item.id === 'website_inbox' && pendingEnquiries > 0
                ? `${displayLabel} (${pendingEnquiries} pending ${pendingEnquiries === 1 ? 'enquiry' : 'enquiries'})`
                : displayLabel
            }
            aria-current={activeTab === item.id ? 'page' : undefined}
            title={displayLabel}
            onClick={() => selectDestination(item.id)}
            onFocus={event => { if (!isDrawer) showHint(event.currentTarget, displayLabel); }}
            onBlur={() => setHint(null)}
            onMouseEnter={event => { if (!isDrawer) showHint(event.currentTarget, displayLabel); }}
            onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setHint(null); }}
          >
            <FontAwesomeIcon icon={item.icon} aria-hidden="true" className="cabms-nav-icon" />
            <span className={!isDrawer && collapsed ? 'cabms-sr-only' : 'cabms-nav-label'}>{displayLabel}</span>
            {item.id === 'website_inbox' && pendingEnquiries > 0 && (
              <span className="cabms-nav-badge" aria-hidden="true">{pendingEnquiries}</span>
            )}
          </button>
        );
      })}
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
          {collapsed ? <FontAwesomeIcon icon={faAnglesRight} aria-hidden="true" /> : <FontAwesomeIcon icon={faAnglesLeft} aria-hidden="true" />}
        </button>
      </div>
      <nav id="cabms-desktop-navigation" aria-label="Main navigation" className="cabms-nav-scroll" onScroll={() => setHint(null)}>{links(false)}</nav>
      <p className={`cabms-sidebar-disclosure ${collapsed ? 'cabms-sr-only' : ''}`}>Demo workspace<br />No live integrations</p>
    </aside>
    <div className="cabms-workspace">
      <header className="cabms-topbar">
        <button ref={openerRef} type="button" className="cabms-icon-button cabms-mobile-toggle"
          aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="cabms-mobile-drawer"
          onClick={() => setMobileOpen(true)}>
          <FontAwesomeIcon icon={faBars} aria-hidden="true" />
        </button>
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
              <span className="cabms-sr-only">{activeBrand.name.charAt(0)}</span>
              <BrandLogo brandId={activeBrandId} variant="mark" alt={`${activeBrand.name} mark`} ariaHidden={true} className="cabms-brand-mark-svg" />
            </div>
            <FontAwesomeIcon icon={faChevronDown} className="cabms-brand-chevron" aria-hidden="true" />
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
                      <span className="cabms-sr-only">{b.name.charAt(0)}</span>
                      <BrandLogo brandId={b.id} variant="mark" alt={`${b.name} mark`} ariaHidden={true} className="cabms-brand-mark-svg" />
                    </span>
                    <div className="cabms-brand-option-info">
                      <span className="cabms-brand-option-name">
                        {b.name || 'Unnamed business'}
                      </span>
                      <span className="cabms-brand-option-abn">{b.abnPlaceholder}</span>
                    </div>
                    {activeBrandId === b.id && <FontAwesomeIcon icon={faCheck} className="cabms-brand-option-check" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="cabms-topbar-identity">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="cabms-business-name m-0 p-0 text-base font-bold flex items-center">
              <span className="cabms-sr-only">{activeBrand.name}</span>
              <BrandLogo
                brandId={activeBrandId}
                variant="full"
                alt={`${activeBrand.name} logo`}
                ariaHidden={true}
                className="cabms-topbar-logo"
              />
            </h1>
            <span className="cabms-active-area font-medium text-sm">
              • {activeDestination ? getDestinationLabel(activeDestination, persona) : 'Restricted destination'}
            </span>
          </div>
        </div>
        <span className="cabms-persona">{personaLabels[persona]}</span>
        <button type="button" className="cabms-icon-button" aria-label="Sign out"
          title="Simulate signing out of the current demo session" onClick={simulateSignOut}>
          <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" /><span className="cabms-sr-only">Sign out</span>
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
            <button ref={closeRef} type="button" className="cabms-icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          </div>
          <p className="cabms-drawer-identity">{activeBrand.name}<br /><span>{personaLabels[persona]}</span></p>
          <nav aria-label="Mobile navigation" className="cabms-nav-scroll">{links(true)}</nav>
          <p className="cabms-sidebar-disclosure">Demo workspace · No live integrations</p>
        </div>
      </div>, document.body
    )}
  </div>;
};
