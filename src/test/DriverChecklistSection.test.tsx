import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverChecklistSection } from '@/components/driver/DriverChecklistSection';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const defaults = { title: 'Pré-Viagem', kind: 'pre' as const, items: ['Pneus', 'Óleo'], tripId: 'trip',
  savedItems: [] as number[], savedId: null as string | null, boundaryId: null as string | null, disabled: false };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: 'saved', error: null });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
const render = async (props: Partial<typeof defaults> = {}) => act(async () => root.render(
  <QueryClientProvider client={client}><DriverChecklistSection {...defaults} {...props}/></QueryClientProvider>,
));
const checkbox = (index: number) => container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[index];
const button = (text: string) => [...container.querySelectorAll('button')].find(node => node.textContent === text)!;

describe('checklist draft and revision safety', () => {
  it('preserves unsaved marks when the parent supplies a new array on rerender', async () => {
    await render(); await act(async () => checkbox(0).click());
    await render({savedItems: []});
    expect(checkbox(0)).toHaveAttribute('aria-checked','true');
    expect(container.textContent).toContain('Alterações não salvas');
    const label = container.querySelector<HTMLLabelElement>('label')!;
    expect(label.htmlFor).toBe(checkbox(0).id);
  });
  it('preserves a draft across remote changes and refuses to overwrite it blindly', async () => {
    await render(); await act(async () => checkbox(0).click());
    await render({savedItems:[1],savedId:'remote'});
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(checkbox(0)).toHaveAttribute('aria-checked','true');
    expect(button('Salvar Pré-Viagem')).toBeDisabled();
    await act(async () => button('Carregar versão atual de Pré-Viagem').click());
    expect(checkbox(0)).toHaveAttribute('aria-checked','false');
    expect(checkbox(1)).toHaveAttribute('aria-checked','true');
    expect(button('Salvar Pré-Viagem')).toBeEnabled();
  });
  it('sends the expected saved record and shift boundary and refreshes linked views', async () => {
    const invalidate = vi.spyOn(client,'invalidateQueries');
    await render({savedId:'previous',boundaryId:'shift'});
    await act(async () => checkbox(0).click());
    await act(async () => button('Salvar Pré-Viagem').click());
    expect(mocks.rpc).toHaveBeenCalledWith('driver_save_checklist', {
      _trip_id:'trip',_kind:'pre',_payload:{checked_items:[0],total_items:2,expected_checklist_id:'previous',expected_boundary_id:'shift'},
    });
    expect(invalidate).toHaveBeenCalledWith({queryKey:['checklist_status']});
    expect(invalidate).toHaveBeenCalledWith({queryKey:['driver_journey_events']});
    expect(invalidate).toHaveBeenCalledWith({queryKey:['pod-history']});
    expect(invalidate).toHaveBeenCalledWith({queryKey:['product-history']});
  });
  it('preserves a failed draft and displays the backend error', async () => {
    mocks.rpc.mockResolvedValue({data:null,error:{message:'O turno mudou'}});
    await render(); await act(async () => checkbox(0).click());
    await act(async () => button('Salvar Pré-Viagem').click());
    expect(checkbox(0)).toHaveAttribute('aria-checked','true');
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:'O turno mudou'}));
  });
  it('blocks saving and editing while data is uncertain and detects a shift change', async () => {
    await render({disabled:true});
    expect(checkbox(0)).toBeDisabled(); expect(button('Salvar Pré-Viagem')).toBeDisabled();
    await render(); await act(async () => checkbox(0).click());
    await render({boundaryId:'next-shift'});
    expect(button('Salvar Pré-Viagem')).toBeDisabled();
    expect(checkbox(0)).toHaveAttribute('aria-checked','true');
  });
});
