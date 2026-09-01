import { describe, expect, it } from 'vitest';
import {
  buildNavigationUrl,
  readNavigationPreference,
  saveNavigationPreference,
} from '@/lib/driver/navigation';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('driver navigation preference', () => {
  it('uses precise coordinates in Google Maps and Waze links', () => {
    const destination = { label: 'Cliente QA', address: 'Rua ignorada', latitude: -23.55, longitude: -46.63 };
    expect(buildNavigationUrl('google', destination)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-23.55%2C-46.63',
    );
    expect(buildNavigationUrl('waze', destination)).toBe(
      'https://waze.com/ul?ll=-23.55%2C-46.63&navigate=yes',
    );
  });

  it('falls back to the address and lets the operating system choose the app', () => {
    expect(buildNavigationUrl('system', { label: 'Cliente', address: 'Av. Paulista, 1000' }, 'Android')).toBe(
      'geo:0,0?q=Av.%20Paulista%2C%201000',
    );
    expect(buildNavigationUrl('system', { label: 'Cliente', address: 'Av. Paulista, 1000' }, 'iPhone')).toBe(
      'https://maps.apple.com/?daddr=Av.%20Paulista%2C%201000&dirflg=d',
    );
  });

  it('rejects invalid coordinates and falls back to the address', () => {
    expect(buildNavigationUrl('google', {
      label: 'Cliente',
      address: 'Rua segura, 10',
      latitude: Number.NaN,
      longitude: 200,
    })).toBe('https://www.google.com/maps/dir/?api=1&destination=Rua%20segura%2C%2010');
  });

  it('persists only supported navigation apps', () => {
    const storage = memoryStorage();
    saveNavigationPreference('waze', storage);
    expect(readNavigationPreference(storage)).toBe('waze');
    storage.setItem('agvlog:driver-navigation-app:v1', 'unsupported');
    expect(readNavigationPreference(storage)).toBeNull();
  });
});
