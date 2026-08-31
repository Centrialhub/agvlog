import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { calculateFreight, logFreightCalculation } from '@/hooks/useFreightCalculator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { FileText, Calculator, CheckCircle, Eye, Edit3, Search } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import FreightReviewDialog from '@/components/freight/FreightReviewDialog';
import type { Json, TablesInsert } from '@/integrations/supabase/types';

interface Doc {
  id: string;
  invoice_number: string | null;
  document_type: string;
  remitter: string | null;
  recipient: string | null;
  pallet_count: number | null;
  weight_kg: number | null;
  value: number | null;
  status: string;
  freight_value?: number | null;
  freight_value_original?: number | null;
  freight_breakdown?: Json;
  freight_overridden?: boolean | null;
  freight_override_reason?: string | null;
  freight_confirmed_at?: string | null;
  deleted_at?: string | null;
}

interface Props {
  loadId: string;
  loadNumber: string;
  destination: string | null;
  documents: Doc[];
}

export default function CTeWorkbench({ loadId, loadNumber, destination, documents }: Props) {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  const inboundDocs = useMemo(() => documents.filter(document => document.document_type === 'inbound' && !document.deleted_at), [documents]);
  const outboundDocs = useMemo(() => documents.filter(document => document.document_type === 'outbound' && !document.deleted_at), [documents]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({ invoice: '', recipient: '' });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedFilters(filters), 300);
    return () => clearTimeout(timeout);
  }, [filters]);

  const normalize = (v: string) => v.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const filteredInboundDocs = useMemo(() => {
    return inboundDocs.filter(d => {
      const docInvoice = normalize(d.invoice_number || '');
      const docRecipient = normalize(d.recipient || '');
      const fInvoice = normalize(debouncedFilters.invoice);
      const fRecipient = normalize(debouncedFilters.recipient);

      if (fInvoice && !docInvoice.includes(fInvoice)) return false;
      if (fRecipient && !docRecipient.includes(fRecipient)) return false;
      return true;
    });
  }, [inboundDocs, debouncedFilters]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [reviewDoc, setReviewDoc] = useState<Doc | null>(null);
  const [calculatedFreight, setCalculatedFreight] = useState<number | null>(null);

  const toggleDoc = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredInboundDocs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredInboundDocs.map(d => d.id)));
    }
  };

  const selectedDocs = useMemo(() => inboundDocs.filter(d => selectedIds.has(d.id)), [inboundDocs, selectedIds]);

  const totals = useMemo(() => ({
    pallets: selectedDocs.reduce((s, d) => s + (d.pallet_count || 0), 0),
    weight: selectedDocs.reduce((s, d) => s + (Number(d.weight_kg) || 0), 0),
    value: selectedDocs.reduce((s, d) => s + (Number(d.value) || 0), 0),
  }), [selectedDocs]);

  const handleCalcFreight = async () => {
    if (!currentTenant) return;
    const result = await calculateFreight({
      tenantId: currentTenant.id,
      destination,
      totalValue: totals.value,
      totalWeight: totals.weight,
      totalPallets: totals.pallets,
    });
    if (result.success) {
      setCalculatedFreight(result.value);
      setOverrideValue('');
      toast.success(`Frete calculado: R$ ${result.value.toFixed(2)}`);
    } else {
      toast.error(result.error || 'Erro no cálculo');
      setCalculatedFreight(0);
    }
  };

  const generateCTe = useMutation({
    mutationFn: async () => {
      if (!currentTenant || selectedDocs.length === 0) throw new Error('Selecione documentos');
      
      const freightValue = overrideValue ? Number(overrideValue) : calculatedFreight;
      if (freightValue === null) throw new Error('Calcule o frete primeiro');

      const cteNumber = `CTE-${loadNumber}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
      const itemSummary = selectedDocs
        .map(d => `NF ${d.invoice_number} - ${d.recipient || d.remitter || ''}`)
        .join(', ')
        .substring(0, 500);

      const payload: TablesInsert<'fiscal_documents'> = {
        tenant_id: currentTenant.id,
        created_by: user?.id,
        document_type: 'outbound',
        invoice_number: cteNumber,
        load_id: loadId,
        remitter: currentTenant.name || 'Transportadora',
        recipient: destination || 'Destino não informado',
        pallet_count: totals.pallets,
        weight_kg: totals.weight,
        value: totals.value,
        freight_value: freightValue,
        product_summary: itemSummary,
        status: 'confirmed',
        issue_date: new Date().toISOString().slice(0, 10),
      };
      const { data, error } = await supabase.from('fiscal_documents').insert(payload).select().single();

      if (error) throw error;

      if (overrideValue && data) {
        await logFreightCalculation(
          currentTenant.id,
          data.id,
          'cte',
          {
            tableName: 'Override manual',
            tableId: '',
            tableCode: 0,
            matchedCriteria: {},
            ignoredCriteria: [],
            specificityScore: 0,
            components: {
              ratePercent: 0, rateValue: 0, fixedValue: Number(overrideValue),
              perKgValue: 0, perKgTotal: 0, perPalletValue: 0, perPalletTotal: 0,
              dispatchValue: 0, trackingValue: 0, tollValue: 0, loadingValue: 0,
              grisValue: 0, insurancePercent: 0, insuranceValue: 0,
            },
            baseValue: Number(overrideValue),
            minValue: 0,
            finalValue: Number(overrideValue),
            fallbackUsed: false,
            fallbackReason: undefined,
            regionId: null,
            regionName: null,
          },
          user?.id,
        );
      }

      return data;
    },
    onSuccess: () => {
      toast.success('CT-e gerado com sucesso');
      setPreviewOpen(false);
      setSelectedIds(new Set());
      setCalculatedFreight(null);
      setOverrideValue('');
      setOverrideReason('');
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['load_documents'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FileText className="h-4 w-4" /> Geração de Conhecimentos (CT-e)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {outboundDocs.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">CT-es Emitidos ({outboundDocs.length})</p>
            {outboundDocs.map(d => (
              <div key={d.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  <span className="font-medium truncate">{d.invoice_number}</span>
                  {d.freight_overridden && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300">Alterado</span>
                  )}
                  {d.freight_confirmed_at && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300">Confirmado</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted-foreground text-xs">
                    {d.freight_value ? fmt(Number(d.freight_value)) : '—'} | {d.pallet_count} pl
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewDoc(d)}>
                    <Edit3 className="h-3 w-3 mr-1" /> Revisar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {inboundDocs.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground font-medium">Selecione NF-es para novo CT-e</p>
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={selectAll}>
                  {selectedIds.size === filteredInboundDocs.length && filteredInboundDocs.length > 0 ? 'Desmarcar' : 'Selecionar'} Todos
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input 
                    placeholder="Filtrar por Nota..." 
                    className="h-8 pl-7 text-xs" 
                    value={filters.invoice}
                    onChange={e => setFilters(f => ({ ...f, invoice: e.target.value }))}
                  />
                </div>
                <Input 
                  placeholder="Filtrar por Destinatário..." 
                  className="h-8 text-xs" 
                  value={filters.recipient}
                  onChange={e => setFilters(f => ({ ...f, recipient: e.target.value }))}
                />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>NF</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="text-right">Paletes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInboundDocs.map(d => (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => toggleDoc(d.id)}>
                    <TableCell>
                      <Checkbox checked={selectedIds.has(d.id)} />
                    </TableCell>
                    <TableCell className="font-medium text-sm">{d.invoice_number || '—'}</TableCell>
                    <TableCell className="text-sm">{d.recipient || '—'}</TableCell>
                    <TableCell className="text-sm text-right">{d.value ? fmt(Number(d.value)) : '—'}</TableCell>
                    <TableCell className="text-sm text-right">{d.weight_kg || 0} kg</TableCell>
                    <TableCell className="text-sm text-right">{d.pallet_count || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border">
                <div className="flex-1 text-xs">
                  <span className="font-semibold">{selectedIds.size}</span> NF(s) | {totals.pallets} paletes | {totals.weight.toLocaleString('pt-BR')} kg | {fmt(totals.value)}
                </div>
                <Button size="sm" variant="outline" onClick={handleCalcFreight}>
                  <Calculator className="h-3 w-3 mr-1" /> Calcular Frete
                </Button>
                <Button size="sm" onClick={() => setPreviewOpen(true)} disabled={calculatedFreight === null && !overrideValue}>
                  <Eye className="h-3 w-3 mr-1" /> Preview
                </Button>
              </div>
            )}
          </>
        )}

        {inboundDocs.length === 0 && outboundDocs.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum documento vinculado a esta carga</p>
        )}

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Preview CT-e</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">NF-es</p><p className="font-semibold">{selectedIds.size}</p></div>
                <div><p className="text-xs text-muted-foreground">Paletes</p><p className="font-semibold">{totals.pallets}</p></div>
                <div><p className="text-xs text-muted-foreground">Peso</p><p className="font-semibold">{totals.weight.toLocaleString('pt-BR')} kg</p></div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Valor das NFs</p><p className="font-semibold">{fmt(totals.value)}</p></div>
                <div>
                  <p className="text-xs text-muted-foreground">Frete Calculado</p>
                  <p className="font-semibold text-primary">{calculatedFreight !== null ? fmt(calculatedFreight) : '—'}</p>
                </div>
              </div>
              <Separator />
              <div>
                <Label className="text-xs">Override do valor (opcional)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Deixe vazio para usar o calculado"
                  value={overrideValue}
                  onChange={e => setOverrideValue(e.target.value)}
                />
              </div>
              {overrideValue && (
                <div>
                  <Label className="text-xs">Justificativa do override *</Label>
                  <Textarea
                    placeholder="Motivo do ajuste manual..."
                    value={overrideReason}
                    onChange={e => setOverrideReason(e.target.value)}
                  />
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => generateCTe.mutate()}
                  disabled={generateCTe.isPending || (!!overrideValue && !overrideReason.trim())}
                >
                  {generateCTe.isPending ? 'Gerando...' : 'Gerar CT-e'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <FreightReviewDialog
          open={!!reviewDoc}
          onOpenChange={(v) => { if (!v) setReviewDoc(null); }}
          doc={reviewDoc}
        />
      </CardContent>
    </Card>
  );
}
