import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalStatusBadge } from '@/components/portal/PortalStatusBadge';
import { usePortalShipments, type ShipmentRow } from '@/hooks/portal/usePortalShipments';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, Search, ChevronRight, ClipboardCheck, AlertTriangle, X } from 'lucide-react';
import type { PublicShipmentStatus } from '@/lib/portal/portalStatus';

function resolvePublicStatus(r: ShipmentRow): PublicShipmentStatus {
  if (r.public_status) return r.public_status as PublicShipmentStatus;
  if (r.has_open_occurrence) return 'exception';
  if (r.document_status === 'delivered') return r.has_pod ? 'pod_available' : 'pod_pending';
  return 'received';
}

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '—');

const QUICK_CHIPS = [
  { id: 'in_transit', label: 'Em trânsito', status: ['in_transit', 'loading', 'loaded'] as string[] | undefined },
  { id: 'delayed', label: 'Atrasadas', delayed: true as boolean | undefined },
  { id: 'out_for_delivery', label: 'Saiu para entrega', status: ['out_for_delivery'] as string[] | undefined },
  { id: 'delivered', label: 'Entregues', status: ['delivered'] as string[] | undefined },
  { id: 'pod_pending', label: 'Canhoto pendente', hasPod: false as boolean | undefined, deliveredOnly: true },
  { id: 'occurrence', label: 'Com ocorrência', hasOccurrence: true as boolean | undefined },
] as const;

export default function PortalShipments() {
  const { selectedClientId } = usePortalClientScope();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [chip, setChip] = useState<string | null>(null);
  const [hasPodFilter, setHasPodFilter] = useState<boolean | undefined>(undefined);
  const [hasOccurrenceFilter, setHasOccurrenceFilter] = useState<boolean | undefined>(undefined);
  const limit = 50;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const activeChip = useMemo(() => QUICK_CHIPS.find((c) => c.id === chip), [chip]);

  const filters = useMemo(() => ({
    search: debouncedSearch || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    city: city || undefined,
    state: state || undefined,
    status: activeChip?.status,
    hasPod: activeChip?.hasPod ?? hasPodFilter,
    hasOccurrence: activeChip?.hasOccurrence ?? hasOccurrenceFilter,
    limit,
    offset: page * limit,
  }), [debouncedSearch, startDate, endDate, city, state, activeChip, hasPodFilter, hasOccurrenceFilter, page, selectedClientId]);

  const { data, isLoading } = usePortalShipments(filters);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const clearFilters = () => {
    setSearch(''); setDebouncedSearch('');
    setStartDate(''); setEndDate(''); setCity(''); setState('');
    setChip(null); setHasPodFilter(undefined); setHasOccurrenceFilter(undefined);
    setPage(0);
  };

  const anyFilter = !!(debouncedSearch || startDate || endDate || city || state || chip || hasPodFilter !== undefined || hasOccurrenceFilter !== undefined);

  return (
    <PortalSection title="Mercadorias" description="Documentos fiscais e cargas vinculados ao seu acesso.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setPage(0); setSearch(e.target.value); }}
              placeholder="Buscar NF, chave, pedido, carga, destinatário, CNPJ..."
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Input type="date" value={startDate} onChange={(e) => { setPage(0); setStartDate(e.target.value); }} className="h-9 text-sm w-[140px]" />
          <Input type="date" value={endDate} onChange={(e) => { setPage(0); setEndDate(e.target.value); }} className="h-9 text-sm w-[140px]" />
          <Input value={city} onChange={(e) => { setPage(0); setCity(e.target.value); }} placeholder="Cidade" className="h-9 text-sm w-[140px]" />
          <Input value={state} onChange={(e) => { setPage(0); setState(e.target.value.toUpperCase().slice(0,2)); }} placeholder="UF" className="h-9 text-sm w-[70px]" />
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
              <X className="h-3.5 w-3.5 mr-1" /> Limpar
            </Button>
          )}
          <Badge variant="outline" className="text-[10px] ml-auto">
            {isLoading ? '...' : `${total} documento(s)`}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_CHIPS.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={chip === c.id ? 'default' : 'outline'}
              onClick={() => { setPage(0); setChip(chip === c.id ? null : c.id); }}
              className="h-7 text-xs rounded-full"
            >
              {c.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <PortalEmptyState
          title="Nenhuma mercadoria encontrada"
          description="Ajuste os filtros ou aguarde novos documentos fiscais serem vinculados ao seu acesso."
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>NF</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Cidade/UF</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Previsão</TableHead>
                  <TableHead>Carga</TableHead>
                  <TableHead className="text-right">Volumes</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.fiscal_document_id} className="cursor-pointer hover:bg-muted/40">
                    <TableCell><PortalStatusBadge status={resolvePublicStatus(r)} /></TableCell>
                    <TableCell className="font-medium">
                      <Link to={`/portal/shipments/${r.fiscal_document_id}`} className="hover:underline">
                        {r.invoice_number || '—'}
                      </Link>
                      {r.client_load_number && (
                        <span className="block text-[10px] text-muted-foreground">CL: {r.client_load_number}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{r.recipient || '—'}</TableCell>
                    <TableCell className="text-sm">{r.recipient_city || '—'}{r.recipient_state ? `/${r.recipient_state}` : ''}</TableCell>
                    <TableCell className="text-sm">{fmtDate(r.issue_date)}</TableCell>
                    <TableCell className="text-sm">{fmtDateTime(r.planned_arrival_at)}</TableCell>
                    <TableCell className="text-sm">{r.load_number || '—'}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {r.pallet_count ?? 0}
                      <div className="flex justify-end gap-1 mt-0.5">
                        {r.has_pod && <ClipboardCheck className="h-3 w-3 text-emerald-600" />}
                        {r.has_open_occurrence && <AlertTriangle className="h-3 w-3 text-rose-600" />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link to={`/portal/shipments/${r.fiscal_document_id}`}>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {rows.map((r) => (
              <Link key={r.fiscal_document_id} to={`/portal/shipments/${r.fiscal_document_id}`}>
                <Card>
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">NF {r.invoice_number || '—'}</span>
                      <PortalStatusBadge status={resolvePublicStatus(r)} />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{r.recipient || '—'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.recipient_city || '—'}{r.recipient_state ? `/${r.recipient_state}` : ''} · Previsão {fmtDateTime(r.planned_arrival_at)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {total > limit && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                Página {page + 1} de {Math.ceil(total / limit)}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                <Button size="sm" variant="outline" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Próxima</Button>
              </div>
            </div>
          )}
        </>
      )}
    </PortalSection>
  );
}
