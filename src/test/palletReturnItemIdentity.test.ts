// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';

let db:PGlite;
beforeAll(async()=>{
  db=new PGlite();
  await db.exec('create table pallet_return_items(id integer generated always as identity primary key,pallet_type_code text not null,pallet_type_name text not null);');
  await db.exec(readFileSync('supabase/migrations/20260922205100_require_pallet_return_item_identity.sql','utf8'));
});
afterAll(async()=>{await db?.close();});

it.each([
  ['', 'Euro'],['  ', 'Euro'],['EUR', ''],['EUR', '  '],
])('refuses pallet return items with blank code or name',async(code,name)=>{
  await expect(db.query('insert into pallet_return_items(pallet_type_code,pallet_type_name) values($1,$2)',[code,name])).rejects.toThrow('pallet_return_item_identity_required');
});

it('accepts identified types and rejects later clearing their identity',async()=>{
  const item=(await db.query<{id:number}>("insert into pallet_return_items(pallet_type_code,pallet_type_name) values('EUR','Euro') returning id")).rows[0].id;
  await expect(db.query('update pallet_return_items set pallet_type_name=$1 where id=$2',[' ',item])).rejects.toThrow('pallet_return_item_identity_required');
  expect((await db.query<{pallet_type_name:string}>('select pallet_type_name from pallet_return_items where id=$1',[item])).rows[0].pallet_type_name).toBe('Euro');
});
