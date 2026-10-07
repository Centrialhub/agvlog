// @vitest-environment node
// WORKSPACE DRAFT. Never run this against a shared/native database.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, catalog, ids, setupPortal, signatures } from './helpers/portalRowActionsFixture';

// Root may set this to the CLI-generated supplemental migration when adopting.
const forward = readFileSync('supabase/migrations/20261005215852_restore_portal_row_action_flags.sql','utf8');
type Row = { id: string; client_id?: string; can_reply?: boolean; can_cancel?: boolean;
  resolved_at?: string | null; status?: string };
type Page = { rows: Row[]; next_cursor: unknown; snapshot_at: string; revision: string };
let db: PGlite;
beforeEach(async () => { db = await setupPortal(); },30_000);
afterEach(async () => { await db?.close(); });
const page = async (kind: 'occurrences'|'pickups', client: string | null = null) =>
  (await asRole<{ value: Page }>(db,`select public.list_client_${kind}_page_v1($1,$2) value`,
    [ids.tenant,client])).rows[0].value;
const hashes = async () => (await db.query(`select proname,md5(prosrc) body_hash from pg_proc
  where oid in($1::regprocedure,$2::regprocedure) order by proname`,signatures)).rows;

describe('A4: restore Portal row action DTOs against the actual predecessors', () => {
  it('reproduces missing fields first, then preserves OIDs/ACLs/schema metadata and supports replay', async () => {
    for (const kind of ['occurrences','pickups'] as const) {
      const before = await page(kind);
      expect(before.rows.length).toBeGreaterThan(0);
      for (const row of before.rows) {
        expect(row).not.toHaveProperty('client_id');
        expect(row).not.toHaveProperty(kind === 'occurrences' ? 'can_reply' : 'can_cancel');
      }
    }
    expect(await hashes()).toEqual([
      { proname: 'list_client_occurrences_page_v1',body_hash: 'd6e1af4fee570817c7a31ccb5555ccf0' },
      { proname: 'list_client_pickups_page_v1',body_hash: 'b6189d64b30fe17ddc5333e35b5604f0' },
    ]);
    const metadata = await catalog(db);
    await db.exec(forward);
    expect(await catalog(db)).toEqual(metadata);
    expect(await hashes()).toEqual([
      { proname: 'list_client_occurrences_page_v1',body_hash: 'd425604618db614ba9beb2f7791f8aad' },
      { proname: 'list_client_pickups_page_v1',body_hash: 'f0b9ad1bbfde7c885a41077685054de5' },
    ]);
    const patched = await hashes();
    await db.exec(forward);
    expect(await hashes()).toEqual(patched);
    expect(await catalog(db)).toEqual(metadata);
  });

  it('projects own permissions per client, keeps restricted rows restricted and honors visibility revocation', async () => {
    await db.exec(forward);
    const occurrences = await page('occurrences');
    expect(occurrences.rows.map(row => row.id)).toEqual([
      ids.occurrence,ids.viewOnlyOccurrence,ids.revokedVisibility,ids.resolvedOccurrence,
    ]);
    expect(occurrences.rows.find(row => row.id===ids.occurrence))
      .toMatchObject({ client_id: ids.client,can_reply: true,resolved_at: null });
    expect(occurrences.rows.find(row => row.id===ids.viewOnlyOccurrence))
      .toMatchObject({ client_id: ids.viewOnlyClient,can_reply: false });
    expect(occurrences.rows.find(row => row.id===ids.revokedVisibility))
      .toMatchObject({ client_id: ids.client,can_reply: false });
    const resolved = occurrences.rows.find(row => row.id===ids.resolvedOccurrence)!;
    // Capability flag stays distinct from the resolved_at state gate in the UI.
    expect(resolved.can_reply && !resolved.resolved_at).toBe(false);
    const pickups = await page('pickups');
    expect(pickups.rows.map(row => row.id)).toEqual([
      ids.pickup,ids.viewOnlyPickup,ids.taxMatchedPickup,ids.linkedPickup,
    ]);
    expect(pickups.rows.find(row => row.id===ids.pickup))
      .toMatchObject({ client_id: ids.client,can_cancel: true,status: 'pendente' });
    expect(pickups.rows.find(row => row.id===ids.viewOnlyPickup))
      .toMatchObject({ client_id: ids.viewOnlyClient,can_cancel: false });
    // Visibility through matching CNPJ does not grant permission on its owner client.
    expect(pickups.rows.find(row => row.id===ids.taxMatchedPickup))
      .toMatchObject({ client_id: ids.hiddenClient,can_cancel: false });
    const linked = pickups.rows.find(row => row.id===ids.linkedPickup)!;
    expect(linked.status === 'pendente' && linked.can_cancel).toBe(false);
    expect((await page('pickups',ids.client)).rows.map(row => row.id))
      .toEqual([ids.pickup,ids.linkedPickup]);
    expect((await page('occurrences',ids.viewOnlyClient)).rows)
      .toEqual([expect.objectContaining({ id: ids.viewOnlyOccurrence,can_reply: false })]);
    await expect(page('occurrences',ids.hiddenClient)).rejects.toThrow('not_authorized_for_client');
  });

  it('preserves snapshot/cursor/revision semantics and excludes inactive or different-actor grants', async () => {
    const sql = 'select public.list_client_occurrences_page_v1(_tenant_id=>$1,_page_size=>2) value';
    const firstBefore = (await asRole<{value:Page}>(db,sql,[ids.tenant])).rows[0].value;
    const allBefore = await page('occurrences');
    await db.exec(forward);
    const first = (await asRole<{value:Page}>(db,sql,[ids.tenant])).rows[0].value;
    expect(first.rows.map(row => row.id)).toEqual(firstBefore.rows.map(row => row.id));
    expect(first.revision).toBe(firstBefore.revision);
    expect(first.next_cursor).toEqual(firstBefore.next_cursor);
    const next = (await asRole<{value:Page}>(db,`select public.list_client_occurrences_page_v1(
      _tenant_id=>$1,_page_size=>2,_snapshot_at=>$2,_cursor=>$3,_expected_revision=>$4) value`,
      [ids.tenant,first.snapshot_at,first.next_cursor,first.revision])).rows[0].value;
    expect([...first.rows,...next.rows].map(row => row.id)).toEqual(allBefore.rows.map(row => row.id));
    expect(next.next_cursor).toBeNull();
    await db.exec(`update operational_events set updated_at='2026-10-04T10:00Z' where id='${ids.occurrence}'`);
    await expect(asRole(db,`select public.list_client_occurrences_page_v1(
      _tenant_id=>$1,_snapshot_at=>$2,_cursor=>$3,_expected_revision=>$4)`,
      [ids.tenant,first.snapshot_at,first.next_cursor,first.revision]))
      .rejects.toMatchObject({code:'40001'});
    await db.exec(`update client_portal_access set active=false where client_id='${ids.client}'`);
    expect((await page('occurrences')).rows.map(row => row.id)).toEqual([ids.viewOnlyOccurrence]);
    expect((await page('pickups')).rows.map(row => row.id)).toEqual([ids.viewOnlyPickup]);
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',ids.otherActor]);
    expect((await page('occurrences')).rows).toEqual([]);
    expect((await page('pickups')).rows).toEqual([]);
  });

  it('retains real reply/cancel authorization, audit and request-key replay behavior', async () => {
    const writerBodies = await db.query(`select proname,md5(prosrc) hash from pg_proc
      where proname in('reply_client_occurrence_v2','cancel_client_pickup_v2') order by proname`);
    await db.exec(forward);
    expect((await db.query(`select proname,md5(prosrc) hash from pg_proc
      where proname in('reply_client_occurrence_v2','cancel_client_pickup_v2') order by proname`)).rows)
      .toEqual(writerBodies.rows);
    const reply = 'select public.reply_client_occurrence_v2($1,$2,$3,$4) id';
    const replyParams = [ids.tenant,ids.occurrence,'Resposta própria',ids.request];
    const saved = await asRole<{id:string}>(db,reply,replyParams);
    expect((await asRole<{id:string}>(db,reply,replyParams)).rows).toEqual(saved.rows);
    await expect(asRole(db,reply,[ids.tenant,ids.occurrence,'Mensagem diferente',ids.request]))
      .rejects.toMatchObject({code:'22023'});
    for (const occurrence of [ids.hiddenOccurrence,ids.foreignOccurrence,ids.revokedVisibility]) {
      await expect(asRole(db,reply,[ids.tenant,occurrence,'Negativa',ids.request])).rejects.toThrow();
    }
    await expect(asRole(db,reply,[ids.tenant,ids.resolvedOccurrence,'Negativa',ids.request]))
      .rejects.toMatchObject({code:'22023'});
    expect((await db.query('select count(*)::int n from client_occurrence_messages')).rows).toEqual([{n:1}]);
    const cancel = 'select public.cancel_client_pickup_v2($1,$2,$3,$4)';
    const cancellation = [ids.tenant,ids.pickup,'Cancelamento próprio para homologação',ids.request];
    await asRole(db,cancel,cancellation);
    await asRole(db,cancel,cancellation);
    const row = (await db.query(`select status,portal_cancel_request_id,portal_cancelled_by,
      portal_cancellation_reason,portal_cancelled_at is not null has_time from pickup_orders where id=$1`,
      [ids.pickup])).rows[0];
    expect(row).toEqual({status:'cancelada',portal_cancel_request_id:ids.request,
      portal_cancelled_by:ids.actor,portal_cancellation_reason:cancellation[2],has_time:true});
    expect((await db.query(`select action,actor_user_id,source from entity_audit_log`)).rows)
      .toEqual([{action:'cancel_by_client',actor_user_id:ids.actor,source:'portal'}]);
    for (const pickup of [ids.viewOnlyPickup,ids.taxMatchedPickup,ids.foreignPickup,ids.linkedPickup]) {
      await expect(asRole(db,cancel,[ids.tenant,pickup,cancellation[2],ids.request])).rejects.toThrow();
    }
    await expect(asRole(db,cancel,[ids.tenant,ids.pickup,'Outra justificativa válida',ids.request]))
      .rejects.toThrow('Only pending pickups can be cancelled');
    expect((await db.query('select count(*)::int n from entity_audit_log')).rows).toEqual([{n:1}]);
  });

  it('keeps both anonymous reader ACLs denied and all ungranted-tenant data hidden', async () => {
    await db.exec(forward);
    for (const kind of ['occurrences','pickups'] as const) {
      await expect(asRole(db,`select public.list_client_${kind}_page_v1($1)`,[ids.tenant],'anon'))
        .rejects.toMatchObject({code:'42501'});
      expect((await asRole<{value:Page}>(db,`select public.list_client_${kind}_page_v1($1) value`,
        [ids.otherTenant])).rows[0].value.rows).toEqual([]);
    }
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub','']);
    expect((await page('occurrences')).rows).toEqual([]);
    expect((await page('pickups')).rows).toEqual([]);
  });

  it.each([
    ['body',`comment on function ${signatures[1]} is 'not a body mutation';
      create or replace function public.list_client_occurrences_page_v1(
        _tenant_id uuid,_client_id uuid default null,_severity text default null,_resolved boolean default null,
        _page_size integer default 50,_snapshot_at timestamptz default null,_cursor jsonb default null,
        _expected_revision text default null) returns jsonb language plpgsql stable security definer
        set search_path='' as $$begin return '{}'::jsonb;end$$;`,'reader_body_changed'],
    ['ACL',`grant execute on function ${signatures[1]} to anon`,'reader_acl_changed'],
    ['search_path',`alter function ${signatures[1]} set search_path=public`,'reader_metadata_changed'],
    ['security mode',`alter function ${signatures[1]} security invoker`,'reader_metadata_changed'],
    ['helper',`create or replace function public._portal_user_has_perm(_tenant_id uuid,_client_id uuid,_perm text) returns boolean
      language plpgsql stable security definer set search_path='public' as $$begin return true;end$$;`,
      'authorization_helper_changed'],
  ])('fails closed on %s drift and leaves both readers untouched',async (_label,mutation,message) => {
    await db.exec(mutation);
    const before = await hashes();
    await expect(db.exec(forward)).rejects.toThrow(message);
    expect(await hashes()).toEqual(before);
  });
});
