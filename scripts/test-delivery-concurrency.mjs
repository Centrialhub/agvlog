import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  deliveryDetails, deliveryIds as ids, deliveryMigrations, deliverySchema, seedDelivery,
  legacyDeliverySchema, deliveryCutoverMigration,
} from '../src/test/helpers/deliveryDatabase.ts';
import { runTripLoadConcurrency } from './test-trip-load-concurrency-cases.mjs';
import { runPlanningConcurrency } from './test-planning-concurrency-cases.mjs';
import { runCompositionConcurrency } from './test-composition-concurrency-cases.mjs';
import { runReplanningConcurrency } from './test-replanning-concurrency-cases.mjs';
import { runDocumentChangeConcurrency } from './test-document-change-concurrency-cases.mjs';
import { runItemPreparationConcurrency } from './test-item-preparation-concurrency-cases.mjs';
import { runOperationOutcomeConcurrency } from './test-operation-outcome-concurrency-cases.mjs';
import { runPortalPrivacyNative } from './test-portal-privacy-native-cases.mjs';
import { runProofVersionConcurrency } from './test-proof-version-concurrency-cases.mjs';
import { runOperationCorrectionConcurrency } from './test-operation-correction-concurrency-cases.mjs';
import { runDeliveryAttemptFoundationNative } from './test-delivery-attempt-foundation-native-cases.mjs';
import { runRedeliveryNative } from './test-redelivery-native-cases.mjs';
import { runDocumentMetadataNative } from './test-document-metadata-native-cases.mjs';
import { runClosingSourcesNative } from './test-closing-sources-native-cases.mjs';
import { runClosingDraftsNative } from './test-closing-drafts-native-cases.mjs';
import { runClosingLifecycleNative } from './test-closing-lifecycle-native-cases.mjs';
import { runControlTowerNative } from './test-control-tower-native-cases.mjs';
import { runSsxPositionNative } from './test-ssx-position-native-cases.mjs';

const arrivalBaseline = readFileSync('supabase/migrations/20260824224152_baseline.sql', 'utf8');
const legacyArrivalDefinition = arrivalBaseline.match(
  /CREATE OR REPLACE FUNCTION public\.driver_mark_arrival\(_stop_id uuid\)[\s\S]*?END; \$function\$;/,
)?.[0];
if (!legacyArrivalDefinition) throw new Error('Legacy driver_mark_arrival definition not found in baseline');
const additiveArrivalMigration = readFileSync(
  'supabase/migrations/20260831232458_add_gps_driver_arrival_rpc.sql',
  'utf8',
);

// Disposable native PostgreSQL; never connects to a configured application database.
// Run with Node 22: node --experimental-strip-types scripts/test-delivery-concurrency.mjs
// PG_QA_BIN may point to an existing, trusted PostgreSQL 17 bin directory.
const cache = resolve('node_modules/.cache/qa-postgres');
const bin = process.env.PG_QA_BIN || join(cache, 'runtime-17.11/pgsql/bin');
const exe = (name) => join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
for (const name of ['initdb', 'pg_ctl', 'psql']) {
  if (!existsSync(exe(name))) throw new Error(`Missing ${exe(name)}; supply PG_QA_BIN. No automatic download.`);
}
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, 'delivery-concurrency-'));
const cluster = join(directory, 'data');
const passwordFile = join(directory, 'init-password');
const password = randomBytes(32).toString('hex');
const listener = createServer();
await new Promise((res, rej) => { listener.once('error', rej); listener.listen(0, '127.0.0.1', res); });
const port = listener.address().port;
await new Promise((res, rej) => listener.close((error) => error ? rej(error) : res()));
const env = { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable' };
const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  '-h', '127.0.0.1', '-p', String(port), '-U', 'qa', '-d', 'postgres'];
const active = new Set();
const literal = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const identity = `select set_config('request.jwt.claim.sub',${literal(ids.user)},false);`;
const asDriver = `${identity} set role authenticated;`;

function session(name, database = 'postgres') {
  const databaseArgs = [...args]; databaseArgs[databaseArgs.length - 1] = database;
  const child = spawn(exe('psql'), databaseArgs, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { child, output: '', error: '', exited: false, code: null };
  active.add(state);
  child.stdout.on('data', (chunk) => { state.output += chunk; });
  child.stderr.on('data', (chunk) => { state.error += chunk; });
  // psql exits immediately on an expected SQL rejection (ON_ERROR_STOP). A write
  // racing that exit must not crash Node before the disposable server is stopped.
  child.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') state.error += `\nstdin: ${error.message}`;
  });
  state.done = new Promise((res, rej) => {
    child.once('error', rej);
    child.once('exit', (code) => { state.exited = true; state.code = code; active.delete(state); res(state); });
  });
  state.send = (sql) => child.stdin.write(`${sql}\n`);
  state.send(`set application_name=${literal(name)}; set statement_timeout='8s'; set lock_timeout='6s';`);
  return state;
}
async function finish(state, sql, success = true) {
  if (!state.exited && !state.child.stdin.destroyed && !state.child.stdin.writableEnded) state.child.stdin.end(`${sql}\n\\q\n`);
  const timeout = setTimeout(() => state.child.kill(), 12_000);
  try { await state.done; } finally { clearTimeout(timeout); }
  if (success) assert.equal(state.code, 0, state.error);
  return state;
}

