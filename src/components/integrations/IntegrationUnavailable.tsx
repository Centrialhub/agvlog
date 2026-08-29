import { AlertTriangle, Construction } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface IntegrationUnavailableProps {
  capability: "ssx" | "fiscal";
  degraded?: boolean;
  onRetry?: () => void;
}

export function IntegrationUnavailable({
  capability,
  degraded = false,
  onRetry,
}: IntegrationUnavailableProps) {
  const label = capability === "ssx" ? "SSX" : "Emissão fiscal";
  return (
    <div className="mx-auto flex min-h-[18rem] max-w-xl items-center p-4">
      <Alert variant={degraded ? "destructive" : "default"}>
        {degraded ? <AlertTriangle className="h-4 w-4" /> : <Construction className="h-4 w-4" />}
        <AlertTitle>{degraded ? "Verificação indisponível" : "Integração em implantação"}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {degraded
              ? `Não foi possível confirmar a disponibilidade de ${label}. A operação foi bloqueada por segurança.`
              : `${label} está desativada para este tenant. Nenhuma sincronização, emissão ou cancelamento será executado.`}
          </p>
          {degraded && onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Tentar novamente
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  );
}
