import { useEffect, useState } from 'react';
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
import { AlertCircle, RefreshCw, FileText } from 'lucide-react';
import { format } from 'date-fns';
import {
  useDriverSettlement, useRegenerateDriverSettlement, useUpdateDriverSettlementStatus,
  useUpdateSettlementKmReview, SETTLEMENT_STATUS_LABEL, isLocked, DriverSettlementStatus,
} from '@/hooks/useDriverSettlements';

const fmtMoney = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number | null | undefined, d = 2) => (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (v?: string | null) => (v ? format(new Date(v), 'dd/MM/yyyy HH:mm') : '—');

interface Props { settlementId: string | null; open: boolean; onOpenChange: (o: boolean) => void; }

export function DriverSettlementDrawer({ settlementId, open, onOpenChange }: Props) {
  const { data, isLoading } = useDriverSettlement(settlementId);
  const regen = useRegenerateDriverSettlement();
  const updateStatus = useUpdateDriverSettlementStatus();
  const updateKm = useUpdateSettlementKmReview();

  const s = data?.settlement;
  const items = data?.items ?? [];

  const [auditedKm, setAuditedKm] = useState<string>('');
  const [kmStatus, setKmStatus] = useState<'pending' | 'reviewed' | 'disputed'>('pending');
  const [kmNotes, setKmNotes] = useState('');

  useEffect(() => {
    if (s) {
      setAuditedKm(s.audited_km != null ? String(s.audited_km) : '');
      setKmStatus(s.km_review_status ?? 'pending');
      setKmNotes(s.km_review_notes ?? '');
    }
  }, [s?.id]);

  const loadItems = items.filter((i: any) => i.item_type === 'load');
  const docItems = items.filter((i: any) => i.item_type === 'fiscal_document');
  const expItems = items.filter((i: any) => i.item_type === 'expense');
  const hasPendingExpenses = (s?.pending_expenses_total ?? 0) > 0;
  const noFreight = (s?.total_freight_value ?? 0) === 0;
  const locked = s ? isLocked(s.status as DriverSettlementStatus) : false;

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
          </SheetTitle>
        </SheetHeader>

        {isLoading || !s ? (
          <div className="py-12 text-center text-muted-foreground">Carregando…</div>
        ) : (
          <div className="space-y-4 mt-4">
            {/* Resumo */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Resumo</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-muted-foreground text-xs">Motorista</div><div>{(s as any).drivers?.name ?? '—'}</div></div>
                <div><div className="text-muted-foreground text-xs">Veículo</div><div>{(s as any).vehicles?.plate ?? '—'}</div></div>
                <div><div className="text-muted-foreground text-xs">Início</div><div>{fmtDate(s.trip_started_at)}</div></div>
                <div><div className="text-muted-foreground text-xs">Fim</div><div>{fmtDate(s.trip_completed_at)}</div></div>
                <div><div className="text-muted-foreground text-xs">KM estimado</div><div>{fmtNum(s.estimated_km, 1)} km</div></div>
                <div><div className="text-muted-foreground text-xs">KM auditado</div><div>{s.audited_km != null ? `${fmtNum(s.audited_km, 1)} km` : '—'}</div></div>
                <div><div className="text-muted-foreground text-xs">Peso total</div><div>{fmtNum(s.total_weight_kg, 0)} kg</div></div>
                <div><div className="text-muted-foreground text-xs">Romaneios / Notas</div><div>{s.loads_count} / {s.documents_count}</div></div>
                <div><div className="text-muted-foreground text-xs">Valor de notas</div><div>{fmtMoney(s.total_invoice_value)}</div></div>
                <div><div className="text-muted-foreground text-xs">Frete (CT-e)</div><div className={noFreight ? 'text-destructive' : ''}>{fmtMoney(s.total_freight_value)}</div></div>
                <div><div className="text-muted-foreground text-xs">Despesas aprovadas</div><div>{fmtMoney(s.approved_expenses_total)}</div></div>
                <div><div className="text-muted-foreground text-xs">Despesas pendentes</div><div>{fmtMoney(s.pending_expenses_total)}</div></div>
                <div className="col-span-2"><div className="text-muted-foreground text-xs">Balanço (valor de notas)</div><div className="font-semibold">{fmtMoney(s.invoice_balance)}</div></div>
                <div className="col-span-2"><div className="text-muted-foreground text-xs">Resultado operacional</div><div className="font-semibold">{fmtMoney(s.operational_balance)}</div></div>
              </CardContent>
            </Card>

            {noFreight && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <AlertCircle className="h-4 w-4" /> Frete (CT-e) ausente. O resultado operacional pode estar subestimado.
              </div>
            )}
            {hasPendingExpenses && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertCircle className="h-4 w-4" /> Existem despesas pendentes. Elas não entram no resultado aprovado até serem aprovadas.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => regen.mutate(s.dispatch_trip_id)} disabled={locked || regen.isPending}>
                <RefreshCw className="h-4 w-4 mr-1" /> Recalcular
              </Button>
              {allowedTransitions(s.status as DriverSettlementStatus).map((next) => (
                <Button key={next} size="sm" onClick={() => updateStatus.mutate({ id: s.id, status: next })} disabled={updateStatus.isPending}>
                  {SETTLEMENT_STATUS_LABEL[next]}
                </Button>
              ))}
            </div>

            <Tabs defaultValue="loads">
              <TabsList>
                <TabsTrigger value="loads">Romaneios ({loadItems.length})</TabsTrigger>
                <TabsTrigger value="docs">Notas ({docItems.length})</TabsTrigger>
                <TabsTrigger value="expenses">Despesas ({expItems.length})</TabsTrigger>
                <TabsTrigger value="km">Conferência de KM</TabsTrigger>
              </TabsList>

              <TabsContent value="loads">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Romaneio</TableHead><TableHead>Origem</TableHead><TableHead>Destino</TableHead><TableHead>Peso</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {loadItems.map((i: any) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.description}</TableCell>
                          <TableCell>{i.metadata?.origin ?? '—'}</TableCell>
                          <TableCell>{i.metadata?.destination ?? '—'}</TableCell>
                          <TableCell>{i.quantity ? `${fmtNum(i.quantity, 0)} kg` : '—'}</TableCell>
                          <TableCell><Badge variant="outline">{i.metadata?.status ?? '—'}</Badge></TableCell>
                        </TableRow>
                      ))}
                      {loadItems.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem cargas vinculadas</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="docs">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>NF</TableHead><TableHead>Destinatário</TableHead><TableHead>Cidade/UF</TableHead><TableHead>Valor</TableHead><TableHead>Peso</TableHead><TableHead>Frete</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {docItems.map((i: any) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.description}</TableCell>
                          <TableCell>{i.metadata?.recipient ?? '—'}</TableCell>
                          <TableCell>{[i.metadata?.recipient_city, i.metadata?.recipient_state].filter(Boolean).join('/') || '—'}</TableCell>
                          <TableCell>{fmtMoney(Number(i.amount))}</TableCell>
                          <TableCell>{i.quantity ? `${fmtNum(i.quantity, 0)} kg` : '—'}</TableCell>
                          <TableCell>{fmtMoney(Number(i.metadata?.freight_value ?? 0))}</TableCell>
                        </TableRow>
                      ))}
                      {docItems.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem documentos</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="expenses">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Categoria</TableHead><TableHead>Valor</TableHead><TableHead>Data</TableHead><TableHead>Status</TableHead><TableHead>Comprovante</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {expItems.map((i: any) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.description}</TableCell>
                          <TableCell>{fmtMoney(Number(i.amount))}</TableCell>
                          <TableCell>{fmtDate(i.metadata?.expense_at)}</TableCell>
                          <TableCell><Badge variant={i.metadata?.approval_status === 'approved' ? 'default' : i.metadata?.approval_status === 'rejected' ? 'destructive' : 'secondary'}>{i.metadata?.approval_status ?? '—'}</Badge></TableCell>
                          <TableCell>{i.metadata?.receipt_url ? <a className="text-primary inline-flex items-center gap-1" href={i.metadata.receipt_url} target="_blank" rel="noreferrer"><FileText className="h-3 w-3" /> abrir</a> : '—'}</TableCell>
                        </TableRow>
                      ))}
                      {expItems.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem despesas</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="km" className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>KM estimado (mapa)</Label>
                    <Input value={s.estimated_km != null ? fmtNum(s.estimated_km, 1) : '—'} readOnly />
                  </div>
                  <div>
                    <Label>KM auditado</Label>
                    <Input type="number" step="0.1" value={auditedKm} onChange={(e) => setAuditedKm(e.target.value)} disabled={locked} />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={kmStatus} onValueChange={(v: any) => setKmStatus(v)} disabled={locked}>
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
                  })}
                >
                  Salvar conferência de KM
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default DriverSettlementDrawer;