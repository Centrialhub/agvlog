import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/errors';

export function PendingCommandRecovery({
  subject,
  onRecover,
  onDiscard,
}: {
  subject: string;
  onRecover: () => Promise<unknown>;
  onDiscard: () => void;
}) {
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="alert" className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
      <p>Existe {subject} com resultado incerto preservado neste dispositivo.</p>
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={recovering} onClick={async () => {
          setRecovering(true); setError(null);
          try { await onRecover(); } catch (caught) { setError(getErrorMessage(caught, 'Não foi possível reenviar.')); }
          finally { setRecovering(false); }
        }}>Reenviar solicitação</Button>
        <Button type="button" size="sm" variant="ghost" disabled={recovering} onClick={onDiscard}>Descartar solicitação</Button>
      </div>
    </div>
  );
}
