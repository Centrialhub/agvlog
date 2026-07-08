import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, FileText, ClipboardCheck, AlertTriangle, BarChart3, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const MORE_ITEMS = [
  { to: '/portal/documents', label: 'Documentos', icon: FileText },
  { to: '/portal/pods', label: 'Canhotos', icon: ClipboardCheck },
  { to: '/portal/occurrences', label: 'Ocorrências', icon: AlertTriangle },
  { to: '/portal/reports', label: 'Relatórios', icon: BarChart3 },
  { to: '/portal/settings', label: 'Configurações', icon: Settings },
];

export function PortalMoreMenu() {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] text-muted-foreground">
          <MoreHorizontal className="h-4 w-4" />
          Mais
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Mais opções</SheetTitle>
        </SheetHeader>
        <div className="grid grid-cols-3 gap-2 mt-4">
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 p-3 rounded-md border text-xs',
                    isActive ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                  )
                }
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            );
          })}
        </div>
        <div className="mt-4">
          <Button variant="outline" className="w-full" onClick={() => { setOpen(false); signOut(); }}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
