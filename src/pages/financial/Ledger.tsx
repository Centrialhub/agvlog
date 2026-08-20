import { AlertTriangle } from 'lucide-react';
import { FeatureFlagGate } from '@/components/FeatureFlagGate';
import { Card, CardContent } from '@/components/ui/card';

export default function OperationalLedger() {
  return (
    <FeatureFlagGate feature="OPERATIONAL_LEDGER">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-primary" />
              Razão Operacional
            </h1>
            <p className="text-sm text-muted-foreground">
              Extrato detalhado de lançamentos financeiros por centro de custo.
            </p>
          </div>
        </div>
        
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
             <p className="text-muted-foreground">O Razão Operacional está sendo reconstruído sobre a camada de integridade.</p>
          </CardContent>
        </Card>
      </div>
    </FeatureFlagGate>
  );
}
