import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, CheckCircle, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { FreightBreakdown } from '@/hooks/useFreightCalculator';

type FreightLog = Tables<'freight_calculation_log'>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entityId?: string | null;
  entityType?: string;
  breakdown?: FreightBreakdown | null;
}

export default function FreightAuditDrawer({ open, onOpenChange, entityId, entityType, breakdown: propBreakdown }: Props) {
  const [logs, setLogs] = useState<FreightLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [totalLogs, setTotalLogs] = useState(0);

  useEffect(() => { setHistoryLimit(10); }, [open, entityId, entityType]);

  useEffect(() => {
    setLogs([]);
    setLoadError('');
    setLoading(false);
    setTotalLogs(0);
    if (!open || !entityId) return undefined;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    let query = supabase
      .from('freight_calculation_log')
      .select('*', { count: 'exact' })
      .eq('entity_id', entityId);
    if (entityType) query = query.eq('entity_type', entityType);
    void (async () => {
      try {
        const { data, error, count } = await query
          .order('created_at', { ascending: false })
          .range(0, historyLimit - 1)
          .abortSignal(controller.signal);
        if (!active) return;
        if (error) {
          setLoadError(error.message || 'Não foi possível carregar a auditoria do frete.');
          return;
        }
        setLogs(data || []);
        setTotalLogs(count ?? data?.length ?? 0);
      } catch (cause: unknown) {
        if (!active && controller.signal.aborted) return;
        setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar a auditoria do frete.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [open, entityId, entityType, historyLimit, reload]);

  const bd = propBreakdown || (logs.length > 0 ? logsToBreakdown(logs[0]) : null);
  const fmt = (v: number | null | undefined) => `R$ ${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Search className="h-4 w-4" /> Auditoria do Frete
          </SheetTitle>
        </SheetHeader>

        {loadError ? (
          <div role="alert" className="mt-4 space-y-3 rounded-md border border-destructive/40 p-4 text-sm text-destructive">
            <p>Não foi possível carregar a auditoria do frete: {loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" />Tentar novamente
            </Button>
          </div>
        ) : !bd ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            {loading ? 'Carregando...' : 'Nenhum cálculo registrado'}
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            {/* Result */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Valor Final do Frete</p>
                    <p className="text-2xl font-bold text-primary">{fmt(bd.finalValue)}</p>
                  </div>
                  {bd.fallbackUsed ? (
                    <Badge variant="outline" className="bg-warning/10 text-warning">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Fallback
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" /> Match
                    </Badge>
                  )}
                </div>
                {bd.fallbackReason && (
                  <p className="text-xs text-warning mt-2">{bd.fallbackReason}</p>
                )}
              </CardContent>
            </Card>

            {/* Table info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Tabela Selecionada</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-sm font-semibold">{bd.tableName}</p>
                <p className="text-xs text-muted-foreground">Código: {bd.tableCode} | Score: {bd.specificityScore}</p>
                {bd.regionName && <p className="text-xs">Região: <span className="font-medium">{bd.regionName}</span></p>}
              </CardContent>
            </Card>

            {/* Matched criteria */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Critérios Casados</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(bd.matchedCriteria).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum critério específico (tabela genérica)</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(bd.matchedCriteria).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-[10px] bg-green-500/5">
                        {k}: {v}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Ignored criteria */}
            {bd.ignoredCriteria.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Critérios Ignorados / Não Casados</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {bd.ignoredCriteria.map((c, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground">{c}</p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Components */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Componentes do Frete</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <Row label={`Frete % (${bd.components.ratePercent}%)`} value={bd.components.rateValue} />
                <Row label="Valor Fixo" value={bd.components.fixedValue} />
                <Row label={`Por kg (${bd.components.perKgValue}/kg)`} value={bd.components.perKgTotal} />
                <Row label={`Por palete (${bd.components.perPalletValue}/pl)`} value={bd.components.perPalletTotal} />
                <Row label="Despacho" value={bd.components.dispatchValue} />
                <Row label="Rastreamento" value={bd.components.trackingValue} />
                <Row label="Pedágio" value={bd.components.tollValue} />
                <Row label="Carga/Descarga" value={bd.components.loadingValue} />
                <Row label="GRIS" value={bd.components.grisValue} />
                <Row label={`Seguro (${bd.components.insurancePercent}%)`} value={bd.components.insuranceValue} />
                <Separator />
                <Row label="Base Calculada" value={bd.baseValue} bold />
                <Row label="Mínimo" value={bd.minValue} />
                <Row label="Valor Final" value={bd.finalValue} bold primary />
              </CardContent>
            </Card>

            {/* History */}
            {logs.length > 1 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Histórico ({logs.length} de {totalLogs})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {logs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {new Date(log.created_at).toLocaleString('pt-BR')}
                        {log.is_override && <Badge variant="outline" className="ml-1 text-[9px]">Override</Badge>}
                      </span>
                      <span className="font-medium">{fmt(Number(log.final_value))}</span>
                    </div>
                  ))}
                  {logs.length < totalLogs ? <Button type="button" variant="outline" size="sm" className="w-full"
                    disabled={loading} onClick={() => setHistoryLimit(limit => limit + 10)}>
                    {loading ? 'Carregando...' : `Carregar mais (${totalLogs - logs.length} restantes)`}
                  </Button> : null}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value, bold, primary }: { label: string; value: number; bold?: boolean; primary?: boolean }) {
  if (!value && !bold) return null;
  return (
    <div className="flex justify-between text-xs">
      <span className={bold ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className={`${bold ? 'font-bold' : ''} ${primary ? 'text-primary' : ''}`}>
        R$ {value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function logsToBreakdown(log: FreightLog): FreightBreakdown {
  const comp = objectValue(log.components);
  const matchedCriteria = Object.fromEntries(Object.entries(objectValue(log.matched_criteria)).map(([key, value]) => [key, String(value)]));
  const ignoredCriteria = Array.isArray(log.ignored_criteria) ? log.ignored_criteria.map(String) : [];
  return {
    tableName: log.freight_table_name || '—',
    tableId: log.freight_table_id || '',
    tableCode: 0,
    regionId: log.region_id,
    regionName: log.region_name,
    matchedCriteria,
    ignoredCriteria,
    specificityScore: 0,
    components: {
      ratePercent: numeric(comp.ratePercent),
      rateValue: numeric(comp.rateValue),
      fixedValue: numeric(comp.fixedValue),
      perKgValue: numeric(comp.perKgValue),
      perKgTotal: numeric(comp.perKgTotal),
      perPalletValue: numeric(comp.perPalletValue),
      perPalletTotal: numeric(comp.perPalletTotal),
      dispatchValue: numeric(comp.dispatchValue),
      trackingValue: numeric(comp.trackingValue),
      tollValue: numeric(comp.tollValue),
      loadingValue: numeric(comp.loadingValue),
      grisValue: numeric(comp.grisValue),
      insurancePercent: numeric(comp.insurancePercent),
      insuranceValue: numeric(comp.insuranceValue),
    },
    baseValue: Number(log.base_value) || 0,
    minValue: 0,
    finalValue: Number(log.final_value) || 0,
    fallbackUsed: log.fallback_used || false,
    fallbackReason: log.fallback_reason ?? undefined,
  };
}
