import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePositionTelemetry } from '@/lib/positionTelemetry';

describe('timestamp inválido no detalhe do veículo', () => {
  it('classifica infinito como ausência de observação válida', () => {
    expect(resolvePositionTelemetry({ captured_at: 'infinity', speed: 20 })).toMatchObject({
      capturedAt: null,
      hasObservation: false,
      movementState: 'unknown',
    });
  });

  it('formata datas somente a partir do timestamp validado', () => {
    const page = readFileSync(join(process.cwd(), 'src/pages/VehicleDetails.tsx'), 'utf8');
    expect(page).toContain('currentTelemetry.capturedAt ?');
    expect(page).toContain('Data de captura indisponível');
    expect(page).not.toContain('format(new Date(positionLast.captured_at)');
    expect(page).not.toContain('formatDistanceToNow(new Date(positionLast.captured_at)');
  });

  it('impede novos timestamps infinitos na posição mais recente', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260921135500_reject_invalid_latest_position_timestamps.sql'),
      'utf8',
    );
    expect(migration).toContain('check (isfinite(captured_at))');
    expect(migration).toContain('not valid');
  });
});
