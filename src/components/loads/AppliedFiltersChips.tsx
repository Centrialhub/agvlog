import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { X, Info, RotateCcw } from 'lucide-react';
import type { AppliedLoadFilterChip } from '@/lib/loads/loadAdvancedFilters';

type ChipKind = AppliedLoadFilterChip['kind'];

const KIND_HINTS: Record<ChipKind, string> = {
  exact: 'Filtra diretamente em uma coluna do banco.',
  approx: 'Filtro aproximado: compara texto contra "Tipo de operação" (não há coluna dedicada).',
};


interface Props {
  chips: AppliedLoadFilterChip[];
  onClearAll: () => void;
}

export default function AppliedFiltersChips({ chips, onClearAll }: Props) {
  if (!chips.length) return null;
  return (
    <div className="flex items-start gap-2 flex-wrap rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[11px] font-medium text-muted-foreground mt-1.5 mr-1 shrink-0">Filtros aplicados:</div>
      <div className="flex flex-wrap gap-1.5 flex-1">
        {chips.map(c => (
          <Tooltip key={c.key}>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className={`gap-1 pr-1 pl-2 py-0.5 text-[11px] font-normal cursor-default ${
                  c.kind === 'approx'
                    ? 'bg-warning/10 text-warning border-warning/30 hover:bg-warning/20'
                    : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'
                }`}
              >
                <span className="font-medium">{c.label}:</span>
                <span className="truncate max-w-[180px]">{c.value}</span>
                {c.kind === 'approx' && <Info className="h-3 w-3 opacity-70" />}
                <button
                  type="button"
                  onClick={c.clear}
                  className="ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5"
                  aria-label={`Remover filtro ${c.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              <div className="font-medium mb-0.5">
                {c.kind === 'approx' ? 'Filtro aproximado' : 'Filtro exato'}
              </div>
              <div className="text-muted-foreground">{c.hint || KIND_HINTS[c.kind]}</div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={onClearAll}>
        <RotateCcw className="h-3 w-3 mr-1" /> Limpar tudo
      </Button>
    </div>
  );
}
