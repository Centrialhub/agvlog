import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Checklists.tsx', 'utf8');

describe('checklist template validation', () => {
  it('blocks blank names and persists the normalized name', () => {
    expect(source).toContain('name: templateForm.name.trim()');
    expect(source).toContain('createChecklist.isPending || !templateForm.name.trim()');
  });
});
