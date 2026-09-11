import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useFinanceAccess} from '@/hooks/useFinanceLedger';
import {readFinanceStatements} from '@/lib/financial/ledgerClient';
import {statementSourceLabels,type StatementListFilters,type StatementSummary} from '@/lib/financial/statementHistoryContract';
import {StatementHistoryDetail} from '@/components/financial/StatementHistoryDetail';
import {StatementImportDialog} from '@/components/financial/StatementImportDialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
const initial:StatementListFilters={page:1,page_size:20,search:'',from:'',to:'',account_id:'',source_status:''};
const date=(value:string)=>value.split('-').reverse().join('/');
export default function FinanceStatements(){
  const {currentTenant,currentRole}=useTenant(),{user}=useAuth(),access=useFinanceAccess();
  if(!currentTenant||!user)return <p>Entre e selecione a empresa.</p>;
  if(!['owner','admin','operator'].includes(currentRole||''))return <p role="alert">Acesso financeiro não permitido.</p>;
  if(access.isPending)return <p role="status">Verificando acesso…</p>;
  if(access.error)return <p role="alert">Não foi possível verificar o acesso. <Button onClick={()=>void access.refetch()}>Tentar novamente</Button></p>;
  if(!access.data)return <p role="alert">Acesso financeiro não permitido.</p>;
  return <StatementWorkspace key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id}/>;
}
function StatementWorkspace({tenant,actor}:{tenant:string;actor:string}){
  const [filters,setFilters]=useState(initial),[draft,setDraft]=useState(initial),[entry,setEntry]=useState(false);
  const [selected,setSelected]=useState<StatementSummary|null>(null),[notice,setNotice]=useState('');
  const qc=useQueryClient(),query=useQuery({queryKey:['finance-statements',tenant,actor,filters],retry:false,queryFn:()=>readFinanceStatements(tenant,filters)}),page=query.data;
  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Extratos importados</h1>
    <p className="text-sm text-muted-foreground">Arquivos originais, conferência das linhas e pendências de identificação.</p></div><Button onClick={()=>setEntry(true)}>Importar extrato</Button></div>
    {notice&&<p role="status">{notice}</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();setFilters({...draft,page:1});setSelected(null);}}>
      <label className="text-sm">Buscar<Input value={draft.search} maxLength={200} onChange={e=>setDraft({...draft,search:e.target.value})} placeholder="Arquivo ou conta"/></label>
      <label className="text-sm">De<Input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
      <label className="text-sm">Até<Input type="date" min={draft.from||undefined} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
      <label className="text-sm">Conferência do original<select className="block h-10 rounded border bg-background px-2" value={draft.source_status} onChange={e=>setDraft({...draft,source_status:e.target.value})}>
        <option value="">Todas</option>{Object.entries(statementSourceLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><Button type="submit">Filtrar</Button>
    </form>
    <p className="text-sm text-muted-foreground">O período filtra arquivos com cobertura declarada sobreposta. Conferir as linhas com o original ainda não confirma conta, cobertura, saldos ou conciliação.</p>
    {query.isPending&&<p role="status">Carregando extratos…</p>}{query.error&&<p role="alert">Não foi possível consultar os extratos. <Button onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
    {page&&!query.error&&<><p>{page.total} arquivo(s) no filtro</p><div className="rounded border"><Table><TableHeader><TableRow>
      <TableHead>Arquivo / conta</TableHead><TableHead>Período declarado</TableHead><TableHead>Conferência do original</TableHead><TableHead>Linhas</TableHead><TableHead>Identificação</TableHead><TableHead>Detalhes</TableHead>
    </TableRow></TableHeader><TableBody>{page.rows.map(row=><TableRow key={row.id}>
      <TableCell><p className="font-medium">{row.file_name}</p><p className="text-xs text-muted-foreground">{row.account_name}</p></TableCell>
      <TableCell>{date(row.period_start)} a {date(row.period_end)}</TableCell><TableCell>{statementSourceLabels[row.source_verification]}</TableCell><TableCell>{row.input_rows}</TableCell>
      <TableCell><p>{row.identity_review_count} a revisar</p>{row.manual_review_count>0&&<p className="rounded border border-amber-600 px-2 text-sm">{row.manual_review_count} revisão(ões) manual(is)</p>}<p className="text-xs text-muted-foreground">{row.counts.duplicate||0} duplicidade(s) por referência</p></TableCell>
      <TableCell><Button variant="ghost" aria-label={`Detalhar ${row.file_name}`} onClick={()=>setSelected(row)}>Detalhar</Button></TableCell>
    </TableRow>)}{!page.rows.length&&<TableRow><TableCell colSpan={6} className="py-8 text-center">Nenhum extrato neste filtro.</TableCell></TableRow>}</TableBody></Table></div>
      <div className="flex items-center justify-between"><Button variant="outline" disabled={filters.page===1||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page-1})}>Anterior</Button>
        <span>Página {page.page} de {Math.max(1,Math.ceil(page.total/page.page_size))}</span><Button variant="outline" disabled={page.page*page.page_size>=page.total||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page+1})}>Próxima</Button></div>
    </>}
    {selected&&<StatementHistoryDetail key={selected.id} statement={selected} actor={actor} onClose={()=>setSelected(null)}/>}
    {entry&&<StatementImportDialog tenant={tenant} actor={actor} onClose={()=>setEntry(false)} onImported={()=>{
      setEntry(false);setNotice('Importação registrada. Consulte a conferência do original e as pendências nas linhas.');
      void invalidateAccountReview(qc,tenant);void qc.invalidateQueries({queryKey:['finance-statements',tenant,actor]});void qc.invalidateQueries({queryKey:['finance-statement-lines',tenant,actor]});
    }}/>}
  </div>;
}
