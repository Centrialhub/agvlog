import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const picker = readFileSync('src/components/maps/AddressResolutionPicker.tsx', 'utf8');

describe('address resolution candidate keys', () => {
  it('distinguishes different results that share coordinates', () => {
    expect(picker).toContain('candidates.map((candidate, index)');
    expect(picker).toContain('key={`${candidate.provider}:${candidate.latitude}:${candidate.longitude}:${candidate.label}:${index}`}');
    expect(picker).not.toContain('key={`${candidate.latitude}:${candidate.longitude}`}');
  });
});
