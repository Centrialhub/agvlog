import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { FeatureFlagGate } from '@/components/FeatureFlagGate';
import { Card, CardContent } from '@/components/ui/card';

export default function DataAudit() {
  return (
    <FeatureFlagGate feature="DATA_QUALITY_CENTER">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Data Audit
            </h1>
            <p className="text-sm text-muted-foreground">
              Auditoria de integridade e qualidade de dados.
            </p>
          </div>
        </div>
        
        <div className="bg-muted/30 p-12 rounded-lg border border-dashed text-center">
          <p className="text-muted-foreground">Funcionalidade em manutenção para auditoria técnica.</p>
        </div>
      </div>
    </FeatureFlagGate>
  );
}
