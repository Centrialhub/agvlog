import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

describe('SSX credential recovery contract', () => {
  const upsert = source('supabase', 'functions', 'agvlog-integration-upsert', 'index.ts');
  const login = source('supabase', 'functions', 'ssx-login', 'index.ts');
  const pipeline = source('supabase', 'functions', 'agvlog-pipeline-run', 'index.ts');
  const settings = source('src', 'pages', 'Settings.tsx');

  it('resets stale authentication state when an administrator replaces credentials', () => {
    expect(upsert).toContain('token_cache: null');
    expect(upsert).toContain('token_expires_at: null');
    expect(upsert).toContain('last_error: null');
    expect(upsert).toContain('"credential_reentry_required"');
    expect(upsert).toContain('delete settings[key]');
    expect(upsert).toContain('hashauth: hashauth || currentHashauth');
    expect(upsert).toContain('hashcode: hashcode || currentHashcode');
  });

  it('distinguishes credential re-entry from provider rate limiting', () => {
    expect(login).toContain('settings.credential_reentry_required === true');
    expect(login).toContain('SSX_CREDENTIAL_REENTRY_REQUIRED');
    expect(login).toContain('credential_reentry_required: true');
  });

  it('keeps cron healthy while surfacing an actionable account condition', () => {
    expect(pipeline).toContain('requiresCredentialReentry');
    expect(pipeline).toContain("status: 'attention_required'");
    expect(pipeline).toContain('last_run_attention');
  });

  it('offers in-place credential replacement without exposing stored secrets', () => {
    expect(settings).toContain('Atualizar credencial');
    expect(settings).toContain('id: account?.id');
    expect(settings).toContain('Deixe em branco para manter o atual');
    expect(settings).not.toContain('password_encrypted');
    expect(settings).not.toContain('token_cache');
  });
});

describe('Fiscal polling contract', () => {
  const ctePoll = source('supabase', 'functions', 'cte-status-poll', 'index.ts');
  const nfsePoll = source('supabase', 'functions', 'nfse-status-poll', 'index.ts');

  it.each([
    ['CT-e', ctePoll],
    ['NFS-e', nfsePoll],
  ])('polls only transient %s states', (_label, poller) => {
    const pending = poller.match(/const PENDING\s*=\s*\[([\s\S]*?)\];/)?.[1] || '';
    for (const status of [
      'draft', 'processing', 'provider_unknown', 'cancel_processing',
      'queued', 'submitted', 'pending', 'transmitting', 'cancelling',
    ]) expect(pending).toContain(`'${status}'`);
    for (const terminal of ['authorized', 'issued', 'rejected', 'denied', 'cancelled', 'error'])
      expect(pending).not.toContain(`'${terminal}'`);
  });
});
