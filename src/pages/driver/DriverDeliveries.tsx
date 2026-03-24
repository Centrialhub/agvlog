import { Card, CardContent } from '@/components/ui/card';
import { Package } from 'lucide-react';

export default function DriverDeliveries() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Entregas</h1>
      <Card>
        <CardContent className="py-8 text-center">
          <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma entrega pendente.</p>
        </CardContent>
      </Card>
    </div>
  );
}
