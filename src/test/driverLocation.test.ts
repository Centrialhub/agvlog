import { describe, expect, it, vi } from 'vitest';

import { getCurrentDriverLocation } from '@/lib/driverLocation';

describe('driver arrival location', () => {
  it('requests a fresh high-accuracy position', async () => {
    const getCurrentPosition = vi.fn((
      success: PositionCallback,
      _failure?: PositionErrorCallback | null,
      _options?: PositionOptions,
    ) => success({
        coords: {
          latitude: -15.802,
          longitude: -43.313,
          accuracy: 12,
        },
      } as GeolocationPosition));

    await expect(getCurrentDriverLocation({ getCurrentPosition })).resolves.toEqual({
      latitude: -15.802,
      longitude: -43.313,
      accuracyM: 12,
    });
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });
  });

  it('fails closed when location permission is denied', async () => {
    const getCurrentPosition = vi.fn((_: PositionCallback, failure?: PositionErrorCallback | null) => {
      if (!failure) throw new Error('failure callback is required');
      failure({ code: 1 } as GeolocationPositionError);
    });

    await expect(getCurrentDriverLocation({ getCurrentPosition })).rejects.toThrow(
      'Permita o acesso à localização',
    );
  });

  it('fails closed when the device has no geolocation provider', async () => {
    await expect(getCurrentDriverLocation(undefined)).rejects.toThrow(
      'não oferece localização',
    );
  });
});
