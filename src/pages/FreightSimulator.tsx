import { useState, useMemo, useEffect, useCallback } from 'react';
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
import { Calculator, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { calculateFreight, type FreightResult } from '@/hooks/useFreightCalculator';
import { toast } from 'sonner';

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

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-min', tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, company_name, payer_group')
        .eq('tenant_id', tenantId!)
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
    queryKey: ['fiscal-docs-recent', tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, access_key, recipient, recipient_city, recipient_state, value, weight_kg, pallet_count, client_id, document_type')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false })
        .limit(200);
      return data || [];
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
          <div>
            <Label>Carregar de um Documento Fiscal (opcional)</Label>
            <Select value={docId || NONE} onValueChange={(v) => loadFromDoc(v === NONE ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um NF/CT-e para preencher os dados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Manual —</SelectItem>
                {docs.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.document_type?.toUpperCase()} {d.invoice_number || d.access_key?.slice(-8)} · {d.recipient || '—'} · {d.recipient_city}/{d.recipient_state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Cliente</Label>
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
          <CardContent className="space-y-4">
            {!result.success && (
              <div className="text-destructive text-sm">{result.error}</div>
            )}
            {result.breakdown && (
              <>
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Tabela aplicada</div>
                    <div className="font-medium flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      #{result.breakdown.tableCode} — {result.breakdown.tableName}
                      {result.breakdown.fallbackUsed && (
                        <Badge variant="outline" className="text-amber-600 border-amber-600">Fallback</Badge>
                      )}
                    </div>
                    {result.breakdown.regionName && (
                      <div className="text-xs text-muted-foreground mt-1">Região: {result.breakdown.regionName}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Valor final do frete</div>
                    <div className="text-2xl font-bold">{formatBRL(result.value)}</div>
                  </div>
                </div>

                {result.breakdown.fallbackReason && (
                  <div className="text-xs text-amber-600">⚠ {result.breakdown.fallbackReason}</div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <Item label="% sobre NF" value={`${result.breakdown.components.ratePercent}%`} sub={formatBRL(result.breakdown.components.rateValue)} />
                  <Item label="Valor fixo" value={formatBRL(result.breakdown.components.fixedValue)} />
                  <Item label="Por kg" value={formatBRL(result.breakdown.components.perKgValue)} sub={formatBRL(result.breakdown.components.perKgTotal)} />
                  <Item label="Por pallet" value={formatBRL(result.breakdown.components.perPalletValue)} sub={formatBRL(result.breakdown.components.perPalletTotal)} />
                  <Item label="Despacho" value={formatBRL(result.breakdown.components.dispatchValue)} />
                  <Item label="Rastreamento" value={formatBRL(result.breakdown.components.trackingValue)} />
                  <Item label="Pedágio" value={formatBRL(result.breakdown.components.tollValue)} />
                  <Item label="Carregamento" value={formatBRL(result.breakdown.components.loadingValue)} />
                  <Item label="GRIS" value={formatBRL(result.breakdown.components.grisValue)} />
                  <Item label="Seguro" value={`${result.breakdown.components.insurancePercent}%`} sub={formatBRL(result.breakdown.components.insuranceValue)} />
                  <Item label="Base calculada" value={formatBRL(result.breakdown.baseValue)} />
                  <Item label="Mínimo da tabela" value={formatBRL(result.breakdown.minValue)} />
                </div>

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Critérios atendidos</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(result.breakdown.matchedCriteria).map(([k, v]) => (
                      <Badge key={k} variant="secondary">{k}: {v}</Badge>
                    ))}
                    {Object.keys(result.breakdown.matchedCriteria).length === 0 && (
                      <span className="text-xs text-muted-foreground">Nenhum critério específico — tabela genérica</span>
                    )}
                  </div>
                </div>

                {result.breakdown.ignoredCriteria.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Critérios ignorados / divergentes</div>
                    <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                      {result.breakdown.ignoredCriteria.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Item({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">= {sub}</div>}
    </div>
  );
}
