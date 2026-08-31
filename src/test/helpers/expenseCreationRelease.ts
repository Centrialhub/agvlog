import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';

export function expenseCreationReleaseSql(mode:'contain'|'resume',transaction=true){
 const sql=readFileSync('docs/qa/EXPENSE-CREATION-'+mode.toUpperCase()+'-2026-08-30.sql','utf8');
 return transaction?sql:sql.replace(/^begin;\r?\n/m,'').replace(/^commit;\s*$/m,'');
}
export async function expenseCreationRelease(db:PGlite,mode:'contain'|'resume'){
 await db.exec('savepoint expense_release_test');
 try{await db.exec(expenseCreationReleaseSql(mode,false));await db.exec('release savepoint expense_release_test');}
 catch(error){await db.exec('rollback to savepoint expense_release_test;release savepoint expense_release_test');throw error;}
}
