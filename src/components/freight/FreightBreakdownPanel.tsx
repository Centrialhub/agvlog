import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import type { FreightBreakdown } from '@/hooks/useFreightCalculator';

const formatBRL = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  breakdown: FreightBreakdown | null;
  finalValue: number;
  success?: boolean;
  error?: string;
}

export default function FreightBreakdownPanel({ breakdown, finalValue, success = true, error }: Props) {
  if (!breakdown) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        {error || 'Nenhuma tabela de frete aplicável encontrada'}
      </div>
    );
  }

  const c = breakdown.components;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Tabela aplicada</div>
          <div className="font-medium flex items-center gap-2 flex-wrap">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">#{breakdown.tableCode} — {breakdown.tableName}</span>
            {breakdown.fallbackUsed ? (
              <Badge variant="outline" className="text-amber-600 border-amber-600">Fallback</Badge>
            ) : (
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Match
              </Badge>
            )}
          </div>
          {breakdown.regionName && (
            <div className="text-xs text-muted-foreground mt-1">Região: {breakdown.regionName}</div>
          )}
          {breakdown.fallbackReason && (
            <div className="text-xs text-amber-600 mt-1">⚠ {breakdown.fallbackReason}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-muted-foreground">Valor final</div>
          <div className="text-2xl font-bold">{formatBRL(finalValue)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
        <Item label="% sobre NF" value={`${c.ratePercent}%`} sub={formatBRL(c.rateValue)} />
        <Item label="Valor fixo" value={formatBRL(c.fixedValue)} />
        <Item label="Por kg" value={formatBRL(c.perKgValue)} sub={formatBRL(c.perKgTotal)} />
        <Item label="Por pallet" value={formatBRL(c.perPalletValue)} sub={formatBRL(c.perPalletTotal)} />
        <Item label="Despacho" value={formatBRL(c.dispatchValue)} />
        <Item label="Rastreamento" value={formatBRL(c.trackingValue)} />
        <Item label="Pedágio" value={formatBRL(c.tollValue)} />
        <Item label="Carregamento" value={formatBRL(c.loadingValue)} />
        <Item label="GRIS" value={formatBRL(c.grisValue)} />
        <Item label="Seguro" value={`${c.insurancePercent}%`} sub={formatBRL(c.insuranceValue)} />
        <Item label="Base calculada" value={formatBRL(breakdown.baseValue)} />
        <Item label="Mínimo da tabela" value={formatBRL(breakdown.minValue)} highlight={breakdown.minValue > breakdown.baseValue} />
      </div>

      {Object.keys(breakdown.matchedCriteria).length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Critérios atendidos</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(breakdown.matchedCriteria).map(([k, v]) => (
              <Badge key={k} variant="secondary" className="text-xs">{k}: {String(v)}</Badge>
            ))}
          </div>
        </div>
      )}

      {breakdown.ignoredCriteria.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Critérios divergentes ({breakdown.ignoredCriteria.length})
          </summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5 text-muted-foreground">
            {breakdown.ignoredCriteria.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function Item({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-md p-2 ${highlight ? 'bg-amber-50 border-amber-300 dark:bg-amber-950/20' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium text-sm">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">= {sub}</div>}
    </div>
  );
}
