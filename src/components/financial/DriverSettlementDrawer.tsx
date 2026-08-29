import { confirmAction, promptAction } from '@/hooks/useAlertStore';
import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, RefreshCw, FileText, Plus, Trash2, AlertTriangle, X } from 'lucide-react';
import { format } from 'date-fns';
import {
  useDriverSettlement, useRegenerateDriverSettlement, useUpdateDriverSettlementStatus,
  useUpdateSettlementKmReview, useAddSettlementAdjustment, useRemoveSettlementAdjustment,
  useRegisterSettlementPayment, useSettleZeroDriverSettlement,
  SETTLEMENT_STATUS_LABEL, isLocked, DriverSettlementStatus,
  useDetachLoadFromSettlement, useAddSettlementManualExpense,
  useDeleteDriverSettlement,
} from '@/hooks/useDriverSettlements';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useBankAccounts } from '@/hooks/useBankReconciliation';
import AttachLoadsDialog from './AttachLoadsDialog';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import type { Json } from '@/integrations/supabase/types';
import type { JsonObject } from '@/lib/jsonTypes';

const fmtMoney = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number | null | undefined, d = 2) => (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (v?: string | null) => (v ? format(new Date(v), 'dd/MM/yyyy HH:mm') : '—');

function metadataRecord(metadata: Json): JsonObject {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function metadataText(metadata: Json, key: string, fallback = '—'): string {
  const value = metadataRecord(metadata)[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function metadataNumber(metadata: Json, key: string): number {
  return Number(metadataRecord(metadata)[key] ?? 0);
}

function metadataBoolean(metadata: Json, key: string): boolean | null {
  const value = metadataRecord(metadata)[key];
  return typeof value === 'boolean' ? value : null;
}

interface Props { settlementId: string | null; open: boolean; onOpenChange: (o: boolean) => void; }

export function DriverSettlementDrawer({ settlementId, open, onOpenChange }: Props) {
  const { data, isLoading } = useDriverSettlement(settlementId);
  const regen = useRegenerateDriverSettlement();
  const updateStatus = useUpdateDriverSettlementStatus();
  const updateKm = useUpdateSettlementKmReview();
  const addAdj = useAddSettlementAdjustment();
  const removeAdj = useRemoveSettlementAdjustment();
  const registerPay = useRegisterSettlementPayment();
  const settleZero = useSettleZeroDriverSettlement();
  const detachLoad = useDetachLoadFromSettlement();
  const [attachOpen, setAttachOpen] = useState(false);
  const addManualExp = useAddSettlementManualExpense();
  const deleteSettlement = useDeleteDriverSettlement();
  const { data: costCenters } = useCostCenters();

  const s = data?.settlement;
  const items = data?.items ?? [];
  const events = data?.events ?? [];
  const payments = data?.payments ?? [];

  const [auditedKm, setAuditedKm] = useState<string>('');
  const [kmStart, setKmStart] = useState<string>('');
  const [kmEnd, setKmEnd] = useState<string>('');
  const [auditedStartLoc, setAuditedStartLoc] = useState<string>('');
  const [auditedEndLoc, setAuditedEndLoc] = useState<string>('');
  const [kmStatus, setKmStatus] = useState<'pending' | 'reviewed' | 'disputed'>('pending');
  const [kmNotes, setKmNotes] = useState('');

  useEffect(() => {
    if (s) {
      setAuditedKm(s.audited_km != null ? String(s.audited_km) : '');
      setKmStart(s.km_start != null ? String(s.km_start) : '');
      setKmEnd(s.km_end != null ? String(s.km_end) : '');
      setAuditedStartLoc(s.audited_start_location ?? '');
      setAuditedEndLoc(s.audited_end_location ?? '');
      setKmStatus(s.km_review_status ?? 'pending');
      setKmNotes(s.km_review_notes ?? '');
    }
  }, [s]);

  const loadItems = items.filter(i => i.item_type === 'load');
  const docItems = items.filter(i => i.item_type === 'fiscal_document');
  const expItems = items.filter(i => i.item_type === 'expense');
  const adjItems = items.filter(i => i.item_type === 'adjustment');
  const hasPendingExpenses = (s?.pending_expenses_total ?? 0) > 0;
  const noFreight = (s?.total_freight_value ?? 0) === 0;
  const locked = s ? isLocked(s.status as DriverSettlementStatus) : false;
  const needsRecalc = !!s?.needs_recalculation;

  const kmDiff = useMemo(() => {
    if (!s?.estimated_km || s.audited_km == null) return null;
    const abs = Number(s.audited_km) - Number(s.estimated_km);
    const pct = (abs / Number(s.estimated_km)) * 100;
    return { abs, pct };
  }, [s?.estimated_km, s?.audited_km]);

  // Adjustment dialog
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjNature, setAdjNature] = useState<'credit' | 'debit'>('credit');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjDesc, setAdjDesc] = useState('');
  const [adjReason, setAdjReason] = useState('');

  // Manual Expense dialog
  const [expOpen, setExpOpen] = useState(false);
  const [expCategory, setExpCategory] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [expCostCenter, setExpCostCenter] = useState('');
  const [expPaymentSource, setExpPaymentSource] = useState('driver');
  const [expReimbursable, setExpReimbursable] = useState(true);
  const [expReceipt, setExpReceipt] = useState('');
  const [expNotes, setExpNotes] = useState('');

  // Payment dialog
  const [payOpen, setPayOpen] = useState(false);
  const remaining = Math.max(0, Number(s?.driver_payable_amount ?? 0) - Number(s?.total_paid_amount ?? 0));
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('pix');
  const [payAccount, setPayAccount] = useState<string>('caixa');
  const [payAccountOther, setPayAccountOther] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payReceipt, setPayReceipt] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payBankAccountId, setPayBankAccountId] = useState<string>('none');
  const [payCostCenter, setPayCostCenter] = useState<string>('Operacional');
  const { data: bankAccounts } = useBankAccounts();
  useEffect(() => { if (payOpen) setPayAmount(remaining > 0 ? String(remaining.toFixed(2)) : ''); }, [payOpen, remaining]);
  const [payAllowOver, setPayAllowOver] = useState(false);
  const [payOverReason, setPayOverReason] = useState('');
  const payNumeric = Number(payAmount || 0);
  const isOverpayment = payNumeric > 0 && payNumeric > remaining;
  const isOtherAccount = payAccount === 'other';
  const otherAccountFilled = payAccountOther.trim().length > 0;
  const accountInvalid = isOtherAccount && !otherAccountFilled;

  // Approve with exception dialog
  const [approveOpen, setApproveOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');

  // Settle without payment (zero-balance) dialog
  const [zeroOpen, setZeroOpen] = useState(false);
  const [zeroReason, setZeroReason] = useState('');

  // Close approved without full payment dialog
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');

  const payableZero = Number(s?.driver_payable_amount ?? 0) === 0;
  const balanceZero = Number(s?.payment_balance ?? remaining) === 0;
  const canSettleZero = s?.status === 'approved' && (payableZero || balanceZero);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');

  const allowedTransitions = (st: DriverSettlementStatus): DriverSettlementStatus[] => {
    switch (st) {
      case 'pending_review': return ['in_review'];
      case 'in_review': return ['approved'];
      case 'approved': return ['paid'];
      case 'paid': return ['closed', 'reopened'];
      case 'closed': return ['reopened'];
      case 'reopened': return ['in_review', 'approved'];
      default: return [];
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-4xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Acerto do Motorista
            {s && <Badge variant="outline">{SETTLEMENT_STATUS_LABEL[s.status as DriverSettlementStatus]}</Badge>}
            {s?.approved_with_exception && <Badge variant="outline" className="text-[10px]">Aprovado c/ exceção</Badge>}
            {needsRecalc && <Badge variant="destructive" className="text-[10px] flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Desatualizado</Badge>}
          </SheetTitle>
        </SheetHeader>

        {isLoading || !s ? (
          <div className="py-12 text-center text-muted-foreground">Carregando…</div>
        ) : (
          <div className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Resumo</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-muted-foreground text-xs">Motorista</div><div>{s.drivers?.name ?? '—'}</div></div>
                <div><div className="text-muted-foreground text-xs">Veículo</div><div>{s.vehicles?.plate ?? '—'}</div></div>
                <div><div className="text-muted-foreground text-xs">Início</div><div>{fmtDate(s.trip_started_at)}</div></div>
                <div><div className="text-muted-foreground text-xs">Fim</div><div>{fmtDate(s.trip_completed_at)}</div></div>
                <div><div className="text-muted-foreground text-xs">KM estimado</div><div>{fmtNum(s.estimated_km, 1)} km</div></div>
                <div><div className="text-muted-foreground text-xs">KM auditado</div><div>{s.audited_km != null ? `${fmtNum(s.audited_km, 1)} km` : '—'}</div></div>
                <div><div className="text-muted-foreground text-xs">KM Inicial / Final</div><div>{s.km_start != null ? fmtNum(s.km_start, 0) : '—'} / {s.km_end != null ? fmtNum(s.km_end, 0) : '—'}</div></div>
                <div><div className="text-muted-foreground text-xs">Peso total</div><div>{fmtNum(s.total_weight_kg, 0)} kg</div></div>
                <div><div className="text-muted-foreground text-xs">Romaneios / Notas</div><div>{s.loads_count} / {s.documents_count}</div></div>
                <div><div className="text-muted-foreground text-xs">Valor da mercadoria</div><div>{fmtMoney(s.total_goods_value ?? s.total_invoice_value)}</div></div>
                <div><div className="text-muted-foreground text-xs">Receita de frete</div><div className={noFreight ? 'text-destructive' : ''}>{fmtMoney(s.total_freight_revenue ?? s.total_freight_value)}</div></div>
                <div><div className="text-muted-foreground text-xs">Despesas aprovadas</div><div>{fmtMoney(s.approved_expenses_total)}</div></div>
                <div><div className="text-muted-foreground text-xs">Despesas pendentes</div><div>{fmtMoney(s.pending_expenses_total)}</div></div>
                <div><div className="text-muted-foreground text-xs">Resultado da rota</div><div className="font-semibold">{fmtMoney(s.route_result ?? s.operational_balance)}</div></div>
                <div><div className="text-muted-foreground text-xs">Créditos motorista</div><div>{fmtMoney(s.driver_credits_total)}</div></div>
                <div><div className="text-muted-foreground text-xs">Débitos motorista</div><div>{fmtMoney(s.driver_debits_total)}</div></div>
                <div><div className="text-muted-foreground text-xs">Reembolso (despesas)</div><div>{fmtMoney(s.driver_reimbursement_total)}</div></div>
                <div><div className="text-muted-foreground text-xs">A pagar motorista</div><div className="font-semibold">{fmtMoney(s.driver_payable_amount)}</div></div>
                <div><div className="text-muted-foreground text-xs">Já pago</div><div>{fmtMoney(s.total_paid_amount)}</div></div>
                <div><div className="text-muted-foreground text-xs">Saldo restante</div><div className="font-semibold">{fmtMoney(s.payment_balance ?? remaining)}</div></div>
              </CardContent>
            </Card>

            {needsRecalc && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4" /> Acerto desatualizado{s.recalculation_reason ? `: ${s.recalculation_reason}` : ''}. Recalcule antes de aprovar.
              </div>
            )}
            {noFreight && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <AlertCircle className="h-4 w-4" /> Receita de frete (CT-e) ausente. O resultado da rota pode estar subestimado.
              </div>
            )}
            {hasPendingExpenses && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertCircle className="h-4 w-4" /> Existem despesas pendentes. Elas não entram no resultado aprovado até serem aprovadas.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {!s.is_manual && (
                <Button size="sm" variant="outline" onClick={() => s.dispatch_trip_id && regen.mutate(s.dispatch_trip_id)} disabled={locked || regen.isPending || !s.dispatch_trip_id}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Recalcular
                </Button>
              )}
              {allowedTransitions(s.status as DriverSettlementStatus).map((next) => {
                if (next === 'paid') {
                  return (
                    <div key={next} className="flex gap-1">
                      <Button size="sm" onClick={() => setPayOpen(true)} disabled={updateStatus.isPending}>
                        Registrar pagamento
                      </Button>
                      {canSettleZero && (
                        <Button size="sm" variant="outline" onClick={() => setZeroOpen(true)} disabled={settleZero.isPending}>
                          Quitar sem pagamento
                        </Button>
                      )}
                    </div>
                  );
                }
                if (next === 'approved') {
                  return (
                    <div key={next} className="flex gap-1">
                      <Button size="sm" onClick={() => updateStatus.mutate({ id: s.id, status: next })} disabled={updateStatus.isPending}>
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setApproveOpen(true)}>
                        Aprovar c/ exceção
                      </Button>
                    </div>
                  );
                }
                if (next === 'closed' && s.status === 'approved') {
                  return (
                    <Button key={next} size="sm" variant="outline" onClick={() => setCloseOpen(true)} disabled={updateStatus.isPending}>
                      Fechar
                    </Button>
                  );
                }
                return (
                  <Button key={next} size="sm" onClick={() => updateStatus.mutate({ id: s.id, status: next })} disabled={updateStatus.isPending}>
                    {SETTLEMENT_STATUS_LABEL[next]}
                  </Button>
                );
              })}
              {!locked && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Excluir acerto
                </Button>
              )}
            </div>

            <Tabs defaultValue="loads">
              <TabsList>
                <TabsTrigger value="loads">Romaneios ({loadItems.length})</TabsTrigger>
                <TabsTrigger value="docs">Notas ({docItems.length})</TabsTrigger>
                <TabsTrigger value="expenses">Despesas ({expItems.length})</TabsTrigger>
                <TabsTrigger value="km">KM</TabsTrigger>
                <TabsTrigger value="adjustments">Ajustes ({adjItems.length})</TabsTrigger>
                <TabsTrigger value="payments">Pagamentos ({payments.length})</TabsTrigger>
                <TabsTrigger value="history">Histórico ({events.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="loads">
                {s.is_manual && !locked && (
                  <div className="flex justify-end mb-2">
                    <Button size="sm" variant="outline" onClick={() => setAttachOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" /> Adicionar romaneio
                    </Button>
                  </div>
                )}
                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Romaneio</TableHead><TableHead>Origem</TableHead><TableHead>Destino</TableHead><TableHead>Peso</TableHead><TableHead>Status</TableHead>{s.is_manual && !locked && <TableHead className="w-10" />}</TableRow></TableHeader>
                    <TableBody>
                      {loadItems.map(i => (
                        <TableRow key={i.id}>
                          <TableCell>{i.description}</TableCell>
                          <TableCell>{metadataText(i.metadata, 'origin')}</TableCell>
                          <TableCell>{metadataText(i.metadata, 'destination')}</TableCell>
                          <TableCell>{i.quantity ? `${fmtNum(i.quantity, 0)} kg` : '—'}</TableCell>
                          <TableCell><Badge variant="outline">{metadataText(i.metadata, 'status')}</Badge></TableCell>
                          {s.is_manual && !locked && (
                            <TableCell>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Remover romaneio"
                                disabled={detachLoad.isPending || !i.source_id}
                                onClick={async () => {
                                  if (i.source_id && await confirmAction('Remover este romaneio do acerto?', { title: 'Remover romaneio', confirmLabel: 'Remover' })) {
                                    detachLoad.mutate({ settlement_id: s.id, load_id: i.source_id });
                                  }
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                      {loadItems.length === 0 && <TableRow><TableCell colSpan={s.is_manual && !locked ? 6 : 5} className="text-center text-muted-foreground">Sem cargas vinculadas</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="docs">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Doc</TableHead><TableHead>Tipo</TableHead><TableHead>Destinatário</TableHead><TableHead>Cidade/UF</TableHead><TableHead>Valor</TableHead><TableHead>Peso</TableHead><TableHead>Frete</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {docItems.map(i => (
                        <TableRow key={i.id}>
                          <TableCell>{i.description}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px] uppercase">{metadataText(i.metadata, 'document_type', 'nfe')}</Badge></TableCell>
                          <TableCell>{metadataText(i.metadata, 'recipient')}</TableCell>
                          <TableCell>{[metadataText(i.metadata, 'recipient_city', ''), metadataText(i.metadata, 'recipient_state', '')].filter(Boolean).join('/') || '—'}</TableCell>
                          <TableCell>{fmtMoney(Number(i.amount))}</TableCell>
                          <TableCell>{i.quantity ? `${fmtNum(i.quantity, 0)} kg` : '—'}</TableCell>
                          <TableCell>{fmtMoney(metadataNumber(i.metadata, 'freight_value'))}</TableCell>
                        </TableRow>
                      ))}
                      {docItems.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Sem documentos</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="expenses">
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <Dialog open={expOpen} onOpenChange={setExpOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" disabled={locked}><Plus className="h-4 w-4 mr-1" /> Nova despesa</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader><DialogTitle>Adicionar despesa manual</DialogTitle></DialogHeader>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2">
                            <Label>Categoria / Descrição *</Label>
                            <Input value={expCategory} onChange={(e) => setExpCategory(e.target.value)} placeholder="Ex.: Refeição, Estacionamento, Manutenção" />
                          </div>
                          <div>
                            <Label>Valor *</Label>
                            <Input type="number" step="0.01" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
                          </div>
                          <div>
                            <Label>Data/Hora *</Label>
                            <Input type="datetime-local" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
                          </div>
                          <div>
                            <Label>Centro de Custo *</Label>
                            <Select value={expCostCenter} onValueChange={setExpCostCenter}>
                              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                              <SelectContent>
                                {costCenters?.map(cc => (
                                  <SelectItem key={cc} value={cc}>{cc}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Fonte do pagamento</Label>
                            <Select value={expPaymentSource} onValueChange={setExpPaymentSource}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="driver">Motorista</SelectItem>
                                <SelectItem value="company">Empresa</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center gap-2 pt-6">
                            <Label className="flex items-center gap-2">
                              <input type="checkbox" checked={expReimbursable} onChange={(e) => setExpReimbursable(e.target.checked)} className="rounded border-gray-300" />
                              Reembolsável?
                            </Label>
                          </div>
                          <div className="col-span-2">
                            <Label>URL do comprovante</Label>
                            <Input value={expReceipt} onChange={(e) => setExpReceipt(e.target.value)} placeholder="Link para imagem/PDF" />
                          </div>
                          <div className="col-span-2">
                            <Label>Observações</Label>
                            <Textarea value={expNotes} onChange={(e) => setExpNotes(e.target.value)} />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setExpOpen(false)}>Cancelar</Button>
                          <Button
                            disabled={!expCategory || !expAmount || !expCostCenter || addManualExp.isPending}
                            onClick={async () => {
                              await addManualExp.mutateAsync({
                                settlement_id: s.id,
                                category: expCategory,
                                amount: Number(expAmount),
                                expense_at: new Date(expDate).toISOString(),
                                cost_center: expCostCenter,
                                payment_source: expPaymentSource,
                                reimbursable: expReimbursable,
                                receipt_url: expReceipt || undefined,
                                notes: expNotes || undefined,
                              });
                              setExpOpen(false);
                              setExpCategory(''); setExpAmount(''); setExpReceipt(''); setExpNotes('');
                            }}
                          >Salvar</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader><TableRow><TableHead>Categoria</TableHead><TableHead>Valor</TableHead><TableHead>Data</TableHead><TableHead>Status</TableHead><TableHead>Reembolso</TableHead><TableHead>Fonte</TableHead><TableHead>Comprovante</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {expItems.map(i => {
                        const approvalStatus = metadataText(i.metadata, 'approval_status');
                        const receiptUrl = metadataText(i.metadata, 'receipt_url', '');
                        return (
                        <TableRow key={i.id}>
                          <TableCell>{i.description}</TableCell>
                          <TableCell>{fmtMoney(Number(i.amount))}</TableCell>
                          <TableCell>{fmtDate(metadataText(i.metadata, 'expense_at', ''))}</TableCell>
                          <TableCell><Badge variant={approvalStatus === 'approved' ? 'default' : approvalStatus === 'rejected' ? 'destructive' : 'secondary'}>{approvalStatus}</Badge></TableCell>
                          <TableCell>{metadataBoolean(i.metadata, 'reimbursable') === false ? <Badge variant="outline" className="text-[10px]">Não</Badge> : <Badge variant="secondary" className="text-[10px]">Sim</Badge>}</TableCell>
                          <TableCell className="text-xs">{metadataText(i.metadata, 'payment_source', 'driver')}</TableCell>
                          <TableCell>{receiptUrl ? <a className="text-primary inline-flex items-center gap-1" href={receiptUrl} target="_blank" rel="noreferrer"><FileText className="h-3 w-3" /> abrir</a> : '—'}</TableCell>
                        </TableRow>
                        );
                      })}
                      {expItems.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Sem despesas</TableCell></TableRow>}
                    </TableBody>
                    </Table>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="km" className="space-y-3">
                {kmDiff && Math.abs(kmDiff.pct) > 10 && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <AlertTriangle className="h-4 w-4" /> Diferença relevante entre KM estimado e auditado ({kmDiff.abs > 0 ? '+' : ''}{fmtNum(kmDiff.abs, 1)} km · {fmtNum(kmDiff.pct, 1)}%). Justificativa recomendada.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>KM estimado (mapa)</Label>
                    <Input value={s.estimated_km != null ? fmtNum(s.estimated_km, 1) : '—'} readOnly />
                  </div>
                  <div>
                    <Label>KM Inicial</Label>
                    <Input 
                      type="number" 
                      value={kmStart} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setKmStart(val);
                        if (kmEnd && val) {
                          setAuditedKm(String(Number(kmEnd) - Number(val)));
                        }
                      }} 
                      disabled={locked} 
                    />
                  </div>
                  <div>
                    <Label>KM Final</Label>
                    <Input 
                      type="number" 
                      value={kmEnd} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setKmEnd(val);
                        if (kmStart && val) {
                          setAuditedKm(String(Number(val) - Number(kmStart)));
                        }
                      }} 
                      disabled={locked} 
                    />
                  </div>
                  <div>
                    <Label>KM Percorrido (Auditoria)</Label>
                    <Input type="number" step="0.1" value={auditedKm} onChange={(e) => setAuditedKm(e.target.value)} disabled={locked} />
                  </div>
                  <div>
                    <Label>Destino Inicial (Auditoria)</Label>
                    <Input value={auditedStartLoc} onChange={(e) => setAuditedStartLoc(e.target.value)} disabled={locked} placeholder={s.route_origin || "Origem"} />
                  </div>
                  <div>
                    <Label>Destino Final (Auditoria)</Label>
                    <Input value={auditedEndLoc} onChange={(e) => setAuditedEndLoc(e.target.value)} disabled={locked} placeholder={s.route_destination || "Destino"} />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={kmStatus} onValueChange={value => setKmStatus(value as 'pending' | 'reviewed' | 'disputed')} disabled={locked}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pendente</SelectItem>
                        <SelectItem value="reviewed">Conferido</SelectItem>
                        <SelectItem value="disputed">Divergente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Observações</Label>
                  <Textarea value={kmNotes} onChange={(e) => setKmNotes(e.target.value)} disabled={locked} />
                </div>
                <Button
                  size="sm"
                  disabled={locked || updateKm.isPending}
                  onClick={() => updateKm.mutate({
                    id: s.id,
                    audited_km: auditedKm === '' ? null : Number(auditedKm),
                    km_status: kmStatus,
                    notes: kmNotes || null,
                    km_start: kmStart === '' ? null : Number(kmStart),
                    km_end: kmEnd === '' ? null : Number(kmEnd),
                    audited_start_location: auditedStartLoc || null,
                    audited_end_location: auditedEndLoc || null,
                  })}
                >
                  Salvar conferência de KM
                </Button>
              </TabsContent>

              <TabsContent value="adjustments" className="space-y-3">
                <div className="flex justify-end">
                  <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" disabled={locked}><Plus className="h-4 w-4 mr-1" /> Novo ajuste</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Adicionar ajuste manual</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <div>
                          <Label>Tipo</Label>
                          <Select value={adjNature} onValueChange={value => setAdjNature(value as 'credit' | 'debit')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="credit">Crédito (aumenta valor ao motorista)</SelectItem>
                              <SelectItem value="debit">Débito (reduz valor ao motorista)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Valor</Label>
                          <Input type="number" step="0.01" min="0" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
                        </div>
                        <div>
                          <Label>Descrição</Label>
                          <Input value={adjDesc} onChange={(e) => setAdjDesc(e.target.value)} placeholder="Ex.: adiantamento, diária, pedágio sem comprovante" />
                        </div>
                        <div>
                          <Label>Motivo *</Label>
                          <Textarea value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setAdjOpen(false)}>Cancelar</Button>
                        <Button
                          disabled={!adjAmount || !adjReason || addAdj.isPending}
                          onClick={async () => {
                            await addAdj.mutateAsync({ id: s.id, nature: adjNature, amount: Number(adjAmount), description: adjDesc, reason: adjReason });
                            setAdjOpen(false); setAdjAmount(''); setAdjDesc(''); setAdjReason('');
                          }}
                        >Salvar</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Descrição</TableHead><TableHead>Motivo</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Data</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {adjItems.map(i => (
                        <TableRow key={i.id}>
                          <TableCell><Badge variant={i.nature === 'credit' ? 'default' : 'destructive'}>{i.nature === 'credit' ? 'Crédito' : 'Débito'}</Badge></TableCell>
                          <TableCell>{i.description ?? '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{metadataText(i.metadata, 'reason')}</TableCell>
                          <TableCell className="text-right">{fmtMoney(Number(i.amount))}</TableCell>
                          <TableCell>{fmtDate(i.created_at)}</TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" disabled={locked || removeAdj.isPending}
                              onClick={async () => {
                                const reason = await promptAction('Informe por que este ajuste deve ser removido.', {
                                  title: 'Remover ajuste',
                                  label: 'Motivo da remoção',
                                });
                                if (reason) removeAdj.mutate({ settlement_id: s.id, item_id: i.id, reason });
                              }}><Trash2 className="h-4 w-4" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {adjItems.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem ajustes manuais</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="payments" className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><div className="text-muted-foreground text-xs">A pagar</div><div className="font-semibold">{fmtMoney(s.driver_payable_amount)}</div></div>
                  <div><div className="text-muted-foreground text-xs">Pago</div><div className="font-semibold">{fmtMoney(s.total_paid_amount)}</div></div>
                  <div><div className="text-muted-foreground text-xs">Saldo</div><div className="font-semibold">{fmtMoney(s.payment_balance ?? remaining)}</div></div>
                </div>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Método</TableHead><TableHead>Conta/origem</TableHead><TableHead>Referência</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Notas</TableHead><TableHead>Comprovante</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {payments.map(p => (
                        <TableRow key={p.id}>
                          <TableCell>{fmtDate(p.paid_at)}</TableCell>
                          <TableCell>{p.payment_method ?? '—'}</TableCell>
                          <TableCell className="text-xs">{p.payment_account ?? '—'}</TableCell>
                          <TableCell>{p.payment_reference ?? '—'}</TableCell>
                          <TableCell className="text-right">{fmtMoney(Number(p.amount))}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.notes ?? '—'}</TableCell>
                          <TableCell>{p.receipt_url ? <a className="text-primary text-xs" href={p.receipt_url} target="_blank" rel="noreferrer">abrir</a> : '—'}</TableCell>
                        </TableRow>
                      ))}
                      {payments.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhum pagamento registrado</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="history">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Evento</TableHead><TableHead>De</TableHead><TableHead>Para</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {events.map(ev => {
                        const paymentAccount = metadataText(ev.payload, 'payment_account', '');
                        const paymentMethod = metadataText(ev.payload, 'payment_method', '');
                        const paymentReference = metadataText(ev.payload, 'payment_reference', '');
                        const paymentAmount = metadataRecord(ev.payload).amount;
                        return (
                        <TableRow key={ev.id}>
                          <TableCell>{fmtDate(ev.created_at)}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{ev.event_type}</Badge></TableCell>
                          <TableCell>{ev.from_status ?? '—'}</TableCell>
                          <TableCell>{ev.to_status ?? '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {ev.event_type === 'payment_registered' ? (
                              <div className="space-y-0.5">
                                {paymentAccount && <div>Conta/origem: <span className="font-medium">{paymentAccount}</span></div>}
                                {paymentAmount != null && <div>Valor: {fmtMoney(Number(paymentAmount))}</div>}
                                {paymentMethod && <div>Método: {paymentMethod}</div>}
                                {paymentReference && <div>Ref.: {paymentReference}</div>}
                                {ev.reason && <div className="text-muted-foreground">Obs.: {ev.reason}</div>}
                              </div>
                            ) : (ev.reason ?? '—')}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                      {events.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem eventos</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>

            {/* Approve with exception */}
            <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>Aprovar com exceção</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">Informe a justificativa para aprovar mesmo com pendências. Requer perfil admin/owner.</p>
                <Textarea value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} placeholder="Motivo da aprovação com exceção" />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancelar</Button>
                  <Button disabled={!exceptionReason || updateStatus.isPending}
                    onClick={async () => {
                      await updateStatus.mutateAsync({ id: s.id, status: 'approved', reason: exceptionReason, allow_exceptions: true });
                      setApproveOpen(false); setExceptionReason('');
                    }}>Aprovar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Register payment */}
            <Dialog open={payOpen} onOpenChange={setPayOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>Registrar pagamento</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Valor pago * (saldo {fmtMoney(remaining)})</Label>
                    <Input type="number" step="0.01" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                  </div>
                  <div>
                    <Label>Método *</Label>
                    <Select value={payMethod} onValueChange={setPayMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pix">PIX</SelectItem>
                        <SelectItem value="ted">TED</SelectItem>
                        <SelectItem value="cash">Dinheiro</SelectItem>
                        <SelectItem value="other">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Conta/origem do pagamento</Label>
                    <Select value={payAccount} onValueChange={setPayAccount}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="caixa">Caixa</SelectItem>
                        <SelectItem value="banco">Banco</SelectItem>
                        <SelectItem value="pix">Pix</SelectItem>
                        <SelectItem value="conta_operacional">Conta operacional</SelectItem>
                        <SelectItem value="cartao_empresa">Cartão empresa</SelectItem>
                        <SelectItem value="other">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                    {isOtherAccount && (
                      <div className="mt-2 space-y-1">
                        <Label className="text-xs">Descreva a conta/origem *</Label>
                        <Input
                          value={payAccountOther}
                          onChange={(e) => setPayAccountOther(e.target.value)}
                          placeholder="Ex.: Banco Sicoob Eventos, Caixa físico filial 2"
                        />
                        {!otherAccountFilled && (
                          <p className="text-xs text-destructive">Informe a conta/origem do pagamento.</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>Vincular a conta bancária (Conciliação)</Label>
                    <Select value={payBankAccountId} onValueChange={setPayBankAccountId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Não vincular agora</SelectItem>
                        {bankAccounts?.map(ba => (
                          <SelectItem key={ba.id} value={ba.id}>{ba.name} ({ba.bank_name})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Centro de Custo</Label>
                    <Select value={payCostCenter} onValueChange={setPayCostCenter}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {costCenters?.map(cc => (
                          <SelectItem key={cc} value={cc}>{cc}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Referência / comprovante</Label>
                    <Input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="ID da transação" />
                  </div>
                  <div>
                    <Label>URL do comprovante</Label>
                    <Input value={payReceipt} onChange={(e) => setPayReceipt(e.target.value)} />
                  </div>
                  <div>
                    <Label>Observações</Label>
                    <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
                  </div>
                  {isOverpayment && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
                      <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Valor maior que o saldo restante ({fmtMoney(remaining)}).</div>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={payAllowOver} onChange={(e) => setPayAllowOver(e.target.checked)} />
                        Permitir sobrepagamento (requer admin/owner e justificativa)
                      </label>
                      {payAllowOver && (
                        <Textarea value={payOverReason} onChange={(e) => setPayOverReason(e.target.value)} placeholder="Justificativa do sobrepagamento" />
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
                  <Button disabled={!payAmount || !payMethod || accountInvalid || registerPay.isPending || (isOverpayment && (!payAllowOver || !payOverReason.trim()))}
                    onClick={async () => {
                      const accountLabelMap: Record<string, string> = {
                        caixa: 'Caixa', banco: 'Banco', pix: 'Pix',
                        conta_operacional: 'Conta operacional', cartao_empresa: 'Cartão empresa',
                      };
                      const accountValue = isOtherAccount
                        ? payAccountOther.trim()
                        : (accountLabelMap[payAccount] ?? payAccount);
                      await registerPay.mutateAsync({
                        id: s.id, amount: Number(payAmount), method: payMethod,
                        account: accountValue,
                        reference: payReference || null, receipt_url: payReceipt || null, notes: payNotes || null,
                        allow_overpayment: isOverpayment ? payAllowOver : false,
                        overpayment_reason: isOverpayment ? payOverReason : null,
                        bank_account_id: payBankAccountId === 'none' ? null : payBankAccountId,
                        cost_center: payCostCenter,
                      });
                      setPayOpen(false); setPayReference(''); setPayReceipt(''); setPayNotes(''); setPayAllowOver(false); setPayOverReason(''); setPayAccountOther('');
                      setPayBankAccountId('none');
                    }}>Registrar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Settle without payment (zero balance) */}
            <Dialog open={zeroOpen} onOpenChange={setZeroOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>Quitar sem pagamento</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">
                  Este acerto não possui saldo a pagar. Use esta ação apenas quando não há transferência financeira a ser feita ao motorista. A operação ficará registrada no histórico.
                </p>
                <div>
                  <Label>Motivo *</Label>
                  <Textarea value={zeroReason} onChange={(e) => setZeroReason(e.target.value)} placeholder="Ex.: acerto sem saldo a pagar, todas as despesas via cartão empresa" />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setZeroOpen(false)}>Cancelar</Button>
                  <Button disabled={!zeroReason.trim() || settleZero.isPending}
                    onClick={async () => {
                      await settleZero.mutateAsync({ id: s.id, reason: zeroReason.trim() });
                      setZeroOpen(false); setZeroReason('');
                    }}>Quitar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Close approved without full payment */}
            <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>Fechar acerto sem pagamento</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">
                  Este acerto ainda não foi marcado como pago. Fechar sem pagamento deve ser usado apenas para cancelamento, baixa administrativa ou exceção operacional. Informe o motivo.
                </p>
                <div>
                  <Label>Motivo *</Label>
                  <Textarea value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Justificativa do fechamento excepcional" />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCloseOpen(false)}>Cancelar</Button>
                  <Button disabled={!closeReason.trim() || updateStatus.isPending}
                    onClick={async () => {
                      await updateStatus.mutateAsync({ id: s.id, status: 'closed', reason: closeReason.trim() });
                      setCloseOpen(false); setCloseReason('');
                    }}>Fechar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" /> Excluir Acerto
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm">
                    Esta ação é **irreversível**. O acerto será removido permanentemente e os romaneios vinculados ficarão disponíveis para novos acertos.
                  </p>
                  <div className="space-y-2">
                    <Label>Confirme o motivo da exclusão *</Label>
                    <Textarea 
                      value={deleteReason} 
                      onChange={(e) => setDeleteReason(e.target.value)} 
                      placeholder="Ex.: Acerto gerado em duplicidade, erro nos valores base..."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
                  <Button 
                    variant="destructive"
                    disabled={!deleteReason.trim() || deleteSettlement.isPending}
                    onClick={async () => {
                      await deleteSettlement.mutateAsync({ id: s.id, reason: deleteReason.trim() });
                      setDeleteOpen(false);
                      onOpenChange(false);
                    }}
                  >
                    Confirmar Exclusão
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
        {s && s.is_manual && (
          <AttachLoadsDialog
            open={attachOpen}
            onOpenChange={setAttachOpen}
            settlementId={s.id}
            driverId={s.driver_id}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export default DriverSettlementDrawer;
