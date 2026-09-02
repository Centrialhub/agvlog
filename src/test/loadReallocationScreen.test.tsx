import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoadReallocation from '@/pages/LoadReallocation';

vi.mock('@/components/ui/select',async()=>{
  const React=await import('react');
  type ChildProps={id?:string;value?:string;disabled?:boolean;placeholder?:string;'aria-label'?:string;children?:import('react').ReactNode};
  const SelectTrigger=()=>null;
  const SelectContent=()=>null;
  const SelectItem=()=>null;
  const SelectValue=()=>null;
  const Select=({children,value,onValueChange,disabled}:{children?:import('react').ReactNode;value?:string;
    onValueChange?:(value:string)=>void;disabled?:boolean})=>{
    let id:string|undefined;let ariaLabel:string|undefined;let placeholder='';
    const options:Array<{value:string;disabled?:boolean;text:string}>=[];
    const textOf=(node:import('react').ReactNode):string=>React.Children.toArray(node).map(child=>
      typeof child==='string'||typeof child==='number'?String(child):
        React.isValidElement<ChildProps>(child)?textOf(child.props.children):'').join(' ').replace(/\s+/g,' ')
      .replace(/\s+([:;,.])/g,'$1').trim();
    const visit=(node:import('react').ReactNode):void=>React.Children.forEach(node,child=>{
      if(!React.isValidElement<ChildProps>(child))return;
      if(child.type===SelectTrigger){id=child.props.id;ariaLabel=child.props['aria-label'];visit(child.props.children);}
      else if(child.type===SelectValue)placeholder=child.props.placeholder??'';
      else if(child.type===SelectItem&&child.props.value)options.push({value:child.props.value,
        disabled:child.props.disabled,text:textOf(child.props.children)});
      else visit(child.props.children);
    });
    visit(children);
    return React.createElement('select',{id,'aria-label':ariaLabel,role:'combobox',value,disabled,
      onChange:(event:import('react').ChangeEvent<HTMLSelectElement>)=>onValueChange?.(event.currentTarget.value)},
    React.createElement('option',{value:'',disabled:true},placeholder),
    ...options.map(option=>React.createElement('option',{key:option.value,value:option.value,disabled:option.disabled},option.text)));
  };
  return {Select,SelectTrigger,SelectContent,SelectItem,SelectValue,SelectGroup:SelectContent,
    SelectLabel:SelectContent,SelectSeparator:()=>null,SelectScrollUpButton:()=>null,SelectScrollDownButton:()=>null};
});

const mock = vi.hoisted(() => ({ rpc: vi.fn(), success: vi.fn(), error: vi.fn(), write: vi.fn(),
  tenant: { id: 'tenant' }, sourceRemoved: false }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: mock.tenant }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast:()=>({ success: mock.success, error: mock.error })}));
vi.mock('@/hooks/useLoads', () => ({ useLoads: () => ({ data: [
  { id: 'source', tenant_id: 'tenant', load_number: '1001', status: 'loading', destination: 'Origem QA' },
  { id: 'target', tenant_id: 'tenant', load_number: '1002', status: 'loading', destination: 'Destino QA' },
  { id: 'started', tenant_id: 'tenant', load_number: '1003', status: 'in_transit' },
] }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [] }) }));
vi.mock('@/hooks/useLoadItems', () => ({ useLoadItems: (loadId: string) => ({ data: loadId === 'source' ? [
  { id: 'item', tenant_id: 'tenant', load_id: 'source', fiscal_document_id: 'doc', item_description: 'Mercadoria QA',
    quantity: 1, pallet_count: 1, weight_kg: 10, fiscal_documents: { invoice_number: '123' } },
] : [], isLoading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc, from: () => {
  const query = { select: () => query, in: () => Promise.resolve({ data: [], error: null }), update: mock.write, delete: mock.write };
  return query;
} } }));
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); mock.tenant = { id: 'tenant' }; mock.sourceRemoved = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  mock.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: {
    moved: 1, source_load_id: 'source', target_load_id: 'target', document_ids: ['doc'], source_removed: mock.sourceRemoved,
  }, error: null }) }));
});
afterEach(() => { cleanup(); client.clear(); });
const page = () => <QueryClientProvider client={client}><MemoryRouter><LoadReallocation /></MemoryRouter></QueryClientProvider>;
async function selectLoads() {
  const source=screen.getByLabelText('Carga Origem');
  expect(screen.queryByRole('option', { name: /1003/ })).not.toBeInTheDocument();
  fireEvent.change(source,{target:{value:'source'}});
  fireEvent.change(screen.getByLabelText('Carga Destino'),{target:{value:'target'}});
  fireEvent.click(await screen.findByRole('button', { name: /Mercadoria QA/ }));
}

describe('real reallocation screen with isolated transport', () => {
  it('announces success only after confirmation and performs no browser-side cleanup or route rewrite', async () => {
    render(page()); await selectLoads(); fireEvent.click(screen.getByRole('button', { name: 'Mover para 1002' }));
    await waitFor(() => expect(mock.success).toHaveBeenCalledWith('1 item(ns) realocado(s) para 1002'));
    expect(screen.getByText('Histórico desta sessão (1)')).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledTimes(1); expect(mock.write).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Carga Origem')).toHaveTextContent('1001');
  });
  it('clears the origin only when the database confirms source_removed', async () => {
    mock.sourceRemoved = true; render(page()); await selectLoads(); fireEvent.click(screen.getByRole('button', { name: 'Mover para 1002' }));
    await waitFor(() => expect(mock.success).toHaveBeenCalledWith(expect.stringContaining('foi removida')));
    expect(screen.getByLabelText('Carga Origem')).toHaveTextContent('Selecione a carga de origem'); expect(mock.write).not.toHaveBeenCalled();
  });
  it('keeps an uncertain result visible without declaring zero moved or adding a success history entry', async () => {
    mock.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: { moved: 1 }, error: null }) }));
    render(page()); await selectLoads(); fireEvent.click(screen.getByRole('button', { name: 'Mover para 1002' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('pode ter sido concluída');
    expect(mock.success).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
    expect(screen.queryByText(/Histórico desta sessão/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mover (selecione itens)' })).toBeDisabled();
  });
  it('shows a replanning rejection and requires a fresh selection', async () => {
    mock.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: null, error: { code: '23514', message: 'composition_requires_replanning' } }) }));
    render(page()); await selectLoads(); fireEvent.click(screen.getByRole('button', { name: 'Mover para 1002' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('replanejamento explícito');
    expect(mock.success).not.toHaveBeenCalled(); expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it('clears selection and history when switching the selected company', async () => {
    const view = render(page()); await selectLoads(); fireEvent.click(screen.getByRole('button', { name: 'Mover para 1002' }));
    await screen.findByText('Histórico desta sessão (1)'); mock.tenant = { id: 'other' }; view.rerender(page());
    expect(screen.queryByText(/Histórico desta sessão/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Carga Origem')).toHaveTextContent('Selecione a carga de origem');
  });
});
