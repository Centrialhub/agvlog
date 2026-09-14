import {beforeEach,expect,it,vi} from 'vitest';
import {cancelTrip,previewTripCancellation} from '@/lib/controlTower/tripCancellation';
const m=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:m.rpc}}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),trip=crypto.randomUUID();
const command={version:1 as const,tenant_id:tenant,trip_id:trip,request_id:crypto.randomUUID(),expected_revision:'a'.repeat(32),reason:'Viagem cadastrada por engano'};
beforeEach(()=>vi.clearAllMocks());
it('rejects previews from another actor before displaying them',async()=>{m.rpc.mockResolvedValue({error:null,data:{version:1,tenant_id:tenant,actor_id:crypto.randomUUID(),trip_id:trip,status:'planned',revision:'a'.repeat(32),can_execute:true,blockers:[],load_ids:[],stop_ids:[]}});await expect(previewTripCancellation(tenant,actor,trip)).rejects.toThrow('fora do contexto');});
it('rejects a cancellation reply with a different request identity',async()=>{m.rpc.mockResolvedValue({error:null,data:{version:1,tenant_id:tenant,actor_id:actor,trip_id:trip,request_id:crypto.randomUUID(),status:'cancelled',confirmed:true}});await expect(cancelTrip(command,actor)).rejects.toThrow('fora do pedido');});
it('preserves an unconfirmed outcome rather than treating a transport error as rollback',async()=>{m.rpc.mockResolvedValue({data:null,error:{message:'network'}});await expect(cancelTrip(command,actor)).rejects.toThrow('pedido foi preservado');});
