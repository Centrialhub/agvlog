import { Card, CardContent } from '@/components/ui/card';
import { Package } from 'lucide-react';

export function PortalEmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}
