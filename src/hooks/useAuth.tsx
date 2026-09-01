import { createContext, useContext, useState, useEffect, useRef, useCallback, Fragment, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {resetNotificationScope} from '@/lib/notificationScope';
import { clearDriverRouteSnapshots } from '@/lib/driver/offlineRouteSnapshot';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  backendUnavailable: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  backendUnavailable: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const current = useRef<Session | null>(null);
  const initialized = useRef(false);
  const revision = useRef(0);

  const acceptSession = useCallback((next: Session | null) => {
    if (!initialized.current || current.current?.user.id !== next?.user.id) {
      // clear() cancels reads, not server-side writes. Durable outboxes must survive.
      queryClient.clear();
      resetNotificationScope();
      if (initialized.current) {
        try { localStorage.removeItem('agvlog_tenant_id'); } catch { /* optional preference */ }
        clearDriverRouteSnapshots();
      }
    }
    initialized.current = true;
    current.current = next;
    setSession(next);
    setBackendUnavailable(false);
    setLoading(false);
  }, [queryClient]);

  useEffect(() => {
    let active = true, settled = false;
    const finish = (opts?: { unavailable?: boolean }) => {
      if (!active || settled) return;
      settled = true;
      if (opts?.unavailable) setBackendUnavailable(true);
      setLoading(false);
    };

    const initialRevision = revision.current;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        revision.current += 1;
        acceptSession(session);
        finish();
      }
    );

    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (!active || revision.current !== initialRevision) return;
        if (error) {
          console.warn('[useAuth] getSession error', error);
          finish({ unavailable: true });
          return;
        }
        acceptSession(session);
        finish();
      })
      .catch((err) => {
        if (!active || revision.current !== initialRevision) return;
        console.warn('[useAuth] getSession failed', err);
        finish({ unavailable: true });
      });

    // Safety timeout: never leave the app stuck on "Carregando..." if Supabase
    // Auth/DB is degraded (504 refresh, DB context canceled, etc.).
    const timer = setTimeout(() => finish({ unavailable: true }), 8000);

    return () => {
      active = false;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [acceptSession]);

  const signOut = async () => {
    const requestedRevision = revision.current;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      // Do not let completion of A's request sign B out of the local UI.
      if (revision.current === requestedRevision) {
        revision.current += 1;
        acceptSession(null);
      }
    } catch {
      toast({ title: 'Não foi possível sair da conta', description: 'A saída não foi confirmada. Verifique a conexão e tente novamente.', variant: 'destructive' });
    }
  };

  return (
    <AuthContext.Provider value={{ user: session?.user ?? null, session, loading, backendUnavailable, signOut }}>
      <Fragment key={session?.user.id ?? 'signed-out'}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
