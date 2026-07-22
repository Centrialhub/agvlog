import { describe, it, expect } from 'vitest';
import { loadKanbanColumn } from '@/lib/status/loadStatus';

describe('loadKanbanColumn', () => {
  it('hold overrides any status', () => {
    expect(loadKanbanColumn({ status: 'in_transit', on_hold: true })).toBe('hold');
    expect(loadKanbanColumn({ status: 'delivered', on_hold: true })).toBe('hold');
    expect(loadKanbanColumn({ status: 'planned', on_hold: true })).toBe('hold');
  });

  it('maps status buckets correctly', () => {
    expect(loadKanbanColumn({ status: 'planned' })).toBe('backlog');
    expect(loadKanbanColumn({ status: 'assembling' })).toBe('prep');
    expect(loadKanbanColumn({ status: 'loading' })).toBe('prep');
    expect(loadKanbanColumn({ status: 'ready' })).toBe('ready');
    expect(loadKanbanColumn({ status: 'loaded' })).toBe('ready');
    expect(loadKanbanColumn({ status: 'in_transit' })).toBe('in_route');
    expect(loadKanbanColumn({ status: 'delivered' })).toBe('done');
    expect(loadKanbanColumn({ status: 'cancelled' })).toBe('done');
    expect(loadKanbanColumn({ status: 'refused' })).toBe('done');
    expect(loadKanbanColumn({ status: 'divergent' })).toBe('done');
  });

  it('unknown or null status falls back to backlog', () => {
    expect(loadKanbanColumn({ status: null })).toBe('backlog');
    expect(loadKanbanColumn({ status: 'weird' })).toBe('backlog');
  });
});