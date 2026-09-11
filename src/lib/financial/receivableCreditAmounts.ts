import {z} from 'zod';
const text=z.string().regex(/^(0|[1-9]\d{0,13})$/).nullable().optional();
const number=z.number().int().nonnegative().max(99999999999999).nullable().optional();
export const receivableCreditTextFields={cash_received_cents:text,credit_applied_cents:text,settled_cents:text};
export const receivableCreditNumberFields={cash_received_cents:number,credit_applied_cents:number,settled_cents:number};
type Composition={cash_received_cents?:string|number|null;credit_applied_cents?:string|number|null;settled_cents?:string|number|null};
const validCents=(value:unknown)=>typeof value==='number'?Number.isSafeInteger(value)&&value>=0&&value<=99999999999999:typeof value==='string'&&/^(0|[1-9]\d{0,13})$/.test(value);
export function creditCompositionValid(v:Composition,legacy?:string|number|null){
 const values=[v.cash_received_cents,v.credit_applied_cents,v.settled_cents];
 if(values.every(x=>x===undefined))return true;
 if(values.some(x=>x===undefined))return false;
 if(values.some(x=>x===null))return values.every(x=>x===null);
 if(!values.every(validCents)||(legacy!=null&&!validCents(legacy)))return false;
 return BigInt(v.cash_received_cents!)+BigInt(v.credit_applied_cents!)===BigInt(v.settled_cents!)&&(legacy==null||BigInt(v.settled_cents!)===BigInt(legacy));
}
export function legacyReceivableCents(value:number|null):string|null{
 if(value===null||!Number.isFinite(value))return null;
 const parts=/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value));
 if(!parts)return null;
 const cents=BigInt(parts[1])*100n+BigInt((parts[2]??'').padEnd(2,'0'));
 return cents>99999999999999n?null:cents.toString();
}
export function receivableListSettlement(row:Composition&{amount:number;received_amount:number|null;status:string;open_cents?:string|null}){const nominal=legacyReceivableCents(row.amount);const settled=row.settled_cents===undefined?legacyReceivableCents(row.received_amount):row.settled_cents===null?null:String(row.settled_cents);const open=row.open_cents!==undefined?row.open_cents:row.status==='cancelled'?'0':nominal===null||settled===null||BigInt(settled)>BigInt(nominal)?null:(BigInt(nominal)-BigInt(settled)).toString();return{nominal,settled,open,cash:row.cash_received_cents===undefined?undefined:row.cash_received_cents===null?null:String(row.cash_received_cents),credit:row.credit_applied_cents===undefined?undefined:row.credit_applied_cents===null?null:String(row.credit_applied_cents)};}
