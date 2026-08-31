import {describe,expect,it} from 'vitest';
import {readDriverDeliveryItems} from '@/lib/driver/driverDeliveryItems';
const context={tenant:'tenant',actor:'actor',trip:'trip',stop:'stop'};
const envelope=()=>({tenant_id:'tenant',actor_id:'actor',trip_id:'trip',stop_id:'stop',items:[{
 id:'item',fiscal_document_id:'invoice',quantity:2,item_description:'Produto',document_status:'returned',is_historical:true,attempt_id:null,
}]});
describe('driver allocation-specific read contract',()=>{
 it('preserves historical outcomes and quantities so finalizers can exclude completed notes',()=>{
  expect(readDriverDeliveryItems(envelope(),context)).toEqual([{id:'item',sku:'invoice',name:'Produto',qty:2,unit:'UN',price:0,documentStatus:'returned'}]);
 });
 it.each(['tenant_id','actor_id','trip_id','stop_id'])('rejects a response for another %s',key=>{
  expect(()=>readDriverDeliveryItems({...envelope(),[key]:'other'},context)).toThrow('Não foi possível conferir');
 });
 it.each([null,NaN,Infinity,0,-1,'2'])('rejects invalid quantity %s without silently treating it as zero',quantity=>{
  expect(()=>readDriverDeliveryItems({...envelope(),items:[{...envelope().items[0],quantity}]},context)).toThrow('inconsistentes');
 });
 it('rejects duplicate item IDs and missing outcome status',()=>{
  expect(()=>readDriverDeliveryItems({...envelope(),items:[...envelope().items,...envelope().items]},context)).toThrow('inconsistentes');
  expect(()=>readDriverDeliveryItems({...envelope(),items:[{...envelope().items[0],document_status:null}]},context)).toThrow('inconsistentes');
 });
});
