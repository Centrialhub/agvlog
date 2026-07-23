import { useState, useMemo, useEffect, useCallback } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Calculator, AlertCircle, CheckCircle2 } from 'lucide-react';
import { calculateFreight, type FreightResult } from '@/hooks/useFreightCalculator';
import { toast } from 'sonner';
import FreightBreakdownPanel from '@/components/freight/FreightBreakdownPanel';

const NONE = '__none__';
const formatBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function FreightSimulator() {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;

  const [docId, setDocId] = useState<string>('');
  const [clientId, setClientId] = useState<string>(NONE);
  const [regionId, setRegionId] = useState<string>(NONE);
  const [payerGroup, setPayerGroup] = useState<string>(NONE);
  const [vehicleType, setVehicleType] = useState<string>('');
  const [totalValue, setTotalValue] = useState<string>('0');
  const [totalWeight, setTotalWeight] = useState<string>('0');
  const [totalPallets, setTotalPallets] = useState<string>('0');
  const [destState, setDestState] = useState<string>('');
  const [destMunicipality, setDestMunicipality] = useState<string>('');
  const [result, setResult] = useState<FreightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoCalc, setAutoCalc] = useState(true);
  const [docTypeFilter, setDocTypeFilter] = useState<'cte' | 'nfe' | 'all'>('cte');
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<'30' | '60' | '90' | 'custom' | 'all'>('30');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [quickSearch, setQuickSearch] = useState<string>('');
  const [quickSearching, setQuickSearching] = useState(false);
  const [onlyValid, setOnlyValid] = useState(true);

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    if (periodFilter === 'all') return { startDate: null as string | null, endDate: null as string | null };
    if (periodFilter === 'custom') {
      return { startDate: customStart || null, endDate: customEnd || null };
    }
    const days = Number(periodFilter);
    const start = new Date(today);
    start.setDate(start.getDate() - days);
    return { startDate: toISO(start), endDate: toISO(today) };
  }, [periodFilter, customStart, customEnd]);

  const { data: clients = [] } = useQuery({
    queryKey: ['suppliers-min-freight', tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, company_name, payer_group')
        .eq('tenant_id', tenantId!)
        .eq('is_supplier', true)
        .order('company_name');
      return data || [];
    },
    enabled: !!tenantId,
  });

  const { data: regions = [] } = useQuery({
    queryKey: ['client-regions-min', tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_regions')
        .select('id, region_name, municipality, state_code, payer_group, client_id')
        .eq('tenant_id', tenantId!)
        .order('region_name');
      return data || [];
    },
    enabled: !!tenantId,
  });

  const { data: docs = [] } = useQuery({
    queryKey: ['fiscal-docs-recent', tenantId, startDate, endDate, onlyValid],
    queryFn: async () => {
      let q = supabase
        .from('fiscal_documents')
        .select('id, invoice_number, access_key, remitter, recipient, recipient_city, recipient_state, value, weight_kg, pallet_count, client_id, document_type, issue_date, status, created_at')
        .eq('tenant_id', tenantId!)
        .order('issue_date', { ascending: false, nullsFirst: false })
        .limit(500);
      if (startDate) q = q.gte('issue_date', startDate);
      if (endDate) q = q.lte('issue_date', endDate);
      if (onlyValid) {
        // Excluir status indesejados (cancelados/rejeitados/rascunhos)
        q = q.not('status', 'in', '(cancelled,canceled,rejected,denied,draft)');
      }
      const { data } = await q;
      const rows = data || [];
      if (!onlyValid) return rows;
      // Deduplicar por chave de acesso (ou nº+emitente quando faltar) — mantém o mais recente
      const seen = new Map<string, any>();
      for (const r of rows) {
        const key = (r as any).access_key
          || `${(r as any).invoice_number || ''}|${(r as any).remitter || ''}|${(r as any).document_type || ''}`;
        if (!key) continue;
        const existing = seen.get(key);
        if (!existing) { seen.set(key, r); continue; }
        const a = new Date((r as any).created_at || (r as any).issue_date || 0).getTime();
        const b = new Date(existing.created_at || existing.issue_date || 0).getTime();
        if (a > b) seen.set(key, r);
      }
      return Array.from(seen.values());
    },
    enabled: !!tenantId,
  });

  const uniquePayerGroups = useMemo(() => {
    const s = new Set<string>();
    regions.forEach((r: any) => r.payer_group && s.add(r.payer_group));
    clients.forEach((c: any) => c.payer_group && s.add(c.payer_group));
    return Array.from(s).sort();
  }, [regions, clients]);

  const filteredRegions = useMemo(() => {
    if (clientId === NONE) return regions;
    return regions.filter((r: any) => !r.client_id || r.client_id === clientId);
  }, [regions, clientId]);

  const filteredDocs = useMemo(() => {
    if (docTypeFilter === 'all') return docs;
    if (docTypeFilter === 'cte') return docs.filter((d: any) => d.document_type === 'outbound');
    return docs.filter((d: any) => d.document_type === 'inbound');
  }, [docs, docTypeFilter]);

  function loadFromDoc(id: string) {
    setDocId(id);
    if (!id || id === NONE) return;
    const d = docs.find((x: any) => x.id === id);
    if (!d) return;
    if (d.client_id) setClientId(d.client_id);
    setTotalValue(String(d.value || 0));
    setTotalWeight(String(d.weight_kg || 0));
    setTotalPallets(String(d.pallet_count || 0));
    setDestState(d.recipient_state || '');
    setDestMunicipality(d.recipient_city || '');
    // Try to auto-suggest region
    const match = regions.find(
      (r: any) =>
        r.municipality?.toLowerCase() === (d.recipient_city || '').toLowerCase() &&
        (!d.recipient_state || r.state_code === d.recipient_state),
    );
    if (match) setRegionId(match.id);
    setResult(null);
  }

  async function handleQuickSearch() {
    const term = quickSearch.trim();
    if (!term || !tenantId) return;
    // Try local first
    const local = filteredDocs.find((d: any) => {
      const num = String(d.invoice_number || '');
      const key = String(d.access_key || '');
      return num === term || num.endsWith(term) || key.endsWith(term);
    });
    if (local) {
      loadFromDoc(local.id);
      toast.success(`Documento ${local.invoice_number || term} carregado`);
      return;
    }
    // Fallback: query DB ignoring period filter
    setQuickSearching(true);
    try {
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, access_key, remitter, recipient, recipient_city, recipient_state, value, weight_kg, pallet_count, client_id, document_type, issue_date')
        .eq('tenant_id', tenantId)
        .or(`invoice_number.eq.${term},access_key.ilike.%${term}%`)
        .limit(5);
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error('Nenhum documento encontrado com esse número/chave');
        return;
      }
      // Inject into local docs cache by reusing loadFromDoc-like flow
      const d: any = data[0];
      setDocId(d.id);
      if (d.client_id) setClientId(d.client_id);
      setTotalValue(String(d.value || 0));
      setTotalWeight(String(d.weight_kg || 0));
      setTotalPallets(String(d.pallet_count || 0));
      setDestState(d.recipient_state || '');
      setDestMunicipality(d.recipient_city || '');
      const match = regions.find(
        (r: any) =>
          r.municipality?.toLowerCase() === (d.recipient_city || '').toLowerCase() &&
          (!d.recipient_state || r.state_code === d.recipient_state),
      );
      if (match) setRegionId(match.id);
      setResult(null);
      toast.success(`Documento ${d.invoice_number || term} carregado (fora do período atual)`);
    } catch (e: any) {
      toast.error(e.message || 'Falha na busca');
    } finally {
      setQuickSearching(false);
    }
  }

  const handleSimulate = useCallback(async (silent = false) => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const region = regions.find((r: any) => r.id === regionId);
      const r = await calculateFreight({
        tenantId,
        clientId: clientId === NONE ? null : clientId,
        payerGroup: payerGroup === NONE ? region?.payer_group || null : payerGroup,
        destination: region?.region_name || destMunicipality || null,
        destinationState: destState || region?.state_code || null,
        destinationMunicipality: destMunicipality || region?.municipality || null,
        vehicleType: vehicleType || null,
        totalValue: Number(totalValue) || 0,
        totalWeight: Number(totalWeight) || 0,
        totalPallets: Number(totalPallets) || 0,
      });
      setResult(r);
      if (!silent && !r.success) toast.error(r.error || 'Falha no cálculo');
    } catch (e: any) {
      if (!silent) toast.error(e.message || 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  }, [tenantId, regions, regionId, clientId, payerGroup, destMunicipality, destState, vehicleType, totalValue, totalWeight, totalPallets]);

  // Auto-recalculate (debounced) when inputs change
  useEffect(() => {
    if (!autoCalc || !tenantId) return;
    const hasMinInput =
      regionId !== NONE || payerGroup !== NONE || clientId !== NONE ||
      Number(totalValue) > 0 || Number(totalWeight) > 0 || Number(totalPallets) > 0;
    if (!hasMinInput) return;
    const t = setTimeout(() => { handleSimulate(true); }, 400);
    return () => clearTimeout(t);
  }, [autoCalc, tenantId, regionId, payerGroup, clientId, totalValue, totalWeight, totalPallets, destState, destMunicipality, vehicleType, handleSimulate]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" /> Prévia de Cálculo de Frete
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Simule o valor do frete que seria aplicado a um CT-e com base na região e grupo pagador escolhidos.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label>Carregar de um Documento Fiscal (opcional)</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
                  {([
                    { v: '30', label: '30d' },
                    { v: '60', label: '60d' },
                    { v: '90', label: '90d' },
                    { v: 'custom', label: 'Custom' },
                    { v: 'all', label: 'Tudo' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setPeriodFilter(opt.v)}
                      className={`px-2.5 py-1 rounded-sm transition-colors ${
                        periodFilter === opt.v
                          ? 'bg-background shadow-sm font-medium'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
                {([
                  { v: 'cte', label: 'CT-e' },
                  { v: 'nfe', label: 'NF-e' },
                  { v: 'all', label: 'Ambos' },
                ] as const).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setDocTypeFilter(opt.v)}
                    className={`px-2.5 py-1 rounded-sm transition-colors ${
                      docTypeFilter === opt.v
                        ? 'bg-background shadow-sm font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={onlyValid}
                    onChange={(e) => setOnlyValid(e.target.checked)}
                  />
                  Excluir cancelados/duplicados
                </label>
              </div>
            </div>
            {periodFilter === 'custom' && (
              <div className="flex items-center gap-2 text-xs">
                <Label className="text-xs">De</Label>
                <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-8 w-auto" />
                <Label className="text-xs">Até</Label>
                <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-8 w-auto" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickSearch(); } }}
                placeholder="Busca rápida por nº ou chave de acesso (Enter)…"
                className="h-9"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleQuickSearch}
                disabled={quickSearching || !quickSearch.trim()}
                className="shrink-0"
              >
                {quickSearching ? 'Buscando…' : 'Localizar'}
              </Button>
            </div>
            <Popover open={docPickerOpen} onOpenChange={setDocPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={docPickerOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate text-left">
                    {(() => {
                      const sel = docs.find((x: any) => x.id === docId);
                      if (!sel) return <span className="text-muted-foreground">Buscar por nº, emitente, destinatário ou cidade…</span>;
                      return `${sel.document_type?.toUpperCase()} ${sel.invoice_number || sel.access_key?.slice(-8) || ''} · ${sel.recipient || sel.remitter || '—'}`;
                    })()}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[420px]" align="start">
                <Command
                  filter={(value, search) => {
                    if (!search) return 1;
                    return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                  }}
                >
                  <CommandInput placeholder="Buscar nº, emitente, destinatário, cidade…" autoFocus />
                  <CommandList>
                    <CommandEmpty>Nenhum documento encontrado</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="manual --"
                        onSelect={() => { loadFromDoc(''); setDocPickerOpen(false); }}
                      >
                        <Check className={cn('mr-2 h-4 w-4', !docId ? 'opacity-100' : 'opacity-0')} />
                        — Manual —
                      </CommandItem>
                      {filteredDocs.map((d: any) => {
                        const num = d.invoice_number || d.access_key?.slice(-8) || '';
                        const haystack = [
                          d.document_type,
                          num,
                          d.remitter,
                          d.recipient,
                          d.recipient_city,
                          d.recipient_state,
                        ].filter(Boolean).join(' ');
                        return (
                          <CommandItem
                            key={d.id}
                            value={`${haystack} ${d.id}`}
                            onSelect={() => { loadFromDoc(d.id); setDocPickerOpen(false); }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', docId === d.id ? 'opacity-100' : 'opacity-0')} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate">
                                <span className="font-medium">{d.document_type?.toUpperCase()}</span> {num}
                                {d.remitter && <span className="text-muted-foreground"> · {d.remitter}</span>}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {d.recipient || '—'} · {d.recipient_city || '—'}/{d.recipient_state || '—'}
                              </div>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-[11px] text-muted-foreground">
              {filteredDocs.length} documento(s) listado(s) — total carregado: {docs.length}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Fornecedor</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Qualquer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Qualquer</SelectItem>
                  {clients.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Região</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {filteredRegions.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.region_name} {r.municipality ? `· ${r.municipality}/${r.state_code}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Grupo Pagador</Label>
              <Select value={payerGroup} onValueChange={setPayerGroup}>
                <SelectTrigger><SelectValue placeholder="Auto da região" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Auto da região</SelectItem>
                  {uniquePayerGroups.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <Label>Valor NF (R$)</Label>
              <Input type="number" value={totalValue} onChange={(e) => setTotalValue(e.target.value)} />
            </div>
            <div>
              <Label>Peso (kg)</Label>
              <Input type="number" value={totalWeight} onChange={(e) => setTotalWeight(e.target.value)} />
            </div>
            <div>
              <Label>Pallets</Label>
              <Input type="number" value={totalPallets} onChange={(e) => setTotalPallets(e.target.value)} />
            </div>
            <div>
              <Label>UF Destino</Label>
              <Input value={destState} onChange={(e) => setDestState(e.target.value.toUpperCase())} maxLength={2} />
            </div>
            <div>
              <Label>Município Destino</Label>
              <Input value={destMunicipality} onChange={(e) => setDestMunicipality(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-between items-center">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={autoCalc}
                onChange={(e) => setAutoCalc(e.target.checked)}
                className="h-4 w-4"
              />
              Recalcular automaticamente ao alterar filtros
            </label>
            <Button onClick={() => handleSimulate(false)} disabled={loading || !tenantId}>
              <Calculator className="h-4 w-4 mr-2" />
              {loading ? 'Calculando...' : 'Recalcular agora'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
              Resultado da Simulação
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FreightBreakdownPanel
              breakdown={result.breakdown}
              finalValue={result.value}
              success={result.success}
              error={result.error}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
