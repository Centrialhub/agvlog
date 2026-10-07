import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
export const functions=JSON.parse(readFileSync(new URL('./native-safe-authorization-functions.json',import.meta.url),'utf8')) as Array<{signature:string;definition:string;bodyMd5:string;acl:string[];ownerName:string}>;
const policies=JSON.parse(readFileSync(new URL('./native-personnel-policies.json',import.meta.url),'utf8')) as Array<{table:string;policy:string;cmd:string;permissive:string;roles:string[];qual:string|null;check:string|null}>;
export const repair=readFileSync('supabase/migrations/20261006013354_restore_assigned_incident_personnel_reads.sql','utf8');
export const rollback=readFileSync('docs/qa/assigned-personnel-rls-rollback-2026-10-06.sql','utf8');
export const id={tenant:'10000000-0000-4000-8000-000000000001',otherTenant:'10000000-0000-4000-8000-000000000002',
 workspace:'11000000-0000-4000-8000-000000000001',otherWorkspace:'11000000-0000-4000-8000-000000000002',
 admin:'20000000-0000-4000-8000-000000000001',operator:'20000000-0000-4000-8000-000000000002',
 assigned:'20000000-0000-4000-8000-000000000003',peer:'20000000-0000-4000-8000-000000000004',
 foreign:'20000000-0000-4000-8000-000000000005',client:'20000000-0000-4000-8000-000000000006',
 employee:'30000000-0000-4000-8000-000000000001',peerEmployee:'30000000-0000-4000-8000-000000000002',
 foreignEmployee:'30000000-0000-4000-8000-000000000003',
 responsible:'40000000-0000-4000-8000-000000000001',peerResponsible:'40000000-0000-4000-8000-000000000002',foreignResponsible:'40000000-0000-4000-8000-000000000003',
 action:'50000000-0000-4000-8000-000000000001',peerAction:'50000000-0000-4000-8000-000000000002',foreignAction:'50000000-0000-4000-8000-000000000003'};
