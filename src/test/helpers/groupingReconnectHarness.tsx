import { useState } from 'react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { AuthProvider,useAuth } from '@/hooks/useAuth';
import { TenantProvider,useTenant } from '@/hooks/useTenant';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';
export const control:{activate?:ReturnType<typeof useTenant>['activateTenantId'];signOut?:()=>Promise<void>}={};
let mounts=0;
function LoadsGroupingState(){
 const [groupingOpen,setGroupingOpen]=useState(false);
 const [instance]=useState(()=>++mounts);
 const tenant=useTenant();const auth=useAuth();const online=useOnlineStatus();
 control.activate=tenant.activateTenantId;control.signOut=auth.signOut;
 return <>
  <output data-testid="scope-state" data-instance={instance}>{auth.user?.id??'signed-out'}:{tenant.currentTenant?.id??'none'}:{tenant.currentRole??'none'}:{online?'online':'offline'}</output>
  <output data-testid="grouping-open">{String(groupingOpen)}</output>
  <button type="button" disabled={!tenant.currentTenant||tenant.loading} onClick={()=>setGroupingOpen(true)}>Agrupar NF-es</button>
  <PendingDocsGrouping open={groupingOpen} onOpenChange={setGroupingOpen} onCreated={()=>undefined}/>
 </>;
}
export function mountGroupingProviders(){
 mounts=0;control.activate=undefined;control.signOut=undefined;
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0,staleTime:0,refetchOnWindowFocus:false},mutations:{retry:false}}});
 const view=render(<QueryClientProvider client={client}><AuthProvider><TenantProvider><LoadsGroupingState/></TenantProvider></AuthProvider></QueryClientProvider>);
 return {client,...view};
}
