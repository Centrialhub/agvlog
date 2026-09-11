import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';

export function DriverOperationalSyncAgent() {
  const sync = useDriverOperationalOffline({ autoRecover: true });
  if (!sync.pending) return null;
  return <div className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900" role="status">
    <span className="min-w-0 flex-1">{sync.pending} ação(ões) da jornada aguardando sincronização.</span>
    <Button type="button" size="sm" variant="outline" className="h-8 bg-white"
      disabled={!sync.online || sync.syncing} onClick={() => void sync.recover(true)}>
      <RefreshCw className={`mr-1 h-3 w-3 ${sync.syncing ? 'animate-spin' : ''}`} />Sincronizar
    </Button>
  </div>;
}
