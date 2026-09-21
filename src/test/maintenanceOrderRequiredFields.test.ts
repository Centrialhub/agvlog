// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maintenanceOrderRequiredFieldsError } from '@/lib/maintenanceOrderValidation';

const migration = readFileSync(
  'supabase/migrations/20260921134743_reject_empty_maintenance_orders.sql',
  'utf8',
);

describe('maintenance order required fields', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create table public.maintenance_orders(
        id uuid primary key default gen_random_uuid(),
        vehicle_id uuid,
        asset_id uuid,
        reported_problem text
      );
    `);
    await db.exec(migration);
  });

  afterAll(async () => { await db.close(); });

  it('stops an empty form before the mutation', () => {
    expect(maintenanceOrderRequiredFieldsError('', '')).toBe('Selecione o veículo da ordem de manutenção.');
    expect(maintenanceOrderRequiredFieldsError(crypto.randomUUID(), '   ')).toBe('Informe o problema relatado.');
    expect(maintenanceOrderRequiredFieldsError(crypto.randomUUID(), 'Ruído no eixo')).toBeNull();
  });

  it('rejects empty orders in the database and accepts a described subject', async () => {
    await expect(db.query('insert into maintenance_orders default values')).rejects.toThrow();
    await expect(db.query(
      'insert into maintenance_orders(vehicle_id,reported_problem) values($1,$2)',
      [crypto.randomUUID(), '   '],
    )).rejects.toThrow();
    await db.query(
      'insert into maintenance_orders(vehicle_id,reported_problem) values($1,$2)',
      [crypto.randomUUID(), 'Ruído no eixo'],
    );
    expect((await db.query<{ count: number }>('select count(*)::integer count from maintenance_orders')).rows[0].count).toBe(1);
  });
});
