import {supabase} from '@/integrations/supabase/client';
import {movementCorrectionPreviewSchema} from './movementCorrectionPreviewContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readMovementCorrectionPreview(tenant:string,movement:string){const {data,error}=await(supabase.rpc as unknown as Rpc)('preview_finance_movement_correction',{_tenant_id:tenant,_movement_id:movement});if(error)throw error;const result=movementCorrectionPreviewSchema.parse(data);if(result.tenant_id!==tenant||result.movement_id!==movement)throw new Error('Conferência fora do movimento selecionado.');return result;}
