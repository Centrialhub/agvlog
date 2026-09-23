import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const picker = readFileSync('src/components/maps/AddressResolutionPicker.tsx', 'utf8');

describe('address resolution original coordinates', () => {
  it('keeps the first assisted point across repeated manual adjustments', () => {
    expect(picker).toContain('previous_lat: current.previous_lat ?? current.latitude');
    expect(picker).toContain('previous_lng: current.previous_lng ?? current.longitude');
    expect(picker).not.toContain('previous_lat: current.latitude,\n    previous_lng: current.longitude');
  });
});
