import { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useClientPortalAccess } from '@/hooks/portal/useClientPortalAccess';
import { PortalClientScopeProvider } from '@/hooks/portal/usePortalClientScope';
import { PortalClientSelector } from '@/components/portal/PortalClientSelector';
import { PortalMoreMenu } from '@/components/portal/PortalMoreMenu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Truck,
  LayoutDashboard,
  Package,
  FileText,
  ClipboardCheck,
  AlertTriangle,
  Inbox,
  LogOut,
  Loader2,
  MapPin,
  BarChart3,
  Settings,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/portal', label: 'Início', icon: LayoutDashboard, end: true },
  { to: '/portal/shipments', label: 'Mercadorias', icon: Package },
  { to: '/portal/tracking', label: 'Tracking', icon: MapPin },
  { to: '/portal/pickups', label: 'Coletas', icon: Inbox },
  { to: '/portal/documents', label: 'Documentos', icon: FileText },
  { to: '/portal/pods', label: 'Canhotos', icon: ClipboardCheck },
  { to: '/portal/occurrences', label: 'Ocorrências', icon: AlertTriangle },
  { to: '/portal/reports', label: 'Relatórios', icon: BarChart3 },
  { to: '/portal/settings', label: 'Configurações', icon: Settings },
];

const MOBILE_NAV = [
  { to: '/portal', label: 'Início', icon: LayoutDashboard, end: true },
  { to: '/portal/shipments', label: 'Mercadorias', icon: Package },
  { to: '/portal/tracking', label: 'Tracking', icon: MapPin },
  { to: '/portal/pickups', label: 'Coletas', icon: Inbox },
];

export default function PortalLayout() {
  return (
    <PortalClientScopeProvider>
      <PortalLayoutInner />
    </PortalClientScopeProvider>
  );
}

function PortalLayoutInner() {
  const { signOut } = useAuth();
  const { data: access, isLoading } = useClientPortalAccess();
  const { pathname } = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!access || access.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary">
            <Truck className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-lg font-semibold">Portal do Cliente</h1>
          <p className="text-sm text-muted-foreground">
            Sua conta ainda não possui acesso a nenhum cliente neste portal. Solicite ao administrador da transportadora que vincule seu usuário a um cliente autorizado.
          </p>
          <Button variant="outline" size="sm" onClick={signOut}>Sair</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-60 border-r border-border bg-card flex-col">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-border">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Truck className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-sm">AGVLog</span>
          <Badge variant="secondary" className="text-[9px] ml-auto">Portal</Badge>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={signOut} className="w-full justify-start">
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card flex items-center px-4 gap-3">
          <div className="md:hidden flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Truck className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm">AGVLog</span>
          </div>
          <div className="flex-1" />
          <PortalClientSelector />
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 pb-20 md:pb-6">
          <Outlet />
        </main>

        {/* Bottom nav mobile */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-card grid grid-cols-5 z-30">
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon;
            const active = item.end ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'flex flex-col items-center justify-center py-2 gap-0.5 text-[10px]',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
          <PortalMoreMenu />
        </nav>
      </div>
    </div>
  );
}

export function PortalSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
