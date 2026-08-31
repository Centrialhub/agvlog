import { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { useTenantCapabilities, type IntegrationCapability } from '@/hooks/useTenantCapabilities';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Truck, LogOut, ChevronLeft, ChevronRight, Menu, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SidebarNavigation } from './SidebarNavigation';
import { PageBreadcrumbs } from './PageBreadcrumbs';
import { findNavigationPage } from './navigation';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DocumentChangeRecoveryPanel } from '@/components/loads/DocumentChangeRecoveryPanel';
import { ItemPreparationRecoveryPanel } from '@/components/loads/ItemPreparationRecoveryPanel';
import { OperationOutcomeRecoveryPanel } from '@/components/loads/OperationOutcomeRecoveryPanel';
import { RedeliveryRecoveryPanel } from '@/components/loads/RedeliveryRecoveryPanel';
import { DocumentMetadataRecoveryPanel } from '@/components/loads/DocumentMetadataRecoveryPanel';
import { ClosingDraftRecoveryPanel } from '@/components/closingReports/ClosingDraftRecoveryPanel';
import { ClosingLifecycleRecoveryPanel } from '@/components/closingReports/ClosingLifecycleRecoveryPanel';
import { ReceivableFinancialRecoveryPanel } from '@/components/financial/ReceivableFinancialRecoveryPanel';
import { ClientInvoiceRecoveryPanel } from '@/components/financial/ClientInvoiceRecoveryPanel';
import { ExpenseReviewRecoveryPanel } from '@/components/financial/ExpenseReviewRecoveryPanel';
import { ExpenseCreationRecoveryPanel } from '@/components/financial/ExpenseCreationRecoveryPanel';
import { SettlementAdjustmentRecoveryPanel } from '@/components/financial/SettlementAdjustmentRecoveryPanel';
import { ChatRecoveryPanel } from '@/components/driver/ChatRecoveryPanel';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { currentTenant, memberships, setCurrentTenantId } = useTenant();
  const { isEnabled, isLoading: capabilitiesLoading, error: capabilitiesError } = useTenantCapabilities();
  const { data: companyProfile } = useCompanyProfile();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pageQuery, setPageQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const capabilityAvailable = (capability: IntegrationCapability) => !capabilitiesLoading && !capabilitiesError && isEnabled(capability);
  useEffect(() => {
    setPageQuery('');
    setMobileOpen(false);
    const page = findNavigationPage(location.pathname);
    document.title = (page?.item.label ?? 'AGVLog') + ' · AGVLog';
  }, [location.pathname]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (window.matchMedia('(min-width: 768px)').matches) {
          setCollapsed(false);
          requestAnimationFrame(() => searchRef.current?.focus());
        } else setMobileOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const logoUrl = companyProfile?.logo_data_url || null;
  const brandName = companyProfile?.trade_name || companyProfile?.legal_name || currentTenant?.name || 'AGVLog';

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-3">Pular para o conteúdo</a>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-[min(22rem,92vw)] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="border-b border-sidebar-border px-4 py-3 text-left">
            <SheetTitle className="flex items-center gap-2 text-sm text-sidebar-primary-foreground">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="h-7 w-7 rounded-md object-contain bg-sidebar-primary/10" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary">
                  <Truck className="h-3.5 w-3.5 text-sidebar-primary-foreground" />
                </span>
              )}
              <span className="truncate">{brandName}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">Navegue por área ou busque uma página.</SheetDescription>
            {memberships.length > 1 ? (
              <label className="space-y-1 text-xs text-sidebar-foreground/70">
                <span>Empresa ativa</span>
                <select
                  aria-label="Empresa ativa"
                  className="h-9 w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-sm text-sidebar-foreground"
                  value={currentTenant?.id ?? ""}
                  onChange={(event) => {
                    setCurrentTenantId(event.target.value);
                    setMobileOpen(false);
                  }}
                >
                  {memberships.map((membership) => (
                    <option key={membership.tenant_id} value={membership.tenant_id}>
                      {membership.tenants.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </SheetHeader>
          <div className="px-3 pt-3"><Input aria-label="Buscar páginas" placeholder="Buscar página, nota, carga..." value={pageQuery} onChange={event => setPageQuery(event.target.value)} className="border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground" /></div>
          <SidebarNavigation query={pageQuery} capabilityAvailable={capabilityAvailable} onNavigate={() => setMobileOpen(false)} />
          <Button variant="ghost" onClick={() => { setMobileOpen(false); void signOut(); }} className="m-2 shrink-0 justify-start"><LogOut className="mr-2 h-4 w-4" />Sair</Button>
        </SheetContent>
      </Sheet>

      <aside className={cn(
        "hidden md:flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200 shrink-0",
        collapsed ? "w-16" : "w-72"
      )}>
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center gap-2 px-3 border-b border-sidebar-border">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={brandName}
              className="h-7 w-7 shrink-0 rounded-md object-contain bg-sidebar-primary/10"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary">
              <Truck className="h-3.5 w-3.5 text-sidebar-primary-foreground" />
            </div>
          )}
          {!collapsed && (
            <span className="font-bold text-sm text-sidebar-primary-foreground tracking-tight truncate">{brandName}</span>
          )}
        </div>

        <div className="px-2 pt-3">
          {collapsed ? <Button variant="ghost" size="icon" aria-label="Buscar páginas" onClick={() => { setCollapsed(false); requestAnimationFrame(() => searchRef.current?.focus()); }}><Search className="h-4 w-4" /></Button>
            : <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-sidebar-foreground/60" />
              <Input ref={searchRef} aria-label="Buscar páginas" placeholder="Buscar páginas..." value={pageQuery} onChange={event => setPageQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setPageQuery(''); }} className="h-10 border-sidebar-border bg-sidebar-accent/40 pl-9 pr-12 text-sidebar-foreground placeholder:text-sidebar-foreground/50" />
              {pageQuery ? <button type="button" aria-label="Limpar busca de páginas" onClick={() => { setPageQuery(''); searchRef.current?.focus(); }} className="absolute right-1 top-1 rounded p-2"><X className="h-4 w-4" /></button> : <kbd className="pointer-events-none absolute right-2 top-3 text-[10px] text-sidebar-foreground/50">Ctrl K</kbd>}
            </div>}
        </div>
        <SidebarNavigation collapsed={collapsed} query={pageQuery} capabilityAvailable={capabilityAvailable} />

        {/* Footer */}
        <div className="border-t border-sidebar-border p-1.5 space-y-0.5">
          {!collapsed && memberships.length > 1 ? (
            <label className="block space-y-1 px-1 pb-1 text-[10px] text-sidebar-foreground/60">
              <span>Empresa ativa</span>
              <select
                aria-label="Empresa ativa"
                className="h-8 w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-xs text-sidebar-foreground"
                value={currentTenant?.id ?? ""}
                onChange={(event) => setCurrentTenantId(event.target.value)}
              >
                {memberships.map((membership) => (
                  <option key={membership.tenant_id} value={membership.tenant_id}>
                    {membership.tenants.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            aria-expanded={!collapsed}
            onClick={() => { setCollapsed(v => !v); setPageQuery(''); }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent/50 transition-colors"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span>Recolher</span>}
          </button>
          <button
            aria-label="Sair da conta"
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent/50 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto focus:outline-none">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur md:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu principal"
            className="md:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <PageBreadcrumbs />
        </header>
        <div className="p-4 md:p-6"><DocumentChangeRecoveryPanel /><ItemPreparationRecoveryPanel /><OperationOutcomeRecoveryPanel /><RedeliveryRecoveryPanel /><DocumentMetadataRecoveryPanel /><ClosingDraftRecoveryPanel /><ClosingLifecycleRecoveryPanel /><ReceivableFinancialRecoveryPanel /><ClientInvoiceRecoveryPanel /><ExpenseReviewRecoveryPanel /><ExpenseCreationRecoveryPanel /><SettlementAdjustmentRecoveryPanel /><ChatRecoveryPanel />{children}</div>
      </main>
    </div>
  );
}
