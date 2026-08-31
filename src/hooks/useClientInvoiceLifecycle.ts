import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import type {CreateClientInvoicePayload} from '@/hooks/useClientInvoices';
import {invoiceError,parseInvoiceContext,parseInvoiceCreationContext,type InvoiceCommandInput,type InvoiceResult} from '@/lib/financial/clientInvoiceCommands';
import {INVOICE_COMMAND_CHANGED,createInvoiceOutbox,pendingInvoiceCommand} from '@/lib/financial/clientInvoiceOutbox';
export function useClientInvoiceLifecycle(invoice?:string,report?:string){
 const {user}=useAuth();const {currentTenant}=useTenant();const actor=user?.id;const tenant=currentTenant?.id;
 const latest=useRef({actor,tenant});latest.current={actor,tenant};const alive=useRef(true);const busy=useRef(false);const client=useQueryClient();
 const [isPending,setPending]=useState(false);const [revision,setRevision]=useState(0);
 useEffect(()=>{alive.current=true;const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(INVOICE_COMMAND_CHANGED,changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener(INVOICE_COMMAND_CHANGED,changed);};},[]);
 const assertContext=useCallback(()=>{if(!alive.current||latest.current.actor!==actor||latest.current.tenant!==tenant)throw new Error('A sessão ou empresa mudou. Recupere a fatura na sessão original.');},[actor,tenant]);
 const query=useQuery({queryKey:['client-invoice-context',tenant,actor,invoice],enabled:!!tenant&&!!actor&&!!invoice,retry:false,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('get_client_invoice_action_context',{_tenant_id:tenant!,_invoice_id:invoice!}).abortSignal(signal);
   if(error)throw new Error(invoiceError(error));assertContext();return parseInvoiceContext(data,tenant!,actor!,invoice!);}});
 const creation=useQuery({queryKey:['client-invoice-creation',tenant,actor,report],enabled:!!tenant&&!!actor&&!!report,retry:false,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('get_client_invoice_creation_context',{_tenant_id:tenant!,_report_id:report!,_draft:null}).abortSignal(signal);
   if(error)throw new Error(invoiceError(error));assertContext();return parseInvoiceCreationContext(data,tenant!,actor!,report!);}});
 const quote=async(draft:CreateClientInvoicePayload)=>{assertContext();if(!tenant||!actor||draft.tenant_id!==tenant)throw new Error('Empresa da prévia incompatível.');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
  try{const {data,error}=await supabase.rpc('get_client_invoice_creation_context',{_tenant_id:tenant,_report_id:null,_draft:JSON.parse(JSON.stringify(draft))}).abortSignal(controller.signal);
   if(error)throw new Error(invoiceError(error));assertContext();return parseInvoiceCreationContext(data,tenant,actor,null);}finally{clearTimeout(timeout);}};
 const outbox=useMemo(()=>createInvoiceOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(INVOICE_COMMAND_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use navegador atualizado em conexão segura para confirmar a fatura.');return navigator.locks.request(key,work);},
  send:async payload=>{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
   try{return await supabase.rpc('apply_client_invoice_command',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}finally{clearTimeout(timeout);}}
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,pending:tenant&&actor?pendingInvoiceCommand(window.localStorage,tenant,actor):null,error:null};}
  catch(cause){return {revision,pending:null,error:invoiceError(cause)};}},[tenant,actor,revision]);
 const run=async(work:()=>Promise<InvoiceResult>)=>{
  if(!tenant||!actor)throw new Error('Entre com uma sessão válida e selecione a empresa.');if(busy.current)throw new Error('Aguarde a operação de fatura em andamento.');assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(cause){throw new Error(invoiceError(cause));}
  finally{try{await Promise.all(['client-invoice-context','client-invoice-creation','client_invoices','client_invoice_detail','receivable-financial-context','receivables','closing-reports','closing-report','closing-action-context','eligible_ctes','eligible_nfse','financial_obligations','financial_matches_suggested'].map(key=>client.invalidateQueries({queryKey:[key]})));}
   finally{busy.current=false;if(alive.current)setPending(false);}}
 };
 return {query,creation,quote,isPending,pending:recovery.pending,recoveryError:recovery.error,submit:(input:InvoiceCommandInput)=>run(()=>outbox.submit(tenant!,actor!,input)),recover:()=>run(()=>outbox.recover(tenant!,actor!))};
}
