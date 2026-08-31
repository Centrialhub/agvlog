import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarNavigation } from '@/components/layout/SidebarNavigation';
import { findNavigationPage, isNavigationActive, navigationSections, searchNavigation } from '@/components/layout/navigation';
import { TooltipProvider } from '@/components/ui/tooltip';

afterEach(cleanup);
describe('sidebar navigation', () => {
  it('does not confuse neighboring routes and identifies detail pages', () => {
    expect(isNavigationActive('/operations-control', '/operations')).toBe(false);
    expect(findNavigationPage('/vehicles/123')?.item.href).toBe('/vehicles');
    expect(findNavigationPage('/cte-monitor')?.item.href).toBe('/cte-hub');
    const hrefs = navigationSections.flatMap(section => section.items.map(item => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it('finds business terms without accents and reports an empty search', () => {
    expect(searchNavigation('rastreamento').length).toBeGreaterThan(0);
    expect(searchNavigation('zzzz-nonexistent')).toHaveLength(0);
  });
  it('opens the current group, marks its page and preserves capability restrictions', () => {
    const view = render(<MemoryRouter initialEntries={['/vehicles/123']}><TooltipProvider><SidebarNavigation query="" capabilityAvailable={() => false} /></TooltipProvider></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Veículos' })).toHaveAttribute('aria-current', 'page');
    view.rerender(<MemoryRouter initialEntries={['/vehicles/123']}><TooltipProvider><SidebarNavigation query="cte" capabilityAvailable={() => false} /></TooltipProvider></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /CT-e/ })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Integração em implantação').length).toBeGreaterThan(0);
  });
  it('makes grouped links reachable when collapsed', () => {
    render(<MemoryRouter><TooltipProvider><SidebarNavigation collapsed query="" capabilityAvailable={() => true} /></TooltipProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Cadastros e estoque' }));
    expect(screen.getByRole('link', { name: 'Clientes e fornecedores' })).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Clientes e fornecedores' }));
    expect(screen.queryByRole('link', { name: 'Clientes e fornecedores' })).not.toBeInTheDocument();
  });
});
