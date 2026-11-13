import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DriverCargoCustody from '@/pages/driver/DriverCargoCustody';

const mocks=vi.hoisted(()=>({read:vi.fn(),command:vi.fn(),start:vi.fn(),online:true}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/hooks/useCurrentDriver',()=>({useCurrentDriver:()=>({data:{id:'driver',active:true}}),useActiveTrip:()=>({data:{id:'trip'}})}));
vi.mock('@/hooks/useOnlineStatus',()=>({useOnlineStatus:()=>mocks.online}));
vi.mock('@/hooks/useDriverCargoTripIdentity',()=>({useDriverCargoTripIdentity:()=>({data:{plate:'AAA1A11',loads:[{loadNumber:'123'}]},isError:false,isFetching:false})}));
vi.mock('@/lib/driver/tripCargoCustody',()=>({getCompleteTripCargoControl:mocks.read,updateDriverTripCargo:mocks.command}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.start}}));
vi.mock('@/pages/driver/DriverCargoCustodyLegacy',()=>({default:()=> <p>Registro anterior</p>}));
const available=(status='accepted')=>({available:true,trip_id:'trip',trip_status:'planned',control:{status,vehicle_id:'vehicle',updated_at:'2026-11-13T17:00:00Z'},documents:[{id:'note1',reference_number:'NF 1'},{id:'note2',reference_number:'NF 2'}],loads:[{load_id:'load'}]});
let client:QueryClient;
beforeEach(()=>{
 vi.clearAllMocks();mocks.online=true;
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 mocks.read.mockResolvedValue({available:false,vehicle_id:'vehicle'});
 mocks.command.mockImplementation(async({action})=>{if(action==='accept')mocks.read.mockResolvedValue(available());if(action==='mark_departed')mocks.read.mockResolvedValue(available('departed'));return {confirmed:true};});
 mocks.start.mockResolvedValue({data:{trip_id:'trip',status:'in_transit',load_ids:['load'],changed:true},error:null});
});
afterEach(()=>{cleanup();client.clear();});
function show(){render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/driver/cargo?trip=trip']}><Routes>
 <Route path="/driver/cargo" element={<DriverCargoCustody/>}/><Route path="/driver/stops" element={<h1>Entregas liberadas</h1>}/>
 </Routes></MemoryRouter></QueryClientProvider>);}
it('uses one click to accept, bulk confirm and start, without physical evidence inputs',async()=>{
 show();const button=await screen.findByRole('button',{name:'Confirmar carga e iniciar entregas'});
 await waitFor(()=>expect(button).toBeEnabled());
 expect(screen.queryByLabelText(/lacre|foto|avaria|veículo conferido/i)).not.toBeInTheDocument();
 fireEvent.click(button);await screen.findByRole('heading',{name:'Entregas liberadas'});
 expect(mocks.command.mock.calls.map(([x])=>x.action)).toEqual(['accept','quick_confirm','mark_departed']);
 expect(mocks.command.mock.calls[1][0].payload).toEqual({expected_updated_at:'2026-11-13T17:00:00Z',confirm_all_documents:true});
 expect(mocks.start).toHaveBeenCalledWith('driver_start_trip',{_trip_id:'trip'});
});
it('does not navigate on an unconfirmed start and retries only that pending phase',async()=>{
 mocks.start.mockResolvedValueOnce({data:null,error:{message:'Tente novamente'}});
 show();const button=await screen.findByRole('button',{name:'Confirmar carga e iniciar entregas'});await waitFor(()=>expect(button).toBeEnabled());
 fireEvent.click(button);await screen.findByRole('alert');
 expect(screen.queryByRole('heading',{name:'Entregas liberadas'})).not.toBeInTheDocument();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmar carga e iniciar entregas'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Confirmar carga e iniciar entregas'}));
 await screen.findByRole('heading',{name:'Entregas liberadas'});
 expect(mocks.command.mock.calls.map(([x])=>x.action)).toEqual(['accept','quick_confirm','mark_departed']);expect(mocks.start).toHaveBeenCalledTimes(2);
});
it('explains an offline connection and never sends a conference',async()=>{
 mocks.online=false;show();expect(await screen.findByText('Conecte-se à internet para confirmar a conferência.')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Confirmar carga e iniciar entregas'})).toBeDisabled();expect(mocks.command).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();
});
