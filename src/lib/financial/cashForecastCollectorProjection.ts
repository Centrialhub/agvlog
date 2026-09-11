import {cashForecastCollectorSchema} from './cashForecastCollectorContract';
import {projectCashForecast,type CashForecastCompanyBasis} from './cashForecastProjection';

type Expected={tenant_id:string;actor_id:string;cutoff:string;period_end:string;revision?:string};
/** Server consumer adapter. This does not persist a forecast or authorize an RPC. */
export function projectCollectedCashForecast(input:unknown,expected:Expected){
 const collection=cashForecastCollectorSchema.parse(input);
 if(collection.tenant_id!==expected.tenant_id||collection.actor_id!==expected.actor_id||collection.cutoff!==expected.cutoff||collection.period_end!==expected.period_end||(expected.revision!==undefined&&collection.revision!==expected.revision))
  throw new Error('Coleta diferente da empresa, operador, período ou revisão solicitados.');
 const source_issues=[...collection.source_issues];
 for(const row of collection.origins.filter(row=>!row.valid))source_issues.push({scope:row.scenario==='unbilled'?'expanded':'confirmed',code:'forecast_origin_unverified',source_ids:[row.source_id]});
 // Preserve invalid source rows alongside diagnostics; never replace their amounts with zero.
 if(!collection.account_scope.account_ids.length)return {collection,projection:null,issues:[...source_issues,{scope:'all' as const,code:'forecast_accounts_unavailable',source_ids:[] as string[]}]};
 const basis:CashForecastCompanyBasis={version:2,tenant_id:collection.tenant_id,account_ids:collection.account_scope.account_ids,captured_at:collection.captured_at,cutoff:collection.cutoff,period_end:collection.period_end,base:collection.base,
  origins:collection.origins.flatMap(row=>row.valid?[{economic_key:row.economic_key,source_table:row.source_table,source_id:row.source_id,source_revision:row.source_revision,direction:row.direction,scenario:row.scenario,nominal_cents:row.nominal_cents!,fulfilled_cents:row.fulfilled_cents!,reserved_credit_cents:row.reserved_credit_cents!,expected_on:row.expected_on,expected_date_source:row.expected_date_source}]:[]),
  recorded_after_cutoff:collection.recorded_after_cutoff,unassigned_credit_cents:collection.unassigned_credit_cents,source_issues};
 const projection=projectCashForecast(basis);
 return {collection,projection,issues:projection.issues};
}
