import {readFileSync} from 'node:fs';
import {createUnloadingCostCorrectionDatabase} from './unloadingCostCorrectionDatabase';
import {installExtinctionCoreScenario,freshExtinctionScenario} from './openComplementExtinctionDatabase';
import {financeIds as i} from './financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;
export async function prepareExtinctionNative(){db=await createUnloadingCostCorrectionDatabase();await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await installExtinctionCoreScenario(db);await db.exec(readFileSync('supabase/migrations/20260911094310_finance_open_complement_extinction_public_boundary.sql','utf8'));await db.exec('commit');}
export async function freshExtinctionNative(){await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);const source=await freshExtinctionScenario(db);await db.exec('commit');return source;}
