import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronUp, ChevronDown, AlertTriangle, Wand2, CheckCircle2, MapPin } from 'lucide-react';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';
import type { ResolvedLocation } from '@/lib/geocoding';
import { LocationPicker } from '@/components/maps/LocationPicker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  tenantId: string;
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
const hasVerifiedLocation = (stop: RouteStopDraft) =>
  typeof stop.latitude === 'number' && typeof stop.longitude === 'number'
  && ['address_geocoded', 'map_selected'].includes(stop.location_source || '');

export default function StopDraftTable({ tenantId, stops, onMove, onUpdate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState('');
  const [editingLocation, setEditingLocation] = useState<ResolvedLocation | null>(null);
  const editingStop = stops.find((stop) => stop.id === editingId) ?? null;

  const openLocation = (stop: RouteStopDraft) => {
    setEditingId(stop.id);
    setEditingAddress(stop.location_address || stop.destination);
    setEditingLocation(typeof stop.latitude === 'number' && typeof stop.longitude === 'number' ? {
      latitude: stop.latitude, longitude: stop.longitude,
      source: stop.location_source === 'address_geocoded' ? 'address_geocoded' : 'map_selected',
      address: stop.location_address || stop.destination, provider: stop.location_provider || null,
      accuracy_m: stop.location_accuracy_m ?? null, confidence: stop.location_confidence ?? null,
      audit: stop.location_audit || {},
    } : null);
  };

  const applyLocation = () => {
    if (!editingStop || !editingLocation) return;
    onUpdate(editingStop.id, {
      latitude: editingLocation.latitude, longitude: editingLocation.longitude,
      location_source: editingLocation.source, location_address: editingLocation.address || editingAddress,
      location_provider: editingLocation.provider, location_accuracy_m: editingLocation.accuracy_m,
      location_confidence: editingLocation.confidence, location_audit: editingLocation.audit,
      geofence_radius_m: editingStop.geofence_radius_m || 500,
      location_exception_reason: null,
    });
    setEditingId(null);
  };
  if (stops.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground border rounded-md">
        Nenhuma parada consolidada. Selecione cargas e clique em "Gerar paradas".
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
    <Table className="min-w-[1450px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Destinatário</TableHead>
          <TableHead>Cidade / Bairro</TableHead>
          <TableHead>NFs</TableHead>
          <TableHead className="min-w-[225px]">Local da entrega</TableHead>
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
            <TableCell className="text-xs align-top">
              <Button type="button" size="sm" variant="outline" className="h-7 w-full justify-start"
                onClick={() => openLocation(s)}>
                <MapPin className="mr-1 h-3.5 w-3.5" />
                {typeof s.latitude === 'number' && typeof s.longitude === 'number'
                  ? 'Revisar endereço/mapa' : 'Definir por endereço/mapa'}
              </Button>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {s.location_source === 'address_geocoded' ? 'Endereço geocodificado' :
                  s.location_source === 'map_selected' ? 'Ponto selecionado no mapa' :
                    typeof s.latitude === 'number' ? 'Coordenada legada: revise antes do despacho' : 'Localização pendente'}
              </p>
              {!hasVerifiedLocation(s) ? (
                <Input value={s.location_exception_reason || ''}
                  onChange={(event) => onUpdate(s.id, { location_exception_reason: event.target.value || null })}
                  minLength={20} maxLength={1000}
                  aria-label={`Justificativa de exceção da parada ${idx + 1}`}
                  placeholder="Exceção auditada (mín. 20 caracteres)" className="mt-2 h-7 text-[11px]" />
              ) : null}
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
    <Dialog open={Boolean(editingStop)} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Local da entrega</DialogTitle>
          <DialogDescription>Use o endereço já conhecido e confirme o acesso exato no mapa.</DialogDescription>
        </DialogHeader>
        {editingStop ? <LocationPicker tenantId={tenantId} address={editingAddress} value={editingLocation}
          onAddressChange={setEditingAddress} onChange={setEditingLocation} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setEditingId(null)}>Cancelar</Button>
          <Button type="button" disabled={!editingLocation} onClick={applyLocation}>Usar este local</Button>
        </div>
      </DialogContent>
    </Dialog>
    </div>
  );
}
