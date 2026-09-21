import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');

describe('operational-event form validation', () => {
  it('blocks descriptions shorter than the command contract and negative financial impact', () => {
    expect(source).toContain('form.description.trim().length < 5');
    expect(source).toContain('form.financial_impact < 0');
    expect(source).toContain('description,');
    expect(source).toContain('type="number" min="0"');
  });
});
