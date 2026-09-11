import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {parseMoneyCents} from '@/lib/financial/receivableCommands';
import {settlementPaymentCommandSchema,type SettlementPaymentCommand} from '@/lib/financial/settlementPaymentContract';
import {recordSettlementPayment,readSettlementPaymentCandidates,settlementPaymentError,SettlementPaymentRejectedError} from '@/lib/financial/settlementPaymentClient';
const money=(n:number)=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function SettlementPaymentWorkspace({tenant,actor,settlement,initialAmount,allowNew=true,onClose}:{tenant:string;actor:string;settlement:string;initialAmount:number;allowNew?:boolean;onClose:()=>void}){
 const key=`finance-settlement-payment:${tenant}:${actor}:${settlement}`;
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {};const saved=JSON.parse(raw),command=settlementPaymentCommandSchema.parse(saved.command);if(saved.actor!==actor||command.tenant_id!==tenant||command.settlement_id!==settlement)throw new Error();return {command};}catch{return {error:'Não foi possível recuperar o pedido. Verifique o histórico antes de registrar outro pagamento.'};}});
 const [command,setCommand]=useState<SettlementPaymentCommand|undefined>(restored.command),[amount,setAmount]=useState(initialAmount>0?initialAmount.toFixed(2):'');
 const [method,setMethod]=useState<SettlementPaymentCommand['method']>('pix'),[reason,setReason]=useState(''),[choice,setChoice]=useState(''),[page,setPage]=useState(1);
 const [error,setError]=useState(restored.error||''),[busy,setBusy]=useState(false),[success,setSuccess]=useState(false),[review,setReview]=useState(false);
 const live=useRef(true),sending=useRef(false),cache=useQueryClient();useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 let cents=0;try{cents=parseMoneyCents(amount);}catch{/* Invalid amount disables query and submission. */}
 const query=useQuery({queryKey:['finance-settlement-payment-candidates',tenant,actor,settlement,cents,page],queryFn:()=>readSettlementPaymentCandidates(tenant,settlement,cents,page),enabled:allowNew&&cents>0&&!command&&!restored.error&&!success,retry:false});
 const data=query.error||query.isFetching?undefined:query.data,selected=data?.rows.find(row=>row.id===choice);
 const valid=allowNew&&!!selected&&!!data&&cents<=data.balance_cents&&cents<=selected.remaining_cents&&reason.trim().length>=10;
 async function submit(){
  if(sending.current||restored.error)return;let original=command;
  if(!original){if(!valid||!review)return;const parsed=settlementPaymentCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),settlement_id:settlement,movement_id:choice,amount_cents:cents,method,reason});if(!parsed.success)return;original=parsed.data;
   try{sessionStorage.setItem(key,JSON.stringify({actor,command:original}));}catch{setError('Não foi possível preservar o pedido. Nenhum pagamento foi enviado.');return;}setCommand(original);
  }
  sending.current=true;setBusy(true);setError('');
  try{await recordSettlementPayment(original);sessionStorage.removeItem(key);
   for(const prefix of ['driver_settlement','driver_settlements','finance-settlement-payment-candidates','finance-settlement-movements','finance-options','finance-payable-options','finance-manual-expense-options','finance-payroll','payroll_periods','payroll_period','payroll_entries','payroll_entry_items','finance-recorded-costs','finance-recorded-cost-summary','finance-movements','finance-audit'])void cache.invalidateQueries({queryKey:[prefix]});
   if(live.current){setCommand(undefined);setSuccess(true);}
  }catch(e){if(e instanceof SettlementPaymentRejectedError&&!command){try{sessionStorage.removeItem(key);if(live.current){setCommand(undefined);setChoice('');setReview(false);setError(`Pagamento recusado: ${settlementPaymentError(e)}. Atualize a seleção.`);}void query.refetch();}catch{if(live.current)setError('Pedido recusado, mas a recuperação local não pôde ser atualizada. Verifique o histórico.');}}
   else if(live.current)setError(`${settlementPaymentError(e)} O pedido original foi preservado para retomada.`);
  }finally{sending.current=false;if(live.current)setBusy(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Registrar pagamento do acerto</DialogTitle><DialogDescription>Registra um pagamento feito com uma saída existente. O sistema não executa transferências. A data da saída será a data do pagamento.</DialogDescription></DialogHeader>
 {error&&<p role="alert">{error}</p>}{!allowNew&&!command&&<p role="alert">Novo registro indisponível nesta abertura. Retome um pedido preservado ou revise o acerto antes de iniciar outro pagamento.</p>}{success?<p role="status">Pagamento registrado e vinculado. Nenhuma nova saída de dinheiro foi criada.</p>:command?<><p>Pedido preservado: {command.request_id}</p><p>Valor: {money(command.amount_cents)} · método: {command.method}</p><p>Saída: {command.movement_id}</p><p>Motivo: {command.reason}</p><Button disabled={busy||!!restored.error} onClick={()=>void submit()}>Retomar pagamento original</Button></>:<>
 <label>Valor pago (R$)<Input inputMode="decimal" value={amount} disabled={review} onChange={event=>{setAmount(event.target.value);setChoice('');setPage(1);}}/></label>
 {amount&&!cents&&<p>Informe valor positivo, sem separador de milhar e com até duas casas decimais.</p>}
 {cents>0&&query.isFetching&&<p>Consultando saldo e saídas…</p>}{query.isError&&<p role="alert">Não foi possível consultar as saídas. {settlementPaymentError(query.error)}<Button onClick={()=>void query.refetch()}>Atualizar consulta</Button></p>}
 {data&&<p>Saldo do acerto: {money(data.balance_cents)}</p>}{data&&cents>data.balance_cents&&<p role="alert">O pagamento não pode superar o saldo do acerto.</p>}
 {!review&&<><fieldset><legend>Saída já registrada</legend>{data?.rows.map(row=><label key={row.id} className="flex gap-2 border rounded p-2 my-2"><input type="radio" name="settlement-payment-movement" checked={choice===row.id} onChange={()=>setChoice(row.id)}/><span>{row.description} · {row.account_name} · {row.occurred_on}<br/>{row.beneficiary_name} · total {money(row.amount_cents)} · disponível {money(row.remaining_cents)}</span></label>)}</fieldset>{data?.total===0&&<p>Nenhuma saída elegível. Confira o motorista e a capacidade disponível; gastos já atribuídos não podem ser contados outra vez.</p>}<div className="flex gap-2"><Button variant="outline" disabled={page===1} onClick={()=>{setPage(page-1);setChoice('');}}>Anterior</Button><span>Página {page}</span><Button variant="outline" disabled={!data||page*20>=data.total} onClick={()=>{setPage(page+1);setChoice('');}}>Próxima</Button></div></>}
 <label>Método<select value={method} disabled={review} onChange={event=>setMethod(event.target.value as SettlementPaymentCommand['method'])}><option value="pix">PIX</option><option value="ted">TED</option><option value="cash">Dinheiro</option><option value="other">Outro</option></select></label>
 <label>Motivo do registro<Textarea maxLength={2000} disabled={review} value={reason} onChange={event=>setReason(event.target.value)}/></label>
 {review?<><p>Confirmar {money(cents)} da saída {selected?.description||choice}. Data do pagamento: {selected?.occurred_on||'Atualizando consulta'}.</p><Button disabled={!valid||busy||!!restored.error} onClick={()=>void submit()}>Confirmar registro do pagamento</Button><Button variant="outline" disabled={busy} onClick={()=>setReview(false)}>Voltar à edição</Button></>:<Button disabled={!valid||!!restored.error} onClick={()=>setReview(true)}>Revisar pagamento</Button>}
 </>}<Button variant="outline" onClick={onClose}>Fechar</Button></DialogContent></Dialog>;
}
