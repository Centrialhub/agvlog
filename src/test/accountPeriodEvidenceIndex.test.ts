import {it,expect} from 'vitest';
import {buildAccountPeriodEvidenceIndex} from '@/lib/financial/accountPeriodEvidenceIndex';
import {accountPeriodEvidenceSchema,exportAccountPeriodEvidence} from '@/lib/financial/accountPeriodEvidenceContract';
const id=()=>crypto.randomUUID();
function evidence(){return accountPeriodEvidenceSchema.parse({version:1,tenant_id:id(),account_id:id(),closure_id:id(),closure:{from:'2026-08-01',to:'2026-08-31',revision:'a'.repeat(32),actor_id:id(),actor_name:'Financeiro',reason:'Conferência dos valores',created_at:'2026-09-01'},snapshot:{facts:{movements:[],groups:[],group_reversals:[],opening_imports:[]},coverage:{dependencies:{imports:[]}}},dependencies:[],integrity:{snapshot_matches_revision:true,dependencies_match:true},reopening:null});}
it('indexes every movement receipt and deduplicates an opening import without changing the saved export',()=>{
 const data=evidence(),rows=Array.from({length:1005},()=>({id:id(),receipt_path:`${data.tenant_id}/${id()}.pdf`,receipt_evidence:{bucket:'receipts'}}));
 const statement={id:id(),source_path:`${data.tenant_id}/statement.ofx`,file_hash:'b'.repeat(64),file_name:'statement.ofx',parser_version:'native-ofx-v1'};
 data.snapshot={facts:{movements:rows,groups:[],group_reversals:[],opening_imports:[statement]},coverage:{dependencies:{imports:[statement]}}};
 const before=exportAccountPeriodEvidence(data),result=buildAccountPeriodEvidenceIndex(data);
 expect(result.documents).toHaveLength(1006);expect(result.coverage_issues).toEqual([]);expect(result.missing_movement_receipt_ids).toEqual([]);expect(exportAccountPeriodEvidence(data)).toBe(before);
});
it('keeps the manual actor and reversal even after the group is reversed and another group is automatic',()=>{
 const data=evidence(),group=id(),actor=id(),reversal=id(),base={actor_id:actor,actor_name:'Nome preservado',reason:'Conferência manual documentada',created_at:'2026-09-01T12:00:00Z'};
 data.snapshot.facts={movements:[],opening_imports:[],groups:[{...base,id:group,method:'manual'},{...base,id:id(),method:'automatic_reference'}],group_reversals:[{...base,id:reversal,group_id:group}]};
 expect(buildAccountPeriodEvidenceIndex(data).manual_decisions).toEqual(expect.arrayContaining([{...base,id:group,kind:'reconciliation',active:false},{...base,id:reversal,kind:'reversal',active:null}]));
 expect(buildAccountPeriodEvidenceIndex(data).manual_decisions).toHaveLength(2);
});
it('distinguishes missing attachments from unavailable history instead of inventing a clean report',()=>{
 const data=evidence(),movement=id();data.snapshot.facts={movements:[{id:movement,receipt_path:null}],groups:[],opening_imports:[]};
 const result=buildAccountPeriodEvidenceIndex(data);expect(result.missing_movement_receipt_ids).toEqual([movement]);expect(result.coverage_issues).toContain('Reversões de conciliação: conjunto preservado indisponível.');
 const empty=evidence();expect(buildAccountPeriodEvidenceIndex(empty).coverage_issues).toEqual([]);
});
it('indexes a saved cash count without demanding fictional bank statements',()=>{
 const data=evidence(),count={id:id(),actor_id:id(),actor_name:'Responsável do caixa',reason:'Contagem de encerramento conferida',created_at:'2026-09-01T12:00:00Z'};
 data.snapshot={evidence_type:'cash_count_v1',count,facts:{movements:[]}};
 const before=exportAccountPeriodEvidence(data),result=buildAccountPeriodEvidenceIndex(data);
 expect(result.coverage_issues).toEqual([]);expect(result.documents).toEqual([]);expect(result.manual_decisions).toEqual([{...count,kind:'cash_count',active:true}]);expect(exportAccountPeriodEvidence(data)).toBe(before);
 data.snapshot.count={id:count.id};expect(buildAccountPeriodEvidenceIndex(data).coverage_issues).toContain('Contagem de caixa com identificação ou autoria incompleta.');
});
it('does not declare a manual group active when its reversal coverage is malformed',()=>{
 const data=evidence();data.snapshot.facts={movements:[],opening_imports:[],groups:[{id:id(),method:'manual',actor_id:id(),actor_name:'Responsável',reason:'Conferência',created_at:'2026-09-01'}],group_reversals:[{id:id(),group_id:'invalid'}]};
 const result=buildAccountPeriodEvidenceIndex(data);expect(result.manual_decisions[0].active).toBeNull();expect(result.coverage_issues.length).toBeGreaterThan(0);
});
