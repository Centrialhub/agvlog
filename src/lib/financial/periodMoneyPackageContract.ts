import {z} from 'zod';
const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/),signed=z.string().regex(/^-?\d+$/),unsigned=z.string().regex(/^\d+$/);
const kind=z.enum(['bank','cash','unsupported']);
export const periodMoneyPackageFiltersSchema=z.object({tenant:uuid,from:date,to:date,accountIds:z.array(uuid)}).refine(v=>v.from<=v.to&&new Set(v.accountIds).size===v.accountIds.length,{message:'Confira o período e selecione cada conta apenas uma vez.'});
const balances=z.object({opening_cents:signed.nullable(),in_cents:unsigned.nullable(),out_cents:unsigned.nullable(),closing_cents:signed.nullable()});
const available=z.object({id:uuid,name:z.string(),account_kind:kind,account_type:z.string().nullable(),active:z.boolean().nullable()});
const actor={actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()};
const closure=z.object({id:uuid,from:date,to:date,revision:z.string().regex(/^[0-9a-f]{32}$/),active:z.boolean(),evidence_kind:z.enum(['bank_statement','cash_count','unknown']),opening_id:uuid.nullable(),predecessor_id:uuid.nullable(),coverage_approval_id:uuid.nullable(),count_id:uuid.nullable(),...actor,integrity:z.object({snapshot_matches_revision:z.boolean(),dependencies_match:z.boolean()}),reopening:z.object({id:uuid,...actor}).nullable()});
const transferRow=z.object({id:uuid,kind:z.enum(['pair','departure']),outgoing_id:uuid,incoming_id:uuid.nullable(),source_account_id:uuid.nullable(),destination_account_id:uuid.nullable(),outgoing_on:date.nullable(),incoming_on:date.nullable(),amount_cents:unsigned.nullable(),classification:z.enum(['internal_pair','scope_boundary_out','scope_boundary_in','cross_period','in_transit','needs_review']),issues:z.array(z.string()),source_closure_ids:z.array(uuid)});
export const periodMoneyPackageSchema=z.object({
 version:z.literal(1),tenant_id:uuid,currency:z.literal('BRL'),timezone:z.literal('America/Sao_Paulo'),basis:z.literal('frozen_money'),status_basis:z.literal('current_closure_state'),period:z.object({from:date,to:date}),captured_at:z.string(),revision:z.string().regex(/^[0-9a-f]{32}$/),
 account_scope:z.object({selected_ids:z.array(uuid),excluded_ids:z.array(uuid),complete:z.boolean(),available:z.array(available)}),
 accounts:z.array(z.object({account_id:uuid,name:z.string(),account_kind:kind,coverage_complete:z.boolean(),issues:z.array(z.string()),balances,closures:z.array(closure),movement_ids:z.array(uuid)})),
 monetary_totals_valid:z.boolean(),totals:balances,transfer_classification_valid:z.boolean(),
 transfer_totals:z.object({internal_pair_cents:unsigned.nullable(),in_excluding_internal_pairs_cents:unsigned.nullable(),out_excluding_internal_pairs_cents:unsigned.nullable()}),
 transfers:z.array(transferRow),issues:z.array(z.string()),limitations:z.array(z.string()),
}).superRefine((v,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 const same=(a:string[],b:string[])=>a.length===b.length&&a.every(x=>b.includes(x));
 const unique=(ids:string[])=>new Set(ids).size===ids.length;
 const scope=v.account_scope,selected=scope.selected_ids,excluded=scope.excluded_ids,ids=scope.available.map(a=>a.id);
 if(!unique(selected)||!unique(excluded)||!unique(ids)||selected.some(id=>excluded.includes(id))||!same([...selected,...excluded],ids)||scope.complete!==(selected.length>0&&excluded.length===0)||!same(v.accounts.map(a=>a.account_id),selected)||!unique(v.accounts.map(a=>a.account_id)))fail('O conjunto de contas do pacote está inconsistente.');
 if(v.period.from>v.period.to)fail('O intervalo do pacote está invertido.');
 const known=(b:z.infer<typeof balances>)=>Object.values(b).every(x=>x!==null);
 const empty=(b:z.infer<typeof balances>)=>Object.values(b).every(x=>x===null);
 const equation=(b:z.infer<typeof balances>)=>!known(b)||BigInt(b.opening_cents!)+BigInt(b.in_cents!)-BigInt(b.out_cents!)===BigInt(b.closing_cents!);
 // Safe parsing must report invalid cents, never throw a BigInt conversion error.
 if([...v.accounts.map(a=>a.balances),v.totals].some(b=>!balances.safeParse(b).success)||Object.entries(v.transfer_totals).some(([,x])=>x!==null&&!unsigned.safeParse(x).success))return;
 for(const account of v.accounts){const catalog=scope.available.find(a=>a.id===account.account_id);
  if(!catalog||account.name!==catalog.name||account.account_kind!==catalog.account_kind||!unique(account.movement_ids))fail('Identidade da conta incompatível com o catálogo.');
  if(account.coverage_complete?account.account_kind==='unsupported'||!known(account.balances)||!equation(account.balances):!empty(account.balances))fail('Saldo da conta sem cobertura ou equação comprovada.');
  if(!unique(account.closures.map(x=>x.id))||account.closures.some(x=>x.from>x.to||x.active!==(x.reopening===null)))fail('Histórico dos fechamentos inconsistente.');
  if(account.coverage_complete&&!account.closures.some(x=>x.active&&x.integrity.snapshot_matches_revision&&x.integrity.dependencies_match))fail('Conta coberta sem fechamento íntegro ativo.');
 }
 if(v.monetary_totals_valid){
  if(!selected.length||!v.accounts.every(a=>a.coverage_complete&&known(a.balances))||!known(v.totals)||!equation(v.totals))fail('Total monetário sem cobertura completa do escopo.');
  else for(const field of ['opening_cents','in_cents','out_cents','closing_cents'] as const)if(BigInt(v.totals[field]!)!==v.accounts.reduce((sum,a)=>sum+BigInt(a.balances[field]!),0n))fail('A soma das contas diverge do total monetário.');
 }else if(!empty(v.totals))fail('Totais indeterminados precisam permanecer sem valor.');
 const transfer=v.transfer_totals;
 const allMovements=v.accounts.flatMap(a=>a.movement_ids);
 if((v.monetary_totals_valid&&!unique(allMovements))||!unique(v.transfers.map(t=>`${t.kind}:${t.id}`)))fail('Origens monetárias ou transferências repetidas no pacote.');
 for(const t of v.transfers){if(!unique(t.source_closure_ids))fail('Provas repetidas para a mesma transferência.');
  if(t.classification==='internal_pair'&&(t.kind!=='pair'||!t.incoming_id||!t.source_account_id||!t.destination_account_id||!selected.includes(t.source_account_id)||!selected.includes(t.destination_account_id)||!allMovements.includes(t.outgoing_id)||!allMovements.includes(t.incoming_id)||!t.outgoing_on||!t.incoming_on||t.outgoing_on<v.period.from||t.outgoing_on>v.period.to||t.incoming_on<v.period.from||t.incoming_on>v.period.to||t.amount_cents===null))fail('Transferência interna sem ambas as pernas no escopo e período.');
 }
 if(v.transfer_classification_valid){
  if(!v.monetary_totals_valid||!known(v.totals)||Object.values(transfer).some(x=>x===null))fail('Fluxos ajustados sem classificação comprovada.');
  else if(BigInt(transfer.internal_pair_cents!)>BigInt(v.totals.in_cents!)||BigInt(transfer.internal_pair_cents!)>BigInt(v.totals.out_cents!)||BigInt(transfer.in_excluding_internal_pairs_cents!)!==BigInt(v.totals.in_cents!)-BigInt(transfer.internal_pair_cents!)||BigInt(transfer.out_excluding_internal_pairs_cents!)!==BigInt(v.totals.out_cents!)-BigInt(transfer.internal_pair_cents!))fail('O ajuste de transferências não conserva os fluxos brutos.');
  if(v.transfers.some(t=>t.classification==='needs_review'||t.issues.length>0))fail('Classificação de transferências com pendências.');
  const pairs=v.transfers.filter(t=>t.classification==='internal_pair');
  if(transfer.internal_pair_cents!==null&&pairs.every(t=>t.amount_cents!==null&&unsigned.safeParse(t.amount_cents).success)&&pairs.reduce((sum,t)=>sum+BigInt(t.amount_cents!),0n)!==BigInt(transfer.internal_pair_cents))fail('O total eliminado diverge das transferências identificadas.');
 }else if(Object.values(transfer).some(x=>x!==null))fail('Fluxos ajustados indeterminados precisam permanecer sem valor.');
});
export type PeriodMoneyPackage=z.infer<typeof periodMoneyPackageSchema>;
export function periodMoneyPackageError(error:unknown){const message=typeof error==='object'&&error!==null&&'message' in error?String(error.message):'';if(message==='finance_access_denied')return 'Acesso financeiro não permitido.';if(message==='finance_invalid_filters')return 'Confira as datas e o intervalo selecionado.';return 'Não foi possível conferir o dinheiro deste período. Atualize a consulta.';}
