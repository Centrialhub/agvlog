import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {createPayableXmlOutbox,discardPendingPayableXml,lockPayableXml,pendingPayableXml,type PendingPayableXml} from '@/lib/financial/payableXmlOutbox';
import {discardPayableXmlUpload,preservePayableXmlFile,readPayableXmlContext,sendPayableXml,payableXmlError,payableXmlUploadKey} from '@/lib/financial/payableXmlClient';
import {payableXmlFieldsSchema} from '@/lib/financial/payableXmlContract';
import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import type {z} from 'zod';
export function usePayableXmlSave(tenant:string,actor:string){const cache=useQueryClient(),mounted=useRef(true),scope=useRef({tenant,actor}),busyRef=useRef(false);scope.current={tenant,actor};const [pending,setPending]=useState<PendingPayableXml|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState<string|null>(null),[cacheWarning,setCacheWarning]=useState('');
 const read=useCallback(()=>{try{setPending(pendingPayableXml(localStorage,tenant,actor));}catch(e){setPending(null);setError(payableXmlError(e));}},[tenant,actor]);
 useEffect(()=>{mounted.current=true;read();window.addEventListener('storage',read);return()=>{mounted.current=false;window.removeEventListener('storage',read);};},[tenant,actor,read]);
 const assertContext=(t:string,a:string)=>{if(!mounted.current||scope.current.tenant!==t||scope.current.actor!==a)throw Error('A sessão mudou. Recupere o pedido na empresa e usuário originais.');};
 const outbox=useMemo(()=>createPayableXmlOutbox({storage:localStorage,uuid:()=>crypto.randomUUID(),lock:lockPayableXml,assertContext,changed:read,send:sendPayableXml}),[read]);
 async function run(file?:File,fields?:z.infer<typeof payableXmlFieldsSchema>,original?:Record<string,unknown>|null){if(busyRef.current)throw Error('Aguarde o pedido em andamento.');busyRef.current=true;setBusy(true);setError('');setCacheWarning('');setConfirmed(null);try{
  let uploadRaw:string|null=null;let result;if(file&&fields){if(pendingPayableXml(localStorage,tenant,actor))throw Error('Recupere o salvamento anterior antes de enviar outra conta.');const validated=payableXmlFieldsSchema.parse(fields);let revision:string|null=null;const payableId=original?String(original.id):null;
   if(original&&payableId){const context=await readPayableXmlContext(tenant,actor,payableId);assertContext(tenant,actor);if(Object.keys(original).some(k=>JSON.stringify(original[k])!==JSON.stringify(context.payable[k])))throw Error('A conta mudou desde a abertura. Reabra para conferir os valores atuais.');revision=context.revision;}
   const artifact=await preservePayableXmlFile(tenant,actor,file);assertContext(tenant,actor);uploadRaw=localStorage.getItem(payableXmlUploadKey(tenant,actor));result=await outbox.submit(tenant,actor,{artifact_id:artifact.artifact_id,payable_id:payableId,expected_revision:revision,fields:validated});
  }else result=await outbox.recover(tenant,actor);
  assertContext(tenant,actor);setConfirmed(result.payable_id);try{if(uploadRaw!==null&&localStorage.getItem(payableXmlUploadKey(tenant,actor))===uploadRaw)localStorage.removeItem(payableXmlUploadKey(tenant,actor));}catch{/* A confirmed command remains confirmed. */}
  try{await invalidateAccountReview(cache,tenant);await Promise.all(['payables','finance-payable-portfolio','finance-payable-xml','finance-recorded-costs','finance-recorded-cost-summary','finance-cash-forecast-preview','finance-cash-forecast-agenda'].map(k=>cache.invalidateQueries({queryKey:[k,tenant]},{throwOnError:true})));}catch{setCacheWarning('A conta e o XML foram salvos, mas a consulta não atualizou. Atualize a página; não envie outra conta.');}
  return result;
 }catch(e){if(mounted.current)setError(payableXmlError(e));throw e;}finally{busyRef.current=false;if(mounted.current){setBusy(false);read();}}}
 return {save:run,recover:()=>run(),discardUpload:async()=>{setBusy(true);setError('');try{await discardPayableXmlUpload(tenant,actor);discardPendingPayableXml(localStorage,tenant,actor);setPending(null);setError('Upload abandonado e recuperação incompatível descartados.');}catch(e){setError(payableXmlError(e));}finally{setBusy(false);}},pending,error,busy,confirmed,cacheWarning};}
