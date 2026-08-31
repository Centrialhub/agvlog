// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';

it('loads predominant product and preserves tenant isolation in the CT-e preview defaults', async () => {
  const db=new PGlite();
  try {
    await db.exec(`
      create table loads(id uuid,tenant_id uuid,driver_id uuid,vehicle_id uuid);
      create table tenant_emitters(tenant_id uuid,active boolean,is_default boolean,created_at timestamptz);
      create table clients(id uuid,tax_id text);
      create table drivers(id uuid,tenant_id uuid);
      create table vehicles(id uuid,tenant_id uuid);
      create table fiscal_documents(tenant_id uuid,document_type text,load_id uuid,remitter_cnpj text,remitter text,
        origin_city text,origin_state text,recipient text,recipient_cnpj text,recipient_city text,recipient_state text,
        client_id uuid,product_summary text,weight_kg numeric,value numeric);
      create function is_tenant_member(t uuid) returns boolean language sql as
        $$ select t='00000000-0000-4000-8000-000000000001'::uuid $$;
      insert into loads(id,tenant_id) values
        ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001'),
        ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000002');
      insert into fiscal_documents(tenant_id,document_type,load_id,product_summary,weight_kg,value) values
        ('00000000-0000-4000-8000-000000000001','inbound','00000000-0000-4000-8000-000000000010','ALIMENTOS',12,90),
        ('00000000-0000-4000-8000-000000000002','inbound','00000000-0000-4000-8000-000000000020','OUTRO TENANT',99,900);
    `);
    await db.exec(readFileSync('supabase/migrations/20260831184715_fix_cte_defaults_product_summary.sql','utf8'));
    const result=await db.query<{result:{cargo_predominant:string;totals:{invoice_count:number;total_weight_kg:number}}}>(
      "select cte_defaults_for_group(array['00000000-0000-4000-8000-000000000010'::uuid]) result");
    expect(result.rows[0].result).toMatchObject({cargo_predominant:'ALIMENTOS',totals:{invoice_count:1,total_weight_kg:12}});
    await expect(db.query("select cte_defaults_for_group(array['00000000-0000-4000-8000-000000000020'::uuid])"))
      .rejects.toThrow('Acesso negado');
    await expect(db.query("select cte_defaults_for_group(array['00000000-0000-4000-8000-000000000010'::uuid,'00000000-0000-4000-8000-000000000020'::uuid])"))
      .rejects.toThrow('mesmo tenant');
  } finally {await db.close();}
},20000);
