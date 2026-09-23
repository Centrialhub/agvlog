// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';

let db:PGlite;
beforeAll(async()=>{
  db=new PGlite();
  await db.exec('create table pallet_return_protocols(id integer generated always as identity primary key,issue_date date not null,returned_at date);');
  await db.exec(readFileSync('supabase/migrations/20260922205200_require_pallet_return_chronology.sql','utf8'));
});
afterAll(async()=>{await db?.close();});

it('rejects a return earlier than its issue date on creation and editing',async()=>{
  await expect(db.query("insert into pallet_return_protocols(issue_date,returned_at) values('2026-09-20','2026-09-19')")).rejects.toThrow('pallet_return_before_issue');
  const item=(await db.query<{id:number}>("insert into pallet_return_protocols(issue_date,returned_at) values('2026-09-20','2026-09-20') returning id")).rows[0].id;
  await expect(db.query("update pallet_return_protocols set issue_date='2026-09-21' where id=$1",[item])).rejects.toThrow('pallet_return_before_issue');
  await expect(db.query("update pallet_return_protocols set returned_at='2026-09-19' where id=$1",[item])).rejects.toThrow('pallet_return_before_issue');
});
