import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import type {Load} from '@/hooks/useLoads';
import LoadRomaneioTabs from '@/components/loads/LoadRomaneioTabs';
const m=vi.hoisted(()=>({save:vi.fn().mockResolvedValue({}),success:vi.fn()}));
vi.mock('@/hooks/useLoads',()=>({useUpdateLoad:()=>({mutateAsync:m.save,isPending:false}),useHoldLoad:()=>({}),useUnholdLoad:()=>({})}));
vi.mock('@/hooks/useVehicles',()=>({useVehicles:()=>({data:[]})}));
vi.mock('@/hooks/useDrivers',()=>({useDrivers:()=>({data:[]})}));
vi.mock('@/hooks/useAlertStore',()=>({useScopedAlerts:()=>({promptAction:vi.fn()})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:m.success,error:vi.fn(),info:vi.fn()})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn(),useSearchParams:()=>[new URLSearchParams()]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{const q={select:()=>q,contains:()=>q,eq:()=>q,in:()=>q,order:()=>q,
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;}}}));
vi.mock('@/components/loads/LoadItemsPanel',()=>({default:()=>null}));
vi.mock('@/components/loads/CTeWorkbench',()=>({default:()=>null}));
vi.mock('@/components/loads/NFSePanel',()=>({default:()=>null}));
vi.mock('@/components/loads/ManifestPanel',()=>({default:()=>null}));
vi.mock('@/components/loads/LoadNotesPanel',()=>({default:()=>null}));
vi.mock('@/components/loads/LoadAggregateRecoveryAlert',()=>({default:()=>null}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('sends only an edited monitoring flag and preserves original timestamp seconds in untouched fields',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const load={id:'70000000-0000-4000-8000-000000000001',load_number:'QA',status:'in_transit',version:3,created_at:'2026-11-01T10:00:00Z',
  actual_load_at:'2026-11-10T09:00:55Z',gate_departure_at:'2026-11-10T10:00:44Z',arrival_at:'2026-11-11T11:00:33Z',estimated_arrival_at:'2026-11-11T11:00:22Z'} as Load;
 render(<QueryClientProvider client={client}><LoadRomaneioTabs load={load} documents={[]} items={[]}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole('switch',{name:'Monitorado'}));
 fireEvent.click(screen.getByRole('button',{name:'Salvar Cabeçalho'}));
 await waitFor(()=>expect(m.save).toHaveBeenCalledOnce());
 expect(m.save.mock.calls[0][0]).toEqual({id:load.id,expectedVersion:3,reason:'Cabeçalho do romaneio atualizado pelo operador.',monitored:true});
 client.clear();
});
it('edits operational fields and submits local timestamps as ISO while note-derived totals stay protected',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const load={id:'70000000-0000-4000-8000-000000000001',load_number:'QA',status:'loaded',version:3,created_at:'2026-11-01T10:00:00Z',
  total_weight_kg:120,total_volume_m3:8,total_pallet_count:4} as Load;
 render(<QueryClientProvider client={client}><LoadRomaneioTabs load={load} documents={[]} items={[]}/></QueryClientProvider>);
 for(const [label,value] of [['Data do Carregamento','2026-11-10T09:00'],['Data Saída (Portaria)','2026-11-10T10:00'],
  ['Data de Chegada','2026-11-11T11:00'],['Tipo Motorista','Agregado'],['Resp. Monitoramento','Operação QA']]){
  const input=screen.getByLabelText(label);expect(input).not.toBeDisabled();fireEvent.change(input,{target:{value}});
 }
 fireEvent.click(screen.getByRole('switch',{name:'Monitorado'}));
 for(const label of ['Peso Total (kg)','Volume M³','Paletes'])expect(screen.getByLabelText(label)).toBeDisabled();
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Gerenciadora de Risco'}),{button:0,ctrlKey:false});
 fireEvent.change(await screen.findByLabelText('Gerenciadora SM'),{target:{value:'Gerenciadora QA'}});
 fireEvent.change(screen.getByLabelText('Liberação SM'),{target:{value:'Liberado QA'}});
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Geral'}),{button:0,ctrlKey:false});
 fireEvent.click(await screen.findByRole('button',{name:'Salvar Cabeçalho'}));
 await waitFor(()=>expect(m.save).toHaveBeenCalledOnce());
 expect(m.save).toHaveBeenCalledWith(expect.objectContaining({id:load.id,expectedVersion:3,
  actual_load_at:new Date('2026-11-10T09:00').toISOString(),gate_departure_at:new Date('2026-11-10T10:00').toISOString(),
  arrival_at:new Date('2026-11-11T11:00').toISOString(),driver_type:'Agregado',monitor_responsible:'Operação QA',monitored:true,
  sm_manager:'Gerenciadora QA',sm_release:'Liberado QA'}));
 expect(m.save.mock.calls[0][0]).not.toHaveProperty('total_weight_kg');client.clear();
});
