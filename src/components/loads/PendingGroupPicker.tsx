import { Button } from '@/components/ui/button';
import type { CombinedRouteGroup } from '@/lib/loads/pendingGroupCombinations';

interface Props {
  target: CombinedRouteGroup;
  candidates: CombinedRouteGroup[];
  disabled: boolean;
  onAdd: (source: CombinedRouteGroup) => void;
  onCancel: () => void;
}

export function PendingGroupPicker({ target, candidates, disabled, onAdd, onCancel }: Props) {
  return (
    <div className="mt-3 space-y-2 rounded border bg-muted/30 p-3" role="group" aria-label={`Adicionar grupo a ${target.destination}`}>
      <p className="text-sm font-medium">Adicionar destino a {target.destination}</p>
      <p className="text-xs text-muted-foreground">As NF-es do grupo escolhido entrarão na mesma carga. A criação acontece ao confirmar no final.</p>
      <div className="flex flex-wrap gap-2">
        {candidates.map(source => (
          <Button key={source.routeName} variant="outline" size="sm" disabled={disabled} className="h-auto max-w-full whitespace-normal py-2 text-left"
            aria-label={`Adicionar ${source.destination}`}
            onClick={() => onAdd(source)}>
            {source.destination} ({source.docs.length} NF-es · {source.totalPallets} paletes)
          </Button>
        ))}
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onCancel}>Cancelar união</Button>
      </div>
    </div>
  );
}
