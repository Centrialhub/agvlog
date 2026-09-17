import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeNFSeSyncResponse } from '@/hooks/useNFSe';

const pollSource = readFileSync('supabase/functions/nfse-status-poll/index.ts', 'utf8');

describe('reported NFS-e poll regressions', () => {
  it('does not call transport failures a successful status update', () => {
    const summary = summarizeNFSeSyncResponse({
      checked: 1, remaining: 49, partial: true, stopped_reason: 'rate_limited',
      results: [{ outcome: 'rate_limited' }],
    });
    expect(summary).toMatchObject({ tone: 'warning', title: 'Consulta parcial de NFS-e' });
    expect(summary.description).toContain('Restantes: 49');
  });

  it('reports a truncated queue instead of presenting the checked page as complete', () => {
    expect(summarizeNFSeSyncResponse({
      checked: 50, total_pending: 80, remaining: 30, truncated: true, partial: true,
      results: Array.from({ length: 50 }, () => ({ outcome: 'pending' })),
    })).toMatchObject({ tone: 'warning' });
  });

  it('counts only real fiscal terminal outcomes as resolved', () => {
    expect(summarizeNFSeSyncResponse({
      checked: 4, remaining: 0, partial: false,
      results: [{ outcome: 'issued' }, { outcome: 'provider_unavailable' }, { outcome: 'disabled' }, { outcome: 'pending' }],
    })).toMatchObject({ tone: 'success', title: '1 NFS-e com status fiscal atualizado' });
  });

  it('never puts drafts in the fiscal polling queue', () => {
    const pendingStatuses = pollSource.match(/const PENDING = \[[\s\S]*?\];/)?.[0] ?? '';
    expect(pendingStatuses).not.toContain("'draft'");
  });

  it('returns the real queue size and remaining work when the page is limited', () => {
    expect(pollSource).toContain("{ count: 'exact' }");
    expect(pollSource).toContain('total_pending');
    expect(pollSource).toContain('remaining');
    expect(pollSource).toContain('truncated');
  });
});
