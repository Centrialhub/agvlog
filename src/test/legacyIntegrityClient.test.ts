import {beforeEach,it,expect,vi} from 'vitest';
import {readLegacyIntegrity} from '@/lib/financial/legacyIntegrityClient';
import {legacyIntegritySchema} from '@/lib/financial/legacyIntegrityContract';
const rpc=vi.hoisted(()=>vi.fn());vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));beforeEach(()=>rpc.mockReset());
const tenant=crypto.randomUUID(),row={source_table:'payables_payments',source_id:crypto.randomUUID(),date_status:'nonfinite',occurred_on:null,raw_date:'infinity',account_id:null,account_status:'unresolved',amount_cents:null,raw_amount:'NaN',direction:'out',issues:['source_date_nonfinite'],context:{}};
const context={version:1,tenant_id:tenant,scope:'tenant',page:1,page_size:30,total:1,counts_by_source:{payables_payments:1},counts_by_issue:{source_date_nonfinite:1},identified_account:{total:0,rows:[]},unknown_account:{scope:'tenant',not_additive_across_accounts:true,total:1,rows:[row]},legacy_integration_status:'not_reviewed',can_close:false};
it('queries tenant only and preserves invalid raw values without converting them',async()=>{
 rpc.mockResolvedValue({data:context,error:null});const result=await readLegacyIntegrity(tenant,1);expect(rpc).toHaveBeenCalledWith('get_finance_legacy_integrity_inventory',{_tenant_id:tenant,_page:1});expect(result.unknown_account.rows[0]).toMatchObject({amount_cents:null,raw_amount:'NaN',occurred_on:null,raw_date:'infinity'});
});
it('rejects foreign scope, invalid grouping, speculative totals and closing claims',async()=>{
 for(const override of [{tenant_id:crypto.randomUUID()},{page:2},{total:2},{can_close:true},{unknown_account:{...context.unknown_account,not_additive_across_accounts:false}},{identified_account:{total:1,rows:[row]},unknown_account:{...context.unknown_account,total:0,rows:[]}}]){rpc.mockResolvedValue({data:{...context,...override},error:null});await expect(readLegacyIntegrity(tenant,1)).rejects.toThrow();}
 expect(legacyIntegritySchema.safeParse({...context,unknown_account:{...context.unknown_account,rows:[{...row,amount_cents:'NaN'}]}}).success).toBe(false);
});
