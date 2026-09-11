import {readFileSync} from 'node:fs';
import {createLegacyReceivableAssociationDatabase} from './legacyReceivableAssociationDatabase';
export async function createUnbilledFreightDatabase(){
 const db=await createLegacyReceivableAssociationDatabase();
 await db.exec("alter table nfse_documents add column status text,add column cancelled boolean default false;create table fiscal_source_reservations(tenant_id uuid,environment text,source_id uuid,outbound_id uuid,nfse_id uuid,primary key(tenant_id,environment,source_id));");
 await db.exec(readFileSync('supabase/migrations/20260910153731_finance_unbilled_freight_summary.sql','utf8'));
 return db;
}
