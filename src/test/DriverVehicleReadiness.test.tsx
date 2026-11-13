import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DriverVehicleReadiness} from '@/components/driver/DriverVehicleReadiness';
const m=vi.hoisted(()=>({submit:vi.fn(),commands:[] as unknown[]}));
vi.mock('@/hooks/useDriverOperationalOffline',()=>({useDriverOperationalOffline:()=>m}));
beforeEach(()=>{m.commands=[];m.submit.mockReset().mockResolvedValue({queued:false,state:'confirmed'});});afterEach(cleanup);
function show(complete=vi.fn()){
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 const view=render(<QueryClientProvider client={client}><DriverVehicleReadiness tripId="trip" savedId={null} boundaryId={null}
  payload={null} disabled={false} driverName="Motorista QA" onComplete={complete}/></QueryClientProvider>);
 return {...view,complete,client};
}
function answerAll(){for(let n=0;n<6;n++)fireEvent.click(screen.getByRole('button',{name:n===1?'Precisa de atenção':'Está OK'}));}
it('greets, asks six questions and auto-saves truthful answers before opening the cargo',async()=>{
 const {complete}=show();expect(screen.getByText('Bem-vindo, Motorista QA!')).toBeInTheDocument();
 answerAll();await waitFor(()=>expect(complete).toHaveBeenCalledOnce());
 expect(m.submit).toHaveBeenCalledExactlyOnceWith({kind:'checklist',aggregateId:'trip',payload:{trip_id:'trip',kind:'pre',checklist_payload:{
  schema_version:2,checklist_model:'vehicle_readiness_v1',answers:[true,false,true,true,true,true],checked_items:[0,1,2,3,4,5],total_items:6,
  expected_checklist_id:null,expected_boundary_id:null,expected_boundary_request_id:null}}});
 expect(screen.queryByRole('button',{name:/Salvar Pré/})).not.toBeInTheDocument();
});
it('continues after durable local queuing, but not after an unconfirmed storage failure or server conflict',async()=>{
 m.submit.mockResolvedValueOnce({queued:true,state:'queued'});const first=show();answerAll();await waitFor(()=>expect(first.complete).toHaveBeenCalledOnce());first.unmount();
 m.submit.mockRejectedValueOnce(new Error('Disco sem espaço'));const second=show();answerAll();await screen.findByRole('alert');expect(second.complete).not.toHaveBeenCalled();second.unmount();
 m.submit.mockResolvedValueOnce({queued:true,state:'needs_attention',error:'Turno alterado'});const third=show();answerAll();await screen.findByText('Turno alterado');expect(third.complete).not.toHaveBeenCalled();
});
it('never navigates after the old driver/trip view unmounts during transport',async()=>{
 let finish!:(value:unknown)=>void;m.submit.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const view=show();answerAll();await waitFor(()=>expect(m.submit).toHaveBeenCalledOnce());view.unmount();
 await act(async()=>{finish({queued:false,state:'confirmed'});});expect(view.complete).not.toHaveBeenCalled();
});
