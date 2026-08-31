import {
  Activity, Archive, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote,
  Barcode, Bell, BookOpenCheck, Boxes, BriefcaseBusiness, Building2, Calculator,
  ChartColumn, ChartNoAxesCombined, CircleDollarSign, ClipboardCheck, ClipboardList,
  DatabaseZap, FileCheck2, FileClock, FileInput, FileSearch, FileSpreadsheet, FileText,
  FolderClock, Gauge, History, LayoutDashboard, Map, MapPinned, Navigation, Package,
  PackageCheck, PackageMinus, PackageOpen, Plug, Receipt, ReceiptText, Route,
  ScanLine, Settings, ShieldAlert, ShieldCheck, ShoppingCart, Sprout, Tags,
  Truck, Upload, UserCog, Users, Wallet, Warehouse, Waypoints, Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { IntegrationCapability } from '@/hooks/useTenantCapabilities';
import { matchesSearch } from '@/lib/listFilters';

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
  keywords?: string;
  capability?: IntegrationCapability;
}

export interface NavigationSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavigationItem[];
}

export const navigationSections: NavigationSection[] = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard, items: [
    { label: 'Centro de operações', href: '/', icon: LayoutDashboard },
    { label: 'Torre de controle', href: '/operations-control', icon: Gauge },
    { label: 'Painel da frota', href: '/dashboard', icon: ChartNoAxesCombined },
    { label: 'Painel operacional', href: '/operations', icon: Activity },
  ] },
  { id: 'operations', label: 'Planejamento e cargas', icon: PackageCheck, items: [
    { label: 'Coletas', href: '/pickup-orders', icon: PackageOpen },
    { label: 'Pedidos', href: '/orders', icon: ShoppingCart },
    { label: 'Importação de documentos', href: '/ingestion', icon: Upload, keywords: 'NF XML arquivo' },
    { label: 'Cargas', href: '/loads', icon: PackageCheck },
    { label: 'Roteirização', href: '/route-planning', icon: Route },
    { label: 'Mover cargas', href: '/reallocation', icon: ArrowLeftRight },
    { label: 'Controle de cargas', href: '/load-control', icon: ClipboardList },
    { label: 'Ordens de transporte', href: '/ort-management', icon: FileInput, keywords: 'ORT' },
  ] },
  { id: 'tracking', label: 'Rastreamento e ocorrências', icon: MapPinned, items: [
    { label: 'Mapa da frota', href: '/fleet-map', icon: Map },
    { label: 'Monitoramento de motoristas', href: '/driver-monitoring', icon: Navigation },
    { label: 'Rastreabilidade de notas', href: '/traceability', icon: ScanLine, keywords: 'NF POD canhoto' },
    { label: 'Rastreabilidade de produtos', href: '/product-traceability', icon: Barcode },
    { label: 'Histórico de produtos', href: '/product-history', icon: History },
    { label: 'Eventos operacionais', href: '/events', icon: Activity },
    { label: 'Alertas', href: '/alerts', icon: Bell },
    { label: 'Falta de mercadoria', href: '/merchandise-shortages', icon: PackageMinus },
    { label: 'Devolução de paletes', href: '/pallet-returns', icon: Boxes },
  ] },
  { id: 'fiscal', label: 'Documentos fiscais', icon: FileText, items: [
    { label: 'Documentos e notas fiscais', href: '/fiscal-documents', icon: FileText, keywords: 'NF NF-e XML' },
    { label: 'Central CT-e', href: '/cte-hub', icon: FileSpreadsheet, capability: 'fiscal', keywords: 'faturamento emissão monitor' },
    { label: 'Consulta CT-e', href: '/cte-search', icon: FileSearch, capability: 'fiscal' },
    { label: 'NFS-e de serviços', href: '/nfse', icon: ReceiptText, capability: 'fiscal' },
    { label: 'MDF provisório', href: '/mdfe-provisional', icon: FileClock, capability: 'fiscal', keywords: 'manifesto MDF-e' },
    { label: 'Auditoria ICMS', href: '/cte-consistency', icon: ShieldCheck, capability: 'fiscal' },
  ] },
  { id: 'finance', label: 'Financeiro', icon: Wallet, items: [
    { label: 'Painel financeiro', href: '/financial', icon: Wallet },
    { label: 'Contas a receber', href: '/receivables', icon: ArrowDownToLine },
    { label: 'Contas a pagar', href: '/payables', icon: ArrowUpFromLine },
    { label: 'Faturas por cliente', href: '/client-invoices', icon: Receipt },
    { label: 'Arquivo de cobrança', href: '/billing-edi', icon: FileInput, keywords: 'DOCCOB EDI' },
    { label: 'Fechamentos', href: '/closing-reports', icon: BookOpenCheck },
    { label: 'Aprovação de despesas', href: '/expense-approval', icon: FileCheck2 },
    { label: 'Acerto de motoristas', href: '/driver-settlements', icon: Banknote },
    { label: 'Conciliação bancária', href: '/bank-reconciliation', icon: ArrowLeftRight },
    { label: 'Centros de custo', href: '/cost-centers', icon: Tags },
  ] },
  { id: 'fleet', label: 'Frota e pessoas', icon: Truck, items: [
    { label: 'Veículos', href: '/vehicles', icon: Truck },
    { label: 'Motoristas', href: '/drivers', icon: Users },
    { label: 'Funcionários', href: '/employees', icon: BriefcaseBusiness },
    { label: 'Folha de pagamento', href: '/payroll', icon: CircleDollarSign },
    { label: 'Ocorrências formais', href: '/incidents', icon: ShieldAlert, keywords: 'RH auditoria' },
    { label: 'Checklists', href: '/checklists', icon: ClipboardCheck },
    { label: 'Ordens de manutenção', href: '/maintenance-orders', icon: Wrench },
    { label: 'Ativos e patrimônio', href: '/assets', icon: Archive },
  ] },
  { id: 'registry', label: 'Cadastros e estoque', icon: Building2, items: [
    { label: 'Clientes e fornecedores', href: '/clients', icon: Building2 },
    { label: 'Clientes da zona rural', href: '/rural-clients', icon: Sprout },
    { label: 'Rotas operacionais', href: '/operational-routes', icon: Waypoints },
    { label: 'Frete automático', href: '/freight', icon: Calculator, keywords: 'tabela simulador regiões' },
    { label: 'Corredores monitorados', href: '/corridors', icon: Route },
    { label: 'Cercas virtuais', href: '/geofences', icon: MapPinned, keywords: 'geofences' },
    { label: 'Estoque e almoxarifado', href: '/stock', icon: Package },
    { label: 'Inventário logístico', href: '/inventory', icon: Warehouse },
  ] },
  { id: 'reports', label: 'Relatórios e auditoria', icon: ChartColumn, items: [
    { label: 'Relatórios da frota', href: '/reports', icon: ChartColumn },
    { label: 'Produtividade', href: '/productivity', icon: ChartNoAxesCombined },
    { label: 'Relatórios de ocorrências', href: '/occurrence-reports', icon: ClipboardList },
    { label: 'Histórico de importações', href: '/ingestion-reports', icon: FolderClock },
    { label: 'Resumo de notas importadas', href: '/imported-notes-summary', icon: FileSpreadsheet },
    { label: 'Auditoria de cargas', href: '/load-extraction-audit', icon: FileSearch },
    { label: 'Auditoria de dados', href: '/data-audit', icon: DatabaseZap },
  ] },
  { id: 'system', label: 'Sistema', icon: Settings, items: [
    { label: 'Equipe e acessos', href: '/team', icon: UserCog },
    { label: 'Integrações', href: '/integration-health', icon: Plug },
    { label: 'Configurações', href: '/settings', icon: Settings },
  ] },
];

export function isNavigationActive(path: string, href: string) {
  return path === href || (href !== '/' && path.startsWith(`${href}/`));
}

const routeAliases: Record<string, string> = {
  '/billing': '/cte-hub', '/cte-monitor': '/cte-hub', '/regions': '/freight', '/routes': '/corridors',
};

export function findNavigationPage(pathname: string) {
  const path = routeAliases[pathname] ?? (pathname.startsWith('/occurrences/') ? '/occurrence-reports' : pathname);
  for (const section of navigationSections) {
    const item = section.items.find(entry => isNavigationActive(path, entry.href));
    if (item) return { section, item, isDetail: pathname !== item.href && !(pathname in routeAliases) };
  }
  return undefined;
}

export function searchNavigation(query: string) {
  return navigationSections.map(section => ({ ...section,
    items: section.items.filter(item => matchesSearch(query, section.label, item.label, item.keywords)),
  })).filter(section => section.items.length > 0);
}
