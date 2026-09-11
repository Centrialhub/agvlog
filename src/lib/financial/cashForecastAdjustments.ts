import {z} from 'zod';
const cents=z.string().regex(/^(0|[1-9]\d{0,13})$/).nullable().optional();
export const forecastAdjustmentFields={discount_cents:cents,loss_cents:cents,adjustment_cents:cents};
type Adjustments={discount_cents?:string|null;loss_cents?:string|null;adjustment_cents?:string|null};
/** Legacy saved sources omit all fields; new evidence must provide a complete composition. */
export function forecastAdjustmentsValid(row:Adjustments,valid=true){
 const values=[row.discount_cents,row.loss_cents,row.adjustment_cents];
 if(values.every(v=>v===undefined))return true;
 if(values.some(v=>v===undefined))return false;
 if(!valid)return values.every(v=>v===null);
 if(!values.every(v=>typeof v==='string'&&/^(0|[1-9]\d{0,13})$/.test(v)))return false;
 return BigInt(row.discount_cents!)+BigInt(row.loss_cents!)===BigInt(row.adjustment_cents!);
}
export function forecastAdjustmentAmount(row:Adjustments):bigint{
 if(!forecastAdjustmentsValid(row))throw new Error('Ajustes sem caixa não comprovados.');
 return row.adjustment_cents===undefined?0n:BigInt(row.adjustment_cents!);
}
