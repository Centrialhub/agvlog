import { useEffect, useState, useId } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, LockKeyhole, SearchX } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { IntegrationCapability } from '@/hooks/useTenantCapabilities';
import { cn } from '@/lib/utils';
import { findNavigationPage, searchNavigation, type NavigationItem } from './navigation';

interface Props {
  collapsed?: boolean;
  query: string;
  capabilityAvailable: (capability: IntegrationCapability) => boolean;
  onNavigate?: () => void;
}

export function SidebarNavigation({ collapsed = false, query, capabilityAvailable, onNavigate }: Props) {
  const id = useId();
  const [popover, setPopover] = useState<string | null>(null);
  const { pathname } = useLocation();
  const current = findNavigationPage(pathname);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const activeSectionId = current?.section.id;
  useEffect(() => {
    if (activeSectionId) setOpenSections(previous => ({ ...previous, [activeSectionId]: true }));
  }, [activeSectionId]);
  const sections = searchNavigation(query);

  function renderItem(item: NavigationItem) {
    const active = current?.item.href === item.href;
    const disabled = item.capability && !capabilityAvailable(item.capability);
    const Icon = item.icon;
    const content = <><Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{item.label}</span></>;
    if (disabled) return (
      <div key={item.href} aria-disabled="true" title="Integração em implantação"
        className="flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-xs text-sidebar-foreground/50">
        {content}<LockKeyhole aria-label="Integração em implantação" className="h-3.5 w-3.5 shrink-0" />
      </div>
    );
    return <Link key={item.href} to={item.href} onClick={() => { setPopover(null); onNavigate?.(); }} aria-current={active ? 'page' : undefined}
      className={cn('flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-sm' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground')}>
      {content}{active && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-primary" />}
    </Link>;
  }

  return <nav aria-label="Navegação principal" className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 py-3">
    {sections.length === 0 && <div role="status" className="space-y-2 px-3 py-6 text-center text-sm text-sidebar-foreground/70">
      <SearchX className="mx-auto h-6 w-6" /><p>Nenhuma página encontrada.</p><p className="text-xs">Tente buscar por carga, nota, frete ou cliente.</p>
    </div>}
    {sections.map(section => {
      const Icon = section.icon;
      const active = current?.section.id === section.id;
      const expanded = Boolean(query.trim()) || (openSections[section.id] ?? active);
      if (collapsed) return <Popover key={section.id} open={popover === section.id} onOpenChange={open => setPopover(open ? section.id : null)}>
        <Tooltip><TooltipTrigger asChild><PopoverTrigger asChild>
          <button type="button" aria-label={section.label} className={cn('flex h-11 w-full items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring', active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60')}>
            <Icon aria-hidden="true" className="h-5 w-5" />
          </button>
        </PopoverTrigger></TooltipTrigger><TooltipContent side="right">{section.label}</TooltipContent></Tooltip>
        <PopoverContent aria-label={section.label} side="right" align="start" className="max-h-[80dvh] w-72 overflow-y-auto border-sidebar-border bg-sidebar p-2 text-sidebar-foreground">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/80">{section.label}</p>
          {section.items.map(renderItem)}
        </PopoverContent>
      </Popover>;
      return <div key={section.id}>
        <button type="button" aria-expanded={expanded} aria-controls={`${id}-nav-${section.id}`} onClick={() => setOpenSections(previous => ({ ...previous, [section.id]: !expanded }))}
          className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-semibold focus-visible:ring-2 focus-visible:ring-sidebar-ring', active ? 'text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/40')}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="flex-1">{section.label}</span>
          <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 transition-transform', !expanded && '-rotate-90')} />
        </button>
        {expanded && <div id={`${id}-nav-${section.id}`} className="mb-2 ml-4 space-y-0.5 border-l border-sidebar-border pl-2">{section.items.map(renderItem)}</div>}
      </div>;
    })}
  </nav>;
}
