import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Landmark, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useBankAccounts, useCreateBankAccount, useBankTransactions, useFinancialObligations,
  useLegacyReconciliationSummary,
  type BankAccountType,
  type LegacyObligationCursor, type LegacyTransactionCursor,
} from '@/hooks/useBankReconciliation';
import {ReconciliationStatementImport} from '@/components/financial/ReconciliationStatementImport';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import {ReconciliationMovementEntry} from '@/components/financial/ReconciliationMovementEntry';
import { getErrorMessage } from '@/lib/errors';
import FinanceStatements from './FinanceStatements';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useFinanceAccess} from '@/hooks/useFinanceLedger';
import { fmtDateSafe, localDateInputValue } from '@/lib/utils/formatDate';


const OBLIGATION_TYPE_LABEL: Record<string, string> = {
  receivable: 'Recebível',
  payable: 'Conta a pagar',
  driver_settlement_payment: 'Acerto motorista',
  driver_expense: 'Despesa motorista',
  maintenance: 'Manutenção',
  fuel: 'Combustível',
  manual_adjustment: 'Ajuste manual',
  other: 'Outro',
};

const STATUS_LABEL: Record<string, string> = {
  unmatched: 'Sem match', suggested: 'Sugerido', matched: 'Conciliado',
  ignored: 'Ignorado', manual_review: 'Revisão manual',
  pending: 'Pendente', partially_paid: 'Parcial', paid: 'Pago',
  cancelled: 'Cancelado', written_off: 'Baixado',
  partial: 'Parcial',
};

function todayIso(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDateInputValue(d);
}

