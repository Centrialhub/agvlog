import { useMemo, useState } from 'react';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalTracking, type PortalTrackingItem } from '@/hooks/portal/usePortalTracking';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, MapPin, Truck, Phone, Clock, Navigation, Info, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { matchesSearch, filterOptions } from '@/lib/listFilters';
import { cn } from '@/lib/utils';
import PortalTrackingMap from '@/components/portal/PortalTrackingMap';

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planejada',
  loading: 'Em carregamento',
  in_transit: 'Em trânsito',
  arrived: 'Chegou ao destino',
  out_for_delivery: 'Saiu para entrega',
};

export default function PortalTracking() {
  const { data: items = [], isLoading, error, refetch } = usePortalTracking();
  const { selectedClientId, can } = usePortalClientScope();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(
    () => items.filter(row => (!selectedClientId || row.client_id === selectedClientId) && (status === 'all' || row.status === status) && matchesSearch(search, row.load_number, row.plate, row.next_stop?.destination, row.next_stop?.city, ...row.documents.flatMap(doc => [doc.invoice_number, doc.recipient, doc.recipient_city]))),
    [items, selectedClientId, search, status],
  );

  const withPosition = filtered.filter((i) => typeof i.lat === 'number');
  const canLive = can('can_view_vehicle_live');

  return (
    <PortalSection
      title="Tracking"
      description="Acompanhe em tempo real as cargas em trânsito com sua mercadoria."
    >
      <div className="mb-4"><ListFilterBar fields={[
        { key: 'search', label: 'Buscar carga em acompanhamento', type: 'search', value: search, onChange: value => { setSearch(value); setSelected(null); }, placeholder: 'Carga, placa, nota, destinatário ou cidade' },
        { key: 'status', label: 'Situação da carga', value: status, onChange: value => { setStatus(value); setSelected(null); }, options: [{ value: 'all', label: 'Todas as situações' }, ...filterOptions(items.map(row => row.status)).map(value => ({ value, label: STATUS_LABEL[value] || value }))] },
      ]} onReset={() => { setSearch(''); setStatus('all'); setSelected(null); }} activeCount={Number(Boolean(search)) + Number(status !== 'all')} resultCount={error ? undefined : filtered.length} totalCount={items.length} loading={isLoading} description="O mapa e os cartões acompanham os mesmos filtros." /></div>
      {!canLive && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            A visualização de posição em tempo real do veículo está desabilitada para a sua conta. Você continua vendo o status e a próxima parada de cada carga.
          </span>
        </div>
      )}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between gap-3">
          <span>Erro ao carregar tracking: {(error as Error).message}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : isLoading ? (
        <div className="p-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <PortalEmptyState
          title="Nenhuma carga em trânsito"
          description="Não há cargas para os filtros e o cliente selecionados."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="min-w-0">
            {canLive && withPosition.length > 0 ? (
              <PortalTrackingMap
                items={filtered}
                selectedLoadId={selected}
                onSelect={(i) => setSelected(i.load_id)}
              />
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  {canLive
                    ? 'Nenhuma carga com posição atualizada no momento.'
                    : 'Mapa em tempo real indisponível conforme a sua permissão.'}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-2 lg:max-h-[420px] lg:overflow-auto lg:pr-1">
            {filtered.map((item) => (
              <TrackingCard
                key={item.load_id}
                item={item}
                selected={selected === item.load_id}
                onSelect={() => setSelected(item.load_id)}
              />
            ))}
          </div>
        </div>
      )}
    </PortalSection>
  );
}

function TrackingCard({
  item,
  selected,
  onSelect,
}: {
  item: PortalTrackingItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'w-full text-left rounded-md border border-border bg-card p-3 transition-colors',
        selected ? 'border-primary ring-1 ring-primary/40' : 'hover:bg-muted/40',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm truncate">Carga {item.load_number}</span>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {STATUS_LABEL[item.status] || item.status}
        </Badge>
      </div>

      {item.plate ? (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <span className="font-mono">{item.plate}</span>
          {item.vehicle_nickname && <span>· {item.vehicle_nickname}</span>}
          {typeof item.speed === 'number' && (
            <span className="ml-auto flex items-center gap-1">
              <Navigation className="h-3 w-3" />
              {Math.round(item.speed)} km/h
            </span>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Veículo não disponível</div>
      )}

      {item.next_stop && (
        <div className="mt-2 text-xs flex items-start gap-1">
          <MapPin className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="truncate">
              {item.next_stop.destination || `${item.next_stop.city || ''}${item.next_stop.state ? '/' + item.next_stop.state : ''}`}
            </div>
            {item.next_stop.planned_arrival_at && (
              <div className="text-muted-foreground">
                Prev.: {format(new Date(item.next_stop.planned_arrival_at), 'dd/MM HH:mm', { locale: ptBR })}
              </div>
            )}
          </div>
        </div>
      )}

      {item.driver_name && (
        <div className="mt-2 text-xs flex items-center gap-1 text-muted-foreground">
          <span className="truncate">Motorista: {item.driver_name}</span>
          {item.driver_phone && (
            <a
              href={`tel:${item.driver_phone}`}
              className="ml-auto inline-flex items-center gap-1 text-primary"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Phone className="h-3 w-3" />
              {item.driver_phone}
            </a>
          )}
        </div>
      )}

      {item.captured_at && (
        <div className="mt-1.5 text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Última posição há {formatDistanceToNow(new Date(item.captured_at), { locale: ptBR })}
        </div>
      )}

      {item.documents && item.documents.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border space-y-1">
          <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
            <FileText className="h-3 w-3" /> Notas ({item.documents.length})
          </div>
          {item.documents.slice(0, 3).map((d) => (
            <Link
              key={d.fiscal_document_id}
              to={`/portal/shipments/${d.fiscal_document_id}`}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="block text-xs rounded-sm px-1.5 py-1 hover:bg-muted/60"
            >
              <div className="flex items-center gap-1 min-w-0">
                <span className="font-medium truncate">NF {d.invoice_number || '—'}</span>
                {d.public_status && (
                  <Badge variant="outline" className="text-[9px] ml-auto shrink-0">
                    {d.public_status}
                  </Badge>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {d.recipient || '—'}
                {d.recipient_city && ` · ${d.recipient_city}${d.recipient_state ? '/' + d.recipient_state : ''}`}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {d.has_open_occurrence && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600">
                    <AlertTriangle className="h-3 w-3" /> ocorrência
                  </span>
                )}
                {d.has_pod && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> canhoto
                  </span>
                )}
              </div>
            </Link>
          ))}
          {item.documents.length > 3 && (
            <div className="text-[10px] text-muted-foreground pl-1.5">
              +{item.documents.length - 3} outras notas
            </div>
          )}
        </div>
      )}
    </div>
  );
}
