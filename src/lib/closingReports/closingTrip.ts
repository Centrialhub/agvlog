import {z} from 'zod';
const number=z.number().finite().nonnegative().nullable();
const text=z.string().nullable();
export const closingTripFieldsSchema=z.object({km_initial:number,km_final:number,fuel_liters:number,fuel_unit_price:number,
 vehicle_plate:text,driver_name:text,departure_at:text,arrival_at_ts:text,route_label:text,route_complement:text});
export type ClosingTripFields=z.infer<typeof closingTripFieldsSchema>;
export const localDateTime=(value:string|null)=>{
 if(!value)return '';const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
 const pad=(n:number)=>String(n).padStart(2,'0');
 return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
