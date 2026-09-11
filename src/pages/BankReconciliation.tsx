import { useMemo, useState } from 'react';
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
  useSuggestedMatches,

  type FinancialObligation, type BankTransaction, type SuggestedMatch,
  type BankAccountType,
} from '@/hooks/useBankReconciliation';
import {ReconciliationStatementImport} from '@/components/financial/ReconciliationStatementImport';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { matchesSearch, filterOptions } from '@/lib/listFilters';
import {ReconciliationMovementEntry} from '@/components/financial/ReconciliationMovementEntry';
import { getErrorMessage } from '@/lib/errors';
import FinanceStatements from './FinanceStatements';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useFinanceAccess} from '@/hooks/useFinanceLedger';


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
  return d.toISOString().slice(0, 10);
}

function fmt(n: number | null | undefined) {
  return (Number(n || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
  return <div className="space-y-4"><div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Conciliação bancária</h1><NewBankAccountDialog/></div>
    <Tabs value={section} onValueChange={setSection}><TabsList><TabsTrigger value="statements">Extratos e conciliação</TabsTrigger><TabsTrigger value="legacy">Histórico anterior</TabsTrigger></TabsList>
      <TabsContent value="statements">{section==='statements'&&<FinanceStatements/>}</TabsContent>
      <TabsContent value="legacy">{section==='legacy'&&<LegacyBankReconciliation/>}</TabsContent>
    </Tabs>
  </div>;
}

function LegacyBankReconciliation() {
  const { data: accounts = [] } = useBankAccounts();
  const [accountId, setAccountId] = useState<string>('');
  const [periodStart, setPeriodStart] = useState(todayIso(-30));
  const [periodEnd, setPeriodEnd] = useState(todayIso());

  const effectiveAccount = accountId || accounts[0]?.id || '';

  const { data: transactions = [] } = useBankTransactions(effectiveAccount, periodStart, periodEnd);
  const { data: obligations = [] } = useFinancialObligations(periodStart, periodEnd);
  const { data: suggested = [] } = useSuggestedMatches(effectiveAccount);

  const kpis = useMemo(() => {
    const inflow = transactions.filter(t => t.transaction_type === 'credit').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const outflow = transactions.filter(t => t.transaction_type === 'debit').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const matched = transactions.filter(t => t.reconciliation_status === 'matched').length;
    const pending = transactions.filter(t => t.reconciliation_status === 'unmatched' || t.reconciliation_status === 'suggested').length;
    const txWithoutOrigin = transactions.filter(t => t.reconciliation_status === 'unmatched').length;
    const titlesWithoutTx = obligations.filter(o => o.matching_status === 'unmatched' && o.status !== 'paid' && o.status !== 'cancelled').length;
    return { inflow, outflow, matched, pending, suggested: suggested.length, txWithoutOrigin, titlesWithoutTx };
  }, [transactions, obligations, suggested]);




  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" /> Histórico anterior</h1>
          <p className="text-sm text-muted-foreground">Consulta dos registros anteriores. Os status antigos não certificam a conciliação com os extratos preservados.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">

          <ReconciliationMovementEntry account={effectiveAccount} />
          <ReconciliationStatementImport account={effectiveAccount} start={periodStart} end={periodEnd} />
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
            <Input type="date" className="h-9" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Fim</Label>
            <Input type="date" className="h-9" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <p className="text-sm">Consulta limitada a 1.000 transações, 1.000 títulos e 500 sugestões. Os totais abaixo se referem aos registros carregados, não ao saldo bancário ou fechamento do período.</p><div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard label="Entradas listadas" value={fmt(kpis.inflow)} />
        <KpiCard label="Saídas listadas" value={fmt(kpis.outflow)} />
        <KpiCard label="Status antigo: conciliado" value={String(kpis.matched)} />
        <KpiCard label="Pendentes" value={String(kpis.pending)} />
        <KpiCard label="Sugestões" value={String(kpis.suggested)} />
        <KpiCard label="Sem origem" value={String(kpis.txWithoutOrigin)} />
        <KpiCard label="Títulos sem banco" value={String(kpis.titlesWithoutTx)} />
      </div>

      <Tabs defaultValue="extrato">
        <TabsList>
          <TabsTrigger value="extrato">Extrato</TabsTrigger>
          <TabsTrigger value="titulos">Títulos do sistema</TabsTrigger>
          <TabsTrigger value="divergencias">Divergências</TabsTrigger>
          <TabsTrigger value="motoristas">Motoristas</TabsTrigger>
        </TabsList>

        <TabsContent value="extrato">
          <ExtratoTab transactions={transactions} suggested={suggested} />
        </TabsContent>
        <TabsContent value="titulos">
          <TitulosTab obligations={obligations} />
        </TabsContent>
        <TabsContent value="divergencias">
          <DivergenciasTab transactions={transactions} obligations={obligations} />
        </TabsContent>
        <TabsContent value="motoristas">
          <MotoristasTab obligations={obligations} transactions={transactions} />
        </TabsContent>
      </Tabs>
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
  const [form, setForm] = useState({ name: '', bank_name: '', account_type: 'checking' as BankAccountType, account_number: '', branch_number: '', pix_key: '', initial_balance: '0' });
  const create = useCreateBankAccount();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="h-4 w-4 mr-1" /> Nova conta</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova conta bancária</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Banco</Label><Input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} /></div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.account_type} onValueChange={value => setForm(f => ({ ...f, account_type: value as BankAccountType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Corrente</SelectItem>
                  <SelectItem value="savings">Poupança</SelectItem>
                  <SelectItem value="cash">Caixa</SelectItem>
                  <SelectItem value="company_card">Cartão empresa</SelectItem>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Agência</Label><Input value={form.branch_number} onChange={e => setForm(f => ({ ...f, branch_number: e.target.value }))} /></div>
            <div><Label>Conta</Label><Input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} /></div>
          </div>
          <div><Label>Chave Pix</Label><Input value={form.pix_key} onChange={e => setForm(f => ({ ...f, pix_key: e.target.value }))} /></div>
          <div><Label>Saldo inicial</Label><Input type="number" step="0.01" value={form.initial_balance} onChange={e => setForm(f => ({ ...f, initial_balance: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate({
            ...form, initial_balance: Number(form.initial_balance || 0),
          }, {
            onSuccess: () => { toast({ title: 'Conta criada' }); setOpen(false); },
            onError: error => toast({ title: 'Erro', description: getErrorMessage(error), variant: 'destructive' }),
          })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtratoTab({transactions,suggested}:{transactions:BankTransaction[];suggested:SuggestedMatch[]}) {
 const {filters,setFilter,resetFilters,activeCount}=useListFilters({search:'',status:'all',direction:'all'},'tx_');
 const filtered=transactions.filter(row=>matchesSearch(filters.search,row.description,row.document_number,row.cost_center)&&(filters.status==='all'||row.reconciliation_status===filters.status)&&(filters.direction==='all'||row.transaction_type===filters.direction));
 return <Card><CardContent className="p-0"><div className="p-3"><ListFilterBar fields={[
  {key:'search',label:'Buscar transação',type:'search',value:filters.search,onChange:value=>setFilter('search',value),placeholder:'Descrição, documento ou centro de custo'},
  {key:'status',label:'Status anterior',value:filters.status,onChange:value=>setFilter('status',value),options:[{value:'all',label:'Todos'},...filterOptions(transactions.map(row=>row.reconciliation_status)).map(value=>({value,label:STATUS_LABEL[value]||value}))]},
  {key:'direction',label:'Movimento',value:filters.direction,onChange:value=>setFilter('direction',value),options:[{value:'all',label:'Entradas e saídas'},{value:'credit',label:'Entradas'},{value:'debit',label:'Saídas'}]},
 ]} onReset={resetFilters} activeCount={activeCount} resultCount={filtered.length} totalCount={transactions.length} description="Filtros sobre os registros históricos carregados."/></div>
 <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Centro de custo</TableHead><TableHead>Valor</TableHead><TableHead>Status anterior</TableHead><TableHead>Sugestão anterior</TableHead></TableRow></TableHeader><TableBody>
 {filtered.map(t=><TableRow key={t.id}><TableCell>{new Date(t.posted_at).toLocaleDateString('pt-BR')}</TableCell><TableCell>{t.description}</TableCell><TableCell>{t.cost_center||'—'}</TableCell>
 <TableCell>{t.transaction_type==='debit'?'Saída':'Entrada'} · {fmt(Math.abs(Number(t.amount)))}</TableCell><TableCell>{STATUS_LABEL[t.reconciliation_status]||t.reconciliation_status}</TableCell>
 <TableCell>{suggested.filter(s=>s.bank_transaction_id===t.id).map(s=><p key={s.id}>{s.financial_obligations?.description||'Sem título'} · {fmt(s.amount_matched)} · sugestão não confirmada</p>)}</TableCell></TableRow>)}
 {!filtered.length&&<TableRow><TableCell colSpan={6}>Nenhum registro histórico neste filtro.</TableCell></TableRow>}
 </TableBody></Table></CardContent></Card>;
}
function TitulosTab({ obligations }: { obligations: FinancialObligation[] }) {
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
              <TableCell className="text-xs">{o.due_date ? new Date(o.due_date).toLocaleDateString('pt-BR') : '—'}</TableCell>
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
    </CardContent></Card>
  );
}

function DivergenciasTab({ transactions, obligations }: { transactions: BankTransaction[]; obligations: FinancialObligation[] }) {
  const orphanTx = transactions.filter(t => t.reconciliation_status === 'unmatched');
  const orphanOb = obligations.filter(o => o.matching_status === 'unmatched' && o.status !== 'paid' && o.status !== 'cancelled');
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card>
        <CardHeader><CardTitle className="text-sm">Transações sem origem ({orphanTx.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>
              {orphanTx.slice(0, 100).map(t => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{new Date(t.posted_at).toLocaleDateString('pt-BR')}</TableCell>
                  <TableCell className="text-xs truncate max-w-[280px]">{t.description}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(t.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Títulos sem transação bancária ({orphanOb.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Vencimento</TableHead><TableHead>Tipo</TableHead><TableHead>Contraparte</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
            <TableBody>
              {orphanOb.slice(0, 100).map(o => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs">{o.due_date ? new Date(o.due_date).toLocaleDateString('pt-BR') : '—'}</TableCell>
                  <TableCell className="text-xs">{OBLIGATION_TYPE_LABEL[o.obligation_type] || o.obligation_type}</TableCell>
                  <TableCell className="text-xs truncate max-w-[220px]">{o.counterparty_name || o.description}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.open_balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function MotoristasTab({ obligations }: { obligations: FinancialObligation[]; transactions: BankTransaction[] }) {
  const settlements = obligations.filter(o => o.obligation_type === 'driver_settlement_payment');
  const expenses = obligations.filter(o => o.obligation_type === 'driver_expense');
  const totalPending = settlements.reduce((s, o) => s + Number(o.open_balance), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard label="Acertos aprovados" value={String(settlements.length)} />
        <KpiCard label="Saldo pendente motoristas" value={fmt(totalPending)} />
        <KpiCard label="Despesas empresa" value={String(expenses.length)} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Acertos aguardando pagamento</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Data</TableHead><TableHead>Motorista</TableHead>
              <TableHead className="text-right">A pagar</TableHead><TableHead className="text-right">Pago</TableHead>
              <TableHead className="text-right">Saldo</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {settlements.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">Sem acertos no livro financeiro.</TableCell></TableRow>}
              {settlements.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs">{o.due_date ? new Date(o.due_date).toLocaleDateString('pt-BR') : '—'}</TableCell>
                  <TableCell className="text-xs">{o.description || o.counterparty_name}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.amount_expected)}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.amount_matched)}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.open_balance)}</TableCell>
                  <TableCell><Badge variant={o.status === 'paid' ? 'default' : 'secondary'} className="text-[10px]">{STATUS_LABEL[o.status] || o.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
