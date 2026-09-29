type Json = Record<string, unknown>;
export function waitSsxTurn(delayMs: 250 | 1000): Promise<void> {
  if (delayMs !== 250 && delayMs !== 1000) throw new RangeError("An explicit SSX pacing delay is required.");
  return new Promise<void>(resolve => setTimeout(resolve, delayMs));
}
type RpcClient = { rpc(name: string, args: Json): PromiseLike<{ data: unknown; error: unknown }> };
export type Checkpoint = {
  decision: 'claimed' | 'cached' | 'deferred'; lease_token?: string;
  result?: Json; error_code?: string; retry_after_seconds?: number;
};
export class SsxSyncError extends Error {
  constructor(public code: string, public retrySeconds = 0) { super(code); }
}
export async function claimSync(client: RpcClient, account: string, resource: string, scope = '', maxAge = 21600) {
  const { data, error } = await client.rpc('claim_ssx_sync_checkpoint_v1', {
    _account_id: account, _resource: resource, _scope_key: scope, _max_age_seconds: maxAge,
  });
  const value = data as Checkpoint | null;
  if (error || !value || !['claimed','cached','deferred'].includes(value.decision)
    || (value.decision === 'claimed' && !value.lease_token)) throw new SsxSyncError('checkpoint_unavailable');
  return value;
}
export async function finishSync(client: RpcClient, account: string, resource: string, scope: string,
  claim: Checkpoint, result: Json = {}, error: SsxSyncError | null = null) {
  const response = await client.rpc('finish_ssx_sync_checkpoint_v1', {
    _account_id: account, _resource: resource, _scope_key: scope, _lease_token: claim.lease_token,
    _result: result, _error_code: error?.code ?? null, _retry_seconds: error?.retrySeconds ?? 0,
  });
  if (response.error || response.data !== true) throw new SsxSyncError('checkpoint_not_confirmed');
}
export async function checkpointedSync(client: RpcClient, account: string, resource: string, scope: string,
  execute: () => Promise<Json>, maxAge = 21600): Promise<Json> {
  const claim = await claimSync(client, account, resource, scope, maxAge);
  if (claim.decision === 'cached') return claim.result || {};
  if (claim.decision === 'deferred') throw new SsxSyncError(claim.error_code || 'retry_deferred', claim.retry_after_seconds);
  let result: Json;
  try { result = await execute(); }
  catch (error) {
    const failure = error instanceof SsxSyncError ? error : new SsxSyncError('request_failed');
    await finishSync(client, account, resource, scope, claim, {}, failure);
    throw failure;
  }
  await finishSync(client, account, resource, scope, claim, result);
  return result;
}
