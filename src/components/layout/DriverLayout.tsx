import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
  Home,
  MapPin,
  Package,
  AlertTriangle,
  Coffee,
  Receipt,
  ClipboardCheck,
  LogOut,
  Truck,
} from 'lucide-react';

const driverNav = [
  { label: 'Início', href: '/driver', icon: Home },
  { label: 'Paradas', href: '/driver/stops', icon: MapPin },
  { label: 'Entregas', href: '/driver/deliveries', icon: Package },
  { label: 'Ocorrências', href: '/driver/issues', icon: AlertTriangle },
  { label: 'Jornada', href: '/driver/journey', icon: Coffee },
  { label: 'Despesas', href: '/driver/expenses', icon: Receipt },
  { label: 'Checklist', href: '/driver/checklist', icon: ClipboardCheck },
];

export default function DriverLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const location = useLocation();

  const isActive = (href: string) => {
    if (href === '/driver') return location.pathname === '/driver';
    return location.pathname.startsWith(href);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top header - minimal */}
      <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Truck className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-sm tracking-tight">AGVLog</span>
          <span className="text-xs text-muted-foreground ml-1">Motorista</span>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      </header>

      {/* Content area */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 max-w-lg mx-auto">{children}</div>
      </main>

      {/* Bottom navigation - mobile style */}
      <nav className="shrink-0 border-t border-border bg-card">
        <div className="flex justify-around items-center py-1.5 max-w-lg mx-auto">
          {driverNav.slice(0, 5).map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-2 py-1 rounded-md text-[10px] transition-colors min-w-[48px]',
                  active
                    ? 'text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          <Link
            to="/driver/expenses"
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1 rounded-md text-[10px] transition-colors min-w-[48px]',
              isActive('/driver/expenses') || isActive('/driver/checklist')
                ? 'text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Receipt className="h-4 w-4" />
            Mais
          </Link>
        </div>
      </nav>
    </div>
  );
}
