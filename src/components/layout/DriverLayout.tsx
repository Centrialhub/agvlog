import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
  Home,
  MapPin,
  Package,
  Receipt,
  MoreHorizontal,
  LogOut,
  Truck,
} from 'lucide-react';

const driverNav: { label: string; href: string; icon: typeof Home; match?: string[] }[] = [
  { label: 'Início', href: '/driver', icon: Home },
  { label: 'Paradas', href: '/driver/stops', icon: MapPin },
  { label: 'Entregas', href: '/driver/deliveries', icon: Package },
  { label: 'Despesas', href: '/driver/expenses', icon: Receipt },
  {
    label: 'Mais',
    href: '/driver/journey',
    icon: MoreHorizontal,
    match: ['/driver/journey', '/driver/checklist', '/driver/issues'],
  },
];

export default function DriverLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const location = useLocation();

  const isActive = (href: string, match?: string[]) => {
    if (match && match.some((m) => location.pathname.startsWith(m))) return true;
    if (href === '/driver') return location.pathname === '/driver';
    return location.pathname.startsWith(href);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background overscroll-none">
      {/* Top header - minimal, with iOS safe area */}
      <header
        className="flex items-center justify-between px-4 border-b border-border bg-card shrink-0"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2 h-12">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Truck className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-base tracking-tight">AGVLog</span>
          <span className="text-xs text-muted-foreground ml-1">Motorista</span>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-11 px-2"
          aria-label="Sair"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </header>

      {/* Content area */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <div className="p-4 pb-6 max-w-lg mx-auto">{children}</div>
      </main>

      {/* Bottom navigation - mobile style with iOS home-bar safe area */}
      <nav
        className="shrink-0 border-t border-border bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex justify-around items-stretch max-w-lg mx-auto">
          {driverNav.map((item) => {
            const active = isActive(item.href, item.match);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] leading-tight transition-colors min-h-14 active:bg-accent/40',
                  active
                    ? 'text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
