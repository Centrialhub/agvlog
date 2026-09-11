import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render,screen} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {DriverAppObservabilityPanel} from '@/components/driver/DriverAppObservabilityPanel';

const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));

describe('operational driver app health panel',()=>{
  it('shows build, queue, document conflicts and categorized geofence errors',async()=>{
    rpc.mockResolvedValue({error:null,data:{generated_at:'2026-09-10T12:00:00Z',total_devices:2,active_24h:1,
      geofence_errors:{invalid_position:3,tracker_identity:2,temporal_binding:1,address_resolution:4,processing:5},devices:[{
        installation_code:'abc12345',actor_code:'def67890',app_version:'1.0.0',build_hash:'a'.repeat(16),
        last_successful_sync_at:'2026-09-10T11:00:00Z',outbox:{total:2,by_state:{queued:1,needs_attention:1},
          by_kind:{delivery:1,arrival:1}},document_conflicts:1,geofence_errors:{outside_geofence:1},seen_at:'2026-09-10T11:30:00Z',
        upload_failures:{total:2,affected_items:1,by_kind:{delivery:2}},
      }]}});
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><DriverAppObservabilityPanel/></QueryClientProvider>);
    expect(await screen.findByText('abc12345')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Posição inválida')).toBeInTheDocument();
    expect(screen.getByText('Identidade do rastreador')).toBeInTheDocument();
    expect(screen.getByText('1 docs')).toBeInTheDocument();
    expect(screen.getByText('2 upload')).toBeInTheDocument();
    expect(screen.getByText('Entrega 1 · Chegada 1')).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('get_driver_app_observability_v1',{_tenant_id:'tenant'});
    client.clear();
  });
});
