import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';

interface Props {
  stops: RouteStopDraft[];
  onMove: (id: string, dir: 'up' | 'down') => void;
  onUpdate: (id: string, patch: Partial<RouteStopDraft>) => void;
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function StopDraftTable({ stops, onMove, onUpdate }: Props) {
  if (stops.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground border rounded-md">
        Nenhuma parada consolidada. Selecione cargas e clique em "Gerar paradas".
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Destinatário</TableHead>
          <TableHead>Cidade / Bairro</TableHead>
          <TableHead>NFs</TableHead>
          <TableHead className="text-right">Peso</TableHead>
          <TableHead className="text-right">Vol.</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead>Janela</TableHead>
          <TableHead className="text-right">Serviço (min)</TableHead>
          <TableHead>Risco</TableHead>
          <TableHead className="w-16">Ordem</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stops.map((s, idx) => (
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
            <TableCell className="text-xs">
              <div className="flex gap-1">
                <Input
                  type="time"
                  value={s.delivery_window_start || ''}
                  onChange={(e) => onUpdate(s.id, { delivery_window_start: e.target.value || null })}
                  className="h-7 w-24 text-xs"
                />
                <Input
                  type="time"
                  value={s.delivery_window_end || ''}
                  onChange={(e) => onUpdate(s.id, { delivery_window_end: e.target.value || null })}
                  className="h-7 w-24 text-xs"
                />
              </div>
            </TableCell>
            <TableCell className="text-xs text-right">
              <Input
                type="number"
                min={0}
                value={s.service_time_minutes}
                onChange={(e) => onUpdate(s.id, { service_time_minutes: Number(e.target.value) || 0 })}
                className="h-7 w-16 text-xs text-right"
              />
            </TableCell>
            <TableCell className="text-xs">
              {s.risk_level !== 'normal' ? (
                <span className="flex items-center gap-1 text-amber-600" title={s.risk_reason || ''}>
                  <AlertTriangle className="h-3 w-3" />
                  {s.risk_level}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
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
        ))}
      </TableBody>
    </Table>
  );
}
