import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronUp, ChevronDown, AlertTriangle, Wand2, CheckCircle2 } from 'lucide-react';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';

interface Props {
  stops: RouteStopDraft[];
  onMove: (id: string, dir: 'up' | 'down') => void;
  onUpdate: (id: string, patch: Partial<RouteStopDraft>) => void;
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const toHHMM = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const addMinutesHHMM = (hhmm: string, delta: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + delta + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const riskStyle = (level: string) => {
  if (level === 'critical') return 'text-destructive border-destructive/40 bg-destructive/10';
  if (level === 'warning') return 'text-amber-700 border-amber-300 bg-amber-50';
  return 'text-green-700 border-green-300 bg-green-50';
};

const riskLabel = (level: string) => level === 'critical' ? 'Crítico' : level === 'warning' ? 'Atenção' : 'Ok';

export default function StopDraftTable({ stops, onMove, onUpdate }: Props) {
  if (stops.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground border rounded-md">
        Nenhuma parada consolidada. Selecione cargas e clique em "Gerar paradas".
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
    <Table className="min-w-[1200px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Destinatário</TableHead>
          <TableHead>Cidade / Bairro</TableHead>
          <TableHead>NFs</TableHead>
          <TableHead className="text-right">Peso</TableHead>
          <TableHead className="text-right">Vol.</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead className="min-w-[260px]">Janela de entrega</TableHead>
          <TableHead className="text-right w-[90px]">Serviço (min)</TableHead>
          <TableHead className="min-w-[240px]">Risco</TableHead>
          <TableHead className="w-16">Ordem</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stops.map((s, idx) => {
          const arrival = toHHMM(s.planned_arrival_at);
          const departure = toHHMM(s.estimated_departure_at);
          const hasWindow = !!(s.delivery_window_start || s.delivery_window_end);
          const canSuggest = !!arrival && !hasWindow;
          const suggest = () => {
            if (!arrival) return;
            onUpdate(s.id, {
              delivery_window_start: addMinutesHHMM(arrival, -30),
              delivery_window_end: addMinutesHHMM(arrival, 60),
            });
          };
          return (
          <TableRow key={s.id}>
            <TableCell className="font-mono text-xs">{idx + 1}</TableCell>
            <TableCell className="text-sm">
              <div className="font-medium">{s.recipient_name}</div>
              <div className="text-xs text-muted-foreground">{s.load_ids.length} carga(s)</div>
            </TableCell>
            <TableCell className="text-xs">
              {s.city || '—'}{s.neighborhood ? ` · ${s.neighborhood}` : ''}
            </TableCell>
            <TableCell className="text-xs">
              {s.invoice_numbers.length > 0 ? (
                <span title={s.invoice_numbers.join(', ')}>
                  <Badge variant="outline">{s.fiscal_document_ids.length}</Badge>
                </span>
              ) : (
                <Badge variant="destructive" className="text-[10px]">sem NF</Badge>
              )}
            </TableCell>
            <TableCell className="text-xs text-right">{fmt(s.total_weight_kg)} kg</TableCell>
            <TableCell className="text-xs text-right">{s.total_pallet_count}</TableCell>
            <TableCell className="text-xs text-right">
              {s.total_value > 0 ? `R$ ${s.total_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
            </TableCell>
            <TableCell className="text-xs align-top">
              <div className="flex items-center gap-1 flex-nowrap">
                <Input
                  type="time"
                  value={s.delivery_window_start || ''}
                  onChange={(e) => onUpdate(s.id, { delivery_window_start: e.target.value || null })}
                  className="h-7 w-[96px] text-xs px-1"
                />
                <span className="text-muted-foreground">→</span>
                <Input
                  type="time"
                  value={s.delivery_window_end || ''}
                  onChange={(e) => onUpdate(s.id, { delivery_window_end: e.target.value || null })}
                  className="h-7 w-[96px] text-xs px-1"
                />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                {arrival ? (
                  <span>Previsto: <span className="font-medium text-foreground">{arrival}</span>{departure ? ` → ${departure}` : ''}</span>
                ) : (
                  <span>Sem previsão</span>
                )}
                {canSuggest && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 text-[11px] text-primary"
                    onClick={suggest}
                    title="Sugerir janela com base no horário previsto (±30/+60 min)"
                  >
                    <Wand2 className="h-3 w-3 mr-1" /> Sugerir
                  </Button>
                )}
              </div>
            </TableCell>
            <TableCell className="text-xs text-right">
              <Input
                type="number"
                min={0}
                value={s.service_time_minutes}
                onChange={(e) => onUpdate(s.id, { service_time_minutes: Number(e.target.value) || 0 })}
                className="h-7 w-16 text-xs text-right ml-auto"
              />
            </TableCell>
            <TableCell className="text-xs align-top">
              <div className={`inline-flex items-start gap-1 rounded-md border px-2 py-1 max-w-[240px] ${riskStyle(s.risk_level)}`}>
                {s.risk_level === 'normal' ? (
                  <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                )}
                <div className="leading-tight">
                  <div className="font-medium">{riskLabel(s.risk_level)}</div>
                  {s.risk_reason && (
                    <div className="text-[11px] opacity-90 whitespace-normal break-words">
                      {s.risk_reason}
                    </div>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-col">
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => onMove(s.id, 'up')} disabled={idx === 0}>
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => onMove(s.id, 'down')} disabled={idx === stops.length - 1}>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>
  );
}
