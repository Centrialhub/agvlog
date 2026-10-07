import type {ItemPreparationPayload,ItemPreparationResult} from '@/lib/loads/itemPreparation';
interface OrderSource {orderNumber:string;clientName?:string|null;quantity?:number|null;palletCount?:number|null;weightKg?:number|null}
interface Options {
 loadId:string;loadNumber:string|number;orders:{source:OrderSource}[];orderIds:Map<string,string>;confirmedCount:number;
 submit:(payload:Omit<ItemPreparationPayload,'tenant_id'>)=>Promise<ItemPreparationResult>;
}
export function requireCreatedOrderIds(orders:{source:OrderSource}[],orderIds:Map<string,string>){
 const confirmed=new Set<string>();
 for(const {source} of orders){
  const orderId=orderIds.get(source.orderNumber);
  if(!orderId||confirmed.has(orderId))throw new Error(`Pedido ${source.orderNumber} sem criação única confirmada. Carga não criada para evitar itens sem vínculo.`);
  confirmed.add(orderId);
 }
}
export async function createConfirmedOrderLoad<T>(orders:{source:OrderSource}[],orderIds:Map<string,string>,create:()=>Promise<T>){
 requireCreatedOrderIds(orders,orderIds);return create();
}
export async function prepareOrderItems({loadId,loadNumber,orders,orderIds,confirmedCount,submit}:Options){
 requireCreatedOrderIds(orders,orderIds);
 let confirmed=confirmedCount;
 for(const {source} of orders){
  const orderId=orderIds.get(source.orderNumber);
  try{
   await submit({load_id:loadId,item_id:null,expected:null,values:{order_id:orderId!,
    item_description:`Pedido ${source.orderNumber} - ${source.clientName||'Sem cliente'}`,quantity:source.quantity??0,
    pallet_count:source.palletCount??Math.ceil((source.quantity??0)/50),weight_kg:source.weightKg??0}});
   confirmed++;
  }catch(error){
   const detail=error instanceof Error?error.message:'Falha ao confirmar o item';
   throw new Error(`Carga ${loadNumber} criada parcialmente: ${confirmed} item(ns) confirmado(s). Pedido ${source.orderNumber} sem confirmação: ${detail}. Preserve a carga e recupere a solicitação antes de repetir o lote.`);
  }
 }
 return confirmed;
}
