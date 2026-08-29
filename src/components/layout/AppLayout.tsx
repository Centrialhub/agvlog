import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { useTenantCapabilities, type IntegrationCapability } from '@/hooks/useTenantCapabilities';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Map, Truck, Users, Bell, Settings, LogOut,
  ChevronLeft, ChevronRight, Hexagon, FileText, Building2, Warehouse,
  PackageCheck, AlertOctagon, Upload, TrendingUp, ChevronDown, Plug,
  Radio, Receipt, DollarSign, UserCog, Package, Wrench,
  Boxes, ClipboardCheck, ArrowRightLeft, Wallet, FileSearch, FileSpreadsheet,
  PackageOpen, MonitorPlay, Sprout, Tag, ShieldCheck,
  Menu,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type NavLeaf = { label: string; href: string; icon: ReactNode; capability?: IntegrationCapability };
type NavGroup = { label: string; icon: ReactNode; items: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

interface NavSection {
  label: string;
  items: NavEntry[];
}

const isGroup = (e: NavEntry): e is NavGroup => 'items' in e;

const navSections: NavSection[] = [
  {
    label: 'Operações',
    items: [
      { label: 'Centro de Operações', href: '/', icon: <LayoutDashboard className="h-4 w-4" /> },
      { label: 'Coletas', href: '/pickup-orders', icon: <PackageOpen className="h-4 w-4" /> },
      { label: 'Importação', href: '/ingestion', icon: <Upload className="h-4 w-4" /> },
      {
        label: 'Documentos Fiscais',
        icon: <FileSpreadsheet className="h-4 w-4" />,
        items: [
          { label: 'CT-e (Faturamento, Monitor, Consulta)', href: '/cte-hub', icon: <FileSpreadsheet className="h-4 w-4" />, capability: 'fiscal' },
          { label: 'Consulta CT-e', href: '/cte-search', icon: <FileSearch className="h-4 w-4" />, capability: 'fiscal' },
          { label: 'NFS-e (Serviços)', href: '/nfse', icon: <FileSpreadsheet className="h-4 w-4" />, capability: 'fiscal' },
          { label: 'ORT', href: '/ort-management', icon: <FileSearch className="h-4 w-4" /> },
          { label: 'Auditoria ICMS', href: '/cte-consistency', icon: <ShieldCheck className="h-4 w-4" />, capability: 'fiscal' },
          { label: 'MDF (provisório)', href: '/mdfe-provisional', icon: <FileText className="h-4 w-4" />, capability: 'fiscal' },
        ],
      },
      {
        label: 'Cargas & Roteirização',
        icon: <PackageCheck className="h-4 w-4" />,
        items: [
          { label: 'Roteirização', href: '/route-planning', icon: <Radio className="h-4 w-4" /> },
          { label: 'Cargas', href: '/loads', icon: <PackageCheck className="h-4 w-4" /> },
          { label: 'Mover Cargas', href: '/reallocation', icon: <ArrowRightLeft className="h-4 w-4" /> },
        ],
      },
      {
        label: 'Rastreabilidade',
        icon: <FileSearch className="h-4 w-4" />,
        items: [
          { label: 'Rastreabilidade', href: '/traceability', icon: <FileSearch className="h-4 w-4" /> },
          { label: 'Rastreab. Produto', href: '/product-traceability', icon: <Package className="h-4 w-4" /> },
          { label: 'Histórico do Produto', href: '/product-history', icon: <FileSearch className="h-4 w-4" /> },
          { label: 'Auditoria de Carga', href: '/load-extraction-audit', icon: <FileSearch className="h-4 w-4" /> },
          { label: 'Resumo NF Importadas', href: '/imported-notes-summary', icon: <FileSpreadsheet className="h-4 w-4" /> },
        ],
      },
      { label: 'Controle de Cargas', href: '/load-control', icon: <PackageCheck className="h-4 w-4" /> },
      { label: 'Monitoramento de Motoristas', href: '/driver-monitoring', icon: <Users className="h-4 w-4" /> },
      { label: 'Devolução de Paletes', href: '/pallet-returns', icon: <Boxes className="h-4 w-4" /> },
      { label: 'Falta de Mercadoria', href: '/merchandise-shortages', icon: <AlertOctagon className="h-4 w-4" /> },
      { label: 'Eventos Operacionais', href: '/events', icon: <AlertOctagon className="h-4 w-4" /> },
      { label: 'Ocorrências Formais (RH/Auditoria)', href: '/incidents', icon: <AlertOctagon className="h-4 w-4" /> },
      { label: 'Relatórios de Ocorrências', href: '/occurrence-reports', icon: <FileSpreadsheet className="h-4 w-4" /> },
      { label: 'Checklists', href: '/checklists', icon: <ClipboardCheck className="h-4 w-4" /> },
      { label: 'Produtividade', href: '/productivity', icon: <TrendingUp className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { label: 'Painel Financeiro', href: '/financial', icon: <Wallet className="h-4 w-4" /> },
      { label: 'Contas a Receber', href: '/receivables', icon: <DollarSign className="h-4 w-4" /> },
      { label: 'Contas a Pagar', href: '/payables', icon: <DollarSign className="h-4 w-4" /> },
      { label: 'Faturas por Cliente', href: '/client-invoices', icon: <FileText className="h-4 w-4" /> },
      { label: 'Arquivo de Cobrança / DOCCOB', href: '/billing-edi', icon: <FileText className="h-4 w-4" /> },
      { label: 'Relatórios de Fechamento', href: '/closing-reports', icon: <FileSpreadsheet className="h-4 w-4" /> },
      { label: 'Aprovação Despesas', href: '/expense-approval', icon: <Receipt className="h-4 w-4" /> },
      { label: 'Acerto de Motoristas', href: '/driver-settlements', icon: <Receipt className="h-4 w-4" /> },
      { label: 'Conciliação Bancária', href: '/bank-reconciliation', icon: <Wallet className="h-4 w-4" /> },
      { label: 'Folha de Pagamento', href: '/payroll', icon: <Wallet className="h-4 w-4" /> },
      { label: 'Centros de Custo', href: '/cost-centers', icon: <Tag className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { label: 'Clientes e Fornecedores', href: '/clients', icon: <Building2 className="h-4 w-4" /> },
      { label: 'Funcionários', href: '/employees', icon: <UserCog className="h-4 w-4" /> },
      { label: 'Veículos', href: '/vehicles', icon: <Truck className="h-4 w-4" /> },
      { label: 'Motoristas', href: '/drivers', icon: <Users className="h-4 w-4" /> },
      { label: 'Ativos / Patrimônio', href: '/assets', icon: <Package className="h-4 w-4" /> },
      { label: 'Documentos Fiscais', href: '/fiscal-documents', icon: <FileText className="h-4 w-4" /> },
      { label: 'Rotas Operacionais', href: '/operational-routes', icon: <FileText className="h-4 w-4" /> },
      { label: 'Frete Automático', href: '/freight', icon: <DollarSign className="h-4 w-4" /> },
      { label: 'Clientes Zona Rural', href: '/rural-clients', icon: <Sprout className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Manutenção & Estoque',
    items: [
      { label: 'Ordens de Manutenção', href: '/maintenance-orders', icon: <Wrench className="h-4 w-4" /> },
      { label: 'Estoque / Almoxarifado', href: '/stock', icon: <Boxes className="h-4 w-4" /> },
      { label: 'Inventário Logístico', href: '/inventory', icon: <Warehouse className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Monitoramento',
    items: [
      { label: 'Torre de Controle', href: '/operations-control', icon: <MonitorPlay className="h-4 w-4" /> },
      { label: 'Mapa da Frota', href: '/fleet-map', icon: <Map className="h-4 w-4" /> },
      { label: 'Alertas', href: '/alerts', icon: <Bell className="h-4 w-4" /> },
      { label: 'Corredores Monitorados', href: '/corridors', icon: <Radio className="h-4 w-4" /> },
      { label: 'Geofences', href: '/geofences', icon: <Hexagon className="h-4 w-4" /> },
      { label: 'Relatórios', href: '/reports', icon: <FileText className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { label: 'Equipe & Acessos', href: '/team', icon: <Users className="h-4 w-4" /> },
      { label: 'Integrações', href: '/integration-health', icon: <Plug className="h-4 w-4" /> },
      { label: 'Configurações', href: '/settings', icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { currentTenant, memberships, setCurrentTenantId } = useTenant();
  const { isEnabled, isLoading: capabilitiesLoading, error: capabilitiesError } = useTenantCapabilities();
  const { data: companyProfile } = useCompanyProfile();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    // Start collapsed, but auto-open the group containing the active route
    const path = window.location.pathname;
    const all = new Set<string>();
    for (const s of navSections) {
      for (const e of s.items) {
        if ('items' in e) {
          const hasActive = e.items.some(i => i.href === '/' ? path === '/' : path.startsWith(i.href));
          if (!hasActive) all.add(e.label);
        }
      }
    }
    return all;
  });

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const toggleSection = (label: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname.startsWith(href);
  };

  const logoUrl = companyProfile?.logo_data_url || null;
  const brandName = companyProfile?.trade_name || companyProfile?.legal_name || currentTenant?.name || 'AGVLog';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[min(20rem,88vw)] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
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
          <nav aria-label="Navegação principal" className="h-[calc(100vh-3.25rem)] overflow-y-auto px-2 py-3">
            {navSections.map(section => (
              <div key={section.label} className="mb-4">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.items.flatMap(entry => isGroup(entry) ? entry.items : [entry]).map(item => {
                    const active = isActive(item.href);
                    const disabled = Boolean(item.capability) && (
                      capabilitiesLoading || Boolean(capabilitiesError) || !isEnabled(item.capability!)
                    );
                    if (disabled) {
                      return (
                        <div
                          key={item.href}
                          aria-disabled="true"
                          title="Integração em implantação"
                          className="flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/40"
                        >
                          {item.icon}
                          <span>{item.label}</span>
                          <span className="ml-auto text-[10px] uppercase tracking-wide">Em implantação</span>
                        </div>
                      );
                    }
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        )}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              onClick={() => { setMobileOpen(false); void signOut(); }}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
            >
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </button>
          </nav>
        </SheetContent>
      </Sheet>

      <aside className={cn(
        "hidden md:flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200 shrink-0",
        collapsed ? "w-14" : "w-56"
      )}>
        {/* Logo */}
        <div className="flex h-12 items-center gap-2 px-3 border-b border-sidebar-border">
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

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto py-2 space-y-1">
          {navSections.map(section => {
            const sectionCollapsed = collapsedSections.has(section.label);

            return (
              <div key={section.label}>
                {!collapsed && (
                  <button
                    onClick={() => toggleSection(section.label)}
                    className="flex w-full items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
                  >
                    {section.label}
                    <ChevronDown className={cn("h-3 w-3 transition-transform", sectionCollapsed && "-rotate-90")} />
                  </button>
                )}
                {(!sectionCollapsed || collapsed) && (
                  <div className="space-y-0.5 px-1.5">
                    {section.items.map(entry => {
                      if (!isGroup(entry)) {
                        const active = isActive(entry.href);
                        const disabled = Boolean(entry.capability) && (
                          capabilitiesLoading || Boolean(capabilitiesError) || !isEnabled(entry.capability!)
                        );
                        if (disabled) {
                          return (
                            <div
                              key={entry.href}
                              aria-disabled="true"
                              title="Integração em implantação"
                              className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-sidebar-foreground/35"
                            >
                              {entry.icon}
                              {!collapsed && <span>{entry.label} · Em implantação</span>}
                            </div>
                          );
                        }
                        return (
                          <Link
                            key={entry.href}
                            to={entry.href}
                            className={cn(
                              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                              active
                                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                            )}
                            title={collapsed ? entry.label : undefined}
                          >
                            {entry.icon}
                            {!collapsed && <span>{entry.label}</span>}
                          </Link>
                        );
                      }
                      const groupCollapsed = collapsedGroups.has(entry.label);
                      const hasActive = entry.items.some(i => isActive(i.href));
                      if (collapsed) {
                        // Mini mode: render children flat with icons only
                        return (
                          <div key={entry.label} className="space-y-0.5">
                            {entry.items.map(item => {
                              const active = isActive(item.href);
                              const disabled = Boolean(item.capability) && (
                                capabilitiesLoading || Boolean(capabilitiesError) || !isEnabled(item.capability!)
                              );
                              if (disabled) {
                                return (
                                  <div
                                    key={item.href}
                                    aria-disabled="true"
                                    title={`${entry.label} • ${item.label} • Em implantação`}
                                    className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-sidebar-foreground/35"
                                  >
                                    {item.icon}
                                  </div>
                                );
                              }
                              return (
                                <Link
                                  key={item.href}
                                  to={item.href}
                                  title={`${entry.label} • ${item.label}`}
                                  className={cn(
                                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                                    active
                                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                                  )}
                                >
                                  {item.icon}
                                </Link>
                              );
                            })}
                          </div>
                        );
                      }
                      return (
                        <div key={entry.label}>
                          <button
                            onClick={() => toggleGroup(entry.label)}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                              hasActive
                                ? "text-sidebar-foreground font-medium"
                                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                            )}
                          >
                            {entry.icon}
                            <span className="flex-1 text-left">{entry.label}</span>
                            <ChevronDown className={cn("h-3 w-3 transition-transform", groupCollapsed && "-rotate-90")} />
                          </button>
                          {!groupCollapsed && (
                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border/60 pl-2">
                              {entry.items.map(item => {
                                const active = isActive(item.href);
                                const disabled = Boolean(item.capability) && (
                                  capabilitiesLoading || Boolean(capabilitiesError) || !isEnabled(item.capability!)
                                );
                                if (disabled) {
                                  return (
                                    <div
                                      key={item.href}
                                      aria-disabled="true"
                                      title="Integração em implantação"
                                      className="flex items-center gap-2.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground/35"
                                    >
                                      {item.icon}
                                      <span>{item.label} · Em implantação</span>
                                    </div>
                                  );
                                }
                                return (
                                  <Link
                                    key={item.href}
                                    to={item.href}
                                    className={cn(
                                      "flex items-center gap-2.5 rounded-md px-2 py-1 text-xs transition-colors",
                                      active
                                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                        : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                                    )}
                                  >
                                    {item.icon}
                                    <span>{item.label}</span>
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

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
            onClick={() => setCollapsed(v => !v)}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent/50 transition-colors"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span>Recolher</span>}
          </button>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent/50 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu principal"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="truncate text-sm font-semibold">{brandName}</span>
        </header>
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
