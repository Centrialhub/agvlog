import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, History, Package, Truck, FileText, MapPin, PackageOpen, ArrowDownToLine, ArrowUpFromLine, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/usePagination';
import { DataPagination } from '@/components/ui/data-pagination';

interface TimelineEvent {
  key: string;
  at: string;
  dateOnly?: boolean;
  kind: 'inbound' | 'pickup' | 'load' | 'stop' | 'event' | 'outbound';
  title: string;
  description?: string;
  responsible?: string;
  destination?: string;
  reference?: string;
  meta?: { quantity?: number; weight?: number; pallets?: number; value?: number };
}

function fmtDateTime(d?: string | null, dateOnly = false) {
  if (!d) return '—';
  if (dateOnly) {
    const [year, month, day] = d.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year} (horário não informado)` : d;
  }
  try { return format(new Date(d), 'dd/MM/yyyy HH:mm', { locale: ptBR }); } catch { return d; }
}
const KIND_META: Record<TimelineEvent['kind'], { label: string; icon: LucideIcon; color: string }> = {
  inbound:  { label: 'Entrada (NF-e)',     icon: ArrowDownToLine, color: 'bg-blue-500' },
  pickup:   { label: 'Coleta',             icon: PackageOpen,    color: 'bg-amber-500' },
  load:     { label: 'Carga / Romaneio',   icon: Truck,          color: 'bg-violet-500' },
  stop:     { label: 'Parada',             icon: MapPin,         color: 'bg-emerald-500' },
  event:    { label: 'Evento operacional', icon: History,        color: 'bg-slate-500' },
  outbound: { label: 'Saída (CT-e)',       icon: ArrowUpFromLine, color: 'bg-primary' },
};

export default function ProductHistory() {
  const { currentTenant } = useTenant();
  const [productInput, setProductInput] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openCombo, setOpenCombo] = useState(false);
  const [criteria, setCriteria] = useState<{ product: string; from: string; to: string } | null>(null);
  const invalidPeriod = Boolean(from && to && from > to);

  // Autocomplete: distinct product descriptions
  const { data: suggestions = [] } = useQuery({
    queryKey: ['product-suggestions', currentTenant?.id, productInput],
    queryFn: async () => {
      if (!currentTenant || productInput.length < 2) return [];
      const { data, error } = await supabase
        .from('load_items')
        .select('item_description')
        .eq('tenant_id', currentTenant.id)
        .ilike('item_description', `%${productInput}%`)
        .limit(50);
      if (error) throw error;
      const seen = new Set<string>();
      const list: string[] = [];
      (data || []).forEach((row) => {
        const v = (row.item_description || '').trim();
        if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); list.push(v); }
      });
      return list.slice(0, 12);
    },
    enabled: !!currentTenant && productInput.length >= 2,
  });

  const { data: timeline = [], isFetching, isError, error: historyError, refetch } = useQuery({
    queryKey: ['product-history', currentTenant?.id, criteria],
    queryFn: async (): Promise<TimelineEvent[]> => {
      if (!currentTenant || !criteria) return [];
      const { data, error } = await supabase.rpc('read_product_history_v1' as never, {
        _tenant_id: currentTenant.id,
        _product: criteria.product,
        _from: criteria.from || null,
        _to: criteria.to || null,
      } as never);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('O servidor retornou um histórico de produto inválido.');
      return data as unknown as TimelineEvent[];
    },
    enabled: !!currentTenant && !!criteria,
    retry: false,
  });

  const summary = useMemo(() => {
    const byKind: Record<string, number> = {};
    timeline.forEach(e => { byKind[e.kind] = (byKind[e.kind] || 0) + 1; });
    const destinations = new Set(timeline.map(e => e.destination).filter(Boolean));
    const responsibles = new Set(timeline.map(e => e.responsible).filter(Boolean));
    return { total: timeline.length, byKind, destinations: destinations.size, responsibles: responsibles.size };
  }, [timeline]);
  const pagination = usePagination(timeline, {
    pageSize: 50,
    resetKey: criteria ? `${criteria.product}|${criteria.from}|${criteria.to}` : '',
  });

  const handleSearch = () => {
    if (invalidPeriod) return;
    const next = { product: productInput.trim(), from, to };
    if (criteria && JSON.stringify(criteria) === JSON.stringify(next)) void refetch();
    else setCriteria(next);
  };

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6 text-primary" /> Histórico do Produto
          </h1>
          <p className="text-sm text-muted-foreground">
            Selecione um item e o período para ver toda a trajetória: entrada, coleta, carga, paradas, eventos e saída.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consulta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Produto</Label>
                <Popover open={openCombo} onOpenChange={setOpenCombo}>
                  <PopoverTrigger asChild>
                    <div className="relative">
                      <Input
                        value={productInput}
                        onChange={(e) => { setProductInput(e.target.value); setOpenCombo(true); }}
                        placeholder="Digite o nome do produto..."
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                      />
                    </div>
                  </PopoverTrigger>
                  {suggestions.length > 0 && (
                    <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
                      <Command>
                        <CommandList>
                          <CommandEmpty>Nenhuma sugestão.</CommandEmpty>
                          <CommandGroup>
                            {suggestions.map(s => (
                              <CommandItem key={s} value={s} onSelect={() => { setProductInput(s); setOpenCombo(false); }}>
                                <Package className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                                <span className="truncate">{s}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  )}
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-history-from" className="text-xs">Período — De</Label>
                <Input id="product-history-from" type="date" max={to || undefined} value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-history-to" className="text-xs">Período — Até</Label>
                <Input id="product-history-to" type="date" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            {invalidPeriod && <p role="alert" className="mt-3 text-xs text-destructive">A data final deve ser igual ou posterior à inicial.</p>}
            <div className="flex gap-2 mt-4">
              <Button onClick={handleSearch} disabled={!productInput.trim() || invalidPeriod || isFetching}>
                <Search className="h-4 w-4 mr-2" /> {isFetching ? 'Buscando...' : 'Buscar histórico'}
              </Button>
              <Button variant="outline" onClick={() => { setProductInput(''); setFrom(''); setTo(''); setCriteria(null); }}>
                Limpar
              </Button>
            </div>
          </CardContent>
        </Card>

        {criteria && (
          <>
            {isError ? (
              <Card><CardContent className="py-8 text-center text-sm text-destructive">Não foi possível carregar o histórico: {historyError instanceof Error ? historyError.message : 'erro desconhecido'} <Button variant="link" onClick={() => refetch()}>Tentar novamente</Button></CardContent></Card>
            ) : <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Eventos no período</div><div className="text-2xl font-semibold">{summary.total}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Destinos distintos</div><div className="text-2xl font-semibold">{summary.destinations}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Responsáveis</div><div className="text-2xl font-semibold">{summary.responsibles}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Cargas / NFs</div><div className="text-2xl font-semibold">{(summary.byKind.load || 0) + (summary.byKind.inbound || 0) + (summary.byKind.outbound || 0)}</div></CardContent></Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Linha do tempo — "{criteria.product}"
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isFetching ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">Carregando histórico...</div>
                ) : timeline.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    Nenhum evento encontrado para este produto no período selecionado.
                  </div>
                ) : (
                  <ol className="relative border-l border-border ml-3 space-y-5">
                    {pagination.items.map((ev) => {
                      const meta = KIND_META[ev.kind];
                      const Icon = meta.icon;
                      return (
                        <li key={ev.key} className="ml-6">
                          <span className={cn("absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full text-white", meta.color)}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="rounded-lg border bg-card p-3">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                              <span className="text-xs text-muted-foreground">{fmtDateTime(ev.at, ev.dateOnly)}</span>
                              {ev.reference && <Badge variant="secondary" className="font-mono text-[10px]">{ev.reference}</Badge>}
                            </div>
                            <div className="text-sm font-medium">{ev.title}</div>
                            {ev.description && <div className="text-xs text-muted-foreground mt-0.5">{ev.description}</div>}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2 text-xs">
                              {ev.destination && (
                                <div><span className="text-muted-foreground">Destino:</span> <span className="font-medium">{ev.destination}</span></div>
                              )}
                              {ev.responsible && (
                                <div><span className="text-muted-foreground">Responsável:</span> <span className="font-medium">{ev.responsible}</span></div>
                              )}
                              {ev.meta && (ev.meta.quantity || ev.meta.weight || ev.meta.pallets || ev.meta.value) && (
                                <div className="text-muted-foreground">
                                  {ev.meta.quantity ? `Qtd ${Number(ev.meta.quantity).toLocaleString('pt-BR')} ` : ''}
                                  {ev.meta.weight ? `• ${Number(ev.meta.weight).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}kg ` : ''}
                                  {ev.meta.pallets ? `• ${ev.meta.pallets} pal ` : ''}
                                  {ev.meta.value ? `• R$ ${Number(ev.meta.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
              <DataPagination {...pagination} onPageChange={pagination.setPage} />
            </Card>
            </>}
          </>
        )}
      </div>
    </>
  );
}
