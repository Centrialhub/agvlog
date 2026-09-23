import { isTerminalLoadStatus } from '@/lib/status/loadStatus';

export function isOperationallyActiveLoad(status: string | null | undefined): boolean {
  return status !== 'divergent' && !isTerminalLoadStatus(status);
}

export function vehicleOccupancyPercentage(loadedPallets: number, maxPallets: number): number {
  if (!Number.isFinite(loadedPallets) || !Number.isFinite(maxPallets) || maxPallets <= 0) return 0;
  return Math.max(0, Math.round((loadedPallets / maxPallets) * 100));
}
