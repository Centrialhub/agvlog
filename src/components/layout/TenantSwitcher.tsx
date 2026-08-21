import React from 'react';
import { useTenant } from '@/hooks/useTenant';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Building2, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TenantSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { memberships, currentTenant, setCurrentTenantId } = useTenant();

  if (memberships.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className={cn(
            "w-full justify-start gap-2 px-2 text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors",
            collapsed && "justify-center px-0"
          )}
        >
          <Building2 className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left truncate text-xs font-medium">
                {currentTenant?.name || 'Selecionar Empresa'}
              </span>
              <ChevronRight className="h-3 w-3 opacity-50" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={collapsed ? "center" : "start"} className="w-56">
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Minhas Empresas
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem 
            key={m.tenant_id} 
            onClick={() => setCurrentTenantId(m.tenant_id)}
            className="flex items-center justify-between gap-2 cursor-pointer"
          >
            <div className="flex flex-col min-w-0">
              <span className={cn("text-xs truncate", m.tenant_id === currentTenant?.id && "font-bold text-primary")}>
                {m.tenants.name}
              </span>
              <span className="text-[10px] text-muted-foreground capitalize">{m.role}</span>
            </div>
            {m.tenant_id === currentTenant?.id && (
              <Check className="h-3 w-3 text-primary shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
