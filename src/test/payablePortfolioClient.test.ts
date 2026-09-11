import {beforeEach,it,expect,vi} from 'vitest';
import {readPayablePortfolio} from '@/lib/financial/payablePortfolioClient';
import {payablePortfolioSchema} from '@/lib/financial/payablePortfolioContract';
const rpc=vi.hoisted(()=>vi.fn());vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));beforeEach(()=>rpc.mockReset());
const tenant=crypto.randomUUID(),filters={date_basis:'due_date' as const,from:'2026-08-01',to:'2026-08-31',category:null,supplier_id:null},revision='a'.repeat(32);
function fixture(){return {version:1,tenant_id:tenant,basis:'current_operational',...filters,as_of:'2026-09-10',revision,page:1,page_size:30,total_titles:1005,cancelled_titles:0,invalid_titles:0,undated_titles:0,totals_valid:true,nominal_cents:'100500',paid_cents:'0',open_cents:'100500',overdue_cents:'100500',status_counts:[{status:'pending',count:1005}],issue_counts:[],rows:Array.from({length:30},()=>({source_table:'payables',source_id:crypto.randomUUID(),status:'pending',supplier_id:null,supplier_name:'Fornecedor',category:'office',description:'Compra conferida',due_on:'2026-08-15',created_on:'2026-07-01',date_in_range:true,origin:{source_table:null,source_id:null},declared_amount:'1.00',declared_paid:'0.00',payment_ids:[],valid:true,issues:[],nominal_cents:'100',paid_cents:'0',open_cents:'100',source_revision:revision}))};}
it('keeps full totals independent of page size and requires the requested revision',async()=>{
 const data=fixture();rpc.mockResolvedValue({data,error:null});expect((await readPayablePortfolio(tenant,filters,1,revision)).total_titles).toBe(1005);expect(rpc).toHaveBeenCalledWith('get_finance_payable_portfolio',{_tenant_id:tenant,_filters:filters,_page:1,_revision:revision});
 for(const patch of [{tenant_id:crypto.randomUUID()},{revision:'b'.repeat(32)},{category:'other'},{date_basis:'created_at'}]){rpc.mockResolvedValue({data:{...data,...patch},error:null});await expect(readPayablePortfolio(tenant,filters,1,revision)).rejects.toThrow();}
});
it('rejects incomplete pages, duplicate titles and inconsistent portfolio totals',()=>{
 const data=fixture();for(const patch of [{rows:data.rows.slice(1)},{rows:data.rows.map(()=>data.rows[0])},{nominal_cents:'1'},{cancelled_titles:1},{status_counts:[{status:'pending',count:1004}]}])expect(payablePortfolioSchema.safeParse({...data,...patch}).success).toBe(false);
});
it('preserves unavailable totals when a problematic title is outside the visible page',()=>{
 const data=fixture(),uncertain={...data,invalid_titles:1,totals_valid:false,nominal_cents:null,paid_cents:null,open_cents:null,overdue_cents:null,issue_counts:[{issue:'invalid_amount',count:1}]};expect(payablePortfolioSchema.safeParse(uncertain).success).toBe(true);expect(payablePortfolioSchema.safeParse({...uncertain,open_cents:'0'}).success).toBe(false);
});
it('passes changed-revision failures through instead of serving a page from another snapshot',async()=>{
 const error={message:'finance_payable_portfolio_changed',code:'40001'};rpc.mockResolvedValue({data:null,error});await expect(readPayablePortfolio(tenant,filters,2,revision)).rejects.toBe(error);
});
