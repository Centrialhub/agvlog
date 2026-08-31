import {readFileSync} from 'node:fs';
import {createDocumentChangeDatabase} from './documentChangesDatabase.ts';
export {documentChangeIds as itemWriterIds,seedDocumentChanges as seedItemWriter} from './documentChangesDatabase.ts';
export const itemWriterSignature='upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)';
export const itemWriterMigration='20260830094049_harden_load_item_preparation_writer.sql';
export const itemWriterCandidateSql=readFileSync('supabase/migrations/'+itemWriterMigration,'utf8');
export async function createItemWriterDatabase(){const db=await createDocumentChangeDatabase();await db.exec(itemWriterCandidateSql);return db;}
