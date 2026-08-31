import type { SupabaseClient } from '@supabase/supabase-js';
type RecordData = Record<string, unknown>;
interface Intent extends RecordData {
 id: string; request_payload: RecordData; hub_document_id?: string; status?: string;
 dispatch_state?: string; last_response?: RecordData;
}
interface DispatchInput {
 admin: SupabaseClient; tenant: string; actor: string; emitter: string; type: string; environment: string;
 body: RecordData; fiscalId?: string; cteId?: string; nfseId?: string;
 call: (method: string, path: string, query?: Record<string,string>, body?: unknown) => Promise<{status: number; data: unknown}>;
}
const record = (value: unknown): RecordData => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
const uncertain = (id: string) => ({
 status: 409, data: {success: false, emission: {id}, error: {
  code: 'FISCAL_RECONCILIATION_REQUIRED',
  message: 'Resultado fiscal pendente de conciliação. Não emita outra nota. Consulte a operação existente pela referência '+id+'.',
 }},
});

/** At most one outbound POST per durable intent. Unknown outcomes never expire into a resend. */
export async function dispatchFiscalEmission(input: DispatchInput) {
 const {admin,tenant,actor,emitter,type,environment,body,call}=input;
 const claimed=await admin.rpc('claim_hub_fiscal_emission',{
  _tenant:tenant,_actor:actor,_emitter:emitter,_type:type,_environment:environment,_body:body,
  _fiscal_id:input.fiscalId||null,_cte_id:input.cteId||null,_nfse_id:input.nfseId||null,
 });
 if(claimed.error) throw new Error('Não foi possível reservar a emissão: '+claimed.error.message);
 const claim=record(claimed.data), emission=record(claim.emission) as Intent;
 if(typeof emission.id!=='string'||!emission.request_payload)throw new Error('Confirmação da reserva fiscal inválida.');
 let result: {status:number;data:unknown};
 if(claim.dispatch===true){
  try {result=await call('POST','/hub_documents_emit',{type},emission.request_payload);}
  catch {
   await admin.rpc('complete_hub_fiscal_emission',{_tenant:tenant,_emission:emission.id,
    _response:{error:{code:'TRANSPORT_UNCERTAIN'}},_http_status:503});
   return uncertain(emission.id);
  }
 } else if(emission.hub_document_id){
  // GET only: refresh provider state, then repair all local mirrors in one transaction.
  try { result=await call('GET','/hub_documents_get',{id:emission.hub_document_id}); }
  catch {return uncertain(emission.id);}
 } else {
  return uncertain(emission.id);
 }
 // Save the receipt separately so a failure in the mirror transaction is recoverable with GET.
 const receipt=record(result.data).document;
 if(emission.hub_document_id && record(receipt).id && record(receipt).id!==emission.hub_document_id)return uncertain(emission.id);
 if(result.status<400 && typeof record(receipt).id==='string') {
  const received=await admin.from('hub_fiscal_emissions').update({hub_document_id:record(receipt).id,last_response:record(result.data)})
   .eq('id',emission.id).eq('tenant_id',tenant).select('id').single();
  if(received.error||!received.data)return uncertain(emission.id);
 }
 const saved=await admin.rpc('complete_hub_fiscal_emission',{
  _tenant:tenant,_emission:emission.id,_response:record(result.data),_http_status:result.status,
 });
 if(saved.error||record(saved.data).confirmed!==true)return uncertain(emission.id);
 // Read committed state: a callback may have won the race with the HTTP response.
 const current=await admin.from('hub_fiscal_emissions').select('*').eq('id',emission.id).eq('tenant_id',tenant).single();
 if(current.error||!current.data)return uncertain(emission.id);
 const committed=current.data;
 const provider=record(record(result.data).document);
 const document={...provider,id:committed.hub_document_id,status:committed.status,accessKey:committed.access_key,
  authorizationProtocol:committed.authorization_protocol,number:committed.number,series:committed.series,
  pdfUrl:committed.pdf_url,xmlUrl:committed.xml_url,message:committed.message};
 return {status:200,data:{success:true,hub:{document},emission:{id:committed.id},recovered:claim.dispatch!==true}};
}

