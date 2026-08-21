import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { isFeatureEnabled, FeatureKey } from '@/lib/featureFlags';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Map, Truck, Users, Bell, Settings, LogOut,
  ChevronLeft, ChevronRight, Hexagon, FileText, Building2, Warehouse,
  PackageCheck, AlertOctagon, Upload, TrendingUp, ChevronDown, Plug,
  Radio, Receipt, DollarSign, UserCog, Package, Wrench,
  Boxes, ClipboardCheck, ArrowRightLeft, Wallet, FileSearch, FileSpreadsheet,
  PackageOpen, MonitorPlay, Sprout, Tag, ShieldCheck, Check
} from 'lucide-react';
import { TenantSwitcher } from './TenantSwitcher';

type NavLeaf = { label: string; href: string; icon: ReactNode; feature?: FeatureKey };
type NavGroup = { label: string; icon: ReactNode; items: NavLeaf[]; feature?: FeatureKey };
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
          { label: 'CT-e (Faturamento, Monitor, Consulta)', href: '/cte-hub', icon: <FileSpreadsheet className="h-4 w-4" /> },
          { label: 'Consulta CT-e', href: '/cte-search', icon: <FileSearch className="h-4 w-4" /> },
          { label: 'NFS-e (Serviços)', href: '/nfse', icon: <FileSpreadsheet className="h-4 w-4" /> },
          { label: 'ORT', href: '/ort-management', icon: <FileSearch className="h-4 w-4" /> },
          { label: 'Auditoria ICMS', href: '/cte-consistency', icon: <ShieldCheck className="h-4 w-4" /> },
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
      { label: 'Controle de Cargas', href: '/load-control', icon: <PackageCheck className="h-4 w-4" />, feature: 'LOAD_CONTROL' },

      { label: 'Monitoramento de Motoristas', href: '/driver-monitoring', icon: <Users className="h-4 w-4" />, feature: 'DRIVER_WORKSPACE' },
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
      { label: 'Razão Operacional', href: '/ledger', icon: <FileText className="h-4 w-4" />, feature: 'OPERATIONAL_LEDGER' },
      { label: 'Centros de Custo', href: '/cost-centers', icon: <Tag className="h-4 w-4" /> },

    ],
  },
  {
    label: 'Cadastros',
    items: [
      { label: 'Clientes e Fornecedores', href: '/clients', icon: <Building2 className="h-4 w-4" /> },
      { label: 'Funcionários', href: '/employees', icon: <UserCog className="h-4 w-4" />, feature: 'HR_CORE' },

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
      { label: 'Auditoria de Dados', href: '/data-quality', icon: <ShieldCheck className="h-4 w-4" />, feature: 'DATA_QUALITY_CENTER' },

      { label: 'Integrações', href: '/integration-health', icon: <Plug className="h-4 w-4" /> },
      { label: 'Configurações', href: '/settings', icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { currentTenant } = useTenant();
  const { data: companyProfile } = useCompanyProfile();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
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
      <aside className={cn(
        "flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200 shrink-0",
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
        {/* Tenant Switcher */}
        <div className="px-3 py-2">
          <TenantSwitcher collapsed={collapsed} />
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
                    {section.items.filter(entry => !entry.feature || isFeatureEnabled(entry.feature)).map(entry => {
                      if (!isGroup(entry)) {
                        const active = isActive(entry.href);
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
                            {entry.items.filter(item => !item.feature || isFeatureEnabled(item.feature)).map(item => {

                              const active = isActive(item.href);
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
                              {entry.items.filter(item => !item.feature || isFeatureEnabled(item.feature)).map(item => {
                                const active = isActive(item.href);
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
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
