// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, afterAll, it, expect } from 'vitest';
import { createFiscalReadinessDatabase, fiscalSnapshot, serviceFiscal } from './helpers/fiscalReadinessDatabase';
import { operationIds as i, operationRpc } from './helpers/operationOutcomeDatabase';
import { subcontractingFixture } from './helpers/subcontractingFixture';
let ctx: Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
const selected=subcontractingFixture(i.tenant);
const d=selected.source.document;
function snapshot() {
  return {...fiscalSnapshot(ctx.client,'production'), cte_payload:{emitterCnpj:'11222333000181',environment:'production',
    contractorCteSource:{id:selected.source.id,sha256:selected.source.original_sha256},
    payload:{tipoCtrc:'01',tipoServico:'1',documentoAnterior:{chave:d.access_key,cnpj:d.issuer_cnpj,nome:d.issuer_name,ie:d.issuer_ie,uf:d.issuer_state,municipioInicio:d.origin_city_code,municipioFim:d.destination_city_code},
      inicio:{codigoCidade:d.origin_city_code,municipio:selected.originName},fim:{codigoCidade:d.destination_city_code,municipio:selected.destinationName},
      tomador:{role:'terceiro',cnpj:d.issuer_cnpj},notasFiscais:[{chave:'1'.repeat(44)}]}}};
}
beforeAll(async()=>{
  ctx=await createFiscalReadinessDatabase();const db=ctx.db;
  await db.exec(`create table if not exists auth.users(id uuid primary key);
    create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    alter table storage.objects add column if not exists metadata jsonb;
    create or replace function private.request_tenant_id() returns uuid language sql stable as $$select '${i.tenant}'::uuid$$;
    create or replace function private.is_request_tenant_member(t uuid) returns boolean language sql stable security definer as $$
      select t=private.request_tenant_id() and exists(select 1 from tenant_memberships where tenant_id=t and user_id=auth.uid() and active)$$;`);
  await db.exec(readFileSync('supabase/migrations/20261103174106_import_contractor_cte_sources.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261103193842_enforce_contractor_cte_issue_link.sql','utf8'));
  await db.query('insert into auth.users(id) values($1) on conflict do nothing',[i.operator]);
  await db.query(`insert into contractor_cte_sources(id,tenant_id,access_key,environment,source_format,document,original_path,original_sha256,original_size,original_name,created_by)
    values($1,$2,$3,'production','pdf',$4,$5,$6,31,'qa.pdf',$7)`,[selected.source.id,i.tenant,d.access_key,d,selected.source.original_path,selected.source.original_sha256,i.operator]);
},30000);
beforeEach(async()=>{await ctx.db.exec('begin');});
afterEach(async()=>{await ctx.db.exec('rollback');});
afterAll(async()=>{await ctx?.db.close();});
async function prepare(p:unknown=snapshot()) { return (await operationRpc<{result:{id:string}}>(ctx.db,'select prepare_cte_issue($1,$2,$3,$4,$5::jsonb) result',[i.tenant,ctx.emitter,'production',[i.doc,i.doc2],JSON.stringify(p)])).rows[0].result; }
it('executa a RPC real, persiste referência e repete sem nova reserva',async()=>{
  const first=await prepare();expect((await prepare()).id).toBe(first.id);
  expect((await ctx.db.query('select cte_payload from fiscal_documents where id=$1',[first.id])).rows[0]).toMatchObject({cte_payload:{contractorCteSource:{id:selected.source.id}}});
});
it('bloqueia hash obsoleto, ambiente, fonte ausente, tomador e trajeto divergentes antes de reservar',async()=>{
  for(const change of [
    (p:ReturnType<typeof snapshot>)=>{p.cte_payload.contractorCteSource.sha256='b'.repeat(64);},
    (p:ReturnType<typeof snapshot>)=>{p.cte_payload.contractorCteSource.id='ffffffff-ffff-4fff-8fff-ffffffffffff';},
    (p:ReturnType<typeof snapshot>)=>{p.cte_payload.payload.tomador.cnpj='11222333000181';},
    (p:ReturnType<typeof snapshot>)=>{p.cte_payload.payload.inicio.codigoCidade='3550308';},
    (p:ReturnType<typeof snapshot>)=>{p.cte_payload.payload.documentoAnterior.chave='1'.repeat(44);},
  ]){const p=snapshot();change(p);await expect(prepare(p)).rejects.toThrow(/contractor_cte_/);}
  expect((await ctx.db.query('select count(*)::int n from fiscal_source_reservations')).rows[0]).toEqual({n:0});
});
it('fonte de outra empresa e ambiente são recusados',async()=>{
  await ctx.db.query('update contractor_cte_sources set tenant_id=$1 where id=$2',[i.otherTenant,selected.source.id]);
  await expect(prepare()).rejects.toThrow('contractor_cte_source_unavailable');
  await ctx.db.query("update contractor_cte_sources set tenant_id=$1,environment='homologation' where id=$2",[i.tenant,selected.source.id]);
  await expect(prepare()).rejects.toThrow('contractor_cte_source_unavailable');
});
it('não permite alterar snapshot reservado nem remover o vínculo em atualização direta',async()=>{
  const first=await prepare();const p=snapshot();p.cte_payload.payload.fim.municipio='Outro';
  await expect(prepare(p)).rejects.toThrow('fiscal_snapshot_changed_reconcile_first');
  await expect(operationRpc(ctx.db,'update fiscal_documents set cte_payload=$1 where id=$2',[fiscalSnapshot(ctx.client).cte_payload,first.id])).rejects.toThrow('permission denied');
  await expect(serviceFiscal(ctx.db,'update fiscal_documents set cte_payload=$1 where id=$2',[fiscalSnapshot(ctx.client).cte_payload,first.id])).rejects.toThrow('contractor_cte_snapshot_immutable');
});
