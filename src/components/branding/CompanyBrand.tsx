import { cn } from '@/lib/utils';

interface CompanyBrandProps {
  name: string;
  logoUrl?: string | null;
  collapsed?: boolean;
}

export function CompanyBrand({ name, logoUrl, collapsed = false }: CompanyBrandProps) {
  return (
    <span className="flex min-w-0 items-center gap-3" title={name}>
      <img
        src={logoUrl || '/icons/agvlog-192.png'}
        alt={collapsed ? name : ''}
        className={cn(
          'shrink-0 rounded-md object-contain',
          logoUrl
            ? cn('h-10 bg-white p-1', collapsed ? 'w-10' : 'w-auto max-w-24')
            : 'h-10 w-10',
        )}
      />
      {!collapsed && (
        <span className="min-w-0 truncate text-sm font-semibold tracking-tight text-sidebar-primary-foreground">
          {name}
        </span>
      )}
    </span>
  );
}
