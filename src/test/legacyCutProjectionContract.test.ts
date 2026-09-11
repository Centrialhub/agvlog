import {expect,it} from 'vitest';
import {legacyCutReviewSchema} from '@/lib/financial/legacyCutReviewContract';
const tenant=crypto.randomUUID(),account=crypto.randomUUID(),id=crypto.randomUUID(),movement=crypto.randomUUID();
const scope={version:1,tenant_id:tenant,account_id:account,from:'2026-08-01',to:'2026-08-31',revision:'a'.repeat(32)};
const part={payment_id:crypto.randomUUID(),link_id:crypto.randomUUID(),movement_id:movement,account_id:account,occurred_on:'2026-08-15',amount_cents:'5000'};
function review(classification:string,footprints?:unknown[],sourceTable='employee_advances'){
 const source={source_table:sourceTable,source_id:id,occurred_on:null,account_id:account,amount_cents:null,movement_ids:[movement],classification};
 if(sourceTable==='employee_advances')Object.assign(source,{chain_revision:'b'.repeat(32),footprints:footprints||[]});
 return {...scope,current:false,approved:false,can_review:false,status:'not_approved',review_id:null,approval:null,history:[],blockers:[],manifest:{...scope,classifier_version:'3',source_count:1,sources:[source],evidence:{employee_advances:[{id}]},integrity:[],blockers:[]}};
}
it('keeps incomplete unresolved evidence readable without upgrading it to a proven payment',()=>{
 const incomplete={...part,occurred_on:null,amount_cents:null,link_id:null};
 expect(legacyCutReviewSchema.safeParse(review('requires_resolution',[incomplete])).success).toBe(true);
 expect(legacyCutReviewSchema.safeParse(review('exact_projection_alias',[incomplete])).success).toBe(false);
});
it('requires unique concrete payment footprints in the declared account for an alias',()=>{
 expect(legacyCutReviewSchema.safeParse(review('exact_projection_alias',[part])).success).toBe(true);
 for(const parts of [[],[part,part],[{...part,account_id:crypto.randomUUID()}],[{...part,amount_cents:'0'}]])expect(legacyCutReviewSchema.safeParse(review('exact_projection_alias',parts)).success).toBe(false);
});
it('keeps legacy bank aliases readable without paid-projection chain fields',()=>{
 expect(legacyCutReviewSchema.safeParse(review('exact_projection_alias',undefined,'bank_transactions')).success).toBe(true);
});
