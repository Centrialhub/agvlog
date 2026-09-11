import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {periodEvidenceCommandSchema,readPeriodEvidence,recordPeriodEvidence,type PeriodEvidenceCommand} from '@/lib/financial/periodEvidenceClient';
const arithmetic={conflicting_anchors:'Os arquivos apresentam saldos conflitantes.',missing_anchors:'Faltam saldos em horários que comprovem os limites do período.',timezone_conflict:'Os horários dos arquivos usam fusos incompatíveis.',equal:'Abertura + movimentação identificada = encerramento informado.',different:'Abertura + movimentação identificada diverge do encerramento informado.'};
export function PeriodEvidenceReview({tenant,actor,account,from,to}:{tenant:string;actor:string;account:string;from:string;to:string}){
 const [open,setOpen]=useState(false);
 return <section className="space-y-2 rounded border p-3" aria-label="Saldos e cobertura dos arquivos"><h3 className="font-medium">Saldos e cobertura dos arquivos</h3>
  <p className="text-sm">Conferência adicional dos saldos contábeis e períodos declarados em OFX. Saldo disponível não substitui saldo contábil.</p>
  {!open?<Button variant="outline" onClick={()=>setOpen(true)}>Examinar evidências de saldo</Button>:<Workspace key={`${tenant}:${actor}:${account}:${from}:${to}`} tenant={tenant} actor={actor} account={account} from={from} to={to}/>}
 </section>;
}
function Workspace({tenant,actor,account,from,to}:{tenant:string;actor:string;account:string;from:string;to:string}){
 const storageKey=`finance-period-evidence:${tenant}:${actor}:${account}:${from}:${to}`;
 const [recovery]=useState<{command:PeriodEvidenceCommand|null;error:boolean}>(()=>{
  try{const raw=sessionStorage.getItem(storageKey);if(!raw)return {command:null,error:false};const parsed=periodEvidenceCommandSchema.parse(JSON.parse(raw));
   return parsed.tenant_id===tenant&&parsed.account_id===account&&parsed.from===from&&parsed.to===to?{command:parsed,error:false}:{command:null,error:true};
  }catch{return {command:null,error:true};}
 });
 const [pending,setPending]=useState(recovery.command);
 const [reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),sending=useRef(false),client=useQueryClient();
 const query=useQuery({queryKey:['finance-period-evidence',tenant,actor,account,from,to],queryFn:()=>readPeriodEvidence(tenant,account,from,to),retry:false});
 async function save(){
  if(recovery.error||sending.current||(!pending&&!query.data))return;
  let command:PeriodEvidenceCommand;
  try{command=pending??periodEvidenceCommandSchema.parse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),account_id:account,from,to,revision:query.data!.revision,reason});}
  catch{setMessage('Os dados da revisão são inválidos. Nenhum pedido foi enviado.');return;}
  sending.current=true;setBusy(true);setMessage('');
  try{sessionStorage.setItem(storageKey,JSON.stringify(command));}catch{setMessage('Não foi possível preservar o pedido. A revisão não foi enviada.');sending.current=false;setBusy(false);return;}
  setPending(command);
  try{const result=await recordPeriodEvidence(command);sessionStorage.removeItem(storageKey);setPending(null);setReason('');setMessage(`Revisão registrada: ${result.review_id}. Autoria e evidências foram preservadas no histórico. O período continua aberto.`);
   void client.invalidateQueries({queryKey:['finance-audit',tenant]});
  }catch(error){const text=error instanceof Error?error.message:'';
   if(text.includes('finance_period_evidence_changed')){sessionStorage.removeItem(storageKey);setPending(null);setMessage('As evidências mudaram. Consulte novamente e registre uma nova revisão.');void query.refetch();}
   else setMessage('Não foi possível confirmar a revisão. O pedido foi preservado; retome para consultar o mesmo resultado sem duplicar.');
  }finally{sending.current=false;setBusy(false);}
 }
 const data=query.error?undefined:query.data;
 return <div className="space-y-3">
  {recovery.error&&<p role="alert">Não foi possível recuperar o pedido preservado. Novas revisões estão bloqueadas para evitar duplicação. Confira o histórico e recupere o pedido com o suporte; o conteúdo local foi mantido.</p>}
  {query.isPending&&<p role="status">Consultando evidências…</p>}{query.error&&<p role="alert">Não foi possível ler as evidências deste período.</p>}
  {data&&<><p>{data.qualified_source_count} arquivo(s) OFX com linhas conferidas e conta identificada exatamente.</p>
   <p>{data.missing_declared_days} dia(s) sem declaração nativa de cobertura integral. {data.declaration_status==='timezone_conflict'&&'Há conflito de fusos entre as declarações.'}</p>
   <dl className="grid gap-2 sm:grid-cols-3"><div><dt>Saldo anterior informado</dt><dd>{data.opening_balance_cents===null?'Não disponível':formatFinanceCents(data.opening_balance_cents)}</dd></div>
    <div><dt>Saldo de encerramento informado</dt><dd>{data.closing_balance_cents===null?'Não disponível':formatFinanceCents(data.closing_balance_cents)}</dd></div>
    <div><dt>Diferença aritmética</dt><dd>{data.difference_cents===null?'Não comparável':formatFinanceCents(data.difference_cents)}</dd></div></dl>
   <p>{arithmetic[data.arithmetic_status]}</p>
   {data.anchors.length>0&&<details><summary>Ver fontes dos saldos</summary><ul>{data.anchors.map(anchor=><li key={anchor.verification_id}>{anchor.day} · {anchor.file_name} · {formatFinanceCents(anchor.cents)} · arquivo {anchor.import_id} · verificação {anchor.verification_id}</li>)}</ul></details>}
   <p className="text-sm">Um intervalo declarado completo e saldos iguais não comprovam autenticidade ou ausência de omissões. Precisão de horário, demais controles e integração dos registros antigos continuam necessários; esta revisão não fecha o período.</p>
   {!pending&&<label className="block">Observações da revisão<Textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder="Evidências conferidas e pendências encontradas"/></label>}
  </>}
  {pending&&<p role="status">Existe uma revisão enviada sem confirmação local. Retomar preserva o pedido original e suas observações.</p>}
  {(data||pending)&&<Button onClick={()=>void save()} disabled={recovery.error||busy||(!pending&&reason.trim().length<5)}>{busy?'Registrando…':pending?'Retomar revisão enviada':'Registrar revisão das evidências'}</Button>}
  {message&&<p role="status">{message}</p>}
 </div>;
}
