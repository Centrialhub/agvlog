export const MAX_XML_BYTES=2_000_000;
export type EmissionIdentity={id:string;tenant_id:string;doc_type:'cte'|'nfse';environment:string;status:string;dispatch_state:string;hub_document_id:string;access_key:string|null;emitter_cnpj:string;number:string|null;series:string|null;authorization_protocol:string|null};
type Tag={local:string;uri:string;attributes:Record<string,{local:string;value:string}>};
export interface XmlReader {on(event:string,handler:(value:never)=>void):XmlReader;write(xml:string):XmlReader;close():unknown}
export type XmlFactory=()=>XmlReader;
const cents=(s:string|null)=>{if(!s||s.length>40||!/^\d+(\.\d{1,2})?$/.test(s))return null;const value=BigInt(s.split('.')[0])*100n+BigInt((s.split('.')[1]||'').padEnd(2,'0'));return value<=99999999999999n?value.toString():null;};
/** Syntax/identity diagnostic, never proof of signature authenticity or a projection command. */
export async function inspectExistingXml(bytes:Uint8Array,e:EmissionIdentity,createParser:XmlFactory){
 if(bytes.length>MAX_XML_BYTES)throw new Error('fiscal_xml_too_large');
 const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('fiscal_xml_external_entities_forbidden');
 const stack:string[]=[],values=new Map<string,string[]>(),counts=new Map<string,number>(),namespaces=new Map<string,string>(),attrs=new Map<string,Record<string,string>>();let nodes=0,root='',namespace='';
 const parser=createParser();
 parser.on('error',()=>{throw new Error('fiscal_xml_invalid');});
 parser.on('opentag',((tag:Tag)=>{if(++nodes>25000||stack.length>64)throw new Error('fiscal_xml_complexity');stack.push(tag.local);if(!root){root=tag.local;namespace=tag.uri;}const path=stack.join('/');counts.set(path,(counts.get(path)||0)+1);namespaces.set(path,tag.uri);if(!values.has(path))values.set(path,[]);attrs.set(path,Object.fromEntries(Object.values(tag.attributes).map(a=>[a.local,a.value])));}) as (v:never)=>void);
 parser.on('text',((text:string)=>{if(stack.length)values.get(stack.join('/'))!.push(text);}) as (v:never)=>void);
 parser.on('cdata',((text:string)=>{if(stack.length)values.get(stack.join('/'))!.push(text);}) as (v:never)=>void);
 parser.on('closetag',()=>{stack.pop();});parser.write(xml).close();
 const get=(path:string)=>counts.get(path)===1&&namespaces.get(path)===namespace?values.get(path)?.join('').trim()||null:null;
 const issues:string[]=[];let key:string|null=null,protocol:string|null=null,amount:string|null=null,issuer:string|null=null,number:string|null=null,series:string|null=null,environment:string|null=null;
 if(e.doc_type==='cte'&&root==='cteProc'&&namespace==='http://www.portalfiscal.inf.br/cte'){
  const base='cteProc/CTe/infCte',prot='cteProc/protCTe/infProt';
  if(['cteProc',base,'cteProc/protCTe'].some(path=>attrs.get(path)?.versao!=='4.00'))issues.push('cte_xml_version_unsupported');
  key=counts.get(base)===1&&namespaces.get(base)===namespace?attrs.get(base)?.Id?.replace(/^CTe/,'')||null:null;protocol=get(prot+'/nProt');issuer=get(base+'/emit/CNPJ');number=get(base+'/ide/nCT');series=get(base+'/ide/serie');environment=get(base+'/ide/tpAmb');amount=cents(get(base+'/vPrest/vTPrest'));
  if(get(prot+'/cStat')!=='100'||get(prot+'/chCTe')!==key||get(prot+'/tpAmb')!==environment||!protocol||!/^\d{15}$/.test(protocol))issues.push('xml_authorization_mismatch');
 }else if(e.doc_type==='nfse'){
  // Municipal/National layouts differ. Retrieval is supported; unsupported layouts stay unresolved.
  issues.push('nfse_authorization_layout_not_reviewed');
 }else issues.push('xml_document_type_mismatch');
 if(e.environment!=='production'||e.dispatch_state!=='recorded'||e.status!=='authorized')issues.push('stored_emission_not_authorized');
 if(e.doc_type==='cte'){
  if(!key||!/^\d{44}$/.test(key)||key!==e.access_key||issuer!==e.emitter_cnpj||number!==e.number||series!==e.series||environment!=='1')issues.push('xml_emission_identity_mismatch');
  if(!amount||BigInt(amount)<=0n)issues.push('xml_amount_invalid');
  if(e.authorization_protocol&&protocol!==e.authorization_protocol)issues.push('stored_protocol_differs');
 }
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer))).map(b=>b.toString(16).padStart(2,'0')).join('');
 return {version:1,tenant_id:e.tenant_id,emission_id:e.id,document_type:e.doc_type,sha256:hash,size_bytes:bytes.length,format:root,identity_matches:e.doc_type==='cte'&&!issues.some(x=>x.includes('identity')||x.includes('type')),issues,protocol,amount_cents:amount,signature_verified:false,can_project:false,can_receive:false};
}
export async function downloadExistingXml(base:string,token:string,id:string,fetcher:typeof fetch=fetch){
 const endpoint=new URL(base);if(endpoint.protocol!=='https:'||!/^\w{20}\.supabase\.co$/.test(endpoint.hostname)||endpoint.pathname!=='/functions/v1'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password||!/^[-\w]{1,128}$/.test(id))throw new Error('fiscal_download_route_not_allowed');
 endpoint.pathname+='/hub_documents_file';endpoint.searchParams.set('id',id);endpoint.searchParams.set('kind','xml');
 const response=await fetcher(endpoint,{method:'GET',redirect:'manual',headers:{Authorization:`Bearer ${token}`,'X-HubFiscal-Api-Version':'2026-08-27'},signal:AbortSignal.timeout(15000)});
 if(!response.ok||response.status>=300)throw new Error('fiscal_existing_xml_unavailable');
 if(Number(response.headers.get('content-length')||0)>MAX_XML_BYTES)throw new Error('fiscal_xml_too_large');
 const reader=response.body?.getReader();if(!reader)throw new Error('fiscal_existing_xml_unavailable');const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_XML_BYTES)throw new Error('fiscal_xml_too_large');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 // No URL/base64 fallback: JSON/signed-link responses need a separately reviewed contract.
 if(!new TextDecoder().decode(bytes.slice(0,200)).trimStart().startsWith('<'))throw new Error('fiscal_existing_xml_response_unsupported');return bytes;
}
