import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, CheckCircle, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { FreightBreakdown } from '@/hooks/useFreightCalculator';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entityId?: string | null;
  entityType?: string;
  breakdown?: FreightBreakdown | null;
}

export default function FreightAuditDrawer({ open, onOpenChange, entityId, breakdown: propBreakdown }: Props) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !entityId) return;
    setLoading(true);
    supabase
      .from('freight_calculation_log')
      .select('*')
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setLogs(data || []);
        setLoading(false);
      });
  }, [open, entityId]);

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

        {!bd ? (
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
                  <CardTitle className="text-xs font-medium text-muted-foreground">Histórico ({logs.length})</CardTitle>
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

function logsToBreakdown(log: any): FreightBreakdown {
  const comp = log.components || {};
  return {
    tableName: log.freight_table_name || '—',
    tableId: log.freight_table_id || '',
    tableCode: 0,
    regionId: log.region_id,
    regionName: log.region_name,
    matchedCriteria: log.matched_criteria || {},
    ignoredCriteria: log.ignored_criteria || [],
    specificityScore: 0,
    components: {
      ratePercent: comp.ratePercent || 0,
      rateValue: comp.rateValue || 0,
      fixedValue: comp.fixedValue || 0,
      perKgValue: comp.perKgValue || 0,
      perKgTotal: comp.perKgTotal || 0,
      perPalletValue: comp.perPalletValue || 0,
      perPalletTotal: comp.perPalletTotal || 0,
      dispatchValue: comp.dispatchValue || 0,
      trackingValue: comp.trackingValue || 0,
      tollValue: comp.tollValue || 0,
      loadingValue: comp.loadingValue || 0,
      grisValue: comp.grisValue || 0,
      insurancePercent: comp.insurancePercent || 0,
      insuranceValue: comp.insuranceValue || 0,
    },
    baseValue: Number(log.base_value) || 0,
    minValue: 0,
    finalValue: Number(log.final_value) || 0,
    fallbackUsed: log.fallback_used || false,
    fallbackReason: log.fallback_reason,
  };
}
