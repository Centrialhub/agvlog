import { useMemo, useState } from 'react';
import { matchesSearch } from '@/lib/listFilters';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Lock, RefreshCw } from 'lucide-react';
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

type PeriodEntriesProps = { period: PayrollPeriod; onOpenEntry: (entry: PayrollEntry) => void };
export function PeriodEntries(props: PeriodEntriesProps) {
  return <PeriodEntriesContent key={`${props.period.tenant_id}:${props.period.id}`} {...props} />;
}
function PeriodEntriesContent({ period, onOpenEntry }: PeriodEntriesProps) {
  const { confirmAction, promptAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { data: entries = [], isLoading, error } = usePayrollEntries(period.id);
  const approve = useApprovePayrollPeriod();
  const close = useClosePayrollPeriod();
  const gen = useGeneratePayrollPeriod();
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => entries.filter(entry =>
    matchesSearch(search, entry.employees?.name, entry.employee_id, entry.employees?.department, entry.employees?.branch)
    && (paymentFilter === 'all' || entry.payment_summary?.status === paymentFilter)
  ), [entries, search, paymentFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pageCount);
  const visibleEntries = filtered.slice((currentPage - 1) * 50, currentPage * 50);

  const totals = useMemo(() => entries.reduce((acc, entry) => ({
    gross: acc.gross + Number(entry.gross_amount || 0),
    disc: acc.disc + Number(entry.discount_amount || 0),
    paid: acc.paid + Number(entry.already_paid_amount || 0),
    titlePaid: acc.titlePaid + Number(entry.payment_summary?.paid_via_titles || 0),
    toPay: acc.toPay + Number(entry.payment_summary?.remaining_amount ?? entry.amount_to_pay),
  }), { gross: 0, disc: 0, paid: 0, titlePaid: 0, toPay: 0 }), [entries]);

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
      required: false,
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

  if (error) return <p role="alert" className="text-destructive">Não foi possível conferir os pagamentos da folha. {getErrorMessage(error, 'Tente novamente.')}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Pagamentos registrados nos títulos. A confirmação pelo extrato bancário é uma conferência separada.</p>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Funcionários</p><p className="text-lg font-bold">{entries.length}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Bruto</p><p className="text-lg font-bold">{formatPayrollCurrency(totals.gross)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Descontos</p><p className="text-lg font-bold text-red-600">{formatPayrollCurrency(totals.disc)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Pago antes da folha</p><p className="text-lg font-bold">{formatPayrollCurrency(totals.paid)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Pago pelos títulos</p><p className="text-lg font-bold">{formatPayrollCurrency(totals.titlePaid)}</p></CardContent></Card>
        <Card className="border-primary/50"><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Saldo a pagar</p><p className="text-lg font-bold text-primary">{formatPayrollCurrency(totals.toPay)}</p></CardContent></Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-sm font-medium">{period.period_name}</span><PayrollStatusBadge status={period.status} /></div>
        <div className="flex gap-2">
          {!locked && <Button size="sm" variant="outline" onClick={handleRegen} disabled={gen.isPending}><RefreshCw className="h-4 w-4 mr-1" /> Recalcular</Button>}
          {!locked && <Button size="sm" onClick={handleApprove} disabled={approve.isPending || entries.length === 0}><CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar</Button>}
          {period.status === 'approved' && <Button size="sm" variant="secondary" onClick={handleClose} disabled={close.isPending}><Lock className="h-4 w-4 mr-1" /> Fechar</Button>}
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
            <TableHead className="text-right">Pago antes da folha</TableHead><TableHead className="text-right">Pago pelos títulos</TableHead>
            <TableHead className="text-right">A pagar</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
              : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">{entries.length ? 'Nenhum funcionário corresponde aos filtros' : 'Sem entradas'}</TableCell></TableRow>
                : visibleEntries.map(entry => (
                  <TableRow key={entry.id} className="hover:bg-muted/50">
                    <TableCell className="text-sm font-medium"><button type="button" className="text-left underline underline-offset-2" onClick={() => onOpenEntry(entry)}>{entry.employees?.name ?? entry.employee_id.slice(0, 8)}</button></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{entry.entry_type === 'driver' ? 'Motorista' : 'Funcionário'}</Badge></TableCell>
                    <TableCell className="text-right text-sm">{formatPayrollCurrency(Number(entry.gross_amount))}</TableCell>
                    <TableCell className="text-right text-sm text-red-600">{formatPayrollCurrency(Number(entry.discount_amount))}</TableCell>
                    <TableCell className="text-right text-sm">{formatPayrollCurrency(Number(entry.already_paid_amount))}</TableCell>
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
        <p role="status">{filtered.length} de {entries.length} funcionários · Página {currentPage} de {pageCount}</p>
        <Button variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Página anterior</Button>
        <Button variant="outline" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Próxima página</Button>
      </nav>}
    </div>
  );
}
