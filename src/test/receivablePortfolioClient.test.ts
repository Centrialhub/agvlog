import {beforeEach,it,expect,vi} from 'vitest';
import {readReceivablePortfolio} from '@/lib/financial/receivablePortfolioClient';
import {receivablePortfolioSchema,portfolioFilters} from '@/lib/financial/receivablePortfolioContract';
const rpc=vi.hoisted(()=>vi.fn());vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));beforeEach(()=>rpc.mockReset());
const tenant=crypto.randomUUID(),filters={from:null,to:null,client:null};
const summary={version:1,tenant_id:tenant,from:null,to:null,client_id:null,as_of:'2026-09-10',total_titles:1501,canceled_titles:10,invalid_titles:0,totals_valid:true,nominal_cents:'10000000000000001',received_allocated_cents:'4000000000000000',open_cents:'6000000000000001',overdue_cents:'100',status_rows:[{status:'partial',count:1501,nominal_cents:'10000000000000001',received_allocated_cents:'4000000000000000',open_cents:'6000000000000001'}]};
it('queries the full portfolio without page or limit and preserves cents beyond Number precision',async()=>{rpc.mockResolvedValue({data:summary,error:null});const result=await readReceivablePortfolio(tenant,filters);expect(rpc).toHaveBeenCalledWith('get_finance_receivable_portfolio_summary',{_tenant_id:tenant,_from:null,_to:null,_client_id:null});expect(result.total_titles).toBe(1501);expect(result.nominal_cents).toBe('10000000000000001');});
it('rejects wrong filters, partial invalid totals and inconsistent balances',async()=>{
 for(const override of [{tenant_id:crypto.randomUUID()},{client_id:crypto.randomUUID()},{totals_valid:false,invalid_titles:1},{overdue_cents:'99999999999999999'},{status_rows:[{...summary.status_rows[0],status:'cancelled'}]}]){rpc.mockResolvedValue({data:{...summary,...override},error:null});await expect(readReceivablePortfolio(tenant,filters)).rejects.toThrow();}
 expect(receivablePortfolioSchema.safeParse({...summary,total_titles:1,totals_valid:false,invalid_titles:1,nominal_cents:null,received_allocated_cents:null,open_cents:null,overdue_cents:null,status_rows:[{status:'unknown',count:1,nominal_cents:null,received_allocated_cents:null,open_cents:null}]}).success).toBe(true);
});
it('rejects mismatched status counts, duplicate statuses and chart totals even when each row balances',()=>{
 for(const override of [{invalid_titles:1502},{total_titles:1502},{status_rows:[summary.status_rows[0],summary.status_rows[0]]},{status_rows:[{...summary.status_rows[0],nominal_cents:'100',received_allocated_cents:'40',open_cents:'60'}]}])expect(receivablePortfolioSchema.safeParse({...summary,...override}).success).toBe(false);
});
it('uses São Paulo calendar dates, preserves explicit boundaries and removes all-period bounds',()=>{
 expect(portfolioFilters('7d','','','all',new Date('2026-09-10T01:00:00Z'))).toEqual({from:'2026-09-02',to:'2026-09-09',client:null});expect(portfolioFilters('all','','','all')).toEqual(filters);expect(portfolioFilters('30d','2026-01-01','2026-01-31','client')).toEqual({from:'2026-01-01',to:'2026-01-31',client:'client'});
});
