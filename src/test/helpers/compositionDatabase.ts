import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createPlanningDatabase,planningIds,seedPlanning} from './planningDatabase.ts';

export interface CompositionFunction {signature:string;definition:string;hash:string;anon:boolean;authenticated:boolean;service_role:boolean;comment:string|null}
export const compositionContracts=(JSON.parse(readFileSync('docs/qa/COMPOSITION-PREDEPLOYMENT-2026-08-30.json','utf8')) as {
  functions:CompositionFunction[];
}).functions;
const schema=JSON.parse(readFileSync('docs/qa/COMPOSITION-SCHEMA-2026-08-30.json','utf8')) as {
  columns:{table:string;column:string;type:string;nullable:string;default:string|null}[];
  triggers:{table:string;definition:string}[];
};
export const compositionLegacySql=compositionContracts.map(f=>f.definition+';\n'+
  `revoke all on function public.${f.signature} from public,anon,authenticated,service_role;\n`+
  (['anon','authenticated','service_role'] as const).filter(role=>f[role]).map(role=>`grant execute on function public.${f.signature} to ${role};`).join('\n')
).join('\n');
export const compositionMigration='20260830072744_harden_load_composition_integrity.sql';
export const compositionCandidateSql=readFileSync(`supabase/migrations/${compositionMigration}`,'utf8');
// Extends the financial/planning fixture with captured composition bodies,
// real load/item/document FKs, mirrors and totals. External fiscal branches stay
// instrumented; this is not the complete Supabase/Auth/PostGIS environment.
export async function installCompositionFixture(db:PGlite){
  const existing=new Set(['id','tenant_id','load_id','fiscal_document_id','quantity']);
  const additions=schema.columns.filter(c=>c.table==='load_items'&&!existing.has(c.column));
  await db.exec(`alter table public.load_items alter column id set default gen_random_uuid(),
    alter column quantity set default 0,${additions.map(c=>`add column ${c.column} ${c.type}${c.default===null?'':` default ${c.default}`}${c.nullable==='NO'?' not null':''}`).join(',')};
    alter table public.loads add column total_volume_m3 numeric;
    alter table public.fiscal_documents add column pallet_count integer default 0,add column product_summary text,add column deleted_at timestamptz;
    create table public.orders(id uuid primary key,tenant_id uuid);
    alter table public.load_items add foreign key(load_id) references public.loads(id) on delete cascade,
      add foreign key(fiscal_document_id) references public.fiscal_documents(id),
      add foreign key(order_id) references public.orders(id);
    alter table public.fiscal_documents add foreign key(load_id) references public.loads(id);
    alter table public.dispatch_stop_documents add foreign key(load_id) references public.loads(id) on delete set null;
  `);
  await db.exec(compositionLegacySql);
  for(const trigger of schema.triggers.filter(t=>t.table==='load_items'))await db.exec(trigger.definition+';');
}
export async function createCompositionDatabase({candidate=false}:{candidate?:boolean}={}){
  const db=await createPlanningDatabase({candidate:true});await installCompositionFixture(db);
  if(candidate)await db.exec(compositionCandidateSql);
  return db;
}
export const compositionIds={...planningIds,doc3:'90000000-0000-4000-8000-000000000003'};
export async function seedComposition(db:PGlite){
  await seedPlanning(db);const i=compositionIds;
  await db.exec('delete from public.orders;');
  await db.query('update public.load_items set weight_kg=case when id=$1 then 10 else 20 end,pallet_count=1,volume_m3=1',[i.item]);
}
export async function compositionRpc(db:PGlite,sql:string,params:unknown[]=[]){
  await db.exec('set role authenticated');
  try{return await db.query(sql,params);}finally{await db.exec('reset role');}
}
