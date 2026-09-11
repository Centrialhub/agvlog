import {useQuery} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useTenant} from '@/hooks/useTenant';
import type {Json} from '@/integrations/supabase/types';

export interface WorkspaceSsxAccount{
  id:string;
  tenant_id:string;
  workspace_id:string;
  provider:string;
  base_url:string;
  username:string;
  status:string;
  settings:Json;
  last_login_at:string|null;
  last_error:string|null;
  created_at:string;
  updated_at:string;
  token_expires_at:string|null;
  migration_state:'ready'|'needs_resolution';
}

export function useWorkspaceSsxAccounts(enabled=true){
  const {currentTenant}=useTenant();
  return useQuery({
    queryKey:['workspace_ssx_accounts',currentTenant?.id],
    queryFn:async()=>{
      if(!currentTenant)return [];
      const {data,error}=await supabase.rpc('get_workspace_ssx_accounts_v1',{_tenant_id:currentTenant.id});
      if(error)throw error;
      return (data||[]) as WorkspaceSsxAccount[];
    },
    enabled:enabled&&!!currentTenant,
    retry:false,
  });
}
