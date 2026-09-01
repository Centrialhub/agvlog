export const NAVIGATION_APPS = ['system', 'google', 'waze'] as const;

export type NavigationApp = (typeof NAVIGATION_APPS)[number];

export interface NavigationDestination {
  label: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export const NAVIGATION_APP_LABELS: Record<NavigationApp, string> = {
  system: 'Aplicativo padrão',
  google: 'Google Maps',
  waze: 'Waze',
};

const PREFERENCE_KEY = 'agvlog:driver-navigation-app:v1';

export function readNavigationPreference(storage: Pick<Storage, 'getItem'> = localStorage): NavigationApp | null {
  try {
    const value = storage.getItem(PREFERENCE_KEY);
    return NAVIGATION_APPS.includes(value as NavigationApp) ? value as NavigationApp : null;
  } catch {
    return null;
  }
}

export function saveNavigationPreference(
  app: NavigationApp,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(PREFERENCE_KEY, app);
  } catch {
    // Navigation still works for this tap when private storage is unavailable.
  }
}

function destinationValue(destination: NavigationDestination): string {
  if (hasValidCoordinates(destination)) {
    return `${destination.latitude},${destination.longitude}`;
  }
  return destination.address?.trim() || destination.label.trim();
}

function hasValidCoordinates(destination: NavigationDestination): boolean {
  return typeof destination.latitude === 'number'
    && Number.isFinite(destination.latitude)
    && destination.latitude >= -90
    && destination.latitude <= 90
    && typeof destination.longitude === 'number'
    && Number.isFinite(destination.longitude)
    && destination.longitude >= -180
    && destination.longitude <= 180;
}

export function buildNavigationUrl(
  app: NavigationApp,
  destination: NavigationDestination,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): string {
  const value = destinationValue(destination);

  if (app === 'google') {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(value)}`;
  }

  if (app === 'waze') {
    const coordinates = hasValidCoordinates(destination);
    const parameter = coordinates ? `ll=${encodeURIComponent(value)}` : `q=${encodeURIComponent(value)}`;
    return `https://waze.com/ul?${parameter}&navigate=yes`;
  }

  if (/iPad|iPhone|iPod/i.test(userAgent)) {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(value)}&dirflg=d`;
  }

  const query = hasValidCoordinates(destination)
    ? `${value}(${destination.label})`
    : value;
  return `geo:0,0?q=${encodeURIComponent(query)}`;
}

export function openNavigation(app: NavigationApp, destination: NavigationDestination): void {
  window.location.assign(buildNavigationUrl(app, destination));
}
