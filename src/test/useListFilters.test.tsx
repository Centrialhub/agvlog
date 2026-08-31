import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useListFilters } from '@/hooks/useListFilters';

function Harness() {
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', status: 'all' });
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="filters">{JSON.stringify({ ...filters, activeCount })}</output><output data-testid="url">{location.search}</output>
    <button onClick={() => setFilter('search', 'João')}>Buscar</button><button onClick={() => setFilter('status', 'active')}>Ativos</button><button onClick={resetFilters}>Limpar</button>
    <button onClick={() => navigate('/details')}>Detalhes</button><button onClick={() => navigate(-1)}>Voltar</button></>;
}
afterEach(cleanup);
describe('URL list filters', () => {
  it('restores deep links and changes or resets only its own parameters', () => {
    render(<MemoryRouter initialEntries={['/list?tab=movements&trip=42&f_search=Maria&f_status=active']}><Harness /></MemoryRouter>);
    expect(screen.getByTestId('filters')).toHaveTextContent('"search":"Maria"');
    fireEvent.click(screen.getByText('Buscar'));
    expect(screen.getByTestId('url')).toHaveTextContent('tab=movements&trip=42');
    expect(screen.getByTestId('filters')).toHaveTextContent('"status":"active"');
    fireEvent.click(screen.getByText('Limpar'));
    expect(screen.getByTestId('url')).toHaveTextContent('?tab=movements&trip=42');
    expect(screen.getByTestId('filters')).toHaveTextContent('"activeCount":0');
  });
  it('keeps the filtered list when returning from a detail page', () => {
    render(<MemoryRouter initialEntries={['/list']}><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByText('Buscar'));
    fireEvent.click(screen.getByText('Ativos'));
    fireEvent.click(screen.getByText('Detalhes'));
    fireEvent.click(screen.getByText('Voltar'));
    expect(screen.getByTestId('filters')).toHaveTextContent('"search":"João","status":"active","activeCount":2');
  });
});
