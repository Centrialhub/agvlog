// @vitest-environment node
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {it,expect} from 'vitest';
import {createCashPeriodCloseDatabase} from './helpers/cashPeriodCloseDatabase';
import {createManualExpenseCancellationDatabase} from './helpers/manualExpenseCancellationDatabase';
import {createLegacyReceivableAssociationDatabase} from './helpers/legacyReceivableAssociationDatabase';
import {collectEffectiveMovementCatalog} from './helpers/effectiveMovementCatalog';
it('exports installed movement consumers and triggers across the three integrated fixture domains',async()=>{
 const factories=[['cash_period_close',createCashPeriodCloseDatabase],['cost_inventory_cancellation',createManualExpenseCancellationDatabase],['receivable_fiscal_projection',createLegacyReceivableAssociationDatabase]] as const;
 const foundation=readFileSync('supabase/migrations/20260910182541_finance_movement_correction_foundation.sql','utf8');
 const history=readFileSync('supabase/migrations/20260910182830_finance_movement_correction_history.sql','utf8');
 const catalogs=[];for(const [name,factory] of factories){const db=await factory();try{await db.exec(foundation);await db.exec(history);catalogs.push(await collectEffectiveMovementCatalog(db,name));}finally{await db.close();}}
 const variants=new Map<string,Set<string>>();for(const c of catalogs)for(const f of c.functions){const hashes=variants.get(f.signature)??new Set<string>();hashes.add(f.sha256);variants.set(f.signature,hashes);}
 const report={version:1,readiness:{public_void_command_ready:false,missing:['original_request FK does not prove record_movement result points to this movement','duplicate/replacement needs active-target and acyclic-graph checks','void INSERT still needs period and complete dependency guard','three fixture catalogs do not constitute one final integrated writer schema']},history:{file:'20260910182830_finance_movement_correction_history.sql',sha256:createHash('sha256').update(history).digest('hex')},foundation:{file:'20260910182541_finance_movement_correction_foundation.sql',sha256:createHash('sha256').update(foundation).digest('hex')},scope:'effective local PGlite installations, not remote or a single complete production schema',dependency_limit:'pg_depend does not resolve PLpgSQL/dynamic SQL body dependencies; textual_calls are candidates, not dependency proof',catalogs,conflicting_effective_definitions:[...variants].filter(([,h])=>h.size>1).map(([signature,hashes])=>({signature,hashes:[...hashes]}))};
 writeFileSync('docs/qa/finance-movement-effective-catalog-2026-09-10.json',JSON.stringify(report,null,2)+'\n');
 expect(catalogs[0].functions.some(f=>f.name==='cash_period_close_snapshot')).toBe(true);expect(catalogs[1].functions.some(f=>f.name==='record_expense_batch')).toBe(true);expect(catalogs[2].functions.some(f=>f.name==='project_receivable_command')).toBe(true);for(const c of catalogs){expect(c.direct_reference_count).toBeGreaterThan(0);expect(c.views.some(v=>v.name==='finance_private.active_movements')).toBe(true);expect(c.all_triggers.some(t=>t.table_name==='public.finance_movements')).toBe(true);}
},60000);
