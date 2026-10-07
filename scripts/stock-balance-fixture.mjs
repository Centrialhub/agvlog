import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export const PREDECESSOR_MD5='b0ff5c10a960fc655a62032273b645f0';
export const STOCK_IDS=Object.freeze({
 tenant:'10000000-0000-4000-8000-000000000001',otherTenant:'10000000-0000-4000-8000-000000000002',
 actor:'20000000-0000-4000-8000-000000000001',otherActor:'20000000-0000-4000-8000-000000000002',
 location:'30000000-0000-4000-8000-000000000001',otherLocation:'30000000-0000-4000-8000-000000000002',
 client:'40000000-0000-4000-8000-000000000001',otherClient:'40000000-0000-4000-8000-000000000002',
 document:'50000000-0000-4000-8000-000000000001',otherDocument:'50000000-0000-4000-8000-000000000002',
});
const digest=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
const extract=(sql,name)=>{
 const start=sql.indexOf(`create or replace function ${name}(`);
 if(start<0)throw Error(`Fixture dependency missing: ${name}`);
 const tail=sql.slice(start),match=/\bas\s+(\$[a-zA-Z_][a-zA-Z0-9_]*\$|\$\$)/i.exec(tail);
 if(!match)throw Error(`Fixture dollar body missing: ${name}`);
 const bodyStart=match.index+match[0].length,end=tail.indexOf(match[1]+';',bodyStart);
 if(end<0)throw Error(`Fixture function terminator missing: ${name}`);
 return {definition:tail.slice(0,end+match[1].length+1),body:tail.slice(bodyStart,end)};
};

