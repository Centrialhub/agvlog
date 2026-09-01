import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TripOperationalEventsPanel from '@/components/control-tower/TripOperationalEventsPanel';

const state = vi.hoisted(() => ({ query: {} as Record<string, unknown>, refetch: vi.fn() }));
vi.mock('@/hooks/useTripOperationalEvents', () => ({ useTripOperationalEvents: () => state.query }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function open() {
  render(<MemoryRouter><TripOperationalEventsPanel tripId="trip-1" /></MemoryRouter>);
}

const baseEvent = {
  id: 'event-1', tenant_id: 'tenant-1', dispatch_trip_id: 'trip-1', load_id: null,
  event_type: 'other', severity: 'medium', description: 'Cliente pediu nova previsão.',
  resolved_at: null, created_at: '2026-08-31T20:00:00Z', visible_to_client: false,
  client_action_required: false, public_status: 'reported_by_driver',
};

describe('TripOperationalEventsPanel', () => {
  it('shows retryable failure without calling it an empty trip', () => {
    state.query = { isError: true, isPending: false, data: undefined, refetch: state.refetch };
    open();
    expect(screen.getByRole('alert')).toHaveTextContent('Nenhum estado vazio foi presumido');
    expect(screen.queryByText('Nenhuma ocorrência registrada para esta viagem.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it('shows an explicit empty state after a successful read', () => {
    state.query = { isError: false, isPending: false, data: [], refetch: state.refetch };
    open();
    expect(screen.getByText('Nenhuma ocorrência registrada para esta viagem.')).toBeInTheDocument();
  });

  it('translates driver events and makes portal visibility explicit to the operator', () => {
    state.query = {
      isError: false, isPending: false, refetch: state.refetch,
      data: [
        baseEvent,
        { ...baseEvent, id: 'event-2', event_type: 'damaged', severity: 'critical',
          description: 'Avaria confirmada.', visible_to_client: true, client_action_required: true },
      ],
    };
    open();
    expect(screen.getByText('Outro')).toBeInTheDocument();
    expect(screen.getByText('Cliente pediu nova previsão.')).toBeInTheDocument();
    expect(screen.getByText('Somente operação')).toBeInTheDocument();
    expect(screen.getByText('Avaria')).toBeInTheDocument();
    expect(screen.getByText('Portal · ação necessária')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir eventos operacionais' })).toHaveAttribute('href', '/events');
  });
});
