import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('defesas geográficas do mapa inicial do motorista', () => {
  it('descarta telemetria inválida no hook antes de entregá-la à tela', () => {
    const source = readSource('src/hooks/useDriverHomeVehiclePosition.ts');
    expect(source).toContain('hasValidGeographicCoordinates(lat, lng)');
  });

  it('filtra paradas e veículo tanto na página quanto na fronteira do mapa', () => {
    const page = readSource('src/pages/driver/DriverHome.tsx');
    const map = readSource('src/components/driver/DriverDeliveryMap.tsx');

    expect(page).toContain('hasValidGeographicCoordinates(Number(stop.latitude), Number(stop.longitude))');
    expect(page).toContain('hasValidGeographicCoordinates(Number(vehiclePos.lat), Number(vehiclePos.lng))');
    expect(map).toContain('stops.filter((stop) => hasValidGeographicCoordinates(stop.lat, stop.lng))');
    expect(map).toContain('vehicle && hasValidGeographicCoordinates(vehicle.lat, vehicle.lng)');
  });
});
