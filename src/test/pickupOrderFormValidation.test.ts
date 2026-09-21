import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/pickup/NewPickupOrderDialog.tsx', 'utf8');

describe('pickup order form validation', () => {
  it('blocks incomplete forms and validates the pickup timestamp before conversion', () => {
    expect(source).toContain('const pickupFormInvalid = (');
    expect(source).toContain('driverId === NONE');
    expect(source).toContain('vehicleId === NONE');
    expect(source).toContain('!recipientName.trim()');
    expect(source).toContain('!Number.isFinite(pickupTimestamp)');
    expect(source).toContain('disabled={pickupFormInvalid || createMut.isPending || updateMut.isPending}');
    expect(source).toContain('pickup_at: new Date(pickupTimestamp).toISOString()');
  });
});
