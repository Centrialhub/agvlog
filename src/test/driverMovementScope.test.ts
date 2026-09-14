import {beforeEach,expect,it,vi} from 'vitest';
import {readFinanceMovements} from '@/lib/financial/ledgerClient';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
const tenant='00000000-0000-4000-8000-000000000001',driver='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const filters={page:1,page_size:30,search:'',from:'',to:'',direction:'out',account_id:'',driver_id:driver};
function response(rowDriver=driver,rowTenant=tenant){return {version:1,tenant_id:tenant,page:1,page_size:30,total:1,active_count:1,voided_count:0,historical_inflow_cents:'0',historical_outflow_cents:'4000',voided_inflow_cents:'0',voided_outflow_cents:'0',inflow_cents:'0',outflow_cents:'4000',rows:[{id:other,tenant_id:rowTenant,bank_account_id:other,account_name:'Conta QA',direction:'out',nature:'driver_advance',amount_cents:4000,occurred_on:'2026-09-14',description:'Envio durante viagem',beneficiary_name:'Motorista',beneficiary_document:null,driver_id:rowDriver,bank_reference:null,receipt_path:null,created_by:other,created_at:'2026-09-14',voided:false,correction:null}]};}
beforeEach(()=>{rpc.mockReset();});
it('passes the driver filter to the published RPC and validates matching returned rows',async()=>{rpc.mockResolvedValue({data:response(),error:null});expect((await readFinanceMovements(tenant,filters)).rows[0].driver_id).toBe(driver);expect(rpc).toHaveBeenCalledWith('list_finance_movements',{_tenant_id:tenant,_filters:filters});});
it.each([[other,tenant],[driver,other]])('rejects rows outside driver/company scope',async(d,t)=>{rpc.mockResolvedValue({data:response(d,t),error:null});await expect(readFinanceMovements(tenant,filters)).rejects.toThrow();});
it('rejects a malformed driver ID before RPC',async()=>{await expect(readFinanceMovements(tenant,{...filters,driver_id:'invalid'})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
