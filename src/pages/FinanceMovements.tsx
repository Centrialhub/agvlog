import {MovementCorrectionDialog} from '@/components/financial/MovementCorrectionDialog';
import {MovementInvalidationHistory,MovementListTotals} from '@/components/financial/MovementInvalidationHistory';
import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { useFinanceAccess, useFinanceMovements } from '@/hooks/useFinanceLedger';
import { MovementEntryDialog } from '@/components/financial/MovementEntryDialog';
import { ExpenseBatchDialog } from '@/components/financial/ExpenseBatchDialog';
import {StatementImportDialog} from '@/components/financial/StatementImportDialog';
import {MovementReceiptTrace} from '@/components/financial/MovementReceiptTrace';
import {InternalTransferDialog} from '@/components/financial/InternalTransferDialog';
import {PendingTransfers} from '@/components/financial/PendingTransfers';
import {AccountOpeningEntry} from '@/components/financial/AccountOpeningEntry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { financeError, formatFinanceCents, movementNatures, type MovementFilters } from '@/lib/financial/ledgerContract';

const initial: MovementFilters = { page: 1, page_size: 50, search: '', from: '', to: '', direction: '', account_id: '' };
export default function FinanceMovements() {
  const { currentTenant, currentRole } = useTenant(); const { user } = useAuth(); const access = useFinanceAccess();
  if (!currentTenant || !user) return <p>Entre e selecione a empresa.</p>;
  if (!['owner', 'admin', 'operator'].includes(currentRole ?? '')) return <p role="alert">Acesso financeiro não permitido.</p>;
  if (access.isPending) return <p role="status">Verificando acesso ao financeiro…</p>;
  if (access.error) return <div role="alert"><p>Não foi possível verificar o acesso financeiro.</p><Button onClick={() => void access.refetch()}>Tentar novamente</Button></div>;
  if (!access.data) return <p role="alert">Acesso financeiro não permitido para este usuário.</p>;
  return <MovementWorkspace key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id} />;
}
function MovementWorkspace({ tenant, actor }: { tenant: string; actor: string }) {
  const [filters, setFilters] = useState(initial), [draft, setDraft] = useState(initial);
  const [entry, setEntry] = useState(false), [notice, setNotice] = useState('');
  const [batchEntry,setBatchEntry] = useState(false);
  const [statementEntry,setStatementEntry]=useState(false);
  const [receiptTrace,setReceiptTrace]=useState<string|null>(null);
  const [correctionMovement,setCorrectionMovement]=useState<string|null>(null);
  const [transferEntry,setTransferEntry]=useState(false);
  const query = useFinanceMovements(filters, true), qc = useQueryClient(); const page = query.isFetching||query.isError?undefined:query.data;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Movimentações registradas</h1>
      <p className="text-sm text-muted-foreground">Envios e recebimentos declarados, antes da conferência do extrato.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>setStatementEntry(true)}>Importar extrato</Button><Button variant="outline" onClick={() => setBatchEntry(true)}>Conferir gastos em lote</Button><Button onClick={() => setEntry(true)}>Registrar movimentação</Button></div></div>
    <Button variant="outline" onClick={()=>setTransferEntry(true)}>Registrar transferência entre contas</Button>
    <PendingTransfers tenant={tenant} actor={actor}/>
    <AccountOpeningEntry tenant={tenant} actor={actor}/>
    {notice && <p role="status">{notice}</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setFilters({ ...draft, page: 1 }); }}>
      <div className="min-w-56 flex-1"><Label htmlFor="movement-search">Buscar</Label><Input id="movement-search" value={draft.search} placeholder="Beneficiário, descrição ou referência" onChange={e => setDraft({ ...draft, search: e.target.value })} /></div>
      <div><Label htmlFor="movement-from">De</Label><Input id="movement-from" type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></div>
      <div><Label htmlFor="movement-to">Até</Label><Input id="movement-to" type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></div>
      <div><Label htmlFor="movement-filter-direction">Direção</Label><select id="movement-filter-direction" className="h-10 rounded-md border bg-background px-3" value={draft.direction} onChange={e => setDraft({ ...draft, direction: e.target.value })}><option value="">Todas</option><option value="in">Entradas</option><option value="out">Saídas</option></select></div>
      <Button type="submit">Filtrar</Button>
    </form>
    {query.isFetching && <p role="status">Carregando movimentações…</p>}
    {query.error && <div role="alert"><p>{financeError(query.error)}</p><Button onClick={() => void query.refetch()}>Atualizar</Button></div>}
    {page && !query.error && <>
      <MovementListTotals page={page}/>
      <div className="rounded-lg border"><Table><TableHeader><TableRow>
        <TableHead>Data</TableHead><TableHead>Beneficiário / motivo</TableHead><TableHead>Conta</TableHead><TableHead>Natureza</TableHead><TableHead>Referência</TableHead><TableHead className="text-right">Valor original</TableHead>
      </TableRow></TableHeader><TableBody>{page.rows.map(row => <TableRow key={row.id}>
        <TableCell className="whitespace-nowrap">{row.occurred_on.split('-').reverse().join('/')}</TableCell>
        <TableCell><p className="font-medium">{row.beneficiary_name}</p><p className="text-xs text-muted-foreground">{row.description}</p>{row.correction&&<MovementInvalidationHistory event={row.correction}/>}</TableCell>
        <TableCell>{row.account_name}</TableCell><TableCell><Badge variant="outline">{movementNatures[row.nature]}</Badge></TableCell>
        <TableCell className="text-xs">{row.bank_reference || 'Não informada'}<Button variant="link" className="block px-0" onClick={()=>setReceiptTrace(row.id)}>Vínculos com recebíveis</Button><Button variant="link" className="block px-0" aria-label={`Conferir correção de ${row.description}`} onClick={()=>setCorrectionMovement(row.id)}>Conferir correção</Button></TableCell>
        <TableCell className="text-right whitespace-nowrap">{row.direction === 'out' ? '−' : '+'} {formatFinanceCents(row.amount_cents)}</TableCell>
      </TableRow>)}{!page.rows.length && <TableRow><TableCell colSpan={6} className="py-8 text-center">Nenhuma movimentação neste filtro.</TableCell></TableRow>}</TableBody></Table></div>
      <div className="flex items-center justify-between"><Button variant="outline" disabled={filters.page === 1 || query.isFetching} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Anterior</Button>
        <span className="text-sm">Página {page.page} de {Math.max(1, Math.ceil(page.total / page.page_size))}</span>
        <Button variant="outline" disabled={page.page * page.page_size >= page.total || query.isFetching} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Próxima</Button></div>
    </>}
    {correctionMovement&&<MovementCorrectionDialog key={`${tenant}:${actor}:${correctionMovement}`} tenant={tenant} actor={actor} movementId={correctionMovement} onClose={()=>setCorrectionMovement(null)}/>}
    {receiptTrace&&<MovementReceiptTrace key={receiptTrace} tenant={tenant} actor={actor} movement={receiptTrace} onClose={()=>setReceiptTrace(null)}/>}
    {transferEntry&&<InternalTransferDialog tenant={tenant} actor={actor} onClose={()=>setTransferEntry(false)} onRecorded={()=>{setTransferEntry(false);setNotice('Transferência registrada nos dois lados. Confira cada conta no respectivo extrato.');void invalidateAccountReview(qc,tenant);for(const prefix of ['finance-movements','finance-audit','finance-reconciliation-options','finance-automatic-reconciliation'])void qc.invalidateQueries({queryKey:[prefix]});}}/>}
    {entry && <MovementEntryDialog tenant={tenant} actor={actor} onClose={() => setEntry(false)} onRecorded={() => {
      setEntry(false); setNotice('Movimentação registrada. A composição e a conferência bancária são etapas separadas.');
      void invalidateAccountReview(qc,tenant);void qc.invalidateQueries({ queryKey: ['finance-movements', tenant, actor] });
    }} />}
    {batchEntry&&<ExpenseBatchDialog tenant={tenant} actor={actor} onClose={()=>setBatchEntry(false)} onRecorded={()=>{
      setBatchEntry(false);setNotice('Gastos registrados com suas categorias e vínculos. Confira os complementos a pagar e reembolsos de descarga a receber.');
      void invalidateAccountReview(qc,tenant);
      void qc.invalidateQueries({queryKey:['finance-options',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-expenses',tenant,actor]});
      void qc.invalidateQueries({queryKey:['payables']});void qc.invalidateQueries({queryKey:['receivables']});
    }}/>}
    {statementEntry&&<StatementImportDialog tenant={tenant} actor={actor} onClose={()=>setStatementEntry(false)} onImported={result=>{
      setStatementEntry(false);setNotice(result.source_verification==='rows_match'
        ?'Extrato registrado e linhas conferidas contra o original. Conta, cobertura, saldos e conciliação permanecem pendentes.'
        :'Extrato preservado com divergência na leitura do original. É necessário revisar a importação.');
      void invalidateAccountReview(qc,tenant);void qc.invalidateQueries({queryKey:['finance-statements',tenant,actor]});
    }}/>}
  </div>;
}