async function query(sql, database = 'postgres') {
  return (await finish(session('delivery-qa-query', database), sql)).output.trim();
}

async function seed() {
  const statements = [];
  // Synthetic fixture parameters only. Never accepts SQL or data from the application.
  await seedDelivery({
    exec: async (sql) => { statements.push(sql); },
    query: async (sql, params) => {
      statements.push(sql.replace(/\$(\d+)/g, (_, index) => literal(params[Number(index) - 1])) + ';');
    },
  });
  await query(statements.join('\n'));
}

async function waitForMarker(state, marker) {
  const deadline = Date.now() + 6000;
  while (!state.output.includes(marker)) {
    assert.ok(!state.exited, `Session exited before ${marker}: ${state.error}`);
    assert.ok(Date.now() < deadline, `Timed out waiting for ${marker}: ${state.error}`);
    await delay(25);
  }
}

async function contested(holderSql, waiterSql, { driver = true, waiterSucceeds = true, holderAfterBlocked = '', waitForBlocking = true, database = 'postgres' } = {}) {
  const holder = session('delivery-qa-holder',database);
  holder.send(`begin; ${driver ? asDriver : identity} ${holderSql}; select '__HOLDER_READY__';`);
  await waitForMarker(holder, '__HOLDER_READY__');
  const waiter = session('delivery-qa-waiter',database);
  waiter.send(`begin; ${driver ? asDriver : identity} ${waiterSql}; commit;`);
  if (!waitForBlocking) {const result=await finish(waiter,'',waiterSucceeds);await finish(holder,`${holderAfterBlocked}; commit;`);return result;}
  const deadline = Date.now() + 4500;
  let overlap = false;
  while (!overlap && Date.now() < deadline) {
    const blocked = await query(`select exists(select 1 from pg_stat_activity w
      join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid))
      where w.application_name='delivery-qa-waiter' and h.application_name='delivery-qa-holder');`);
    overlap = blocked === 't';
    if (!overlap) {
      assert.ok(!waiter.exited, `Waiter failed before overlap: ${waiter.error}`);
      await delay(25);
    }
  }
  assert.ok(overlap, 'The competing write did not block on the held graph. Race reproduced.');
  await finish(holder, `${holderAfterBlocked}; commit;`);
  const result = await finish(waiter, '', waiterSucceeds);
  if (!waiterSucceeds) assert.notEqual(result.code, 0, 'Conflicting write unexpectedly committed');
  return result;
}

const outcome = (status = 'delivered', request = ids.request, details = deliveryDetails) =>
  `select public.driver_record_delivery_outcome(${literal(ids.stop)},${literal(status)},
    ${literal(JSON.stringify(details))}::jsonb,${literal(request)},'arrived')`;