const identifier=(value:string)=>'"'+value.replace(/"/g,'""')+'"';
export async function setup(snapshot=false){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create role supabase_auth_admin;create role dashboard_user;
  create schema auth;create schema private;grant usage on schema auth,private to authenticated,service_role;
  grant usage on schema auth to supabase_auth_admin,dashboard_user;
  create table public.workspaces(id uuid primary key);
  create table public.drivers(id uuid primary key);
  create table public.tenants(id uuid primary key,workspace_id uuid not null references workspaces);
  create table public.incidents(id uuid primary key,tenant_id uuid not null references tenants,unique(tenant_id,id));
  create table public.tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean,primary key(tenant_id,user_id));
  create table public.client_portal_access(tenant_id uuid,user_id uuid,active boolean);
  create table public.employees(id uuid primary key,tenant_id uuid not null,workspace_id uuid not null,
    user_id uuid,status text not null default 'active',name text not null,doc_cpf text,notes text,
    driver_id uuid references drivers,manager_id uuid references employees,
    foreign key(workspace_id) references workspaces on delete restrict,unique(tenant_id,id));
  create table public.incident_responsible(id uuid primary key,tenant_id uuid not null,
    employee_id uuid,description text,incident_id uuid not null${snapshot?',assigned_user_id uuid':''},
    foreign key(tenant_id,employee_id) references employees(tenant_id,id),
    foreign key(tenant_id,incident_id) references incidents(tenant_id,id) on delete cascade,
    foreign key(tenant_id) references tenants on delete cascade);
  create table public.employee_incident_actions(id uuid primary key,tenant_id uuid not null,
    employee_id uuid not null,description text,incident_id uuid not null,
    action_type text not null default 'note',amount numeric not null default 0,status text not null default 'open',
    check(action_type<>'payroll_discount' or amount>0),
    check(action_type in('note','verbal_warning','written_warning','suspension','training_required','payroll_discount','document_request','termination_recommendation','other')),
    check(status in('open','completed','cancelled')),
    foreign key(tenant_id,employee_id) references employees(tenant_id,id),
    foreign key(tenant_id,incident_id) references incidents(tenant_id,id) on delete cascade,
    foreign key(tenant_id) references tenants on delete cascade);
  alter table public.employees enable row level security;
  alter table public.incident_responsible enable row level security;
  alter table public.employee_incident_actions enable row level security;
  grant select,insert,update,delete on employees,incident_responsible,employee_incident_actions to authenticated;
  grant select on employees,incident_responsible,employee_incident_actions to anon;`);
 const creationOrder=['auth.uid()','auth.jwt()','private.request_tenant_id()',
  'private.user_can_access_tenant(uuid,uuid)','public.is_tenant_admin(uuid)',
  'public.is_tenant_member(uuid)','public.is_tenant_operator_or_admin(uuid)',
  'private.is_request_tenant_member(uuid)'];
 if(functions.length!==creationOrder.length||functions.some(row=>!creationOrder.includes(row.signature)))
  throw Error('Unexpected native helper fixture set');
 for(const row of [...functions].sort((a,b)=>creationOrder.indexOf(a.signature)-creationOrder.indexOf(b.signature))){
  await db.exec(row.definition.trimEnd()+';');
  // Bodies are copied byte-for-byte; fixture owner OIDs differ from native OIDs.
  await db.exec(`alter function ${row.signature} owner to ${row.ownerName};
    revoke all on function ${row.signature} from public,anon,authenticated,service_role,postgres,dashboard_user;`);
  await db.exec(`set role ${row.ownerName};`);
  for(const acl of row.acl){const grantee=acl.split('=')[0]||'public';
    await db.exec(`grant execute on function ${row.signature} to ${grantee};`);}
  await db.exec('reset role');
 }
 for(const row of policies){
  let qual=row.qual;
  if(snapshot&&row.table==='incident_responsible'&&row.policy==='Assigned employees and operators can view incident_responsible')
    qual=qual!.replace('OR (is_tenant_member(tenant_id)','OR ((assigned_user_id = ( SELECT auth.uid() AS uid)) AND is_tenant_member(tenant_id)');
  await db.exec(`create policy ${identifier(row.policy)} on public.${identifier(row.table)} as ${row.permissive}
    for ${row.cmd} to ${row.roles.map(identifier).join(',')}${qual?' using('+qual+')':''}${row.check?' with check('+row.check+')':''};`);
 }
 await db.query('insert into workspaces values($1),($2)',[id.workspace,id.otherWorkspace]);
 await db.query('insert into tenants values($1,$3),($2,$4)',[id.tenant,id.otherTenant,id.workspace,id.otherWorkspace]);
 await db.query('insert into incidents values($1,$1),($2,$2)',[id.tenant,id.otherTenant]);
 await db.query(`insert into tenant_memberships values($1,$3,'admin',true),($1,$4,'operator',true),
  ($1,$5,'driver',true),($1,$6,'driver',true),($2,$7,'driver',true)`,[id.tenant,id.otherTenant,id.admin,id.operator,id.assigned,id.peer,id.foreign]);
 await db.query('insert into client_portal_access values($1,$2,true)',[id.tenant,id.client]);
 await db.query(`insert into employees(id,tenant_id,workspace_id,user_id,status,name,doc_cpf,notes) values
  ($1,$4,$6,$8,'active','Synthetic own','RH-PRIVATE-1','private1'),($2,$4,$6,$9,'active','Synthetic peer','RH-PRIVATE-2','private2'),
  ($3,$5,$7,$10,'active','Synthetic foreign','RH-PRIVATE-3','private3')`,[id.employee,id.peerEmployee,id.foreignEmployee,id.tenant,id.otherTenant,id.workspace,id.otherWorkspace,id.assigned,id.peer,id.foreign]);
 await db.query(`insert into incident_responsible(id,tenant_id,employee_id,description,incident_id${snapshot?',assigned_user_id':''}) values
  ($1,$4,$6,'own',$4${snapshot?',$9':''}),($2,$4,$7,'peer',$4${snapshot?',$10':''}),($3,$5,$8,'foreign',$5${snapshot?',$11':''})`,
  [id.responsible,id.peerResponsible,id.foreignResponsible,id.tenant,id.otherTenant,id.employee,id.peerEmployee,id.foreignEmployee,...(snapshot?[id.assigned,id.peer,id.foreign]:[])]);
 await db.query(`insert into employee_incident_actions(id,tenant_id,employee_id,description,incident_id) values($1,$4,$6,'own',$4),($2,$4,$7,'peer',$4),($3,$5,$8,'foreign',$5)`,
  [id.action,id.peerAction,id.foreignAction,id.tenant,id.otherTenant,id.employee,id.peerEmployee,id.foreignEmployee]);
 return db;
}
export async function request<T>(db:PGlite,user:string|null,query:string,params:unknown[]=[],options:{tenant?:string;workspace?:string;role?:'authenticated'|'anon';claims?:Record<string,unknown>;headers?:string}={}){
 const role=options.role??'authenticated';const tenant=options.tenant??id.tenant;
 const claims={sub:user,role,active_tenant_id:tenant,active_workspace_id:options.workspace??id.workspace,...options.claims};
 await db.exec('begin');
 try{
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true)",
   [user??'',JSON.stringify(claims),options.headers??JSON.stringify({'x-agvlog-tenant-id':tenant})]);
  await db.exec(`set local role ${role}`);const result=await db.query<T>(query,params);await db.exec('commit');return result;
 }catch(error){await db.exec('rollback');throw error;}
}
export async function visible(db:PGlite,user:string|null,table:'incident_responsible'|'employee_incident_actions'|'employees',options:Parameters<typeof request>[4]={}){
 return (await request<{id:string}>(db,user,`select id from public.${table} order by id`,[],options)).rows.map(row=>row.id);
}
export async function graph(db:PGlite){
 return (await db.query(`select jsonb_build_object(
  'classes',(select jsonb_agg(to_jsonb(c) order by oid) from pg_class c where oid in('employees'::regclass,'incident_responsible'::regclass,'employee_incident_actions'::regclass)),
  'policies',(select jsonb_agg(case when (polrelid='incident_responsible'::regclass and polname='Assigned employees and operators can view incident_responsible') or (polrelid='employee_incident_actions'::regclass and polname='eia_select') then to_jsonb(p)-'polqual' else to_jsonb(p) end order by oid) from pg_policy p where polrelid in('employees'::regclass,'incident_responsible'::regclass,'employee_incident_actions'::regclass)),
  'constraints',(select jsonb_agg(to_jsonb(c) order by oid) from pg_constraint c where conrelid in('employees'::regclass,'incident_responsible'::regclass,'employee_incident_actions'::regclass))
 ) value`)).rows[0];
}
