import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LayoutDashboard,
  Map,
  Truck,
  Users,
  Bell,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Hexagon,
  FileText,
  Menu,
  Building2,
  ShoppingCart,
  Warehouse,
  PackageCheck,
  Activity,
  AlertOctagon,
  Upload,
  TrendingUp,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-5 w-5" /> },
  { label: 'Mapa da Frota', href: '/fleet-map', icon: <Map className="h-5 w-5" /> },
  { label: 'Veículos', href: '/vehicles', icon: <Truck className="h-5 w-5" /> },
  { label: 'Motoristas', href: '/drivers', icon: <Users className="h-5 w-5" /> },
  { label: 'Clientes', href: '/clients', icon: <Building2 className="h-5 w-5" /> },
  { label: 'Pedidos', href: '/orders', icon: <ShoppingCart className="h-5 w-5" /> },
  { label: 'Documentos Fiscais', href: '/fiscal-documents', icon: <FileText className="h-5 w-5" /> },
  { label: 'Importação', href: '/ingestion', icon: <Upload className="h-5 w-5" /> },
  { label: 'Estoque', href: '/inventory', icon: <Warehouse className="h-5 w-5" /> },
  { label: 'Cargas', href: '/loads', icon: <PackageCheck className="h-5 w-5" /> },
  { label: 'Operações', href: '/operations', icon: <Activity className="h-5 w-5" /> },
  { label: 'Ocorrências', href: '/events', icon: <AlertOctagon className="h-5 w-5" /> },
  { label: 'Alertas', href: '/alerts', icon: <Bell className="h-5 w-5" /> },
  { label: 'Geofences', href: '/geofences', icon: <Hexagon className="h-5 w-5" /> },
  { label: 'Relatórios', href: '/reports', icon: <FileText className="h-5 w-5" /> },
  { label: 'Produtividade', href: '/productivity', icon: <TrendingUp className="h-5 w-5" /> },
  { label: 'Rotas', href: '/routes', icon: <Map className="h-5 w-5" /> },
  { label: 'Configurações', href: '/settings', icon: <Settings className="h-5 w-5" /> },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { currentTenant, memberships, setCurrentTenantId, currentRole } = useTenant();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = currentRole === 'owner' || currentRole === 'admin';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className={cn(
        "flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}>
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary">
            <Truck className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && <span className="font-bold text-sm text-sidebar-primary-foreground">AGVLog</span>}
        </div>

        {/* Tenant switcher */}
        {!collapsed && memberships.length > 1 && (
          <div className="px-3 py-2 border-b border-sidebar-border">
            <Select
              value={currentTenant?.id}
              onValueChange={setCurrentTenantId}
            >
              <SelectTrigger className="h-8 bg-sidebar-accent border-sidebar-border text-sidebar-foreground text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {memberships.map(m => (
                  <SelectItem key={m.tenant_id} value={m.tenant_id}>
                    {m.tenants.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {navItems
            .filter(item => !item.adminOnly || isAdmin)
            .map(item => {
              const active = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  {item.icon}
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-2 space-y-1">
          <button
            onClick={() => setCollapsed(v => !v)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 transition-colors"
          >
            {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            {!collapsed && <span>Recolher</span>}
          </button>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 transition-colors"
          >
            <LogOut className="h-5 w-5" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