const graph = `select public._lock_delivery_trip_graph(${literal(ids.tenant)},${literal(ids.trip)})`;
const cases = [
  ['same request waits and replays without duplicate proof or occurrence', async () => {
    await seed();
    const replay = await contested(outcome(), outcome());
    assert.ok(replay.output.includes('"replayed": true'), replay.output);
    assert.equal(await query(`select (select count(*) from public.proof_of_delivery)||','||
      (select count(*) from public.operational_events)||','||
      (select count(*) from public.dispatch_events where payload ? 'delivery_request');`), '1,1,1');
  }],
  ['different outcome waits, then rejects a terminal stop without overwriting proof', async () => {
    await seed();
    const conflict = await contested(outcome(), outcome('refused', 'a0000000-0000-4000-8000-000000000002',
      { notes: 'Cliente recusou a entrega' }), { waiterSucceeds: false });
    assert.match(conflict.error, /40001|23514/);
    assert.equal(await query(`select status from public.dispatch_stops where id=${literal(ids.stop)};`), 'delivered');
    assert.equal(await query('select count(*) from public.proof_of_delivery;'), '1');
  }],
  ['canonical load-link deletion cannot pass a held delivery graph', async () => {
    await seed();
    await contested(graph, `delete from public.dispatch_trip_loads where dispatch_trip_id=${literal(ids.trip)}`, { driver: false });
  }],
  ['canonical load-link update cannot pass a held delivery graph', async () => {
    await seed();
    await contested(graph, `update public.dispatch_trip_loads set tenant_id=tenant_id where dispatch_trip_id=${literal(ids.trip)}`,
      { driver: false });
  }],
  ['arrival and delivery acquire trip before stop without a deadlock', async () => {
    await seed();
    await query(`insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,created_by)
      values(${literal(ids.tenant)},${literal(ids.trip)},${literal(ids.stop)},'arrival',${literal(ids.user)});`);
    // The waiter must block on the trip without first holding the stop. Only
    // after that overlap is proven does the holder lock the complete graph.
    await contested(`select id from public.dispatch_trips where id=${literal(ids.trip)} for update`,
      `select public.driver_mark_arrival(${literal(ids.stop)},-23.5,-46.6,10)`, { driver: false, holderAfterBlocked: graph });
    assert.equal(await query("select count(*) from public.dispatch_events where event_type='arrival';"), '1');
  }],
  ['concurrent departures replay one physical event and leave delivery pending', async () => {
    await seed();
    const departure=`select public.driver_register_departure(${literal(ids.stop)},null)`;
    const replay=await contested(departure,departure);
    const stored=await query("select id from public.dispatch_events where event_type='departure';");
    assert.ok(replay.output.includes(stored),replay.output);
    assert.equal(await query("select count(*) from public.dispatch_events where event_type='departure';"),'1');
    assert.equal(await query('select status from public.dispatch_stops;'),'arrived');
    assert.equal(await query('select status from public.loads;'),'in_transit');
  }],
  ['departure and delivery acquire trip before stop without a deadlock', async () => {
    await seed();
    await contested(`select id from public.dispatch_trips where id=${literal(ids.trip)} for update`,
      `select public.driver_register_departure(${literal(ids.stop)},null)`, { driver:false,holderAfterBlocked:graph });
  }],
  ['departure revalidates driver assignment after waiting on a trip lock', async () => {
    await seed();
    const otherDriver='60000000-0000-4000-8000-000000000099';
    await query(`insert into public.drivers values(${literal(otherDriver)},${literal(ids.tenant)},
      '10000000-0000-4000-8000-000000000099',true);`);
    const rejected=await contested(`select id from public.dispatch_trips where id=${literal(ids.trip)} for update`,
      `select public.driver_register_departure(${literal(ids.stop)},null)`, { driver:false,waiterSucceeds:false,
        holderAfterBlocked:`update public.dispatch_trips set driver_id=${literal(otherDriver)} where id=${literal(ids.trip)}` });
    assert.match(rejected.error,/42501/);
    assert.equal(await query("select count(*) from public.dispatch_events where event_type='departure';"),'0');
    assert.equal(await query('select actual_departure_at is null from public.dispatch_stops;'),'t');
  }],
];

