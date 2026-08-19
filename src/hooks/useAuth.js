import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
const AuthContext = createContext({
    user: null,
    session: null,
    loading: true,
    backendUnavailable: false,
    signOut: async () => { },
});
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [backendUnavailable, setBackendUnavailable] = useState(false);
    useEffect(() => {
        let settled = false;
        const finish = (opts) => {
            if (settled)
                return;
            settled = true;
            if (opts?.unavailable)
                setBackendUnavailable(true);
            setLoading(false);
        };
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            setBackendUnavailable(false);
            finish();
        });
        supabase.auth.getSession()
            .then(({ data: { session }, error }) => {
            if (error) {
                console.warn('[useAuth] getSession error', error);
                finish({ unavailable: true });
                return;
            }
            setSession(session);
            setUser(session?.user ?? null);
            finish();
        })
            .catch((err) => {
            console.warn('[useAuth] getSession failed', err);
            finish({ unavailable: true });
        });
        // Safety timeout: never leave the app stuck on "Carregando..." if Supabase
        // Auth/DB is degraded (504 refresh, DB context canceled, etc.).
        const timer = setTimeout(() => finish({ unavailable: true }), 8000);
        return () => {
            clearTimeout(timer);
            subscription.unsubscribe();
        };
    }, []);
    const signOut = async () => {
        try {
            await supabase.auth.signOut();
        }
        catch (e) {
            console.warn('[useAuth] signOut failed', e);
        }
        localStorage.removeItem('agvlog_tenant_id');
    };
    return (_jsx(AuthContext.Provider, { value: { user, session, loading, backendUnavailable, signOut }, children: children }));
}
export function useAuth() {
    return useContext(AuthContext);
}
