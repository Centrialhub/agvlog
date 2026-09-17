import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CteHub from '@/pages/CteHubPage';

vi.mock('@/pages/BillingPage', () => ({ default: () => <div>Billing content</div> }));
vi.mock('@/pages/CteMonitor', () => ({ default: () => <div>Monitor content</div> }));
vi.mock('@/pages/CteSearch', () => ({ default: () => <div>Search content</div> }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe('CT-e hub URL navigation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('canonicalizes an unknown tab instead of rendering an empty page', async () => {
    render(<MemoryRouter initialEntries={['/cte?tab=unknown']}><CteHub /><LocationProbe /></MemoryRouter>);
    expect(screen.getByText('Billing content')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cte?tab=faturamento'));
  });

  it('writes tab changes to the URL', async () => {
    render(<MemoryRouter initialEntries={['/cte?tab=faturamento']}><CteHub /><LocationProbe /></MemoryRouter>);
    const tab = screen.getByRole('tab', { name: /Consulta/ });
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.click(tab);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cte?tab=consulta'));
    expect(screen.getByText('Search content')).toBeInTheDocument();
  });
});
