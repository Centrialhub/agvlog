import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { useLoadAggregateCommand } from '@/hooks/useLoadAggregateCommand';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';

const actionLabel: Record<string, string> = {
  create: 'criação', update: 'edição', hold: 'bloqueio', unhold: 'liberação',
  delete: 'exclusão', delete_many: 'exclusão em lote',
};

export default function LoadAggregateRecoveryAlert() {
  const command = useLoadAggregateCommand();
  const { toast } = useToast();
  if (!command.pending && !command.recoveryError) return null;

  const recover = async () => {
    try {
      await command.recover();
      toast({ title: 'Alteração de carga confirmada' });
    } catch (error: unknown) {
      toast({
        title: 'Alteração ainda pendente', description: getErrorMessage(error), variant: 'destructive',
      });
    }
  };

  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {command.recoveryError ? 'Recuperação de carga indisponível' : 'Alteração de carga sem confirmação'}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {command.recoveryError
            || `Há uma ${actionLabel[command.pending?.payload.action || ''] || 'alteração'} pendente. Novas alterações ficam bloqueadas até recuperar o mesmo pedido.`}
        </span>
        {command.pending && !command.recoveryError && (
          <Button type="button" variant="outline" size="sm" onClick={recover} disabled={command.isPending}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${command.isPending ? 'animate-spin' : ''}`} />
            Recuperar
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