// Only build SQL. This module never starts PostgreSQL, connects, or applies it.
// Root is the candidate checkout, not this artifact directory. Never use this
// minimal synthetic graph to stand in for hosted Auth/Storage or full baseline.
export function buildStockBalanceFixture({root=process.cwd()}={}){
 const sources={};
 const read=name=>{const bytes=readFileSync(join(root,name));sources[name]=digest(bytes);return bytes.toString('utf8').replace(/\r\n/g,'\n');};
 const old=extract(read('supabase/migrations/20260917050000_fix_inventory_and_payroll_followups.sql'),'public.update_inventory_balance');
 if(digest(old.body,'md5')!==PREDECESSOR_MD5)throw Error('Captured stock predecessor source drifted; review instead of broadening its hash.');
 const admin=extract(read('supabase/migrations/20260831164442_remove_authenticator_requirement.sql'),'public.is_tenant_admin');
 const history=read('supabase/migrations/20260917144500_make_inventory_movements_immutable.sql');
 const rpc=read('supabase/migrations/20260926190732_restore_inventory_public_rpcs.sql');
 const i=STOCK_IDS;
 const sql=`
-- Disposable synthetic graph only. Caller must own an isolated database.
-- Actual balance body, admin helper, immutability migration and RPC restoration
-- are extracted verbatim above; dimensions/nullability and the eight balance
-- constraints reproduce task-3/final-native-stock-contract.json at 05d6639c.
do $roles$ begin
 if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres superuser;end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end;$roles$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.tenants(id uuid primary key);
create table public.tenant_memberships(tenant_id uuid not null,user_id uuid not null,role text not null,active boolean not null,primary key(tenant_id,user_id));
create table public.clients(id uuid primary key,tenant_id uuid not null,company_name text);
create table public.inventory_locations(id uuid primary key,tenant_id uuid not null,name text);
create table public.fiscal_documents(id uuid primary key,tenant_id uuid not null);
create table public.inventory_balances(
 id uuid not null default gen_random_uuid(),tenant_id uuid not null,
 location_id uuid,client_id uuid,item_description text not null,
 quantity numeric not null default 0,pallet_count integer not null default 0,
 weight_kg numeric default 0,volume_m3 numeric default 0,
 first_inbound_at timestamptz,last_movement_at timestamptz,updated_at timestamptz not null default now(),
 constraint inventory_balances_pkey primary key(id),
 constraint inventory_balances_tenant_id_fkey foreign key(tenant_id) references public.tenants(id),
 constraint inventory_balances_location_id_fkey foreign key(location_id) references public.inventory_locations(id),
 constraint inventory_balances_client_id_fkey foreign key(client_id) references public.clients(id),
 constraint inventory_balances_logical_key unique nulls not distinct(tenant_id,location_id,client_id,item_description));
alter table public.inventory_balances
 add constraint inventory_balances_quantity_nonnegative check(quantity>=0) not valid,
 add constraint inventory_balances_pallets_nonnegative check(pallet_count>=0) not valid,
 add constraint inventory_balances_dimensions_nonnegative check(quantity>=0 and pallet_count>=0 and weight_kg>=0 and volume_m3>=0) not valid;
create table public.inventory_movements(
 id uuid not null,tenant_id uuid not null,location_id uuid,movement_type text not null,
 client_id uuid,item_description text not null,quantity numeric not null,pallet_count integer,
 weight_kg numeric,volume_m3 numeric,fiscal_document_id uuid,notes text,
 moved_at timestamptz not null,created_at timestamptz not null,created_by uuid,adjustment_direction text,
 constraint inventory_movements_pkey primary key(id),
 constraint inventory_movements_tenant_id_fkey foreign key(tenant_id) references public.tenants(id),
 constraint inventory_movements_location_id_fkey foreign key(location_id) references public.inventory_locations(id),
 constraint inventory_movements_client_id_fkey foreign key(client_id) references public.clients(id),
 constraint inventory_movements_fiscal_document_id_fkey foreign key(fiscal_document_id) references public.fiscal_documents(id));
alter table public.inventory_movements
 add constraint inventory_movements_supported_type check(movement_type in('inbound','outbound','adjustment')) not valid,
 add constraint inventory_adjustment_direction check((movement_type='adjustment' and adjustment_direction in('increase','decrease')) or (movement_type<>'adjustment' and adjustment_direction is null)) not valid;
${admin.definition}
alter function public.is_tenant_admin(uuid) owner to postgres;
alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;
create policy "Admins can manage inventory_balances" on public.inventory_balances as permissive for all to authenticated using(public.is_tenant_admin(tenant_id)) with check(public.is_tenant_admin(tenant_id));
create policy "Admins can view inventory_movements" on public.inventory_movements as permissive for select to authenticated using(public.is_tenant_admin(tenant_id));
grant usage on schema public,auth to authenticated,service_role;
grant select,insert,update,delete on public.inventory_balances,public.inventory_movements to authenticated;
${old.definition}
alter function public.update_inventory_balance() owner to postgres;
revoke all on function public.update_inventory_balance() from public,anon,authenticated,service_role;
grant execute on function public.update_inventory_balance() to service_role;
create trigger trg_inventory_movement_balance after insert on public.inventory_movements for each row execute function public.update_inventory_balance();
${history}
alter function public.guard_inventory_movement_history() owner to postgres;
${rpc}
alter function public.create_inventory_movement_v1(jsonb) owner to postgres;
insert into public.tenants values('${i.tenant}'),('${i.otherTenant}');
insert into public.tenant_memberships values('${i.tenant}','${i.actor}','admin',true),('${i.otherTenant}','${i.otherActor}','admin',true);
insert into public.inventory_locations values('${i.location}','${i.tenant}','Own fixture'),('${i.otherLocation}','${i.otherTenant}','Foreign fixture');
insert into public.clients values('${i.client}','${i.tenant}','Own fixture'),('${i.otherClient}','${i.otherTenant}','Foreign fixture');
insert into public.fiscal_documents values('${i.document}','${i.tenant}'),('${i.otherDocument}','${i.otherTenant}');
`;
 return {sql,sources,predecessorMd5:PREDECESSOR_MD5};
}
