import { describe,expect,it } from 'vitest';
import { buildExpenseBatch,distributeExpenseMovement,newExpenseLine,type ExpenseBatchDraft } from '@/lib/financial/expenseBatchContract';
const tenant=crypto.randomUUID(),driver=crypto.randomUUID(),movement={id:crypto.randomUUID(),label:'Envio',driver_id:driver,remaining_cents:50000};
function draft():ExpenseBatchDraft {
  return {context:'trip',trip:{id:crypto.randomUUID(),label:'Viagem',driver_id:driver},description:'Retorno',reason:'Conferência dos recibos',
    lines:[300,50,150].map((value,index)=>({...newExpenseLine('trip'),category: index===1?'food':'fuel',description:'Gasto',amount:String(value),
      supplierName:'Comércio',noReceiptReason:'Recibo pendente',allocations:[{movement,amount:String(value)}]}))};
}
describe('expense batch review contract',()=>{
  it('distributes one send across three expenses without requiring three repeated selections',()=>{
    const value=draft();value.lines.forEach(line=>{line.allocations=[];});
    const result=distributeExpenseMovement(value,movement);
    expect(result.lines.map(line=>line.allocations[0].amount)).toEqual(['300,00','50,00','150,00']);
    expect(distributeExpenseMovement(result,movement)).toEqual(result);
    expect(value.lines.every(line=>line.allocations.length===0)).toBe(true);
  });
  it('leaves the complement uncovered when one send cannot cover all expenses',()=>{
    const value=draft();value.lines.forEach(line=>{line.allocations=[];});value.lines[2].amount='180';
    const result=buildExpenseBatch(distributeExpenseMovement(value,movement),tenant,crypto.randomUUID());
    expect(result.items[2].amount_cents).toBe(18000);expect(result.items[2].allocations[0].amount_cents).toBe(15000);
  });
  it('preserves individual categories and a shared send identity',()=>{
    const result=buildExpenseBatch(draft(),tenant,crypto.randomUUID());
    expect(result.items.map(i=>i.amount_cents)).toEqual([30000,5000,15000]);
    expect(result.items[1].category).toBe('food');
    expect(result.items.every(i=>i.allocations[0].movement_id===movement.id)).toBe(true);
  });
  it('rejects combined over-allocation even if each individual expense fits the send',()=>{
    const value=draft();value.lines[2].amount='151';value.lines[2].allocations[0].amount='151';
    expect(()=>buildExpenseBatch(value,tenant,crypto.randomUUID())).toThrow('excede o saldo');
  });
  it('rejects a send belonging to another driver after the trip changes',()=>{
    const value=draft();value.trip!.driver_id=crypto.randomUUID();
    expect(()=>buildExpenseBatch(value,tenant,crypto.randomUUID())).toThrow('outro motorista');
  });
  it('keeps missing receipts explicit and requires an actual upload for unloading',()=>{
    const value=draft();value.lines[0].noReceiptReason='';
    expect(()=>buildExpenseBatch(value,tenant,crypto.randomUUID())).toThrow('comprovante');
    value.lines[0].noReceiptReason='Recibo pendente';value.lines[0].category='unloading';
    expect(()=>buildExpenseBatch(value,tenant,crypto.randomUUID())).toThrow('entrega válida');
  });
});
