import {financeError} from '@/lib/financial/ledgerContract';
import {movementUseError} from '@/lib/financial/movementUseErrors';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {linkSettlementMovement,readSettlementMovements,SettlementMovementRejectedError} from '@/lib/financial/settlementMovementClient';
import {settlementMovementCommandSchema,type SettlementMovementCommand} from '@/lib/financial/settlementMovementContract';
import {FinanceAccessBoundary} from './FinanceAccessBoundary';
import {SettlementLinkReversal} from './SettlementLinkReversal';
const money=(cents:number)=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function SettlementMovementLink({payment,settlement}:{payment:string;settlement:string}){
 const {currentTenant}=useTenant(),{user}=useAuth();
 if(!currentTenant||!user)return null;
 return <SettlementMovementEntry key={`${currentTenant.id}:${user.id}:${payment}`} tenant={currentTenant.id} actor={user.id} payment={payment} settlement={settlement}/>;
}
export function SettlementMovementEntry({tenant,actor,payment,settlement}:{tenant:string;actor:string;payment:string;settlement:string}){
 const [open,setOpen]=useState(false);
 return <><Button size="sm" variant="outline" onClick={()=>setOpen(true)}>Vínculo da saída</Button>{open&&<FinanceAccessBoundary><SettlementMovementWorkspace tenant={tenant} actor={actor} payment={payment} settlement={settlement} onClose={()=>setOpen(false)}/></FinanceAccessBoundary>}</>;
}
export function SettlementMovementWorkspace({tenant,actor,payment,settlement,onClose}:{tenant:string;actor:string;payment:string;settlement:string;onClose:()=>void}){
 const key=`finance-settlement-link:${tenant}:${actor}:${payment}`;
 const [restored]=useState(()=>{
  try{const raw=sessionStorage.getItem(key);if(!raw)return {};
   const saved=JSON.parse(raw),command=settlementMovementCommandSchema.parse(saved.command);
   if(saved.actor!==actor||command.tenant_id!==tenant||command.payment_id!==payment)throw new Error();
   return {command};
  }catch{return {error:'Não foi possível recuperar o pedido. Não envie outro vínculo antes de verificar o histórico.'};}
 });
 const [command,setCommand]=useState<SettlementMovementCommand|undefined>(restored.command);
 const [error,setError]=useState(restored.error||''),[choice,setChoice]=useState(''),[reason,setReason]=useState('');
 const [page,setPage]=useState(1),[busy,setBusy]=useState(false),[success,setSuccess]=useState(false);
 const [reversalPending,setReversalPending]=useState(false);
 const alive=useRef(true),sending=useRef(false),cache=useQueryClient();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const query=useQuery({queryKey:['finance-settlement-movements',tenant,actor,payment,page],queryFn:()=>readSettlementMovements(tenant,payment,page),retry:false});
 const data=query.error?undefined:query.data,contextValid=data?.settlement_id===settlement;
 async function submit(){
  if(sending.current||restored.error||reversalPending)return;
  let original=command;
  if(!original){
   if(!contextValid||!data||data.link||!data.rows.some(row=>row.id===choice))return;
   const parsed=settlementMovementCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),payment_id:payment,movement_id:choice,reason});
   if(!parsed.success){setError('Informe a saída e uma justificativa com pelo menos 10 caracteres.');return;}
   original=parsed.data;
   try{sessionStorage.setItem(key,JSON.stringify({actor,command:original}));}catch{setError('Não foi possível preservar o pedido neste navegador. Nenhum vínculo foi enviado.');return;}
   setCommand(original);
  }
  sending.current=true;setBusy(true);setError('');
  try{
   const result=await linkSettlementMovement(original);
   if(result.settlement_id!==settlement)throw new Error('Resposta fora do acerto.');
   sessionStorage.removeItem(key);
   for(const prefix of ['finance-settlement-movements','finance-movements','finance-audit','finance-legacy-inventory','finance-payable-options','finance-options','finance-manual-expense-options','finance-payroll'])void cache.invalidateQueries({queryKey:[prefix]});
   if(alive.current){setCommand(undefined);setSuccess(true);}
  }catch(e){
   if(e instanceof SettlementMovementRejectedError&&!command){
    try{sessionStorage.removeItem(key);if(alive.current){setCommand(undefined);setChoice('');setError(`Vínculo recusado: ${movementUseError(e)||'Confira os dados do pagamento e da saída selecionada'}. Revise a seleção e tente novamente.`);}void query.refetch();}
    catch{if(alive.current)setError('Pedido recusado, mas não foi possível atualizar a recuperação local. Verifique o histórico antes de continuar.');}
   }else if(alive.current)setError(`${movementUseError(e)||financeError(e)} O pedido original foi preservado; retome para obter a confirmação.`);
  }
  finally{sending.current=false;if(alive.current)setBusy(false);}
 }
 return <Dialog open onOpenChange={value=>{if(!value)onClose();}}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Vincular pagamento à saída registrada</DialogTitle><DialogDescription>Relaciona o pagamento existente ao dinheiro registrado para o mesmo motorista e dia. A conferência com o extrato continua separada.</DialogDescription></DialogHeader>
 {error&&<p role="alert">{error}</p>}
 {success&&<p role="status">Vínculo confirmado. Nenhum pagamento ou movimento adicional foi criado.</p>}
 {query.isPending&&<p>Consultando pagamento e saídas…</p>}{query.isError&&<p role="alert">Não foi possível consultar o vínculo. {movementUseError(query.error)||'Confira o pagamento e a saída selecionada.'} <Button onClick={()=>void query.refetch()}>Tentar consulta novamente</Button></p>}
 {data&&!contextValid&&<p role="alert">Pagamento fora do acerto selecionado.</p>}
 {data&&contextValid&&<><p>Pagamento: {money(data.amount_cents)}</p>{data.link&&<div className="rounded border p-3 space-y-1"><p>Vinculado: {money(data.link.amount_cents)}</p><p>Saída: {data.link.movement_id}</p><p>Por {data.link.actor_name} ({data.link.created_by})</p><p>Em {new Date(data.link.created_at).toLocaleString('pt-BR')}</p><p>Motivo: {data.link.reason||'Consultar auditoria'}</p></div>}</>}
 {data&&contextValid&&<section aria-label="Histórico permanente dos vínculos" className="space-y-2"><h3>Histórico de intervenções manuais</h3>{data.history.length===0?<p>Nenhum vínculo anterior.</p>:data.history.map(item=><article key={item.id} className="rounded border border-amber-600 p-3"><p>Vínculo manual · {item.reversal?'Desfeito':'Ativo'} · {money(item.amount_cents)}</p><p>Saída: {item.movement_id}</p><p>Vinculado por {item.actor_name} ({item.created_by}) em {new Date(item.created_at).toLocaleString('pt-BR')}</p><p>Motivo: {item.reason||'Consultar auditoria'}</p>{item.reversal&&<><p>Desfeito por {item.reversal.actor_name} ({item.reversal.actor_id}) em {new Date(item.reversal.created_at).toLocaleString('pt-BR')}</p><p>Motivo da correção: {item.reversal.reason}</p></>}</article>)}</section>}
 <SettlementLinkReversal tenant={tenant} actor={actor} payment={payment} activeLink={contextValid?data?.link?.id||null:null} disabled={!!command||busy||!!restored.error} onPendingChange={setReversalPending} onConfirmed={()=>{setSuccess(false);setChoice('');}}/>
 {command&&!success?<><p>Pedido preservado: {command.request_id}</p><p>Saída: {command.movement_id}</p><p>Justificativa: {command.reason}</p><Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':'Retomar pedido original'}</Button></>:!success&&contextValid&&!data?.link&&<>
 <fieldset disabled={busy}><legend>Saídas com capacidade para o valor integral</legend>{data?.rows.map(row=><label key={row.id} className="flex gap-2 rounded border p-2 my-2"><input type="radio" name="settlement-movement" checked={choice===row.id} onChange={()=>setChoice(row.id)}/><span>{row.description} · {row.account_name} · {row.occurred_on}<br/>{row.beneficiary_name} · total {money(row.amount_cents)} · disponível {money(row.remaining_cents)}</span></label>)}</fieldset>
 {data?.total===0&&<p>Nenhuma saída elegível. Confira motorista, data e valores registrados. Acertos que reembolsam despesas já atribuídas à mesma saída exigem revisão da composição; não registre outro gasto para contornar a falta de capacidade.</p>}
 <div className="flex gap-2"><Button variant="outline" disabled={page===1} onClick={()=>{setPage(page-1);setChoice('');}}>Anterior</Button><span>Página {page}</span><Button variant="outline" disabled={!data||page*20>=data.total} onClick={()=>{setPage(page+1);setChoice('');}}>Próxima</Button></div>
 <label>Justificativa<Textarea value={reason} onChange={event=>setReason(event.target.value)} maxLength={2000}/></label>
 <p>Confirme que o valor integral deste pagamento pertence à saída escolhida.</p><Button disabled={!choice||reason.trim().length<10||busy||!!restored.error||reversalPending} onClick={()=>void submit()}>Confirmar vínculo existente</Button>
 </>}
 <Button variant="outline" onClick={onClose}>Fechar</Button>
 </DialogContent></Dialog>;
}
