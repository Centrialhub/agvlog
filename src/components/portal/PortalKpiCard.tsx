import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: string;
  isLoading?: boolean;
}

export function PortalKpiCard({ label, value, icon: Icon, tone = 'text-muted-foreground', isLoading }: Props) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={cn('h-4 w-4', tone)} />
        </div>
        <p className="text-2xl font-bold mt-2 tabular-nums">
          {isLoading ? '—' : value}
        </p>
      </CardContent>
    </Card>
  );
}
