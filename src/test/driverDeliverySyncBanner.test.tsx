import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {DriverDeliverySyncBanner} from '@/components/driver/DriverDeliverySyncBanner';
import {createDeliverySubmission} from '@/lib/driver/driverDeliverySubmission';
import type {DriverDeliveryOfflineDraft} from '@/lib/driver/driverDeliveryOfflineStore';
import {DRIVER_OFFLINE_OUTBOX_CHANGED} from '@/lib/driver/driverOfflineOutbox';
const mocks=vi.hoisted(()=>({tenant:'tenant',actor:'driver',online:false,records:new Map<string,DriverDeliveryOfflineDraft>(),
  upload:vi.fn(),rpc:vi.fn(),refresh:vi.fn(),replay:vi.fn(),authListeners:new Set<(event:string)=>void>()}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mocks.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mocks.actor}})}));
vi.mock('@/hooks/useOnlineStatus',()=>({useOnlineStatus:()=>mocks.online}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc,auth:{refreshSession:mocks.refresh,
  onAuthStateChange:(callback:(event:string)=>void)=>{mocks.authListeners.add(callback);return {data:{subscription:{unsubscribe:()=>mocks.authListeners.delete(callback)}}};}}}}));
vi.mock('@/lib/secureUpload',()=>({uploadSecureFile:mocks.upload}));
vi.mock('@/lib/driver/driverDeliveryOfflineStore',async importOriginal=>({...await importOriginal<typeof import('@/lib/driver/driverDeliveryOfflineStore')>(),
  driverDeliveryOfflineStore:{
    save:async(draft:DriverDeliveryOfflineDraft)=>{mocks.records.set(draft.requestId,draft);window.dispatchEvent(new CustomEvent(DRIVER_OFFLINE_OUTBOX_CHANGED));},
    list:async(tenant:string,actor:string)=>[...mocks.records.values()].filter(draft=>draft.tenantId===tenant&&draft.actorId===actor),
    remove:async(id:string)=>{mocks.records.delete(id);window.dispatchEvent(new CustomEvent(DRIVER_OFFLINE_OUTBOX_CHANGED));},
  }}));
vi.mock('@/lib/driver/driverDeliverySubmission',async importOriginal=>{
  const actual=await importOriginal<typeof import('@/lib/driver/driverDeliverySubmission')>();
  mocks.replay.mockImplementation(actual.replayPendingDeliverySubmissions);
  return {...actual,replayPendingDeliverySubmissions:mocks.replay};
});
const clients:QueryClient[]=[];
const fixture=()=>({tenantId:'tenant',actorId:'driver',tripId:'trip',stopId:'stop',expectedStatus:'arrived',eventKey:'avaria',
  photos:[new File([new Uint8Array(16)],'photo.png',{type:'image/png'})],receiptScan:null,signatureDataUrl:null,details:{notes:'controlled test'}});
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});clients.push(client);
  const wrapper=()=> <QueryClientProvider client={client}><MemoryRouter><DriverDeliverySyncBanner/></MemoryRouter></QueryClientProvider>;
  return {client,...render(wrapper()),redraw:wrapper};}
afterEach(()=>{cleanup();for(const client of clients)client.clear();clients.length=0;vi.useRealTimers();vi.restoreAllMocks();});
beforeEach(()=>{mocks.records.clear();mocks.tenant='tenant';mocks.actor='driver';mocks.online=false;mocks.upload.mockReset();mocks.rpc.mockReset();mocks.replay.mockClear();
  Object.defineProperty(navigator,'onLine',{configurable:true,value:false});mocks.rpc.mockResolvedValue({data:{event_id:crypto.randomUUID(),operational_event_id:crypto.randomUUID(),replayed:false},error:null});});
describe('delivery banner with a real QueryClient',()=>{
  it('makes one upload on permanent 400 despite progress events and 100 subsequent outbox notifications',async()=>{
    await createDeliverySubmission(fixture()).submit();const saved=[...mocks.records.values()][0];
    let release!:()=>void;mocks.upload.mockImplementation(async()=>{await new Promise<void>(resolve=>{release=resolve;});throw Object.assign(new Error('controlled invalid_upload'),{status:400,code:'invalid_upload'});});
    const view=mount();mocks.online=true;Object.defineProperty(navigator,'onLine',{configurable:true,value:true});view.rerender(view.redraw());
    await waitFor(()=>expect(mocks.upload).toHaveBeenCalledTimes(1));
    act(()=>{for(let i=0;i<100;i++)window.dispatchEvent(new CustomEvent(DRIVER_OFFLINE_OUTBOX_CHANGED));});
    expect(mocks.upload).toHaveBeenCalledTimes(1);act(()=>release());
    await waitFor(()=>expect(view.client.getQueryState(['driver_delivery_outbox_replay','tenant','driver'])?.fetchStatus).toBe('idle'));
    act(()=>{for(let i=0;i<100;i++)window.dispatchEvent(new CustomEvent(DRIVER_OFFLINE_OUTBOX_CHANGED));});
    await waitFor(()=>expect(mocks.replay).toHaveBeenCalledTimes(2));
    expect(mocks.upload).toHaveBeenCalledTimes(1);expect(mocks.rpc).not.toHaveBeenCalled();
    expect([...mocks.records.values()][0]).toMatchObject({requestId:saved.requestId,state:'needs_attention',attention:{kind:'upload_failure',code:'invalid_upload'}});
    expect(screen.getByRole('link')).toHaveTextContent('1 envio salvo aguarda');
  });
  it('coalesces idle events without cancelling an existing replay and cleans the listener on unmount',async()=>{
    const actual=mocks.replay.getMockImplementation()!;let release!:()=>void;
    mocks.online=true;Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
    mocks.replay.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({confirmed:0,cleaned:0,rejected:0,pending:0,needsAttention:0,pendingStopIds:[],nextRetryAt:null});}));
    const view=mount();await waitFor(()=>expect(mocks.replay).toHaveBeenCalledTimes(1));
    act(()=>{for(let i=0;i<100;i++)window.dispatchEvent(new CustomEvent(DRIVER_OFFLINE_OUTBOX_CHANGED));});
    await act(async()=>release());expect(mocks.replay).toHaveBeenCalledTimes(1);
    view.unmount();act(()=>window.dispatchEvent(new CustomEvent(DRIVER_OFFLINE_OUTBOX_CHANGED)));
    await new Promise(resolve=>setTimeout(resolve,10));expect(mocks.replay).toHaveBeenCalledTimes(1);expect(mocks.authListeners.size).toBe(0);
    mocks.replay.mockImplementation(actual);
  });
  it('uses the durable retry deadline and cancels that timer when the actor changes',async()=>{
    vi.useFakeTimers();const actual=mocks.replay.getMockImplementation()!;
    mocks.online=true;mocks.replay.mockImplementation(async()=>({confirmed:0,cleaned:0,rejected:0,pending:1,needsAttention:0,pendingStopIds:['stop'],nextRetryAt:Date.now()+60_000}));
    const view=mount();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(mocks.replay).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(59_999);});expect(mocks.replay).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(mocks.replay).toHaveBeenCalledTimes(2);
    mocks.actor='other-driver';view.rerender(view.redraw());await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(mocks.replay.mock.calls.at(-1)).toEqual(['tenant','other-driver']);
    const count=mocks.replay.mock.calls.length;view.unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(180_000);});expect(mocks.replay).toHaveBeenCalledTimes(count);
    mocks.replay.mockImplementation(actual);
  });
});