function fmt(n: number | null | undefined) {
  return (Number(n || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function legacyPeriodError(start: string, end: string): string {
  const startAt = Date.parse(`${start}T00:00:00Z`), endAt = Date.parse(`${end}T00:00:00Z`);
  if (!start || !end || !Number.isFinite(startAt) || !Number.isFinite(endAt)) return 'Informe datas válidas para consultar o histórico.';
  if (startAt > endAt) return 'A data inicial não pode ser posterior à data final.';
  if ((endAt - startAt) / 86400000 > 3660) return 'O período do histórico não pode ultrapassar 3.660 dias.';
  return '';
}

function fmtCents(n: string) {
  return (Number(n) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function BankReconciliation() {
  const {currentTenant,currentRole}=useTenant(),{user}=useAuth(),access=useFinanceAccess();
  if(!currentTenant||!user)return <p>Entre e selecione a empresa.</p>;
  if(!['owner','admin','operator'].includes(currentRole||''))return <p role="alert">Acesso financeiro não permitido.</p>;
  if(access.isPending)return <p role="status">Verificando acesso…</p>;
  if(access.error)return <p role="alert">Não foi possível verificar o acesso. <Button onClick={()=>void access.refetch()}>Tentar novamente</Button></p>;
  if(!access.data)return <p role="alert">Acesso financeiro não permitido.</p>;
  return <ReconciliationWorkspace key={`${currentTenant.id}:${user.id}`}/>;
}

function ReconciliationWorkspace(){
  const [section,setSection]=useState('statements');
  return <div className="min-w-0 space-y-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h1 className="text-2xl font-semibold">Conciliação bancária</h1><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><ReconciliationMovementEntry/><NewBankAccountDialog/></div></div>
    <Tabs value={section} onValueChange={setSection}><div className="-m-1 overflow-x-auto p-1"><TabsList className="h-auto min-w-max"><TabsTrigger value="statements">Extratos e conciliação</TabsTrigger><TabsTrigger value="legacy">Histórico anterior</TabsTrigger></TabsList></div>
      <TabsContent value="statements">{section==='statements'&&<FinanceStatements/>}</TabsContent>
      <TabsContent value="legacy">{section==='legacy'&&<LegacyBankReconciliation/>}</TabsContent>
    </Tabs>
  </div>;
}

function LegacyBankReconciliation() {
  const accountsQuery = useBankAccounts();
  const accounts = accountsQuery.data ?? [];
  const [accountId, setAccountId] = useState<string>('');
  const [periodStart, setPeriodStart] = useState(todayIso(-30));
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [legacySection, setLegacySection] = useState('extrato');

  const effectiveAccount = accountId || accounts[0]?.id || '';
  const periodError = legacyPeriodError(periodStart, periodEnd);
  const summaryQuery = useLegacyReconciliationSummary(periodError ? null : effectiveAccount, periodStart, periodEnd);

  if (accountsQuery.isPending) return <p role="status" className="rounded border p-4">Carregando contas bancárias…</p>;
  if (accountsQuery.isError) return <div role="alert" className="space-y-2 rounded border border-destructive p-4"><p>Não foi possível carregar as contas bancárias: {getErrorMessage(accountsQuery.error)}</p><Button variant="outline" onClick={() => void accountsQuery.refetch()}>Tentar novamente</Button></div>;
  if (accounts.length === 0) return <p role="status" className="rounded border p-4">Nenhuma conta bancária cadastrada. Use “Nova conta” para começar.</p>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" /> Histórico anterior</h1>
          <p className="text-sm text-muted-foreground">Consulta dos registros anteriores. Os status antigos não certificam a conciliação com os extratos preservados.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">

          <ReconciliationMovementEntry account={effectiveAccount} />
          {!periodError && <ReconciliationStatementImport account={effectiveAccount} start={periodStart} end={periodEnd} />}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Conta bancária</Label>
            <Select value={effectiveAccount} onValueChange={setAccountId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
              <SelectContent>
                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}{a.bank_name ? ` — ${a.bank_name}` : ''}</SelectItem>)}
                {accounts.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Cadastre uma conta primeiro</div>}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Início</Label>
            <Input aria-label="Início" type="date" max={periodEnd || undefined} className="h-9" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Fim</Label>
            <Input aria-label="Fim" type="date" min={periodStart || undefined} className="h-9" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {periodError && <p role="alert" className="rounded border border-destructive p-4 text-destructive">{periodError}</p>}
      {!periodError && summaryQuery.isPending && <p role="status" className="rounded border p-4">Calculando os totais exatos do histórico…</p>}
      {!periodError && summaryQuery.isError && <div role="alert" className="space-y-2 rounded border border-destructive p-4"><p>Não foi possível calcular o histórico: {getErrorMessage(summaryQuery.error)}</p><Button variant="outline" onClick={() => void summaryQuery.refetch()}>Tentar novamente</Button></div>}
      {!periodError && summaryQuery.data && <>
        <p className="text-sm text-muted-foreground">Totais exatos para a conta e o período selecionados. As tabelas usam paginação por cursor e não certificam os status antigos.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <KpiCard label="Entradas" value={fmtCents(summaryQuery.data.inflow_cents)} />
          <KpiCard label="Saídas" value={fmtCents(summaryQuery.data.outflow_cents)} />
          <KpiCard label="Status antigo: conciliado" value={String(summaryQuery.data.matched_count)} />
          <KpiCard label="Pendentes" value={String(summaryQuery.data.pending_count)} />
          <KpiCard label="Sugestões" value={String(summaryQuery.data.suggestion_count)} />
          <KpiCard label="Sem origem" value={String(summaryQuery.data.unmatched_transaction_count)} />
          <KpiCard label="Títulos sem banco" value={String(summaryQuery.data.unmatched_obligation_count)} />
        </div>

      <Tabs value={legacySection} onValueChange={setLegacySection}>
        <div className="-m-1 overflow-x-auto p-1"><TabsList className="h-auto min-w-max">
          <TabsTrigger value="extrato">Extrato</TabsTrigger>
          <TabsTrigger value="titulos">Títulos do sistema</TabsTrigger>
          <TabsTrigger value="divergencias">Divergências</TabsTrigger>
          <TabsTrigger value="motoristas">Motoristas</TabsTrigger>
        </TabsList></div>

        <TabsContent value="extrato">
          {legacySection === 'extrato' && <ExtratoTab key={`${effectiveAccount}:${periodStart}:${periodEnd}`} account={effectiveAccount} start={periodStart} end={periodEnd} total={summaryQuery.data.transaction_count} />}
        </TabsContent>
        <TabsContent value="titulos">
          {legacySection === 'titulos' && <TitulosTab key={`${effectiveAccount}:${periodStart}:${periodEnd}`} account={effectiveAccount} start={periodStart} end={periodEnd} total={summaryQuery.data.obligation_count} />}
        </TabsContent>
        <TabsContent value="divergencias">
          {legacySection === 'divergencias' && <DivergenciasTab key={`${effectiveAccount}:${periodStart}:${periodEnd}`} account={effectiveAccount} start={periodStart} end={periodEnd} transactionTotal={summaryQuery.data.unmatched_transaction_count} obligationTotal={summaryQuery.data.unmatched_obligation_count} />}
        </TabsContent>
        <TabsContent value="motoristas">
          {legacySection === 'motoristas' && <MotoristasTab key={`${effectiveAccount}:${periodStart}:${periodEnd}`} account={effectiveAccount} start={periodStart} end={periodEnd} settlementCount={summaryQuery.data.driver_settlement_count} expenseCount={summaryQuery.data.driver_expense_count} pendingCents={summaryQuery.data.driver_pending_cents} />}
        </TabsContent>
      </Tabs>
      </>}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="pt-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </CardContent></Card>
  );
}

function NewBankAccountDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', bank_name: '', bank_code: '', account_type: 'checking' as BankAccountType, account_number: '', branch_number: '', pix_key: '' });
  const create = useCreateBankAccount();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="min-h-11" variant="outline" size="sm"><Plus aria-hidden="true" className="h-4 w-4 mr-1" /> Nova conta</Button></DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Nova conta bancária</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="bank-account-name">Nome *</Label><Input id="bank-account-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><Label htmlFor="bank-account-bank">Banco</Label><Input id="bank-account-bank" value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} /></div>
            <div>
              <Label htmlFor="bank-account-type">Tipo</Label>
              <Select value={form.account_type} onValueChange={value => setForm(f => ({ ...f, account_type: value as BankAccountType }))}>
                <SelectTrigger id="bank-account-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Corrente</SelectItem>
                  <SelectItem value="savings">Poupança</SelectItem>
                  <SelectItem value="money_market">Mercado monetário</SelectItem>
                  <SelectItem value="cash">Caixa</SelectItem>
                  <SelectItem value="company_card">Cartão empresa</SelectItem>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><Label htmlFor="bank-account-code">Código do banco</Label><Input id="bank-account-code" value={form.bank_code} onChange={e => setForm(f => ({ ...f, bank_code: e.target.value.trim() }))} /></div>
            <div><Label htmlFor="bank-account-branch">Agência</Label><Input id="bank-account-branch" value={form.branch_number} onChange={e => setForm(f => ({ ...f, branch_number: e.target.value }))} /></div>
            <div><Label htmlFor="bank-account-number">Conta</Label><Input id="bank-account-number" value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} /></div>
          </div>
          <div><Label htmlFor="bank-account-pix">Chave Pix</Label><Input id="bank-account-pix" value={form.pix_key} onChange={e => setForm(f => ({ ...f, pix_key: e.target.value }))} /></div>
          <p className="text-xs text-muted-foreground">O saldo inicial é registrado pela revisão de abertura, com evidência do extrato ou contagem de caixa.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate({
            ...form, initial_balance: 0,
          }, {
            onSuccess: () => { toast({ title: 'Conta criada' }); setOpen(false); },
            onError: error => toast({ title: 'Erro', description: getErrorMessage(error), variant: 'destructive' }),
          })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryPageControls({ page, rowCount, total, hasMore, onPrevious, onNext }: {
  page: number; rowCount: number; total?: number; hasMore: boolean; onPrevious: () => void; onNext: () => void;
}) {
  return <div className="flex flex-col gap-2 border-t p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
    <span>Página {page} · {rowCount} registro{rowCount === 1 ? '' : 's'}{total === undefined ? '' : ` de ${total}`}</span>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={page === 1} onClick={onPrevious}>Anterior</Button>
      <Button variant="outline" size="sm" disabled={!hasMore} onClick={onNext}>Próxima</Button>
    </div>
  </div>;
}

function ExtratoTab({ account, start, end, total }: { account: string; start: string; end: string; total: number }) {
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', status: 'all', direction: 'all' }, 'tx_');
  const [cursors, setCursors] = useState<Array<LegacyTransactionCursor | null>>([null]);
  const query = useBankTransactions(account, start, end, {
    cursor: cursors[cursors.length - 1],
    search: filters.search,
    status: filters.status as 'all' | 'unmatched' | 'suggested' | 'matched' | 'ignored' | 'manual_review',
    direction: filters.direction as 'all' | 'credit' | 'debit',
  });
  const rows = query.data?.rows ?? [];
  const changeFilter = (key: 'search' | 'status' | 'direction', value: string) => {
    setCursors([null]);
    setFilter(key, value);
  };
  const reset = () => {
    setCursors([null]);
    resetFilters();
  };
  if (query.isPending) return <p role="status" className="rounded border p-4">Carregando transações históricas…</p>;
  if (query.isError) return <div role="alert" className="space-y-2 rounded border border-destructive p-4"><p>Não foi possível carregar as transações: {getErrorMessage(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  const unfiltered = !filters.search && filters.status === 'all' && filters.direction === 'all';
  return <Card><CardContent className="p-0"><div className="p-3"><ListFilterBar fields={[
    {key:'search',label:'Buscar transação',type:'search',value:filters.search,onChange:value=>changeFilter('search',value),placeholder:'Descrição, documento ou centro de custo'},
    {key:'status',label:'Status anterior',value:filters.status,onChange:value=>changeFilter('status',value),options:[
      {value:'all',label:'Todos'},{value:'unmatched',label:'Sem match'},{value:'suggested',label:'Sugerido'},
      {value:'matched',label:'Conciliado'},{value:'ignored',label:'Ignorado'},{value:'manual_review',label:'Revisão manual'},
    ]},
    {key:'direction',label:'Movimento',value:filters.direction,onChange:value=>changeFilter('direction',value),options:[{value:'all',label:'Entradas e saídas'},{value:'credit',label:'Entradas'},{value:'debit',label:'Saídas'}]},
  ]} onReset={reset} activeCount={activeCount} resultCount={rows.length} totalCount={total} description="Filtros aplicados no servidor antes da paginação."/></div>
  <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Centro de custo</TableHead><TableHead>Valor</TableHead><TableHead>Status anterior</TableHead><TableHead>Sugestão anterior</TableHead></TableRow></TableHeader><TableBody>
  {rows.map(t=><TableRow key={t.id}><TableCell>{fmtDateSafe(t.posted_at)}</TableCell><TableCell>{t.description}</TableCell><TableCell>{t.cost_center||'—'}</TableCell>
  <TableCell>{t.transaction_type==='debit'?'Saída':'Entrada'} · {fmt(Math.abs(Number(t.amount)))}</TableCell><TableCell>{STATUS_LABEL[t.reconciliation_status]||t.reconciliation_status}</TableCell>
  <TableCell>{t.suggestions.map(s=><p key={s.id}>{s.obligation?.description||'Sem título'} · {fmt(s.amount_matched)} · sugestão não confirmada</p>)}</TableCell></TableRow>)}
  {!rows.length&&<TableRow><TableCell colSpan={6}>Nenhum registro histórico neste filtro.</TableCell></TableRow>}
  </TableBody></Table>
  <HistoryPageControls page={cursors.length} rowCount={rows.length} total={unfiltered ? total : undefined} hasMore={query.data?.has_more ?? false}
    onPrevious={() => setCursors(current => current.slice(0, -1))}
    onNext={() => query.data?.next_cursor && setCursors(current => [...current, query.data!.next_cursor])} />
  </CardContent></Card>;
}
function TitulosTab({ account, start, end, total }: { account: string; start: string; end: string; total: number }) {
  const [cursors, setCursors] = useState<Array<LegacyObligationCursor | null>>([null]);
  const query = useFinancialObligations(account, start, end, { cursor: cursors[cursors.length - 1] });
  if (query.isPending) return <p role="status" className="rounded border p-4">Carregando títulos históricos…</p>;
  if (query.isError) return <div role="alert" className="space-y-2 rounded border border-destructive p-4"><p>Não foi possível carregar os títulos: {getErrorMessage(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  const obligations = query.data?.rows ?? [];
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Vencimento</TableHead><TableHead>Tipo</TableHead><TableHead>Contraparte</TableHead>
          <TableHead className="text-right">Esperado</TableHead><TableHead className="text-right">Conciliado</TableHead>
          <TableHead className="text-right">Saldo</TableHead><TableHead>Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {obligations.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Nenhum título histórico nesta consulta.</TableCell></TableRow>}
          {obligations.map(o => (
            <TableRow key={o.id}>
              <TableCell className="text-xs">{fmtDateSafe(o.due_date)}</TableCell>
              <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{OBLIGATION_TYPE_LABEL[o.obligation_type] || o.obligation_type}</Badge></TableCell>
              <TableCell className="text-xs max-w-[280px] truncate">{o.counterparty_name || o.description || '—'}</TableCell>
              <TableCell className="text-right text-xs">{fmt(o.amount_expected)}</TableCell>
              <TableCell className="text-right text-xs">{fmt(o.amount_matched)}</TableCell>
              <TableCell className="text-right text-xs">{fmt(o.open_balance)}</TableCell>
              <TableCell><Badge variant={o.status === 'paid' ? 'default' : 'secondary'} className="text-[10px]">{STATUS_LABEL[o.status] || o.status}</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <HistoryPageControls page={cursors.length} rowCount={obligations.length} total={total} hasMore={query.data?.has_more ?? false}
        onPrevious={() => setCursors(current => current.slice(0, -1))}
        onNext={() => query.data?.next_cursor && setCursors(current => [...current, query.data!.next_cursor])} />
    </CardContent></Card>
  );
}

function DivergenciasTab({ account, start, end, transactionTotal, obligationTotal }: {
  account: string; start: string; end: string; transactionTotal: number; obligationTotal: number;
}) {
  const [transactionCursors, setTransactionCursors] = useState<Array<LegacyTransactionCursor | null>>([null]);
  const [obligationCursors, setObligationCursors] = useState<Array<LegacyObligationCursor | null>>([null]);
  const transactionQuery = useBankTransactions(account, start, end, {
    cursor: transactionCursors[transactionCursors.length - 1], view: 'unmatched',
  });
  const obligationQuery = useFinancialObligations(account, start, end, {
    cursor: obligationCursors[obligationCursors.length - 1], view: 'unmatched',
  });
  if (transactionQuery.isPending || obligationQuery.isPending) return <p role="status" className="rounded border p-4">Carregando divergências históricas…</p>;
  const error = transactionQuery.error ?? obligationQuery.error;
  if (error) return <div role="alert" className="space-y-2 rounded border border-destructive p-4"><p>Não foi possível carregar as divergências: {getErrorMessage(error)}</p><Button variant="outline" onClick={() => { void transactionQuery.refetch(); void obligationQuery.refetch(); }}>Tentar novamente</Button></div>;
  const orphanTx = transactionQuery.data?.rows ?? [];
  const orphanOb = obligationQuery.data?.rows ?? [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card>
        <CardHeader><CardTitle className="text-sm">Transações sem origem ({transactionTotal})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>
              {orphanTx.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{fmtDateSafe(t.posted_at)}</TableCell>
                  <TableCell className="text-xs truncate max-w-[280px]">{t.description}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(t.amount)}</TableCell>
                </TableRow>
              ))}
              {orphanTx.length === 0 && <TableRow><TableCell colSpan={3}>Nenhuma transação sem origem nesta página.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <HistoryPageControls page={transactionCursors.length} rowCount={orphanTx.length} total={transactionTotal} hasMore={transactionQuery.data?.has_more ?? false}
            onPrevious={() => setTransactionCursors(current => current.slice(0, -1))}
            onNext={() => transactionQuery.data?.next_cursor && setTransactionCursors(current => [...current, transactionQuery.data!.next_cursor])} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Títulos sem transação bancária ({obligationTotal})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Vencimento</TableHead><TableHead>Tipo</TableHead><TableHead>Contraparte</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
            <TableBody>
              {orphanOb.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs">{fmtDateSafe(o.due_date)}</TableCell>
                  <TableCell className="text-xs">{OBLIGATION_TYPE_LABEL[o.obligation_type] || o.obligation_type}</TableCell>
                  <TableCell className="text-xs truncate max-w-[220px]">{o.counterparty_name || o.description}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.open_balance)}</TableCell>
                </TableRow>
              ))}
              {orphanOb.length === 0 && <TableRow><TableCell colSpan={4}>Nenhum título sem transação nesta página.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <HistoryPageControls page={obligationCursors.length} rowCount={orphanOb.length} total={obligationTotal} hasMore={obligationQuery.data?.has_more ?? false}
            onPrevious={() => setObligationCursors(current => current.slice(0, -1))}
            onNext={() => obligationQuery.data?.next_cursor && setObligationCursors(current => [...current, obligationQuery.data!.next_cursor])} />
        </CardContent>
      </Card>
    </div>
  );
}

function MotoristasTab({ account, start, end, settlementCount, expenseCount, pendingCents }: {
  account: string; start: string; end: string; settlementCount: number; expenseCount: number; pendingCents: string;
}) {
  const [cursors, setCursors] = useState<Array<LegacyObligationCursor | null>>([null]);
  const query = useFinancialObligations(account, start, end, {
    cursor: cursors[cursors.length - 1], view: 'drivers',
  });
  if (query.isPending) return <p role="status" className="rounded border p-4">Carregando obrigações de motoristas…</p>;
  if (query.isError) return <div role="alert" className="space-y-2 rounded border border-destructive p-4"><p>Não foi possível carregar as obrigações de motoristas: {getErrorMessage(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  const obligations = query.data?.rows ?? [];
  const total = settlementCount + expenseCount;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard label="Acertos aprovados" value={String(settlementCount)} />
        <KpiCard label="Saldo pendente motoristas" value={fmtCents(pendingCents)} />
        <KpiCard label="Despesas empresa" value={String(expenseCount)} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Obrigações de motoristas ({total})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Motorista</TableHead>
              <TableHead className="text-right">A pagar</TableHead><TableHead className="text-right">Pago</TableHead>
              <TableHead className="text-right">Saldo</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {obligations.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">Sem obrigações de motoristas no período.</TableCell></TableRow>}
              {obligations.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs">{fmtDateSafe(o.due_date)}</TableCell>
                  <TableCell className="text-xs">{OBLIGATION_TYPE_LABEL[o.obligation_type] || o.obligation_type}</TableCell>
                  <TableCell className="text-xs">{o.description || o.counterparty_name}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.amount_expected)}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.amount_matched)}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.open_balance)}</TableCell>
                  <TableCell><Badge variant={o.status === 'paid' ? 'default' : 'secondary'} className="text-[10px]">{STATUS_LABEL[o.status] || o.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <HistoryPageControls page={cursors.length} rowCount={obligations.length} total={total} hasMore={query.data?.has_more ?? false}
            onPrevious={() => setCursors(current => current.slice(0, -1))}
            onNext={() => query.data?.next_cursor && setCursors(current => [...current, query.data!.next_cursor])} />
        </CardContent>
      </Card>
    </div>
  );
}
