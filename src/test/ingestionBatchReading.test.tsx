import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Ingestion from '@/pages/Ingestion';
import type { ValidatedDocument } from '@/lib/ingestionValidator';

const state = vi.hoisted(() => ({
  onFiles: null as null | ((files: FileList) => Promise<void>),
  docs: [] as ValidatedDocument[], toast: vi.fn(),
}));
vi.mock('@/hooks/useFiscalDocuments', () => ({ useFiscalDocuments: () => ({ data: [] }), useCreateFiscalDocument: () => ({}) }));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: [] }) }));
vi.mock('@/hooks/useOrders', () => ({ useCreateOrder: () => ({}) }));
vi.mock('@/hooks/useLoads', () => ({ useCreateLoad: () => ({}), useLoads: () => ({ data: [] }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [] }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: [] }) }));
vi.mock('@/hooks/useOperationalRoutes', () => ({ useOperationalRoutes: () => ({ data: [] }), useUpdateOperationalRoute: () => ({}) }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/hooks/useItemPreparationWrites', () => ({ useItemPreparationWrites: () => ({}) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/hooks/useFreightCalculator', () => ({ calculateFreight: vi.fn(), logFreightCalculation: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/loads/PendingDocsGrouping', () => ({ default: () => null }));
vi.mock('@/components/pickup/PickupOrderPicker', () => ({ default: () => null }));
vi.mock('@/components/ingestion/ORTReviewStep', () => ({ default: () => null }));
vi.mock('@/components/ingestion/RoutingStep', () => ({ default: () => null }));
vi.mock('@/components/ingestion/GroupingStep', () => ({ default: () => null }));
vi.mock('@/components/ingestion/ResultsStep', () => ({ default: () => null }));
vi.mock('@/components/ingestion/UploadStep', () => ({
  default: (props: { onFiles: typeof state.onFiles; readProgress: { completed: number; total: number } | null }) => {
    state.onFiles = props.onFiles;
    return <div role="status">{props.readProgress ? `${props.readProgress.completed}/${props.readProgress.total}` : 'ready'}</div>;
  },
}));
vi.mock('@/components/ingestion/ValidationStep', () => ({
  default: ({ docs }: { docs: ValidatedDocument[] }) => {
    state.docs = docs;
    return <div>Revisão: {docs.length}</div>;
  },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('batch reading orchestration', () => {
  it('reads all 337 XMLs with progress, ignores a concurrent selection, and reports a broken file without losing the batch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><Ingestion /></MemoryRouter></QueryClientProvider>);
    const files = Array.from({ length: 337 }, (_, index) => ({
      name: `${index + 1}.xml`, size: 500,
      text: vi.fn(async () => {
        if (index === 180) throw new Error('Falha de leitura');
        return `<NFe><infNFe><ide><nNF>${index + 1}</nNF></ide></infNFe></NFe>`;
      }),
    }));
    const repeated = { name: 'repeated.xml', size: 1, text: vi.fn() };
    let task: Promise<void>;
    act(() => { task = state.onFiles!(files as unknown as FileList); });
    expect(screen.getByRole('status')).toHaveTextContent('0/337');
    await act(async () => { await state.onFiles!([repeated] as unknown as FileList); });
    expect(repeated.text).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^[1-9]\d*\/337$/));
    await act(async () => { await task!; });
    expect(screen.getByText('Revisão: 337')).toBeInTheDocument();
    expect(files.every(file => file.text.mock.calls.length === 1)).toBe(true);
    expect(state.docs[0].source.invoiceNumber).toBe('1');
    expect(state.docs[336].source.invoiceNumber).toBe('337');
    expect(state.docs[180].validations[0].message).toContain('Falha de leitura');
    client.clear();
  });
});
