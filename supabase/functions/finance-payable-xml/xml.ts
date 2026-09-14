export const MAX_PAYABLE_XML_BYTES=2_000_000;
type Tag={local:string;uri:string;attributes:Record<string,{local:string;value:string}>};
export interface PayableXmlReader{on(event:string,handler:(value:never)=>void):PayableXmlReader;write(xml:string):PayableXmlReader;close():unknown}
/** Bounded structural extraction only. Neither fiscal authorization nor antivirus verification. */
export function inspectPayableXml(bytes:Uint8Array,factory:()=>PayableXmlReader){
 if(!bytes.length||bytes.length>MAX_PAYABLE_XML_BYTES)throw Error('payable_xml_size_limit');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('payable_xml_entities_forbidden');
 const stack:string[]=[],values=new Map<string,string>(),counts=new Map<string,number>(),attrs=new Map<string,Record<string,string>>();let nodes=0,root='';
 const parser=factory();parser.on('error',()=>{throw Error('payable_xml_invalid');});parser.on('processinginstruction',()=>{throw Error('payable_xml_processing_instruction_forbidden');});
 parser.on('opentag',((tag:Tag)=>{if(++nodes>25000||stack.length>=64)throw Error('payable_xml_complexity');stack.push(tag.local);const path=stack.join('/');if(!root)root=tag.local;if(tag.uri!=='http://www.portalfiscal.inf.br/nfe'&&tag.uri!=='http://www.w3.org/2000/09/xmldsig#')throw Error('payable_xml_namespace_unsupported');if(tag.uri==='http://www.w3.org/2000/09/xmldsig#'&&!stack.includes('Signature'))throw Error('payable_xml_namespace_unsupported');counts.set(path,(counts.get(path)||0)+1);values.set(path,'');attrs.set(path,Object.fromEntries(Object.values(tag.attributes).map(a=>[a.local,a.value])));}) as (v:never)=>void);
 const capture=((value:string)=>{if(!stack.length)return;const path=stack.join('/'),next=(values.get(path)||'')+value;if(next.length>10000)throw Error('payable_xml_text_limit');values.set(path,next);}) as (v:never)=>void;
 parser.on('text',capture);parser.on('cdata',capture);parser.on('closetag',()=>{stack.pop();});parser.write(text).close();
 if(!['nfeProc','NFe'].includes(root))throw Error('payable_xml_layout_unsupported');const base=root==='NFe'?'NFe/infNFe':'nfeProc/NFe/infNFe';if(counts.get(base)!==1)throw Error('payable_xml_ambiguous_document');
 const get=(path:string)=>{const key=base+'/'+path;if((counts.get(key)||0)>1)throw Error('payable_xml_ambiguous_field');return values.get(key)?.trim()||null;};
 const amount=get('total/ICMSTot/vNF');if(!amount||!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount))throw Error('payable_xml_amount_invalid');const amountCents=(BigInt(amount.split('.')[0])*100n+BigInt((amount.split('.')[1]||'').padEnd(2,'0'))).toString();if(BigInt(amountCents)<=0n||BigInt(amountCents)>99999999999999n)throw Error('payable_xml_amount_invalid');
 if(get('emit/CNPJ')&&get('emit/CPF'))throw Error('payable_xml_ambiguous_field');
 const emitter=get('emit/xNome'),document=get('emit/CNPJ')||get('emit/CPF'),number=get('ide/nNF'),series=get('ide/serie'),key=attrs.get(base)?.Id?.replace(/^NFe/,'')||null;
 if(!emitter||emitter.length>1000||!document||!/^\d{11}$|^\d{14}$/.test(document)||!number||!/^\d{1,9}$/.test(number)||!series||!/^\d{1,3}$/.test(series)||!key||!/^\d{44}$/.test(key))throw Error('payable_xml_identity_invalid');
 const rawDate=get('ide/dhEmi')||get('ide/dEmi'),issueDate=rawDate?.slice(0,10)||null;if(!issueDate||!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)||!Number.isFinite(Date.parse(issueDate))||new Date(issueDate).toISOString().slice(0,10)!==issueDate)throw Error('payable_xml_date_invalid');
 return{kind:'nfe' as const,emitter_name:emitter,emitter_document:document,document_number:number,series,access_key:key,issue_date:issueDate,amount_cents:amountCents,signature_verified:false as const,antivirus_verified:false as const};
}
