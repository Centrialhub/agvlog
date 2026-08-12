import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Landmark, Upload, RefreshCw, Play, Check, X, Link2, Plus, Calendar, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useBankAccounts, useCreateBankAccount, useBankTransactions, useFinancialObligations,
  useSuggestedMatches, useSyncObligations, useImportBankStatement, useRunReconciliation,
  useAcceptMatch, useRejectMatch, useCreateManualMatch, useCreateManualTransaction,
  type FinancialObligation, type BankTransaction,
} from '@/hooks/useBankReconciliation';
import {
  parseWorkbook, buildParsedRows, computeFileHash, type ColumnMapping,
} from '@/lib/bankStatementParser';
import { useCostCenters } from '@/hooks/useCostCenters';

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
  const { toast } = useToast();
  const { data: accounts = [] } = useBankAccounts();
  const [accountId, setAccountId] = useState<string>('');
  const [periodStart, setPeriodStart] = useState(todayIso(-30));
  const [periodEnd, setPeriodEnd] = useState(todayIso());

  const effectiveAccount = accountId || accounts[0]?.id || '';

  const { data: transactions = [] } = useBankTransactions(effectiveAccount, periodStart, periodEnd);
  const { data: obligations = [] } = useFinancialObligations(periodStart, periodEnd);
  const { data: suggested = [] } = useSuggestedMatches(effectiveAccount);

  const kpis = useMemo(() => {
    const inflow = transactions.filter(t => t.amount > 0).reduce((s, t) => s + Number(t.amount), 0);
    const outflow = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const matched = transactions.filter(t => t.reconciliation_status === 'matched').length;
    const pending = transactions.filter(t => t.reconciliation_status === 'unmatched' || t.reconciliation_status === 'suggested').length;
    const txWithoutOrigin = transactions.filter(t => t.reconciliation_status === 'unmatched').length;
    const titlesWithoutTx = obligations.filter(o => o.matching_status === 'unmatched' && o.status !== 'paid' && o.status !== 'cancelled').length;
    return { inflow, outflow, matched, pending, suggested: suggested.length, txWithoutOrigin, titlesWithoutTx };
  }, [transactions, obligations, suggested]);

  const syncObg = useSyncObligations();
  const runRecon = useRunReconciliation();

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" /> Conciliação Bancária</h1>
          <p className="text-sm text-muted-foreground">Importe extratos, gere sugestões e concilie títulos financeiros do sistema.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <NewBankAccountDialog />
          <NewManualTransactionDialog accountId={effectiveAccount} />
          <ImportStatementDialog accountId={effectiveAccount} periodStart={periodStart} periodEnd={periodEnd} />
          <Button variant="outline" size="sm" onClick={() => syncObg.mutate({ from: periodStart, to: periodEnd }, {
            onSuccess: (r: any) => toast({ title: 'Títulos sincronizados', description: JSON.stringify(r) }),
            onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
          })} disabled={syncObg.isPending}>
            <RefreshCw className="h-4 w-4 mr-1" /> Sincronizar títulos
          </Button>
          <Button size="sm" disabled={!effectiveAccount || runRecon.isPending} onClick={() => runRecon.mutate(
            { bank_account_id: effectiveAccount, period_start: periodStart, period_end: periodEnd },
            {
              onSuccess: (r: any) => toast({ title: 'Conciliação executada', description: `${r.auto} auto · ${r.suggested} sugestões · ${r.scanned} transações` }),
              onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
            }
          )}>
            <Play className="h-4 w-4 mr-1" /> Rodar conciliação
          </Button>
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

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard label="Entradas banco" value={fmt(kpis.inflow)} />
        <KpiCard label="Saídas banco" value={fmt(kpis.outflow)} />
        <KpiCard label="Conciliados" value={String(kpis.matched)} />
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
          <ExtratoTab transactions={transactions} suggested={suggested} obligations={obligations} />
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
  const [form, setForm] = useState({ name: '', bank_name: '', account_type: 'checking' as any, account_number: '', branch_number: '', pix_key: '', initial_balance: '0' });
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
              <Select value={form.account_type} onValueChange={v => setForm(f => ({ ...f, account_type: v }))}>
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
          } as any, {
            onSuccess: () => { toast({ title: 'Conta criada' }); setOpen(false); },
            onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
          })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportStatementDialog({ accountId, periodStart, periodEnd }: { accountId: string; periodStart: string; periodEnd: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowsRaw, setRowsRaw] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: '', description: '', amount: '' });
  const [preview, setPreview] = useState<any[]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(0);
  const [matrix, setMatrix] = useState<any[][]>([]);
  const [autoGuessFailed, setAutoGuessFailed] = useState(false);
  const importMut = useImportBankStatement();

  const reset = () => {
    setFile(null); setHeaders([]); setRowsRaw([]); setMapping({ date: '', description: '', amount: '' });
    setPreview([]); setHeaderRowIndex(0); setMatrix([]); setAutoGuessFailed(false);
  };

  const applyGuess = (hs: string[]) => {
    const guess = (candidates: string[]) => hs.find(h => candidates.some(c => h.toLowerCase().includes(c))) || '';
    const next: ColumnMapping = {
      date: guess(['data', 'date', 'dt']),
      description: guess(['descri', 'histor', 'memo', 'lanç', 'lanc']),
      amount: guess(['valor', 'amount']),
      inflow: guess(['crédito', 'credito', 'entrada', 'credit']),
      outflow: guess(['débito', 'debito', 'saída', 'saida', 'debit']),
      document: guess(['doc', 'referen']),
      balance: guess(['saldo', 'balance']),
    };
    setMapping(next);
    setAutoGuessFailed(!next.date || !next.description || (!next.amount && !next.inflow && !next.outflow));
  };

  const onFile = async (f: File) => {
    setFile(f);
    const { headers: hs, rows, headerRowIndex: idx, matrix: mx } = await parseWorkbook(f);
    setHeaders(hs);
    setRowsRaw(rows);
    setHeaderRowIndex(idx);
    setMatrix(mx);
    applyGuess(hs);
  };

  const changeHeaderRow = async (newIdx: number) => {
    if (!file || !matrix.length) return;
    const clamped = Math.max(0, Math.min(newIdx, Math.min(matrix.length - 1, 19)));
    const { headers: hs, rows, headerRowIndex: idx, matrix: mx } = await parseWorkbook(file, clamped);
    setHeaders(hs); setRowsRaw(rows); setHeaderRowIndex(idx); setMatrix(mx);
    applyGuess(hs);
    setPreview([]);
  };

  const buildPreview = () => {
    const parsed = buildParsedRows(rowsRaw, mapping, accountId || 'preview');
    setPreview(parsed.slice(0, 10));
    return parsed;
  };

  const submit = async () => {
    if (!file || !accountId) return;
    const parsed = buildParsedRows(rowsRaw, mapping, accountId);
    if (parsed.length === 0) {
      toast({
        title: 'Nenhuma linha válida',
        description: 'Verifique se as colunas Data, Descrição e Valor (ou Crédito/Débito) foram mapeadas corretamente e se a linha do cabeçalho está certa.',
        variant: 'destructive',
      });
      return;
    }
    const hash = await computeFileHash(file);
    importMut.mutate({
      bank_account_id: accountId,
      file_name: file.name,
      file_hash: hash,
      period_start: periodStart,
      period_end: periodEnd,
      rows: parsed,
      raw_metadata: { mapping, source_headers: headers },
    }, {
      onSuccess: (r: any) => {
        toast({ title: 'Extrato importado', description: `${r.rows_inserted} novas · ${r.rows_skipped} ignoradas` });
        reset(); setOpen(false);
      },
      onError: (e: any) => toast({ title: 'Erro', description: e.message || 'Falha ao importar', variant: 'destructive' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline" disabled={!accountId}><Upload className="h-4 w-4 mr-1" /> Importar extrato</Button></DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Importar extrato bancário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input type="file" accept=".csv,.xls,.xlsx" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          {headers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs bg-muted/40 rounded px-2 py-1.5">
              <span className="text-muted-foreground">Cabeçalho detectado na linha</span>
              <Input
                type="number"
                min={1}
                max={Math.min(matrix.length, 20)}
                value={headerRowIndex + 1}
                onChange={(e) => changeHeaderRow(Number(e.target.value) - 1)}
                className="h-7 w-16"
              />
              <span className="text-muted-foreground truncate max-w-full">
                Colunas: {headers.slice(0, 6).join(' · ')}{headers.length > 6 ? ` (+${headers.length - 6})` : ''}
              </span>
            </div>
          )}
          {headers.length > 0 && autoGuessFailed && (
            <div className="text-xs rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-1.5">
              Não foi possível identificar automaticamente as colunas Data / Descrição / Valor. Selecione manualmente abaixo (ou ajuste a linha do cabeçalho).
            </div>
          )}
          {headers.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <MappingSelect label="Data *" value={mapping.date} onChange={v => setMapping(m => ({ ...m, date: v }))} headers={headers} />
              <MappingSelect label="Descrição *" value={mapping.description} onChange={v => setMapping(m => ({ ...m, description: v }))} headers={headers} />
              <MappingSelect label="Valor (com sinal)" value={mapping.amount || ''} onChange={v => setMapping(m => ({ ...m, amount: v }))} headers={headers} />
              <MappingSelect label="Entrada (crédito)" value={mapping.inflow || ''} onChange={v => setMapping(m => ({ ...m, inflow: v }))} headers={headers} />
              <MappingSelect label="Saída (débito)" value={mapping.outflow || ''} onChange={v => setMapping(m => ({ ...m, outflow: v }))} headers={headers} />
              <MappingSelect label="Documento" value={mapping.document || ''} onChange={v => setMapping(m => ({ ...m, document: v }))} headers={headers} />
              <MappingSelect label="Saldo" value={mapping.balance || ''} onChange={v => setMapping(m => ({ ...m, balance: v }))} headers={headers} />
              <MappingSelect label="Centro de Custo" value={mapping.costCenter || ''} onChange={v => setMapping(m => ({ ...m, costCenter: v }))} headers={headers} />
            </div>
          )}
          {headers.length > 0 && (
            <Button variant="outline" size="sm" onClick={buildPreview} disabled={!mapping.date || !mapping.description || (!mapping.amount && !mapping.inflow && !mapping.outflow)}>
              Gerar preview
            </Button>
          )}
          {preview.length > 0 && (
            <div className="max-h-60 overflow-auto border rounded">
              <Table>
                <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Centro de Custo</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                <TableBody>
                  {preview.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{new Date(p.posted_at).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell className="text-xs truncate max-w-[300px]">{p.description}</TableCell>
                      <TableCell className="text-xs">{p.cost_center || '-'}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(p.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={!accountId || !file || importMut.isPending || !mapping.date || !mapping.description} onClick={submit}>
            {importMut.isPending ? 'Importando...' : 'Importar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewManualTransactionDialog({ accountId }: { accountId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    posted_at: todayIso(),
    description: '',
    amount: '',
    type: 'debit' as 'credit' | 'debit',
    document_number: '',
    cost_center: '',
  });
  const create = useCreateManualTransaction();
  const { data: costCenters = [] } = useCostCenters();

  const reset = () => setForm({
    posted_at: todayIso(),
    description: '',
    amount: '',
    type: 'debit',
    document_number: '',
    cost_center: '',
  });

  const handleSubmit = () => {
    if (!accountId) return;
    const amountNum = Math.abs(Number(form.amount));
    const finalAmount = form.type === 'credit' ? amountNum : -amountNum;

    create.mutate({
      bank_account_id: accountId,
      posted_at: form.posted_at,
      description: form.description,
      amount: finalAmount,
      transaction_type: form.type,
      document_number: form.document_number,
      cost_center: form.cost_center,
    }, {
      onSuccess: () => {
        toast({ title: 'Lançamento manual criado' });
        setOpen(false);
        reset();
      },
      onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!accountId}>
          <Plus className="h-4 w-4 mr-1" /> Lançamento manual
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo lançamento manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={form.posted_at}
                onChange={e => setForm(f => ({ ...f, posted_at: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={form.type}
                onValueChange={v => setForm(f => ({ ...f, type: v as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Crédito (Entrada)</SelectItem>
                  <SelectItem value="debit">Débito (Saída)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input
              placeholder="Ex: Pagamento fornecedor X"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0,00"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Documento / Ref</Label>
              <Input
                placeholder="Opcional"
                value={form.document_number}
                onChange={e => setForm(f => ({ ...f, document_number: e.target.value }))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            disabled={!form.description || !form.amount || create.isPending}
            onClick={handleSubmit}
          >
            Salvar lançamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MappingSelect({ label, value, onChange, headers }: { label: string; value: string; onChange: (v: string) => void; headers: string[] }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value || '__none__'} onValueChange={v => onChange(v === '__none__' ? '' : v)}>
        <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">—</SelectItem>
          {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ExtratoTab({ transactions, suggested, obligations }: { transactions: BankTransaction[]; suggested: any[]; obligations: FinancialObligation[] }) {
  const accept = useAcceptMatch();
  const reject = useRejectMatch();
  const { toast } = useToast();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const suggMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of suggested) m.set(s.bank_transaction_id, s);
    return m;
  }, [suggested]);

  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead>
          <TableHead>Status</TableHead><TableHead>Candidato</TableHead><TableHead>Ações</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {transactions.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Sem transações no período.</TableCell></TableRow>}
          {transactions.map(t => {
            const s = suggMap.get(t.id);
            return (
              <TableRow key={t.id}>
                <TableCell className="text-xs">{new Date(t.posted_at).toLocaleDateString('pt-BR')}</TableCell>
                <TableCell className="text-xs max-w-[380px] truncate">{t.description}</TableCell>
                <TableCell className={`text-right text-xs ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(t.amount)}</TableCell>
                <TableCell><Badge variant={t.reconciliation_status === 'matched' ? 'default' : 'secondary'} className="text-[10px]">{STATUS_LABEL[t.reconciliation_status] || t.reconciliation_status}</Badge></TableCell>
                <TableCell className="text-xs">
                  {s ? (
                    <div>
                      <div className="truncate max-w-[250px]">{s.financial_obligations?.description || '—'}</div>
                      <div className="text-[10px] text-muted-foreground">Score {Number(s.confidence_score || 0).toFixed(0)} · {fmt(s.amount_matched)}</div>
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {s ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => accept.mutate(s.id, {
                        onSuccess: () => toast({ title: 'Match aceito' }),
                        onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
                      })}><Check className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setRejectId(s.id); setRejectReason(''); }}><X className="h-3 w-3" /></Button>
                      <ManualMatchDialog transaction={t} obligations={obligations} />
                    </div>
                  ) : (
                    <ManualMatchDialog transaction={t} obligations={obligations} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Dialog open={!!rejectId} onOpenChange={(v) => !v && setRejectId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rejeitar sugestão</DialogTitle></DialogHeader>
          <Textarea rows={3} placeholder="Motivo" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>Cancelar</Button>
            <Button disabled={!rejectReason.trim()} onClick={() => rejectId && reject.mutate({ matchId: rejectId, reason: rejectReason }, {
              onSuccess: () => { toast({ title: 'Sugestão rejeitada' }); setRejectId(null); },
              onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
            })}>Rejeitar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent></Card>
  );
}

function ManualMatchDialog({ transaction, obligations }: { transaction: BankTransaction; obligations: FinancialObligation[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const create = useCreateManualMatch();
  const direction = transaction.amount >= 0 ? 'inflow' : 'outflow';
  const candidates = useMemo(() => obligations.filter(o =>
    o.direction === direction && o.open_balance > 0 && o.status !== 'paid' && o.status !== 'cancelled'
    && (search === '' || (o.description || '').toLowerCase().includes(search.toLowerCase()) || (o.counterparty_name || '').toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 100), [obligations, search, direction]);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPickedId(null); setAmount(''); setReason(''); setSearch(''); } }}>
      <DialogTrigger asChild><Button size="sm" variant="ghost" className="h-7 px-2"><Link2 className="h-3 w-3" /></Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Conciliar manualmente</DialogTitle></DialogHeader>
        <div className="text-xs text-muted-foreground">
          Transação: {new Date(transaction.posted_at).toLocaleDateString('pt-BR')} · {transaction.description} · <b>{fmt(transaction.amount)}</b>
        </div>
        <Input placeholder="Buscar título por descrição ou contraparte..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="max-h-64 overflow-auto border rounded">
          <Table>
            <TableHeader><TableRow><TableHead></TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
            <TableBody>
              {candidates.map(o => (
                <TableRow key={o.id} className={pickedId === o.id ? 'bg-accent' : 'cursor-pointer'} onClick={() => { setPickedId(o.id); setAmount(String(Math.min(Math.abs(transaction.amount), o.open_balance))); }}>
                  <TableCell><input type="radio" checked={pickedId === o.id} readOnly /></TableCell>
                  <TableCell className="text-xs">{o.description || '—'}<div className="text-[10px] text-muted-foreground">{o.counterparty_name}</div></TableCell>
                  <TableCell className="text-xs">{OBLIGATION_TYPE_LABEL[o.obligation_type] || o.obligation_type}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(o.open_balance)}</TableCell>
                </TableRow>
              ))}
              {candidates.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">Nenhum título compatível encontrado.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Valor a conciliar</Label><Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div><Label className="text-xs">Observação (opcional)</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={!pickedId || !Number(amount) || create.isPending} onClick={() => create.mutate({
            bank_transaction_id: transaction.id,
            financial_obligation_id: pickedId!,
            amount_matched: Number(amount),
            reason: reason || null,
          }, {
            onSuccess: () => { toast({ title: 'Conciliação criada' }); setOpen(false); setPickedId(null); setAmount(''); setReason(''); },
            onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
          })}>Conciliar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
          {obligations.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Rode "Sincronizar títulos" para popular o livro financeiro.</TableCell></TableRow>}
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

function MotoristasTab({ obligations, transactions }: { obligations: FinancialObligation[]; transactions: BankTransaction[] }) {
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
