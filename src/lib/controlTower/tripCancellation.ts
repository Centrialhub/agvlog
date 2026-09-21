import {z} from 'zod';

import {supabase} from '@/integrations/supabase/client';

const uuid=z.string().uuid();

export const tripCancellationCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,trip_id:uuid,expected_revision:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().trim().min(10).max(2000)}).strict();

export type TripCancellationCommand=z.infer<typeof tripCancellationCommandSchema>;


export const tripCancellationResultSchema=z.object({version:z.literal(1),tenant_id:uuid,actor_id:uuid,trip_id:uuid,request_id:uuid,status:z.literal('cancelled'),confirmed:z.literal(true)});
export const tripCancellationPreviewSchema=z.object({version:z.literal(1),tenant_id:uuid,actor_id:uuid,trip_id:uuid,status:z.string(),revision:z.string().regex(/^[a-f0-9]{32}$/),can_execute:z.boolean(),blockers:z.array(z.object({code:z.string(),count:z.number().int().nonnegative()})),load_ids:z.array(uuid),stop_ids:z.array(uuid),completed_cancellation:z.boolean().optional(),result:tripCancellationResultSchema.nullable().optional()});
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>;

export class TripCancellationRejected extends Error{}

async function call(name:string,args:Record<string,unknown>){

 const {data,error}=await(supabase.rpc.bind(supabase) as unknown as Rpc)(name,args);

 if(error){if(/^(22|23|40|42|55)/.test(error.code||''))throw new TripCancellationRejected('O servidor recusou o cancelamento. Consulte novamente a viagem e seus impedimentos.');throw Error('Não foi possível confirmar a resposta. O pedido foi preservado para retomar.');}return data;

}

export async function previewTripCancellation(tenant:string,actor:string,trip:string){

 const data=tripCancellationPreviewSchema.parse(await call('preview_dispatch_trip_cancellation',{_tenant_id:tenant,_trip_id:trip}));

 if(data.tenant_id!==tenant||data.actor_id!==actor||data.trip_id!==trip)throw Error('Conferência de viagem fora do contexto.');return data;

}

export async function cancelTrip(command:TripCancellationCommand,actor:string){

 const data=tripCancellationResultSchema.parse(await call('cancel_dispatch_trip',{_payload:tripCancellationCommandSchema.parse(command)}));

 if(data.tenant_id!==command.tenant_id||data.actor_id!==actor||data.trip_id!==command.trip_id||data.request_id!==command.request_id)throw Error('Confirmação de viagem fora do pedido original.');return data;

}

export const tripCancellationBlockers:Record<string,string>={trip_execution_started:'A viagem já foi iniciada ou não está planejada.',load_requires_review:'Há carga que exige revisão.',stop_execution_started:'Há parada com execução registrada.',physical_journey_requires_review:'A jornada já começou ou reúne outras viagens.',fiscal_review_required:'Há vínculo fiscal que precisa de revisão.',driver_expenses:'Há gastos do motorista.',vehicle_fueling:'Há abastecimento.',incidents:'Há ocorrência.',proof_of_delivery:'Há comprovante de entrega.',operational_events:'Há evento operacional.',driver_settlements:'Há acerto do motorista.',payables:'Há conta a pagar.',delivery_document_outcomes:'Há resultado de entrega.',finance_expense_batches:'Há lote de gastos.',delivery_receipts:'Há canhoto.',trip_cargo_controls:'Há controle de carga.',driver_operational_command_receipts:'Há operação enviada pelo motorista.',delivery_receipt_physical_events:'Há evento físico de entrega.',driver_delivery_fiscal_conflicts:'Há pendência fiscal de entrega.',driver_settlement_cargo_quarantines:'Há acerto com pendência de carga.',trip_cargo_historical_reconciliations:'Há conferência histórica de carga.',nfse_documents:'Há NFS-e vinculada.',checklist_executions:'Há checklist executado.',dispatch_events:'Há evento da viagem.',route_runs:'Há execução de rota.'};

