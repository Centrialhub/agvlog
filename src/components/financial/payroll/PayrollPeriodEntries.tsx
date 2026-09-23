import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Lock, RefreshCw, XCircle } from 'lucide-react';
import { useScopedAlerts } from '@/hooks/useAlertStore';
import {
  PAYROLL_PERIOD_STATUS_LABELS,
  type PayrollEntry,
  type PayrollPeriod,
  type PayrollPeriodStatus,
  useApprovePayrollPeriod,
  useClosePayrollPeriod,
  useGeneratePayrollPeriod,
  usePayrollEntries,
  usePayrollGenerationIssues,
  useChangePayrollPeriodState,
} from '@/hooks/usePayroll';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PayrollStatusBadge } from '@/components/financial/PayrollStatusBadge';
import { payrollPaymentIssues, payrollPaymentLabels } from '@/lib/financial/payrollPaymentContract';
import { getErrorMessage } from '@/lib/errors';
import { formatPayrollCurrency } from './formatPayrollCurrency';
import { payrollCarryoverInAmount } from '@/lib/financial/payrollCarryoverPresentation';
import { PendingCommandRecovery } from '@/components/operator/PendingCommandRecovery';

type PeriodEntriesProps = { period: PayrollPeriod; onOpenEntry: (entry: PayrollEntry) => void };
export function PeriodEntries(props: PeriodEntriesProps) {
  return <PeriodEntriesContent key={`${props.period.tenant_id}:${props.period.id}`} {...props} />;
}
function PeriodEntriesContent({ period, onOpenEntry }: PeriodEntriesProps) {
  const { confirmAction, promptAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, error } = usePayrollEntries(period.id,page,search,paymentFilter);
  const entries=data?.rows??[];
  const approve = useApprovePayrollPeriod();
  const close = useClosePayrollPeriod();
  const gen = useGeneratePayrollPeriod();
  const issues=usePayrollGenerationIssues(period.id);const lifecycle=useChangePayrollPeriodState();
  const pendingLifecycle=lifecycle.getPendingCommand?.(period.id);
  const pageCount=Math.max(1,Math.ceil((data?.filtered_total??0)/50));
  useEffect(()=>{if(data&&page>pageCount)setPage(pageCount);},[data,page,pageCount]);
  const totals={gross:Number(data?.totals.gross??0),disc:Number(data?.totals.discount??0),paid:Number(data?.totals.already_paid??0),
    carryoverIn:Number(data?.totals.carryover_in??0),carryoverOut:Number(data?.totals.carryover_out??0),
    titlePaid:Number(data?.totals.title_paid??0),toPay:Number(data?.totals.remaining??0)};

  const locked = period.status === 'approved' || period.status === 'closed' || period.status === 'cancelled';

  const handleApprove = async () => {
    if (!await confirmAction(
      'Aprovar folha? Itens serão travados e contas a pagar serão geradas para os saldos.',
      { title: 'Aprovar folha', confirmLabel: 'Aprovar' },
    )) return;
    try { await approve.mutateAsync(period.id); toast.success('Folha aprovada'); }
    catch (mutationError) { toast.error(getErrorMessage(mutationError, 'Não foi possível aprovar a folha.')); }
  };

  const handleClose = async () => {
    const reason = await promptAction('Informe o motivo do fechamento da folha.', {
      title: 'Fechar folha',
      label: 'Motivo do fechamento',
      required: true,
    }) ?? undefined;
    if (reason === undefined) return;
    try { await close.mutateAsync({ period_id: period.id, reason }); toast.success('Folha fechada'); }
    catch (mutationError) { toast.error(getErrorMessage(mutationError, 'Não foi possível fechar a folha.')); }
  };

  const handleRegen = async () => {
    try {
      await gen.mutateAsync({
        period_start: period.period_start,
        period_end: period.period_end,
        period_name: period.period_name,
        include_drivers: period.include_drivers,
        include_non_drivers: period.include_non_drivers,
      });
      toast.success('Folha recalculada');
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError, 'Não foi possível recalcular a folha.'));
    }
  };
  const changeState=async(action:'cancel'|'reopen')=>{const reason=await promptAction(`Informe o motivo para ${action==='cancel'?'cancelar':'reabrir'} a folha.`,{title:action==='cancel'?'Cancelar folha':'Reabrir folha',label:'Motivo',required:true});if(!reason)return;try{await lifecycle.mutateAsync({periodId:period.id,action,reason});toast.success(action==='cancel'?'Folha cancelada':'Folha reaberta para recálculo');}catch(e){toast.error(getErrorMessage(e,'Não foi possível alterar a folha.'));}};

  if (error) return <p role="alert" className="text-destructive">Não foi possível conferir os pagamentos da folha. {getErrorMessage(error, 'Tente novamente.')}</p>;
  if (isLoading || isFetching) return <p role="status">Conferindo valores e pagamentos da folha… Aguarde a consulta para aprovar, recalcular ou fechar.</p>;
  return (
    <div className="space-y-3">
      {pendingLifecycle && <PendingCommandRecovery subject="uma alteração deste período" onRecover={()=>lifecycle.recoverPending(period.id)} onDiscard={()=>lifecycle.discardPending(period.id)} />}
      <p className="text-sm text-muted-foreground">Pagamentos registrados nos títulos. A confirmação pelo extrato bancário é uma conferência separada.</p>
      {(issues.isPending||issues.isFetching)&&<p role="status">Conferindo pendências da geração…</p>}
      {issues.isError&&<p role="alert">Não foi possível conferir as pendências. A aprovação permanece bloqueada. <Button type="button" variant="outline" onClick={()=>void issues.refetch()}>Tentar novamente</Button></p>}
      {issues.data?.length?<section role="alert" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm"><strong>Pendências da geração ({issues.data.length})</strong>{issues.data.map(issue=><p key={issue.id}>{issue.message}</p>)}<p>Resolva e recalcule antes de aprovar.</p></section>:null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Funcionários</p><p className="text-lg font-bold">{data?.total??0}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Bruto</p><p className="text-lg font-bold">{formatPayrollCurrency(totals.gross)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Descontos</p><p className="text-lg font-bold text-red-600">{formatPayrollCurrency(totals.disc)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Pago antes da folha</p><p className="text-lg font-bold">{formatPayrollCurrency(totals.paid)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Saldo anterior</p><p className="text-lg font-bold text-blue-700">{formatPayrollCurrency(totals.carryoverIn)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">A transportar</p><p className="text-lg font-bold text-amber-700">{formatPayrollCurrency(totals.carryoverOut)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Pago pelos títulos</p><p className="text-lg font-bold">{formatPayrollCurrency(totals.titlePaid)}</p></CardContent></Card>
        <Card className="border-primary/50"><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Saldo a pagar</p><p className="text-lg font-bold text-primary">{formatPayrollCurrency(totals.toPay)}</p></CardContent></Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-sm font-medium">{period.period_name}</span><PayrollStatusBadge status={period.status} /></div>
        <div className="flex gap-2">
          {!locked && <Button size="sm" variant="outline" onClick={handleRegen} disabled={gen.isPending}><RefreshCw className="h-4 w-4 mr-1" /> Recalcular</Button>}
          {!locked && <Button size="sm" onClick={handleApprove} disabled={approve.isPending || !data?.total || issues.isPending || issues.isFetching || issues.isError || !!issues.data?.length}><CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar</Button>}
          {period.status === 'approved' && <Button size="sm" variant="secondary" onClick={handleClose} disabled={close.isPending}><Lock className="h-4 w-4 mr-1" /> Fechar</Button>}
          {['draft','calculated','under_review','approved'].includes(period.status)&&<Button size="sm" variant="destructive" onClick={()=>void changeState('cancel')} disabled={lifecycle.isPending}><XCircle className="h-4 w-4 mr-1"/>Cancelar</Button>}
          {period.status==='cancelled'&&<Button size="sm" variant="outline" onClick={()=>void changeState('reopen')} disabled={lifecycle.isPending}><RefreshCw className="h-4 w-4 mr-1"/>Reabrir</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Buscar na folha<Input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Nome, identificação, departamento ou filial" /></label>
        <label className="text-sm">Situação do pagamento<select className="block rounded border p-2" value={paymentFilter} onChange={event => { setPaymentFilter(event.target.value); setPage(1); }}><option value="all">Todos</option>{Object.entries(payrollPaymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <Button variant="outline" onClick={() => { setSearch(''); setPaymentFilter('all'); setPage(1); }}>Limpar busca e filtros</Button>
      </div>
      <p className="text-sm text-muted-foreground">Os totais e as ações de aprovação e fechamento abrangem a folha inteira. A busca e os filtros alteram apenas a lista abaixo.</p>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Funcionário</TableHead><TableHead>Tipo</TableHead>
            <TableHead className="text-right">Bruto</TableHead><TableHead className="text-right">Descontos</TableHead>
            <TableHead className="text-right">Pago antes da folha</TableHead><TableHead className="text-right">Saldo anterior</TableHead><TableHead className="text-right">A transportar</TableHead><TableHead className="text-right">Pago pelos títulos</TableHead>
            <TableHead className="text-right">A pagar</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={10} className="text-center py-8 text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
              : entries.length === 0 ? <TableRow><TableCell colSpan={10} className="text-center py-8 text-sm text-muted-foreground">{data?.total ? 'Nenhum funcionário corresponde aos filtros' : 'Sem entradas'}</TableCell></TableRow>
                : entries.map(entry => (
                  <TableRow key={entry.id} className="hover:bg-muted/50">
                    <TableCell className="text-sm font-medium"><button type="button" className="text-left underline underline-offset-2" onClick={() => onOpenEntry(entry)}>{entry.employees?.name ?? entry.employee_id.slice(0, 8)}</button></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{entry.entry_type === 'driver' ? 'Motorista' : 'Funcionário'}</Badge></TableCell>
                    <TableCell className="text-right text-sm">{formatPayrollCurrency(Number(entry.gross_amount))}</TableCell>
                    <TableCell className="text-right text-sm text-red-600">{formatPayrollCurrency(Number(entry.discount_amount))}</TableCell>
                    <TableCell className="text-right text-sm">{formatPayrollCurrency(Number(entry.already_paid_amount))}</TableCell>
                    <TableCell className="text-right text-sm text-blue-700">{formatPayrollCurrency(payrollCarryoverInAmount(entry))}</TableCell>
                    <TableCell className="text-right text-sm text-amber-700">{formatPayrollCurrency(Number(entry.carryover_amount || 0))}</TableCell>
                    <TableCell className="text-right text-sm">{formatPayrollCurrency(Number(entry.payment_summary?.paid_via_titles ?? 0))}</TableCell>
                    <TableCell className="text-right text-sm font-bold">{formatPayrollCurrency(Number(entry.payment_summary?.remaining_amount ?? entry.amount_to_pay))}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{PAYROLL_PERIOD_STATUS_LABELS[entry.status as PayrollPeriodStatus] ?? entry.status}</Badge>
                      {entry.payment_summary && <><Badge variant={entry.payment_summary.issues.length ? 'destructive' : 'outline'}>{payrollPaymentLabels[entry.payment_summary.status]}</Badge>{entry.payment_summary.issues.map(issue => <p key={issue} className="text-xs text-destructive">{payrollPaymentIssues[issue] ?? issue}</p>)}</>}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </CardContent></Card>
      {!isLoading && <nav aria-label="Páginas dos funcionários da folha" className="flex flex-wrap items-center gap-3">
        <p role="status">{data?.filtered_total??0} de {data?.total??0} funcionários · Página {page} de {pageCount}</p>
        <Button variant="outline" disabled={page === 1} onClick={() => setPage(value=>value-1)}>Página anterior</Button>
        <Button variant="outline" disabled={!data?.has_more} onClick={() => setPage(value=>value+1)}>Próxima página</Button>
      </nav>}
    </div>
  );
}
