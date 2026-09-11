import {z} from 'zod';
import type {DeliveryReceiptRow} from './deliveryReceiptOperations';

export const deliveryReceiptCoverFieldSchema=z.enum(['delivery_date','destination','driver','vehicle','receiver','documents']);
export const deliveryReceiptCoverConfigSchema=z.object({
  enabled:z.boolean(),title:z.string().trim().min(3).max(120),subtitle:z.string().trim().max(240).nullable(),
  footer:z.string().trim().max(500).nullable(),fields:z.array(deliveryReceiptCoverFieldSchema).min(1).max(6)
    .refine(values=>new Set(values).size===values.length),
}).strict();
export type DeliveryReceiptCoverConfig=z.infer<typeof deliveryReceiptCoverConfigSchema>;
export const defaultDeliveryReceiptCoverConfig:DeliveryReceiptCoverConfig={enabled:true,title:'Comprovante de entrega',subtitle:null,
  footer:null,fields:['delivery_date','destination','driver','vehicle','receiver','documents']};

type Document=DeliveryReceiptRow['documents'][number];
const normalizedName=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,160);
export function deliveryDocumentSupplierKey(document:Document){
  const tax=(document.issuer_tax_id??'').replace(/\D/g,'');
  if(tax.length>=8&&tax.length<=14)return `tax:${tax}`;
  if(document.supplier_id)return `id:${document.supplier_id}`;
  const name=normalizedName(document.issuer_name??'');return name?`name:${name}`:null;
}

export interface DeliveryReceiptSupplierGroup{key:string;name:string;rows:DeliveryReceiptRow[];documentKinds:string[]}
export function groupDeliveryReceiptsBySupplier(rows:DeliveryReceiptRow[]):DeliveryReceiptSupplierGroup[]{
  const groups=new Map<string,{name:string;rows:Map<string,DeliveryReceiptRow>;kinds:Set<string>}>();
  for(const row of rows)for(const document of row.documents){
    const key=deliveryDocumentSupplierKey(document);if(!key)continue;
    const name=document.issuer_name?.trim()||document.issuer_tax_id?.trim()||'Fornecedor sem nome';
    const group=groups.get(key)??{name,rows:new Map(),kinds:new Set<string>()};
    group.rows.set(row.id,row);group.kinds.add(document.kind);groups.set(key,group);
  }
  return [...groups.entries()].map(([key,value])=>({key,name:value.name,rows:[...value.rows.values()],documentKinds:[...value.kinds].sort()}))
    .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
