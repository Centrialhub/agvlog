import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ClipboardCheck, Clock, FileClock, MessageSquareWarning, MoreHorizontal, Receipt } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const links = [
  { href: '/driver/journey', label: 'Jornada', description: 'Pausas e histórico de trabalho', icon: Clock },
  { href: '/driver/expenses', label: 'Despesas', description: 'Comprovantes e aprovação', icon: Receipt },
  { href: '/driver/checklist', label: 'Checklist', description: 'Conferências de pré e pós-viagem', icon: ClipboardCheck },
  { href: '/driver/events', label: 'Eventos', description: 'Histórico dos eventos lançados', icon: FileClock },
  { href: '/driver/issues', label: 'Ocorrências', description: 'Problemas e comunicação com a operação', icon: MessageSquareWarning },
];

export function DriverMoreMenu() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const active = links.some(link => pathname === link.href || pathname.startsWith(`${link.href}/`));
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><button type="button" aria-label="Mais opções do motorista" className={cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] focus-visible:ring-2 focus-visible:ring-ring', active ? 'font-medium text-primary' : 'text-muted-foreground')}>
      <MoreHorizontal aria-hidden="true" className="h-5 w-5" />Mais
    </button></SheetTrigger>
    <SheetContent side="bottom" className="rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <SheetHeader className="text-left"><SheetTitle>Mais opções</SheetTitle><SheetDescription>Acesse as ferramentas da sua viagem.</SheetDescription></SheetHeader>
      <nav aria-label="Ferramentas do motorista" className="mt-4 space-y-1">
        {links.map(link => <Link key={link.href} to={link.href} onClick={() => setOpen(false)} aria-current={pathname === link.href ? 'page' : undefined} className="flex min-h-14 items-center gap-3 rounded-lg p-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <link.icon aria-hidden="true" className="h-5 w-5 text-primary" /><span><span className="block text-sm font-medium">{link.label}</span><span className="block text-xs text-muted-foreground">{link.description}</span></span>
        </Link>)}
      </nav>
    </SheetContent>
  </Sheet>;
}
