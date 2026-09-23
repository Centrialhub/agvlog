import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AddressResolution from '@/pages/AddressResolution';

const mocks=vi.hoisted(()=>({rpc:vi.fn(),confirmAction:vi.fn(),geocode:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'10000000-0000-4000-8000-000000000001'}}),useIsAdmin:()=>true}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'20000000-0000-4000-8000-000000000001'}})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:mocks.success,error:mocks.error})}));
vi.mock('@/hooks/useAlertStore',()=>({useScopedAlerts:()=>({confirmAction:mocks.confirmAction})}));
vi.mock('@/lib/geocoding',async importOriginal=>({
  ...await importOriginal<typeof import('@/lib/geocoding')>(),geocodeAddress:mocks.geocode,
}));
vi.mock('@/components/maps/AddressResolutionPicker',()=>({
  AddressResolutionPicker:({onSelectionChange}:{onSelectionChange:()=>void})=><button onClick={onSelectionChange}>Ajustar ponto de teste</button>,
}));

beforeEach(()=>{
  vi.clearAllMocks();mocks.confirmAction.mockResolvedValue(false);
  mocks.rpc.mockResolvedValue({data:[{items:[{
    id:'30000000-0000-4000-8000-000000000001',entity_type:'client',entity_id:'40000000-0000-4000-8000-000000000001',
    address_snapshot:'Rua Exemplo, 12',status:'ambiguous',candidates:[{
      label:'Rua Exemplo',latitude:-19.9,longitude:-43.9,provider:'nominatim',accuracy_m:50,confidence:0.8,
    }],attempts:1,last_error:null,invalidated_at:null,company_name:'Cliente A',trade_name:null,
  }],total_count:1,pending_count:0,ambiguous_count:1,error_count:0,
  snapshot_at:'2026-09-23T12:00:00Z',next_cursor_updated_at:null,next_cursor_id:null,has_more:false}],error:null});
});
afterEach(cleanup);

it('preserves an unconfirmed map adjustment until the reviewer approves discarding it',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});
  render(<QueryClientProvider client={client}><AddressResolution/></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button',{name:/Conferir opções de endereço para Cliente A/}));
  fireEvent.click(await screen.findByRole('button',{name:'Ajustar ponto de teste'}));
  const initialReads=mocks.rpc.mock.calls.length;

  fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));
  await waitFor(()=>expect(mocks.confirmAction).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button',{name:'Ajustar ponto de teste'})).toBeInTheDocument();
  expect(mocks.rpc).toHaveBeenCalledTimes(initialReads);

  fireEvent.click(screen.getByRole('button',{name:/Buscar opções para Cliente A/}));
  await waitFor(()=>expect(mocks.confirmAction).toHaveBeenCalledTimes(2));
  expect(mocks.geocode).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Ajustar ponto de teste'})).toBeInTheDocument();

  mocks.confirmAction.mockResolvedValue(true);
  fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(initialReads+1));
  expect(screen.queryByRole('button',{name:'Ajustar ponto de teste'})).not.toBeInTheDocument();
});