let started = false;
try {
  // Generated, throwaway local credential, removed immediately after initdb.
  writeFileSync(passwordFile, `${password}\n`, { mode: 0o600, flag: 'wx' });
  const initialized = spawnSync(exe('initdb'), ['-D', cluster, '-U', 'qa', `--pwfile=${passwordFile}`,
    '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--no-sync'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  unlinkSync(passwordFile);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.error?.message);
  const launched = spawnSync(exe('pg_ctl'), ['start', '-D', cluster, '-l', join(directory, 'server.log'),
    '-o', `-h 127.0.0.1 -p ${port} -c max_connections=12 -c shared_buffers=32MB`, '-t', '10', '-w'],
  { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  started = existsSync(join(cluster, 'postmaster.pid'));
  assert.equal(launched.status, 0, launched.stderr || launched.error?.message);
  console.log(`Native PostgreSQL: ${await query('show server_version;')} (loopback, disposable fixture)`);
  if(['finance-transfers','finance-settlements','finance-payroll-lifecycle','finance-settlement-payment','finance-trip-cost-builder','finance-account-openings','finance-cash-openings','finance-coverage-approvals','finance-verification-reauth','finance-legacy-payable','finance-legacy-receipt','finance-legacy-integrity','finance-receivable-portfolio','finance-recorded-cost-summary','finance-fiscal-dashboard','finance-unbilled-freight','finance-full-sequence','finance-legacy-expense-cost','finance-maintenance-labor','finance-maintenance-direct-part','finance-account-period-close','finance-legacy-cut-settlement','finance-stock-acquisition','finance-stock-consumption','finance-paid-projections','finance-paid-real-close','finance-cash-period','finance-payable-portfolio','finance-expense-cancellation','finance-manual-expense-cancellation','finance-active-movements','finance-reconciliation-voids','finance-movement-correction-context','finance-manual-movement-void','finance-public-movement-void','finance-period-money-package','finance-receivable-temporal','finance-receivable-captured-history','finance-receivable-payments-page','finance-period-unloading','finance-unloading-source-guard','finance-unloading-source-context','finance-unloading-projection-repair','finance-public-unloading-repair','redelivery-release'].includes(process.env.PG_QA_SUITE)) {
    // This suite prepares its own isolated database and roles below.
  } else if(process.env.PG_QA_SUITE==='control-tower') {
    await query('create role anon;create role authenticated;create role service_role;');
  } else {
  await query(deliverySchema + legacyDeliverySchema + '\nbegin;\n' +
    [...deliveryMigrations,deliveryCutoverMigration].map((file) => readFileSync(join('supabase/migrations', file), 'utf8')).join('\n') + '\ncommit;');
  // Install the exact legacy definition expected by the additive migration.
  // Arrival replay exercises real row locks and ownership without executing the
  // PostGIS distance branch. Distance validation still needs a PostGIS instance.
  await query(`alter table public.dispatch_stops add column latitude double precision, add column longitude double precision;
    ${legacyArrivalDefinition};
    revoke all on function public.driver_mark_arrival(uuid) from public,anon,authenticated,service_role;
    grant execute on function public.driver_mark_arrival(uuid) to authenticated,service_role;
    ${additiveArrivalMigration}`);
  const stopContracts=JSON.parse(readFileSync('docs/qa/STOP-WRITERS-PREDEPLOYMENT-2026-08-30.json','utf8'));
  const departureOriginal=stopContracts.functions.find(f=>f.signature==='driver_register_departure(uuid,text)');
  await query(departureOriginal.definition + ';\nbegin;\n' +
    readFileSync('supabase/migrations/20260830042313_harden_driver_stop_departure.sql','utf8') + '\ncommit;');
  const selectedCases=process.env.PG_QA_SUITE==='trip-load'?[]:cases;
  for (const [name, test] of selectedCases) {
    await test();
    console.log(`PASS ${name}`);
  }
  const tripLoadCount=await runTripLoadConcurrency({query,session,finish,seed,waitForMarker,contested,literal,ids,identity,asDriver,graph});
  const planningCount=await runPlanningConcurrency({query,session,finish,waitForMarker,contested,literal});
  const compositionCount=await runCompositionConcurrency({query,session,finish,waitForMarker,contested,literal});
  const replanningCount=await runReplanningConcurrency({query,session,finish,waitForMarker,contested,literal});
  const documentChangeCount=await runDocumentChangeConcurrency({query,session,finish,waitForMarker,contested,literal});
  const itemPreparationCount=await runItemPreparationConcurrency({query,session,finish,waitForMarker,contested,literal});
  const operationOutcomeCount=await runOperationOutcomeConcurrency({query,session,finish,waitForMarker,contested,literal});
  const proofVersionCount=await runProofVersionConcurrency({query,session,finish,waitForMarker,contested,literal});
  const correctionCount=await runOperationCorrectionConcurrency({query,session,finish,waitForMarker,contested,literal});
  const portalPrivacyCount=await runPortalPrivacyNative({query,queryDatabase:(database,sql)=>query(sql,database),literal});
  const attemptFoundationCount=await runDeliveryAttemptFoundationNative({query,session,finish,waitForMarker,contested,literal});
  const redeliveryCount=await runRedeliveryNative({query,session,finish,waitForMarker,contested,literal});
  const metadataCount=await runDocumentMetadataNative({query,session,finish,waitForMarker,contested,literal});
  const closingSourcesCount=await runClosingSourcesNative({query,session,finish,waitForMarker,literal});
  const closingDraftsCount=await runClosingDraftsNative({query,session,finish,waitForMarker,contested,literal});
  const closingLifecycleCount=await runClosingLifecycleNative({query,session,finish,waitForMarker,contested,literal});
  const {runReceivableFinancialNative}=await import('./test-receivable-financial-native-cases.mjs');
  const receivableFinancialCount=await runReceivableFinancialNative({query,session,finish,waitForMarker,contested,literal});
  const {runClientInvoiceNative}=await import('./test-client-invoice-native-cases.mjs');
  const clientInvoiceCount=await runClientInvoiceNative({query,session,finish,waitForMarker,contested,literal});
  const {runExpenseReviewNative}=await import('./test-expense-review-native-cases.mjs');
  const expenseReviewCount=await runExpenseReviewNative({query,session,finish,waitForMarker,contested,literal});
  const {runExpenseCreationNative}=await import('./test-expense-creation-native-cases.mjs');
  const expenseCreationCount=await runExpenseCreationNative({query,session,finish,waitForMarker,contested,literal});
  const {runDriverChatNative}=await import('./test-driver-chat-native-cases.mjs');
  const driverChatCount=await runDriverChatNative({query,session,finish,waitForMarker,contested,literal});
  const {runEventChatNative}=await import('./test-event-chat-native-cases.mjs');
  const eventChatCount=await runEventChatNative({query,session,finish,waitForMarker,contested,literal});
  const {runExpenseMfaNative}=await import('./test-expense-mfa-native-cases.mjs');
  const expenseMfaCount=await runExpenseMfaNative({query,session,finish,waitForMarker,contested,literal});
  const {runSettlementAdjustmentNative}=await import('./test-settlement-adjustment-native-cases.mjs');
  const settlementAdjustmentCount=await runSettlementAdjustmentNative({query,session,finish,waitForMarker,contested,literal});
  const {runFiscalReadinessNative}=await import('./test-fiscal-readiness-native-cases.mjs');
  const fiscalCount=await runFiscalReadinessNative({query,contested,literal});
  console.log(fiscalCount+' fiscal native tests passed.');
  console.log(`${selectedCases.length+tripLoadCount+planningCount+compositionCount+replanningCount+documentChangeCount+itemPreparationCount+operationOutcomeCount+proofVersionCount+correctionCount+portalPrivacyCount+attemptFoundationCount+redeliveryCount+metadataCount+closingSourcesCount+closingDraftsCount+closingLifecycleCount+receivableFinancialCount+clientInvoiceCount+expenseReviewCount+expenseCreationCount+driverChatCount+eventChatCount+expenseMfaCount+settlementAdjustmentCount} native PostgreSQL tests passed (concurrency, invariants, privacy and recovery). No production connection or fiscal request.`);
  }
  if(!['finance-transfers','finance-settlements','finance-payroll-lifecycle','finance-settlement-payment','finance-trip-cost-builder','finance-account-openings','finance-cash-openings','finance-coverage-approvals','finance-verification-reauth','finance-legacy-payable','finance-legacy-receipt','finance-legacy-integrity','finance-receivable-portfolio','finance-recorded-cost-summary','finance-fiscal-dashboard','finance-unbilled-freight','finance-full-sequence','finance-legacy-expense-cost','finance-maintenance-labor','finance-maintenance-direct-part','finance-account-period-close','finance-legacy-cut-settlement','finance-stock-acquisition','finance-stock-consumption','finance-paid-projections','finance-paid-real-close','finance-cash-period','finance-payable-portfolio','finance-expense-cancellation','finance-manual-expense-cancellation','finance-active-movements','finance-reconciliation-voids','finance-movement-correction-context','finance-manual-movement-void','finance-public-movement-void','finance-period-money-package','finance-receivable-temporal','finance-receivable-captured-history','finance-receivable-payments-page','finance-period-unloading','finance-unloading-source-guard','finance-unloading-source-context','finance-unloading-projection-repair','finance-public-unloading-repair','redelivery-release'].includes(process.env.PG_QA_SUITE)) {
  const towerCount=await runControlTowerNative({query,contested,literal,session,finish,waitForMarker});
  console.log(`${towerCount} additional Control Tower native tests passed.`);
  const ssxCount=await runSsxPositionNative({query,contested,literal});
  console.log(`${ssxCount} additional SSX position native tests passed.`);
  }
  if(!['control-tower','finance-settlements','finance-payroll-lifecycle','finance-settlement-payment','finance-trip-cost-builder','finance-account-openings','finance-cash-openings','finance-coverage-approvals','finance-verification-reauth','finance-legacy-payable','finance-legacy-receipt','finance-legacy-integrity','finance-receivable-portfolio','finance-recorded-cost-summary','finance-fiscal-dashboard','finance-unbilled-freight','finance-full-sequence','finance-legacy-expense-cost','finance-maintenance-labor','finance-maintenance-direct-part','finance-account-period-close','finance-legacy-cut-settlement','finance-stock-acquisition','finance-stock-consumption','finance-paid-projections','finance-paid-real-close','finance-cash-period','finance-payable-portfolio','finance-expense-cancellation','finance-manual-expense-cancellation','finance-active-movements','finance-reconciliation-voids','finance-movement-correction-context','finance-manual-movement-void','finance-public-movement-void','finance-period-money-package','finance-receivable-temporal','finance-receivable-captured-history','finance-receivable-payments-page','finance-period-unloading','finance-unloading-source-guard','finance-unloading-source-context','finance-unloading-projection-repair','finance-public-unloading-repair','redelivery-release'].includes(process.env.PG_QA_SUITE)) {
    const {runInternalTransfersNative}=await import('./test-finance-transfers-native-cases.mjs');
    const count=await runInternalTransfersNative({query,contested,literal,createRoles:process.env.PG_QA_SUITE==='finance-transfers'});
    console.log(`${count} additional internal transfer native tests passed.`);
  }
  if(process.env.PG_QA_SUITE==='finance-settlements') {
    const {runSettlementLinksNative}=await import('./test-finance-settlements-native-cases.mjs');
    const count=await runSettlementLinksNative({query,contested,literal,createRoles:true});
    console.log(`${count} settlement link native tests passed.`);
  }
  if(process.env.PG_QA_SUITE==='finance-payroll-lifecycle') {
    const {runPayrollLifecycleNative}=await import('./test-finance-payroll-lifecycle-native-cases.mjs');
    const count=await runPayrollLifecycleNative({query,contested,literal,createRoles:true});
    console.log(`${count} payroll lifecycle native tests passed.`);
  }
  if(process.env.PG_QA_SUITE==='finance-settlement-payment') {
    const {runSettlementPaymentNative}=await import('./test-finance-settlement-payment-native-cases.mjs');
    const count=await runSettlementPaymentNative({query,contested,literal,createRoles:true});
    console.log(`${count} canonical settlement payment native tests passed.`);
  }
  if(process.env.PG_QA_SUITE==='finance-trip-cost-builder') {
    const {runTripCostBuilderNative}=await import('./test-finance-trip-cost-builder-native-cases.mjs');
    const count=await runTripCostBuilderNative({query,contested,session,finish,waitForMarker,literal,createRoles:true});
    console.log(`${count} trip cost builder native tests passed.`);
  }
  if(process.env.PG_QA_SUITE==='finance-verification-reauth') {
    const {runVerificationReauthorizationNative}=await import('./test-finance-verification-reauth-native-cases.mjs');
    const count=await runVerificationReauthorizationNative({query,contested,literal,createRoles:true});
    console.log(`Verification reauthorization native tests passed: ${count}`);
  }
  if(process.env.PG_QA_SUITE==='finance-coverage-approvals') {
    const {runCoverageApprovalsNative}=await import('./test-finance-coverage-approvals-native-cases.mjs');
    const count=await runCoverageApprovalsNative({query,contested,literal,createRoles:true});
    console.log(`Coverage approvals native tests passed: ${count}`);
  }
  if(process.env.PG_QA_SUITE==='finance-cash-openings') {
    const {runCashOpeningsNative}=await import('./test-finance-cash-openings-native-cases.mjs');
    const count=await runCashOpeningsNative({query,contested,literal,createRoles:true});
    console.log(`Cash opening native tests passed: ${count}`);
  }
  if(process.env.PG_QA_SUITE==='finance-account-openings') {
    const {runAccountOpeningsNative}=await import('./test-finance-account-openings-native-cases.mjs');
    const count=await runAccountOpeningsNative({query,contested,literal,createRoles:true});
    console.log(count+' account opening native tests passed.');
  }
  if(process.env.PG_QA_SUITE==='finance-legacy-payable') {
    const {runLegacyPayableNative}=await import('./test-finance-legacy-payable-native-cases.mjs');
    const count=await runLegacyPayableNative({query,contested,literal,createRoles:true});
    console.log(count+' legacy payable association native tests passed.');
  }
  if(process.env.PG_QA_SUITE==='finance-legacy-receipt') {
    const {runLegacyReceiptNative}=await import('./test-finance-legacy-receipt-native-cases.mjs');
    const count=await runLegacyReceiptNative({query,contested,literal,createRoles:true});
    console.log(count+' legacy receipt association native tests passed.');
  }
  if(process.env.PG_QA_SUITE==='finance-legacy-integrity') {
    const {runLegacyIntegrityNative}=await import('./test-finance-legacy-integrity-native-cases.mjs');
    const count=await runLegacyIntegrityNative({query,literal,createRoles:true});
    console.log(count+' legacy integrity native tests passed.');
  }
if(process.env.PG_QA_SUITE==='finance-receivable-portfolio') {
const {runReceivablePortfolioNative}=await import('./test-finance-receivable-portfolio-native-cases.mjs');
console.log(await runReceivablePortfolioNative({query,literal,createRoles:true})+' receivable portfolio native tests passed.');
}
if(process.env.PG_QA_SUITE==='finance-recorded-cost-summary') {
const {runRecordedCostSummaryNative}=await import('./test-finance-recorded-cost-summary-native-cases.mjs');
console.log(await runRecordedCostSummaryNative({query,literal,createRoles:true})+' recorded cost summary native tests passed.');
}
if(process.env.PG_QA_SUITE==='finance-fiscal-dashboard') {const {runFiscalDashboardNative}=await import('./test-finance-fiscal-dashboard-native-cases.mjs');console.log(await runFiscalDashboardNative({query,literal,createRoles:true})+' fiscal dashboard native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-unbilled-freight') {const {runUnbilledFreightNative}=await import('./test-finance-unbilled-freight-native-cases.mjs');console.log(await runUnbilledFreightNative({query,literal,createRoles:true})+' unbilled freight native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-full-sequence') {const {runFullMigrationSequenceNative}=await import('./test-full-migration-sequence-native.mjs');console.log(await runFullMigrationSequenceNative({query,literal})+' complete migrations applied.');}
if(process.env.PG_QA_SUITE==='finance-legacy-expense-cost') {const {runLegacyExpenseCostNative}=await import('./test-finance-legacy-expense-cost-native-cases.mjs');console.log(await runLegacyExpenseCostNative({query,contested,literal,createRoles:true})+' legacy expense cost native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-maintenance-labor') {const {runMaintenanceLaborNative}=await import('./test-finance-maintenance-labor-native-cases.mjs');console.log(await runMaintenanceLaborNative({query,contested,literal,createRoles:true})+' maintenance labor native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-maintenance-direct-part') {const {runMaintenanceDirectPartNative}=await import('./test-finance-maintenance-direct-part-native-cases.mjs');console.log(await runMaintenanceDirectPartNative({query,contested,literal,createRoles:true})+' maintenance direct part native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-account-period-close') {const {runAccountPeriodCloseNative}=await import('./test-finance-account-period-close-native-cases.mjs');console.log(await runAccountPeriodCloseNative({query,contested,literal,createRoles:true})+' account period close native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-legacy-cut-settlement') {const {runLegacyCutSettlementNative}=await import('./test-finance-legacy-cut-settlement-native-cases.mjs');console.log(await runLegacyCutSettlementNative({query,contested,literal,createRoles:true})+' legacy cut settlement native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-stock-acquisition') {const {runStockAcquisitionNative}=await import('./test-finance-stock-acquisition-native-cases.mjs');console.log(await runStockAcquisitionNative({query,contested,literal,createRoles:true})+' stock acquisition native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-stock-consumption') {const {runStockConsumptionNative}=await import('./test-finance-stock-consumption-native-cases.mjs');console.log(await runStockConsumptionNative({query,contested,literal,createRoles:true})+' stock consumption native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-paid-projections') {const {runPaidProjectionsNative}=await import('./test-finance-paid-projections-native-cases.mjs');console.log(await runPaidProjectionsNative({query,contested,literal,createRoles:true})+' paid projection native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-paid-real-close') {const {runPaidRealCloseNative}=await import('./test-finance-paid-real-close-native-cases.mjs');console.log(await runPaidRealCloseNative({query,contested,literal,createRoles:true})+' paid real close native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-cash-period') {const {runCashPeriodNative}=await import('./test-finance-cash-period-native-cases.mjs');console.log(await runCashPeriodNative({query,contested,literal,createRoles:true})+' cash period native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-payable-portfolio') {const {runPayablePortfolioNative}=await import('./test-finance-payable-portfolio-native-cases.mjs');console.log(await runPayablePortfolioNative({query,contested,literal,createRoles:true})+' payable portfolio native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-expense-cancellation') {const {runExpenseCancellationNative}=await import('./test-finance-expense-cancellation-native-cases.mjs');console.log(await runExpenseCancellationNative({query,contested,literal,createRoles:true})+' expense cancellation native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-manual-expense-cancellation') {const {runManualExpenseCancellationNative}=await import('./test-finance-manual-expense-cancellation-native-cases.mjs');console.log(await runManualExpenseCancellationNative({query,contested,literal,createRoles:true})+' manual expense cancellation native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-active-movements') {const {runActiveMovementNative}=await import('./test-finance-active-movements-native-cases.mjs');console.log(await runActiveMovementNative({query,contested,literal,createRoles:true})+' active movement native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-reconciliation-voids') {const {runReconciliationVoidsNative}=await import('./test-finance-reconciliation-voids-native-cases.mjs');console.log(await runReconciliationVoidsNative({query,contested,literal,createRoles:true})+' reconciliation voids native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-movement-correction-context') {const {runMovementCorrectionContextNative}=await import('./test-finance-movement-correction-context-native-cases.mjs');console.log(await runMovementCorrectionContextNative({query,contested,literal,createRoles:true})+' movement correction context native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-manual-movement-void') {const {runManualMovementVoidNative}=await import('./test-finance-manual-movement-void-native-cases.mjs');console.log(await runManualMovementVoidNative({query,contested,literal,createRoles:true})+' manual movement void native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-public-movement-void') {const {runPublicMovementVoidNative}=await import('./test-finance-public-movement-void-native-cases.mjs');console.log(await runPublicMovementVoidNative({query,contested,literal,createRoles:true})+' public movement void native tests passed.');}
if(process.env.PG_QA_SUITE==='finance-period-money-package') {const {runPeriodMoneyPackageNative}=await import('./test-finance-period-money-package-native-cases.mjs');console.log(await runPeriodMoneyPackageNative({query,contested,literal,createRoles:true})+' period money package native tests passed.');}
  if (process.env.PG_QA_SUITE === 'finance-receivable-temporal') { const {runReceivableTemporalNative}=await import('./test-finance-receivable-temporal-native-cases.mjs'); const total=await runReceivableTemporalNative({query,contested,literal,createRoles:true}); console.log(`${total} receivable temporal native tests passed.`); }
  if (process.env.PG_QA_SUITE === 'finance-receivable-captured-history') { const {runReceivableCapturedHistoryNative}=await import('./test-finance-receivable-captured-history-native-cases.mjs'); const total=await runReceivableCapturedHistoryNative({query,contested,literal,createRoles:true}); console.log(`${total} receivable captured history native tests passed.`); }
  if (process.env.PG_QA_SUITE === 'finance-receivable-payments-page') { const {runReceivablePaymentsPageNative}=await import('./test-finance-receivable-payments-page-native-cases.mjs'); const total=await runReceivablePaymentsPageNative({query,contested,literal,createRoles:true}); console.log(`${total} receivable payments page native tests passed.`); }
  if (process.env.PG_QA_SUITE === 'finance-period-unloading') { const {runPeriodUnloadingNative}=await import('./test-finance-period-unloading-native-cases.mjs'); const total=await runPeriodUnloadingNative({query,contested,literal,createRoles:true}); console.log(`${total} period unloading native tests passed.`); }
  if (process.env.PG_QA_SUITE === 'finance-unloading-source-guard') { const {runUnloadingSourceGuardNative}=await import('./test-finance-unloading-source-guard-native-cases.mjs'); const total=await runUnloadingSourceGuardNative({query,contested,literal,createRoles:true}); console.log(`${total} unloading source guard native tests passed.`); }
  if (process.env.PG_QA_SUITE === 'finance-unloading-source-context') { const {runUnloadingSourceContextNative}=await import('./test-finance-unloading-source-context-native-cases.mjs'); const total=await runUnloadingSourceContextNative({query,contested,literal,createRoles:true}); console.log(`${total} unloading source context native tests passed.`); }
  if (process.env.PG_QA_SUITE === 'finance-unloading-projection-repair') { const {runUnloadingProjectionRepairNative}=await import('./test-finance-unloading-projection-repair-native-cases.mjs'); const total=await runUnloadingProjectionRepairNative({query,contested,literal,createRoles:true}); console.log(`${total} unloading projection repair native tests passed.`); }
  if (process.env.PG_QA_SUITE === 'finance-public-unloading-repair') { const {runPublicUnloadingRepairNative}=await import('./test-finance-public-unloading-repair-native-cases.mjs'); const total=await runPublicUnloadingRepairNative({query,contested,literal,createRoles:true}); console.log(`${total} public unloading repair native tests passed.`); }
  if(process.env.PG_QA_SUITE==='redelivery-release'){const {runRedeliveryReleaseNative}=await import('./test-redelivery-release-native-cases.mjs');const count=await runRedeliveryReleaseNative({query,session,finish,waitForMarker,contested,literal});console.log(`${count} redelivery release native tests passed.`);}
} catch (error) {
  // Keep the original assertion visible even if cleanup has a second failure.
  console.error('Native PostgreSQL suite failed before cleanup:', error);
  throw error;
} finally {
  for (const state of active) state.child.kill();
  await Promise.allSettled([...active].map((state) => state.done));
  if (existsSync(passwordFile)) unlinkSync(passwordFile);
  if (started) {
    // Windows fsync at shutdown can exceed 10s while the coverage/build gate runs.
    const stopped = spawnSync(exe('pg_ctl'), ['stop', '-D', cluster, '-m', 'fast', '-t', '25', '-w'],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(stopped.status, 0, `Could not stop disposable PostgreSQL: ${stopped.stderr}`);
    assert.ok(!existsSync(join(cluster, 'postmaster.pid')), 'Disposable PostgreSQL is still running');
    console.log('Disposable PostgreSQL stopped. Diagnostic files retained under node_modules/.cache/qa-postgres.');
  }
}
