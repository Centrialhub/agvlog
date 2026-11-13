import type { TripCargoSnapshot, DriverTripCargoAction } from './tripCargoCustody';

export async function completeQuickCargoConference(io: {
  read: () => Promise<TripCargoSnapshot>;
  command: (action: DriverTripCargoAction, payload?: Record<string, unknown>) => Promise<unknown>;
  start: () => Promise<void>;
  assertActive: () => void;
}) {
  let snapshot = await io.read(); io.assertActive();
  if (!snapshot.available || snapshot.control.status === 'pending_acceptance') {
    const vehicle = snapshot.available ? snapshot.control.vehicle_id : snapshot.vehicle_id;
    if (!vehicle) throw new Error('A operação precisa vincular o veículo à viagem.');
    await io.command('accept', { vehicle_id: vehicle }); io.assertActive();
    snapshot = await io.read(); io.assertActive();
  }
  if (!snapshot.available) throw new Error('Não foi possível preparar a conferência. Tente novamente.');
  const status = snapshot.control.status;
  if (status === 'accepted' || status === 'loading') {
    await io.command('quick_confirm', {
      expected_updated_at: snapshot.control.updated_at,
      confirm_all_documents: true,
    }); io.assertActive();
  } else if (status !== 'ready_to_depart' && status !== 'departed') {
    throw new Error('Esta viagem já foi encerrada ou devolvida.');
  }
  if (status !== 'departed') { await io.command('mark_departed'); io.assertActive(); }
  await io.start(); io.assertActive();
}
