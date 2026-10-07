import { onlineManager } from '@tanstack/react-query';
import { act,cleanup,fireEvent,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { MEMBERSHIP_QUERY } from '@/components/auth/TenantDataBoundary';
import { readPendingLoadCreations } from '@/lib/loads/loadCreationOutbox';
import { control,mountGroupingProviders } from './helpers/groupingReconnectHarness';
import { authEvent,driver,hold,release,resetTransport,scope,session,transport,vehicle } from './helpers/groupingReconnectTransport';

vi.mock('@/integrations/supabase/client',async()=>{
 const {fixtureSupabase}=await import('./helpers/groupingReconnectTransport');return {supabase:fixtureSupabase()};
});
vi.mock('@/hooks/useVehicles',()=>({useVehicles:()=>({data:[vehicle]})}));
vi.mock('@/hooks/useDrivers',()=>({useDrivers:()=>({data:[driver]})}));
vi.mock('@/hooks/useOperationalRoutes',()=>({useOperationalRoutes:()=>({data:[]})}));
// Auth/Tenant/Online/Boundary/Grouping/UI/SDK pagination/load-creation are REAL.
// No fake clock, query-data injection, fetchAllPages mock or provider mock.

const combined='MG - Brasília - Pirapora';
const docsKey=['pending_fiscal_docs',scope.tenant];
let view:ReturnType<typeof mountGroupingProviders>;
let onlineDescriptor:PropertyDescriptor|undefined;
let locksDescriptor:PropertyDescriptor|undefined;
beforeEach(()=>{
 resetTransport();onlineManager.setOnline(true);localStorage.clear();
 onlineDescriptor=Object.getOwnPropertyDescriptor(navigator,'onLine');
 locksDescriptor=Object.getOwnPropertyDescriptor(navigator,'locks');
 Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>transport.online});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 // jsdom layout primitive, without replacing any product component.
 vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});
});
afterEach(async()=>{
 cleanup();view?.client.clear();transport.online=true;onlineManager.setOnline(true);transport.gates.forEach(gate=>gate.release());
 await Promise.resolve();localStorage.clear();vi.unstubAllGlobals();
 if(onlineDescriptor)Object.defineProperty(navigator,'onLine',onlineDescriptor);else Reflect.deleteProperty(navigator,'onLine');
 if(locksDescriptor)Object.defineProperty(navigator,'locks',locksDescriptor);else Reflect.deleteProperty(navigator,'locks');
});
async function mount(){
 view=mountGroupingProviders();await waitFor(()=>expect(screen.getByTestId('scope-state')).toHaveTextContent(`${scope.actor}:${scope.tenant}:owner:online`));
 fireEvent.click(screen.getByRole('button',{name:'Agrupar NF-es'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Criar 2 Carga(s)'})).toBeEnabled());
}
async function choose(label:string,option:string){
 const trigger=screen.getByRole('combobox',{name:label});trigger.focus();
 fireEvent.keyDown(trigger,{key:'ArrowDown'});
 const item=await screen.findByRole('option',{name:option});fireEvent.keyDown(item,{key:'Enter'});
 await waitFor(()=>expect(screen.getByRole('combobox',{name:label})).toHaveTextContent(option));
}
async function planned(){
 await mount();
 // Select both explicit empty values before joining; suggestions must not refill.
 await choose('Veículo de MG - Brasília','Sem veículo');
 await choose('Motorista de MG - Brasília','Sem motorista');
 fireEvent.click(screen.getByRole('button',{name:'Juntar outro grupo a MG - Brasília'}));
 fireEvent.click(screen.getByRole('button',{name:'Adicionar MG - Pirapora'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Criar 1 Carga(s)'})).toBeEnabled());
 assertPlan();return {dialog:screen.getByRole('dialog'),instance:screen.getByTestId('scope-state').getAttribute('data-instance')};
}
function assertPlan(){
 expect(screen.getByRole('dialog')).toBeInTheDocument();
 expect(screen.getByRole('checkbox',{name:`Selecionar ${combined}`})).toBeChecked();
 expect(screen.getByRole('combobox',{name:`Veículo de ${combined}`})).toHaveTextContent('Sem veículo');
 expect(screen.getByRole('combobox',{name:`Motorista de ${combined}`})).toHaveTextContent('Sem motorista');
 expect(screen.getByRole('button',{name:`Separar grupos de ${combined}`})).toBeInTheDocument();
 expect(screen.queryByRole('checkbox',{name:'Selecionar MG - Pirapora'})).not.toBeInTheDocument();
}
async function network(online:boolean){
 await act(async()=>{transport.online=online;window.dispatchEvent(new Event(online?'online':'offline'));
  // Real transition event; onlineManager is reset only between isolated tests.
  await new Promise<void>(resolve=>setTimeout(resolve,0));});
 await waitFor(()=>expect(screen.getByTestId('scope-state')).toHaveTextContent(online?'online':'offline'));
}
const membershipReads=()=>transport.reads.filter(read=>read.path.endsWith('/get_current_memberships_v1'));
describe('M4 grouping plan at the REAL Auth/Tenant/network boundary',()=>{
 it('preserves combined MG Brasília/Pirapora and explicit none through offline/online and fresh same-scope reads',async()=>{
  const original=await planned();const before=membershipReads().length;
  await network(false);assertPlan();expect(screen.getByRole('dialog')).toBe(original.dialog);
  expect(screen.getByTestId('scope-state')).toHaveAttribute('data-instance',original.instance!);
  const memberships=hold('membership'),documents=hold('documents');
  await network(true);
  await waitFor(()=>expect(membershipReads().length).toBeGreaterThan(before));
  assertPlan();expect(screen.getByRole('dialog')).toBe(original.dialog);
  expect(screen.getByTestId('scope-state')).toHaveAttribute('data-instance',original.instance!);
  expect(transport.delivered).toEqual([]);
  release('membership',memberships);release('documents',documents);
  await waitFor(()=>expect(view.client.getQueryState(docsKey)?.fetchStatus).toBe('idle'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Criar 1 Carga(s)'})).toBeEnabled());
  assertPlan();expect(screen.getByRole('dialog')).toBe(original.dialog);expect(transport.delivered).toEqual([]);
 });
 it('preserves plan during held memberships/docs revalidation and TOKEN_REFRESHED without remounting Loads state',async()=>{
  const original=await planned();const count=membershipReads().length;
  const memberships=hold('membership'),documents=hold('documents');
  const pending=view.client.refetchQueries({queryKey:docsKey,exact:true});
  await act(async()=>authEvent('TOKEN_REFRESHED',session(scope.actor,scope.tenant,10)));
  await waitFor(()=>expect(membershipReads().length).toBeGreaterThan(count));
  assertPlan();expect(screen.getByRole('button',{name:'Criar 1 Carga(s)'})).toBeDisabled();
  expect(screen.getByRole('dialog')).toBe(original.dialog);
  release('membership',memberships);release('documents',documents);await act(async()=>{await pending;});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Criar 1 Carga(s)'})).toBeEnabled());assertPlan();
  expect(screen.getByTestId('scope-state')).toHaveAttribute('data-instance',original.instance!);
  expect(transport.delivered).toEqual([]);
 });
 it.each(['tenant','actor','role','signout'])('resets local grouping state for a genuine %s scope transition',async kind=>{
  const original=await planned();
  if(kind==='tenant')await act(async()=>{expect(await control.activate?.(scope.otherTenant)).toBe(true);});
  if(kind==='actor')await act(async()=>authEvent('SIGNED_IN',session(scope.otherActor)));
  if(kind==='role'){transport.role='operator';await act(async()=>{await view.client.refetchQueries({queryKey:[MEMBERSHIP_QUERY,scope.actor]});});}
  if(kind==='signout')await act(async()=>{await control.signOut?.();});
  const expected=kind==='tenant'?scope.otherTenant:kind==='actor'?scope.otherActor:kind==='role'?'operator':'signed-out';
  await waitFor(()=>expect(screen.getByTestId('scope-state')).toHaveTextContent(expected));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByTestId('grouping-open')).toHaveTextContent('false');
  expect(screen.getByTestId('scope-state').getAttribute('data-instance')).not.toBe(original.instance);
  expect(transport.delivered).toEqual([]);
  if(kind!=='signout'){
   fireEvent.click(screen.getByRole('button',{name:'Agrupar NF-es'}));
   await waitFor(()=>expect(screen.getByRole('button',{name:'Criar 2 Carga(s)'})).toBeEnabled());
   expect(screen.queryByRole('button',{name:`Separar grupos de ${combined}`})).not.toBeInTheDocument();
  }
 });
 it('cancels a held old-actor membership request and never applies its late result to the new actor',async()=>{
  await planned();const gate=hold('membership');const before=membershipReads().length;
  await act(async()=>authEvent('TOKEN_REFRESHED',session(scope.actor,scope.tenant,20)));
  await waitFor(()=>expect(membershipReads().length).toBeGreaterThan(before));
  const old=membershipReads().at(-1)!;expect(old.actor).toBe(scope.actor);expect(old.signal).not.toBeNull();
  await act(async()=>authEvent('SIGNED_IN',session(scope.otherActor)));
  await waitFor(()=>expect(old.signal?.aborted).toBe(true));
  release('membership',gate);
  await waitFor(()=>expect(screen.getByTestId('scope-state')).toHaveTextContent(scope.otherActor));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(transport.delivered).toEqual([]);
 });
 it('hides stale permissions on failed online membership revalidation; retry does not resurrect the old plan',async()=>{
  await planned();transport.memberError=true;
  await act(async()=>{await view.client.refetchQueries({queryKey:[MEMBERSHIP_QUERY,scope.actor]});});
  await screen.findByRole('alert');
  expect(screen.getByText(/Os dados anteriores foram ocultados/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(transport.delivered).toEqual([]);
  transport.memberError=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
  await waitFor(()=>expect(screen.getByTestId('grouping-open')).toHaveTextContent('false'));
  fireEvent.click(screen.getByRole('button',{name:'Agrupar NF-es'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Criar 2 Carga(s)'})).toBeEnabled());
  expect(screen.queryByRole('button',{name:`Separar grupos de ${combined}`})).not.toBeInTheDocument();
 });
 it('cancels and reopens with separate auto-selected groups instead of preserving a canceled combination',async()=>{
  await planned();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button',{name:'Agrupar NF-es'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Criar 2 Carga(s)'})).toBeEnabled());
  expect(screen.getByRole('checkbox',{name:'Selecionar MG - Brasília'})).toBeChecked();
  expect(screen.getByRole('checkbox',{name:'Selecionar MG - Pirapora'})).toBeChecked();
  expect(screen.queryByRole('button',{name:`Separar grupos de ${combined}`})).not.toBeInTheDocument();
  expect(transport.delivered).toEqual([]);
 });
 it('keeps the real pending UUID/payload through reconnect and replays only that request on explicit recovery',async()=>{
  await planned();transport.uncertain=true;
  fireEvent.click(screen.getByRole('button',{name:'Criar 1 Carga(s)'}));
  await screen.findByRole('button',{name:'Recuperar criação'});
  expect(transport.delivered).toHaveLength(1);
  const original=structuredClone(transport.delivered[0]);
  const saved=readPendingLoadCreations(localStorage,scope.tenant,scope.actor,'grouped');
  expect(saved).toHaveLength(1);expect(saved[0].payload.request_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(saved[0].payload).toEqual(original);
  expect(original).toMatchObject({tenant_id:scope.tenant,changes:{destination:combined,vehicle_id:null,driver_id:null}});
  await network(false);expect(readPendingLoadCreations(localStorage,scope.tenant,scope.actor,'grouped')).toEqual(saved);
  expect(transport.delivered).toHaveLength(1);
  await network(true);await screen.findByRole('button',{name:'Recuperar criação'});
  expect(transport.delivered).toHaveLength(1);expect(readPendingLoadCreations(localStorage,scope.tenant,scope.actor,'grouped')).toEqual(saved);
  transport.uncertain=false;fireEvent.click(screen.getByRole('button',{name:'Recuperar criação'}));
  await waitFor(()=>expect(transport.delivered).toHaveLength(2));
  expect(transport.delivered[1]).toEqual(original);expect(transport.committed.size).toBe(1);
  await waitFor(()=>expect(readPendingLoadCreations(localStorage,scope.tenant,scope.actor,'grouped')).toEqual([]));
 });
});
