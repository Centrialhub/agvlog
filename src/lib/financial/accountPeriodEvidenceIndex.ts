import {z} from 'zod';
import type {AccountPeriodEvidence} from './accountPeriodEvidenceContract';

const object=z.record(z.unknown()),uuid=z.string().uuid();
const source=object.and(z.object({id:uuid}));
const decision=z.object({id:uuid,actor_id:uuid,actor_name:z.string().min(1),reason:z.string().min(1),created_at:z.string().min(1)});
export type AccountPeriodDocument={kind:'movement_receipt'|'voided_movement_receipt'|'bank_statement';source_id:string;path:string;evidence:unknown};
export type AccountPeriodManualDecision=z.infer<typeof decision>&{kind:'reconciliation'|'reversal'|'cash_count'|'movement_void';active:boolean|null;movement_id?:string;duplicate_of_movement_id?:string|null;replacement_movement_id?:string|null};
export type AccountPeriodEvidenceIndex={documents:AccountPeriodDocument[];manual_decisions:AccountPeriodManualDecision[];missing_movement_receipt_ids:string[];coverage_issues:string[]};

/** Uses only the saved closing record. Never fetches current sources or files. */
export function buildAccountPeriodEvidenceIndex(data:AccountPeriodEvidence):AccountPeriodEvidenceIndex{
 const result:AccountPeriodEvidenceIndex={documents:[],manual_decisions:[],missing_movement_receipt_ids:[],coverage_issues:[]};
 const issue=(message:string)=>{if(!result.coverage_issues.includes(message))result.coverage_issues.push(message);};
 function rows(value:unknown,label:string){const parsed=z.array(z.unknown()).safeParse(value);if(!parsed.success){issue(`${label}: conjunto preservado indisponível.`);return [];}
  return parsed.data.flatMap(raw=>{const row=source.safeParse(raw);if(!row.success){issue(`${label}: origem sem identificação válida.`);return [];}return [row.data];});}
 const facts=object.safeParse(data.snapshot.facts),coverage=object.safeParse(data.snapshot.coverage);
 const dependencies=object.safeParse(coverage.success?coverage.data.dependencies:undefined);
 const movements=rows(facts.success?facts.data.movements:undefined,'Movimentos');
 const hasVoidHistory=facts.success&&('movement_voids' in facts.data||'voided_movements' in facts.data);
 const voids=hasVoidHistory?rows(facts.data.movement_voids,'Invalidações de movimentos'):[];
 const voidedMovements=hasVoidHistory?rows(facts.data.voided_movements,'Movimentos originais invalidados'):[];
 const cash=data.snapshot.evidence_type==='cash_count_v1';
 const groups=cash?[]:rows(facts.success?facts.data.groups:undefined,'Conciliações');
 const reversals=cash?[]:rows(facts.success?facts.data.group_reversals:undefined,'Reversões de conciliação');
 const imports=cash?[]:rows(dependencies.success?dependencies.data.imports:undefined,'Extratos do período');
 const openingImports=cash?[]:rows(facts.success?facts.data.opening_imports:undefined,'Extratos da abertura');
 if(cash){const count=decision.safeParse(data.snapshot.count);if(count.success)result.manual_decisions.push({...count.data,kind:'cash_count',active:true});else issue('Contagem de caixa com identificação ou autoria incompleta.');}
 const path=(value:unknown)=>typeof value==='string'&&value.trim().length>0?value:null;
 const seenMovements=new Set<string>();
 for(const movement of movements){
  if(seenMovements.has(movement.id)){issue(`Movimento repetido: ${movement.id}.`);continue;}seenMovements.add(movement.id);
  if(!Object.prototype.hasOwnProperty.call(movement,'receipt_path')){issue(`Informação de comprovante indisponível: ${movement.id}.`);continue;}
  const receipt=path(movement.receipt_path);
  if(receipt===null){result.missing_movement_receipt_ids.push(movement.id);continue;}
  result.documents.push({kind:'movement_receipt',source_id:movement.id,path:receipt,evidence:movement.receipt_evidence??null});
  if(movement.receipt_evidence==null)issue(`Comprovante sem metadados preservados: ${movement.id}.`);
 }
 const voidedIds=new Set<string>(),eventMovements=new Set<string>();
 for(const original of voidedMovements){
  if(voidedIds.has(original.id)){issue(`Original invalidado repetido: ${original.id}.`);continue;}voidedIds.add(original.id);
  if(seenMovements.has(original.id))issue(`Movimento presente como ativo e invalidado: ${original.id}.`);
  const receipt=path(original.receipt_path);
  if(receipt){result.documents.push({kind:'voided_movement_receipt',source_id:original.id,path:receipt,evidence:original.receipt_evidence??null});if(original.receipt_evidence==null)issue(`Comprovante do original invalidado sem metadados preservados: ${original.id}.`);}
 }
 const voidDecision=decision.extend({movement_id:uuid,duplicate_of_movement_id:uuid.nullable(),replacement_movement_id:uuid.nullable()});
 const seenVoids=new Set<string>();
 for(const event of voids){
  if(seenVoids.has(event.id)){issue(`Invalidação repetida: ${event.id}.`);continue;}seenVoids.add(event.id);
  const parsed=voidDecision.safeParse(event);
  if(!parsed.success){issue(`Invalidação com autoria ou referências incompletas: ${event.id}.`);continue;}
  if(eventMovements.has(parsed.data.movement_id))issue(`Mais de uma invalidação do movimento: ${parsed.data.movement_id}.`);
  eventMovements.add(parsed.data.movement_id);
  if(!voidedIds.has(parsed.data.movement_id))issue(`Original da invalidação não preservado: ${parsed.data.movement_id}.`);
  result.manual_decisions.push({...parsed.data,kind:'movement_void',active:true});
 }
 for(const id of voidedIds)if(!eventMovements.has(id))issue(`Movimento invalidado sem evento íntegro preservado: ${id}.`);
 const seenImports=new Map<string,string>();
 for(const entry of [...imports,...openingImports]){
  const location=path(entry.source_path);
  if(location===null){issue(`Extrato sem localização preservada: ${entry.id}.`);continue;}
  const prior=seenImports.get(entry.id);
  if(prior!==undefined){if(prior!==location)issue(`Extrato com localizações divergentes: ${entry.id}.`);continue;}
  seenImports.set(entry.id,location);
  result.documents.push({kind:'bank_statement',source_id:entry.id,path:location,evidence:{file_hash:entry.file_hash??null,file_name:entry.file_name??null,parser_version:entry.parser_version??null}});
  if(typeof entry.file_hash!=='string'||!/^[a-f0-9]{64}$/i.test(entry.file_hash))issue(`Extrato sem hash válido preservado: ${entry.id}.`);
 }
 const reversed=new Set<string>();let reversalCoverageKnown=!result.coverage_issues.some(x=>x.startsWith('Reversões de conciliação:'));
 for(const reversal of reversals){
  const group=uuid.safeParse(reversal.group_id);
  if(group.success)reversed.add(group.data);else{issue(`Reversão sem conciliação identificada: ${reversal.id}.`);reversalCoverageKnown=false;}
  const parsed=decision.safeParse(reversal);
  if(parsed.success)result.manual_decisions.push({...parsed.data,kind:'reversal',active:null});else issue(`Reversão com autoria incompleta: ${reversal.id}.`);
 }
 for(const group of groups){
  if(group.method==='automatic_reference')continue;
  if(group.method!=='manual'){issue(`Método de conciliação não reconhecido: ${group.id}.`);continue;}
  const parsed=decision.safeParse(group);
  if(parsed.success)result.manual_decisions.push({...parsed.data,kind:'reconciliation',active:reversalCoverageKnown?!reversed.has(group.id):null});else issue(`Conciliação manual com autoria incompleta: ${group.id}.`);
 }
 result.documents.sort((a,b)=>a.kind.localeCompare(b.kind)||a.source_id.localeCompare(b.source_id));
 result.manual_decisions.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 result.missing_movement_receipt_ids.sort();result.coverage_issues.sort();return result;
}
