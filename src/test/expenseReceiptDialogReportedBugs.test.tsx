import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpenseReceiptDialog } from '@/components/financial/ExpenseReceiptDialog';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ signed: vi.fn(), clicks: 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: mocks.signed }) } },
}));

beforeEach(() => {
  mocks.clicks = 0;
  mocks.signed.mockReset();
  mocks.signed.mockImplementation(async () => ({ data: { signedUrl: `https://example.invalid/receipt-${mocks.signed.mock.calls.length}` }, error: null }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { mocks.clicks += 1; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('oferece fallback para HEIC sem renderizar uma imagem quebrada', async () => {
  render(<ExpenseReceiptDialog tenantId="tenant" path="tenant/expense.heic" onClose={() => {}} />);
  expect(await screen.findByText(/Pré-visualização de HEIC\/HEIF não disponível/)).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('renova a URL assinada antes de abrir o comprovante', async () => {
  render(<ExpenseReceiptDialog tenantId="tenant" path="tenant/expense.jpg" onClose={() => {}} />);
  await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button', { name: 'Abrir arquivo do comprovante' }));
  await waitFor(() => expect(mocks.signed).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mocks.clicks).toBe(1));
});

it('agenda renovação automática antes dos cinco minutos', () => {
  const source = readFileSync('src/components/financial/ExpenseReceiptDialog.tsx', 'utf8');
  expect(source).toContain('setInterval(()=>void sign(),240000)');
  expect(source).toContain("createSignedUrl(path,300)");
});
