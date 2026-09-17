import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {prepareEmployeeAdvanceCandidatesNativeFixture} from './employeeAdvanceCandidatesNativeFixture';

export async function preparePayrollCarryoverNativeFixture(){
 await prepareEmployeeAdvanceCandidatesNativeFixture();
 const db=new PGlite();
 await db.exec(readFileSync('supabase/migrations/20260914215302_finance_payroll_carryover_propagation.sql','utf8'));
 await db.exec('reset role');
}
