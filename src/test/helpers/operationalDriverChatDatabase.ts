import { createOperatorReferencePaginationDatabase } from './operatorReferencePaginationDatabase.ts';
import { chatIds, driverChatSql, installDriverChatFixture } from './driverChatDatabase.ts';

/** Isolated SQL fixture: actual cursor reader/chat RPCs, synthetic identities. */
export async function createOperationalDriverChatDatabase() {
  const db = await createOperatorReferencePaginationDatabase({ legacy: false });
  await installDriverChatFixture(db);
  const i = chatIds;
  await db.query(`insert into drivers(id,tenant_id,user_id,name,active,created_at,updated_at) values
    ($1,$2,$3,'Motorista QA',true,'2026-01-01','2026-01-01'),
    ($4,$2,$5,'Colega QA',true,'2026-01-01','2026-01-01'),
    ($6,$7,$8,'Outra empresa QA',true,'2026-01-01','2026-01-01')`,
  [i.driver,i.tenant,i.user,i.peerDriver,i.peerUser,i.foreignDriver,i.otherTenant,i.foreignUser]);
  await db.query(`insert into tenant_memberships values
    ($1,$2,'driver',true),($1,$3,'driver',true),($4,$5,'driver',true),
    ($1,$6,'operator',true),($1,$7,'admin',true),($1,$8,'client',true)`,
  [i.tenant,i.user,i.peerUser,i.otherTenant,i.foreignUser,i.operator,i.admin,i.client]);
  await db.query("insert into profiles values($1,'Operação QA'),($2,'Admin QA')",[i.operator,i.admin]);
  await db.exec(driverChatSql());
  return db;
}
