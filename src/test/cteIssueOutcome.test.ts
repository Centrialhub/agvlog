import { describe, expect, it } from 'vitest';
import { DefinitiveCteIssueError, isDefinitiveCteIssueError } from '@/lib/fiscal/cteIssueOutcome';

describe('CT-e batch issue outcome', () => {
  it('continues after a definitive provider rejection', () => {
    expect(isDefinitiveCteIssueError(new DefinitiveCteIssueError('Rejeição SEFAZ'))).toBe(true);
  });

  it('stops after an uncertain transport error', () => {
    expect(isDefinitiveCteIssueError(new Error('Tempo esgotado ao transmitir'))).toBe(false);
  });
});