import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260830024309_enforce_driver_journey_state_machine.sql',
), 'utf8');

describe('driver journey backend contract', () => {
  it('serializes journey changes by actor and revalidates the assigned trip', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('for share of t');
    expect(migration).toContain("'in_transit', 'in_progress'");
  });

  it('enforces the complete transition graph and terminal state', () => {
    expect(migration).toContain("v_previous_event is null or v_previous_event = 'end_shift'");
    expect(migration).toContain("v_previous_event in ('start_shift', 'resume')");
    expect(migration).toContain("v_previous_event in ('lunch', 'rest', 'overnight')");
    expect(migration).toContain('Sequência de jornada inválida');
  });

  it('enforces checklist gates and an allowlist at the database boundary', () => {
    expect(migration).toContain("when 'start_shift' then 8 else 5");
    expect(migration).toContain('Checklist pré-viagem');
    expect(migration).toContain('Checklist pós-viagem');
    expect(migration).toContain("_event_type <> 'operational_note'");
    expect(migration).toContain("_event_type !~ '^info_[a-z0-9_]{1,64}$'");
  });

  it('fails closed for SQL NULL and records statement-independent event times', () => {
    expect(migration).toContain('if not coalesce((');
    expect(migration).toContain('), false) then');
    expect(migration).toContain('clock_timestamp()');
    expect(migration).toContain('Viagem cancelada ou indisponível');
    expect(migration).toContain("item.value::text ~ '^[0-7]$'");
  });
});
