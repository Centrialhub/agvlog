import type {BuiltItem,BuiltPreview,Divergence,FreightAllocation,SummaryLine} from './closingReportBuilder';
import type {ClosingSources,ClosingSource,ClosingFiscalCandidate} from './closingSources';
export interface ClosingAttemptTrace {version:1;source_key:string;allocation_id:string|null;attempt_id:string|null;historical:boolean;
 outcome_id:string|null;occurred_at:string|null;physical_source:ClosingSource['physical']['source'];volume_count_verified:boolean;
 fiscal_source_kind:ClosingFiscalCandidate['kind']|null;fiscal_source_id:string|null;financial_review_required:boolean;freight_allocation_mode:FreightAllocation}
export type AttemptBuiltItem=BuiltItem&{metadata:ClosingAttemptTrace};
export interface ClosingAttemptPreview extends BuiltPreview {items:AttemptBuiltItem[];source_context:Pick<ClosingSources,'tenant_id'|'actor_id'|'filters'|'revision'>;
 totals:BuiltPreview['totals']&{attempt_count:number};financial_review_required:boolean;posting_enabled:false}
const invoiceIdentity=(i:BuiltItem)=>i.invoice_key||i.fiscal_document_id||String(i.sort_order);
const sum=(items:BuiltItem[],key:'freight_value'|'weight_kg'|'volume_count')=>items.reduce((total,i)=>total+i[key],0);
const uniqueInvoices=(items:BuiltItem[])=>Array.from(new Map(items.map(item=>[invoiceIdentity(item),item])).values());
const money=(value:number)=>Math.round(value*100)/100;
function moneyTotal(items:BuiltItem[],key:'invoice_value'|'freight_value'){
 const cents=items.reduce((value,item)=>value+BigInt(Math.round(item[key]*100)),0n);
 if(cents>BigInt(Number.MAX_SAFE_INTEGER)||cents<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('Total excede a precisão segura. Reduza a seleção antes de conferir.');
 return Number(cents)/100;
}
const links=(c:ClosingFiscalCandidate,s:ClosingSource)=>s.attempt_id===null&&!!s.document.load_id&&
 !!c.document_ids?.includes(s.document.id)&&!!c.load_ids?.includes(s.document.load_id);
function eligible(c:ClosingFiscalCandidate){return c.environment==='production'&&c.status==='authorized'&&
 c.sefaz_status==='authorized'&&!c.cancelled_at&&c.is_voided===false&&c.freight_value!==null&&c.freight_value>=0;}
// Integer-rational largest-remainder allocation: a complete universe shares the
// exact CT-e cents. The visible subset never receives the omitted NF's share.
export function allocateClosingCents(total:number,weights:Array<{key:string;weight:number}>):Map<string,number>|null{
 if(total<0||!Number.isSafeInteger(Math.round(total*100))||weights.some(w=>w.weight<0||!Number.isSafeInteger(Math.round(w.weight*1000))))return null;
 const scaled=weights.map(w=>({...w,units:BigInt(Math.round(w.weight*1000))}));
 const denominator=scaled.reduce((s,w)=>s+w.units,0n);if(denominator<=0n)return null;
 const cents=BigInt(Math.round(total*100));let used=0n;
 const shares=scaled.map(w=>{const product=cents*w.units;const value=product/denominator;used+=value;return {...w,value,remainder:product%denominator};});
 const ranked=[...shares].sort((a,b)=>a.remainder===b.remainder?a.key.localeCompare(b.key):a.remainder>b.remainder?-1:1);
 for(let index=0;used<cents;index++,used++)ranked[index].value++;
 return new Map(shares.map(w=>[w.key,Number(w.value)/100]));
}
function summary(items:AttemptBuiltItem[],key:'arrival_date'|'destination_city'):SummaryLine[]{
 const groups=new Map<string,AttemptBuiltItem[]>();for(const row of items){const label=row[key]??(key==='arrival_date'?'Sem data':'Sem destino');groups.set(label,[...(groups.get(label)??[]),row]);}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([label,rows])=>({group_type:key,group_label:label,
  total_invoice_value:moneyTotal(uniqueInvoices(rows),'invoice_value'),total_freight_value:moneyTotal(rows,'freight_value'),
  total_weight_kg:sum(rows,'weight_kg'),total_volume:sum(rows,'volume_count'),fiscal_document_count:uniqueInvoices(rows).length}));
}
export function buildClosingAttemptPreview(sources:ClosingSources,options:{allocation?:FreightAllocation;onlyWithCte?:boolean}={}):ClosingAttemptPreview{
 const identities=sources.documents.map(s=>s.document.id+':'+(s.attempt_id??'original'));
 if(new Set(identities).size!==identities.length)throw new Error('Uma tentativa aparece em mais de uma alocação. Concilie os vínculos antes de calcular o fechamento.');
 const mode=options.allocation??'per_nf';const divergences:Divergence[]=[];const items:AttemptBuiltItem[]=[];
 const add=(s:ClosingSource,code:string,description:string,severity:Divergence['severity']='warning')=>
  divergences.push({code,description,severity,fiscal_document_id:s.document.id,invoice_number:s.document.invoice_number,load_id:s.document.load_id});
 const allocation=new Map<string,Map<string,number>|null>();
 for(const c of sources.fiscal_candidates){
  const universe=sources.allocation_documents.filter(s=>links(c,s));const ids=c.document_ids??[];
  // Missing, duplicate or multiply allocated source NFs are not made up by a fallback.
  if(!eligible(c)||new Set(ids).size!==ids.length||universe.length!==ids.length||new Set(universe.map(s=>s.document.id)).size!==ids.length){allocation.set(c.kind+':'+c.id,null);continue;}
  if(mode==='first_nf_only')allocation.set(c.kind+':'+c.id,new Map(universe.map(s=>[s.key,s.document.id===ids[0]?c.freight_value!:0])));
  else allocation.set(c.kind+':'+c.id,allocateClosingCents(c.freight_value!,universe.map(s=>({key:s.key,
   weight:mode==='cte_by_weight'?s.document.weight_kg:s.document.value}))));
 }
 for(const s of sources.documents){
  const d=s.document;const l=s.load;const candidates=sources.fiscal_candidates.filter(c=>links(c,s));const accepted=candidates.filter(eligible);
  // Two storage paths for the same tax document are not two independent freights.
  // Until reconciled, even equal access keys are an ambiguity, never last-row-wins.
  const cte=accepted.length===1?accepted[0]:null;
  if(options.onlyWithCte&&!cte)continue;
  let review=s.financial_review_required;let freight=d.freight_value;
  if(cte?.receivable_id){review=true;add(s,'cte_already_has_receivable','O CT-e já possui recebível: concilie a cobrança antes de faturar outro fechamento.');}
  if(s.financial_review_required){freight=0;add(s,'unpriced_redelivery','Nova tentativa: frete requer revisão própria; frete anterior não herdado.');}
  if(candidates.length!==accepted.length){review=true;add(s,'non_production_or_unconfirmed_cte','Há CT-e não autorizado, cancelado ou sem ambiente de produção confirmado.');}
  if(accepted.length>1){review=true;freight=mode==='per_nf'?freight:0;add(s,'ambiguous_cte','Mais de uma origem fiscal vinculada: concilie antes de usar seu frete.','error');}
  if(mode!=='per_nf'&&s.attempt_id===null){
   const shares=cte?allocation.get(cte.kind+':'+cte.id):null;
   if(!shares||!shares.has(s.key)){freight=0;review=true;add(s,'incomplete_cte_allocation','Rateio não calculado: CT-e ou universo completo de notas não confirmado.','error');}
   else freight=shares.get(s.key)!;
  }
  if(freight<0||!Number.isFinite(freight)){review=true;freight=0;add(s,'invalid_freight','Frete inválido: confira a origem.','error');}
  if(!s.outcome)add(s,'no_audited_outcome','Tentativa sem resultado auditado; nenhuma data de entrega presumida.','info');
  if(!s.volume_count_verified)add(s,'unverified_volume_count','Quantidade de volumes da nova tentativa não confirmada; peso, pallets e m³ não equivalem a volumes.');
  if(!cte)add(s,'no_confirmed_cte','Sem CT-e de produção confirmado para esta tentativa.','info');
  const deliveryDate=s.outcome?.status==='delivered'?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s.outcome.occurred_at)):null;
  items.push({fiscal_document_id:d.id,cte_document_id:cte?.kind==='cte_document'?cte.id:null,load_id:d.load_id,
   origin_city:d.origin_city,origin_state:d.origin_state,remitter_name:d.remitter,remitter_cnpj:d.remitter_cnpj,recipient_name:d.recipient,recipient_cnpj:d.recipient_cnpj,
   destination_city:d.recipient_city,destination_state:d.recipient_state,issue_date:d.issue_date,arrival_date:l?.arrival_date??null,delivery_date:deliveryDate,
   invoice_number:d.invoice_number,invoice_key:d.access_key,cte_number:cte?.number??null,cte_key:cte?.access_key??null,load_number:l?.load_number??null,
   invoice_value:d.value,weight_kg:s.physical.item_count?s.physical.weight_kg:d.weight_kg,volume_count:s.volume_count_verified?d.volume_count:0,
   freight_value:money(freight),freight_cif_value:d.freight_cif_value,freight_fob_value:d.freight_fob_value,delivery_status:s.outcome?.status??null,
   observation:null,source_type:'system',sort_order:items.length,vehicle_id:l?.vehicle_id??null,vehicle_plate:l?.vehicle_plate??null,
   driver_id:l?.driver_id??null,driver_name:l?.driver_name??null,departure_at:l?.departure_at??null,arrival_at_ts:l?.arrival_at??null,
   route_label:d.recipient_city,route_complement:d.origin_city,
   metadata:{version:1,source_key:s.key,allocation_id:s.allocation_id,attempt_id:s.attempt_id,historical:s.historical,
    outcome_id:s.outcome?.id??null,occurred_at:s.outcome?.occurred_at??null,physical_source:s.physical.source,volume_count_verified:s.volume_count_verified,
    fiscal_source_kind:cte?.kind??null,fiscal_source_id:cte?.id??null,financial_review_required:review,freight_allocation_mode:mode}});
 }
 const invoiceValues=new Map<string,number>();for(const item of items){const key=invoiceIdentity(item);const value=money(item.invoice_value);
  if(invoiceValues.has(key)&&invoiceValues.get(key)!==value)throw new Error('A mesma nota apresenta valores diferentes entre tentativas. Concilie a origem antes do fechamento.');invoiceValues.set(key,value);}
 const distinct=uniqueInvoices(items);
 return {items,divergences,totals:{total_invoice_value:moneyTotal(distinct,'invoice_value'),total_freight_value:moneyTotal(items,'freight_value'),
  total_weight_kg:sum(items,'weight_kg'),total_volume:sum(items,'volume_count'),fiscal_document_count:distinct.length,
  cte_count:new Set(items.map(i=>i.metadata.fiscal_source_id).filter(Boolean)).size,load_count:new Set(items.map(i=>i.load_id).filter(Boolean)).size,attempt_count:items.length},
  summaryByArrival:summary(items,'arrival_date'),summaryByDestination:summary(items,'destination_city'),
  source_context:{tenant_id:sources.tenant_id,actor_id:sources.actor_id,filters:sources.filters,revision:sources.revision},
  financial_review_required:items.some(i=>i.metadata.financial_review_required),posting_enabled:false};
}
