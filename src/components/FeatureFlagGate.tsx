import React from 'react';
import { FeatureKey, isFeatureEnabled } from '@/lib/featureFlags';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from './ui/card';

interface FeatureFlagGateProps {
  feature: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const FeatureFlagGate: React.FC<FeatureFlagGateProps> = ({ 
  feature, 
  children, 
  fallback 
}) => {
  if (isFeatureEnabled(feature)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center justify-center text-center space-y-3">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <div>
          <h3 className="text-lg font-semibold">Recurso Temporariamente Indisponível</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Esta funcionalidade está em manutenção técnica para estabilização da camada de dados. 
            Agradecemos a compreensão.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
