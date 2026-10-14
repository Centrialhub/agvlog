import { useEffect } from 'react';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';

type OperationalApi = ReturnType<typeof useDriverOperationalOffline>;
export function DriverOperationalRecoveryProbe({ onReady }: { onReady: (api: OperationalApi) => void }) {
  const api = useDriverOperationalOffline();
  useEffect(() => { onReady(api); }, [api, onReady]);
  return null;
}
