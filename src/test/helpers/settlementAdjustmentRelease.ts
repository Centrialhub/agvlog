import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
export const settlementAdjustmentReleaseSql=(mode:'contain'|'resume')=>readFileSync('docs/qa/SETTLEMENT-ADJUSTMENT-'+mode.toUpperCase()+'-2026-08-30.sql','utf8');
export async function settlementAdjustmentRelease(db:PGlite,mode:'contain'|'resume'){
 await db.exec('savepoint adjustment_release');try{await db.exec(settlementAdjustmentReleaseSql(mode).replace(/^begin;$/m,'').replace(/^commit;$/m,''));await db.exec('release savepoint adjustment_release');}
 catch(error){await db.exec('rollback to savepoint adjustment_release;release savepoint adjustment_release');throw error;}
}
