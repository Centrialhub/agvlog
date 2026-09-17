import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CostCenterManager } from '@/components/cost-centers/CostCenterManager';

const state = vi.hoisted(() => ({
  fullData: [{
    id: 'cost-center', tenant_id: 'tenant', name: 'Operacional', active: true,
    created_at: '2026-09-13T00:00:00Z', updated_at: '2026-09-13T00:00:00Z',
  }],
  isFullLoading: false,
  isFullError: false,
  refetchFull: vi.fn(),
  addCostCenter: vi.fn(),
  toggleCostCenter: vi.fn(),
  deleteCostCenter: vi.fn(),
  isAdding: false,
  togglingId: null as string | null,
  deletingId: null as string | null,
}));

vi.mock('@/hooks/useCostCenters', () => ({
  useCostCenters: () => state,
}));

afterEach(() => {
  cleanup();
  state.isFullLoading = false;
  state.isFullError = false;
  state.isAdding = false;
  state.togglingId = null;
  state.deletingId = null;
  vi.clearAllMocks();
});

it('adds a trimmed cost center and clears the field after success', async () => {
  state.addCostCenter.mockResolvedValue(undefined);
  render(<CostCenterManager />);

  fireEvent.click(screen.getByRole('button', { name: 'Novo centro de custo' }));
  const input = screen.getByRole('textbox', { name: 'Nome do centro de custo' });
  fireEvent.change(input, { target: { value: '  Pedágios  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar centro de custo' }));

  await waitFor(() => expect(state.addCostCenter).toHaveBeenCalledWith('Pedágios'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('keeps add accessible and explains when the name is missing', () => {
  render(<CostCenterManager />);

  const openButton = screen.getByRole('button', { name: 'Novo centro de custo' });
  expect(openButton).toBeEnabled();
  fireEvent.click(openButton);

  const input = screen.getByRole('textbox', { name: 'Nome do centro de custo' });
  const addButton = screen.getByRole('button', { name: 'Salvar centro de custo' });

  expect(addButton).toBeEnabled();
  fireEvent.click(addButton);

  expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome do centro de custo.');
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(state.addCostCenter).not.toHaveBeenCalled();
});

it('offers distinct deactivate and permanent-delete actions', async () => {
  state.toggleCostCenter.mockResolvedValue(undefined);
  state.deleteCostCenter.mockResolvedValue(undefined);
  render(<CostCenterManager />);

  fireEvent.click(screen.getByRole('button', { name: 'Desativar Operacional' }));
  await waitFor(() => expect(state.toggleCostCenter).toHaveBeenCalledWith({ id: 'cost-center', active: false }));

  fireEvent.click(screen.getByRole('button', { name: 'Excluir Operacional' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Excluir centro de custo?');
  fireEvent.click(screen.getByRole('button', { name: 'Excluir definitivamente' }));

  await waitFor(() => expect(state.deleteCostCenter).toHaveBeenCalledWith('cost-center'));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});

it('shows a retry instead of an empty list when loading fails', () => {
  state.isFullError = true;
  render(<CostCenterManager />);

  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar');
  expect(screen.queryByText('Nenhum centro de custo cadastrado.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Novo centro de custo' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(state.refetchFull).toHaveBeenCalledOnce();
});
