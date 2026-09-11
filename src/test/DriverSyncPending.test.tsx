import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DriverSyncPending from '@/pages/driver/DriverSyncPending';

const mocks=vi.hoisted(()=>({
  list:vi.fn(),deliveryList:vi.fn(),expenseList:vi.fn(),deliveryReplay:vi.fn(),expenseReplay:vi.fn(),
  operationalReplay:vi.fn(),invalidate:vi.fn(),toast:vi.fn(),
  discardConflict:vi.fn(),
  rpc:vi.fn(),
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useOnlineStatus',()=>({useOnlineStatus:()=>true}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('@/hooks/useDriverExpensesOperational',()=>({useDriverExpenseSubmission:()=>({
  pending:{data:[]},replay:{mutateAsync:mocks.expenseReplay,isPending:false},
})}));
vi.mock('@/hooks/useDriverOperationalOffline',()=>({useDriverOperationalOffline:()=>({
  recover:mocks.operationalReplay,syncing:false,
})}));
vi.mock('@/lib/driver/driverExpenseOfflineStore',()=>({driverExpenseOfflineStore:{list:mocks.expenseList}}));
vi.mock('@/lib/driver/driverDeliverySubmission',()=>({
  deliveryErrorMessage:(error:unknown)=>String(error),listPendingDeliverySubmissions:mocks.deliveryList,
  replayPendingDeliverySubmissions:mocks.deliveryReplay,invalidateDeliveryQueries:mocks.invalidate,
  discardResolvedDeliverySubmission:mocks.discardConflict,
}));
vi.mock('@/lib/driver/driverOfflineOutbox',()=>({
  DRIVER_OFFLINE_OUTBOX_CHANGED:'agvlog:driver-offline-outbox-changed',driverOfflineOutbox:{list:mocks.list},
}));

const kinds=['delivery','expense','arrival','departure','journey','checklist','occurrence','cargo'] as const;

describe('fila offline unificada do motorista',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    localStorage.clear();mocks.rpc.mockResolvedValue({data:null,error:null});
    mocks.deliveryList.mockResolvedValue([]);mocks.expenseList.mockResolvedValue([]);
    mocks.deliveryReplay.mockResolvedValue({confirmed:1});mocks.expenseReplay.mockResolvedValue({confirmed:1});
    mocks.operationalReplay.mockResolvedValue({confirmed:2});mocks.invalidate.mockResolvedValue(undefined);
    mocks.discardConflict.mockResolvedValue({discarded:true,pending:false});
    mocks.list.mockResolvedValue(kinds.map((kind,index)=>({version:1,id:`request-${index}`,scopeKey:'tenant:actor',tenantId:'tenant',actorId:'actor',
      kind,aggregateId:`aggregate-${index}`,state:index===6?'needs_attention':'queued',payload:kind==='delivery'?{eventKey:'entregue'}:{},files:[],
      attempts:index,lastError:index===6?'Conflito remoto':null,createdAt:'2026-09-10T10:00:00.000Z',updatedAt:'2026-09-10T10:00:00.000Z'})));
  });

  it('exibe todos os tipos e tenta sincronizar cada processador',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    render(<QueryClientProvider client={client}><DriverSyncPending/></QueryClientProvider>);
    for(const label of ['Entrega','Despesa','Chegada','Saída','Jornada','Checklist','Ocorrência','Carga']){
      expect((await screen.findAllByText(new RegExp(label))).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Conflito remoto')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Sincronizar agora'}));
    await waitFor(()=>expect(mocks.deliveryReplay).toHaveBeenCalledWith('tenant','actor'));
    expect(mocks.expenseReplay).toHaveBeenCalledOnce();
    expect(mocks.operationalReplay).toHaveBeenCalledWith(true);
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Sincronização concluída'})));
    client.clear();
  });

  it('removes a fiscal conflict only after the operator explicitly discarded it',async()=>{
    mocks.list.mockResolvedValue([{version:1,id:'a0000000-0000-4000-8000-000000000001',scopeKey:'tenant:actor',tenantId:'tenant',actorId:'actor',
      kind:'delivery',aggregateId:'trip',state:'needs_attention',payload:{eventKey:'entregue',attention:{code:'delivery_fiscal_snapshot_changed'}},
      files:[],attempts:1,lastError:'Documentos realocados',createdAt:'2026-09-10T10:00:00.000Z',updatedAt:'2026-09-10T10:00:00.000Z'}]);
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    render(<QueryClientProvider client={client}><DriverSyncPending/></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Verificar decisão operacional'}));
    await waitFor(()=>expect(mocks.discardConflict).toHaveBeenCalledWith('tenant','actor','a0000000-0000-4000-8000-000000000001'));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Tentativa descartada pela operação'}));
    client.clear();
  });
});
