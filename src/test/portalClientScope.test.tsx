import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  PortalClientScopeProvider,
  usePortalClientScope,
} from '@/hooks/portal/usePortalClientScope';

const mocks = vi.hoisted(() => ({ clients: [] as Array<Record<string, unknown>> }));

vi.mock('@/hooks/portal/useClientPortalAccess', () => ({
  useClientPortalAccess: () => ({ data: mocks.clients, isLoading: false }),
}));

function ScopeProbe() {
  const scope = usePortalClientScope();
  return (
    <div>
      <span data-testid="selected">{scope.selectedClientId ?? 'all'}</span>
      <span data-testid="active">{scope.activeClients.map((client) => client.client_id).join(',')}</span>
    </div>
  );
}

describe('portal client scope', () => {
  it('automatically scopes single-client accounts so tracking and dashboard queries can run', () => {
    mocks.clients = [{
      client_id: 'client-a',
      access_type: 'viewer',
      can_view_financial: false,
      can_download_documents: false,
      can_open_occurrences: false,
      can_request_pickup: false,
      can_view_vehicle_live: true,
      can_view_driver_contact: false,
    }];

    render(<PortalClientScopeProvider><ScopeProbe /></PortalClientScopeProvider>);

    expect(screen.getByTestId('selected')).toHaveTextContent('client-a');
    expect(screen.getByTestId('active')).toHaveTextContent('client-a');
  });
});
