import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

const PREFERENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function useUserUiPreference<T>(preferenceKey: string, defaultValue: T) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['user_ui_preference', user?.id, preferenceKey],
    queryFn: async () => {
      if (!user) return defaultValue;
      const { data, error } = await (supabase as any)
        .from('user_ui_preferences')
        .select('preference_value, updated_at')
        .eq('user_id', user.id)
        .eq('preference_key', preferenceKey)
        .maybeSingle();
      if (error) throw error;
      if (data?.updated_at && Date.now() - new Date(data.updated_at).getTime() > PREFERENCE_MAX_AGE_MS) {
        await (supabase as any)
          .from('user_ui_preferences')
          .delete()
          .eq('user_id', user.id)
          .eq('preference_key', preferenceKey);
        return defaultValue;
      }
      return (data?.preference_value || defaultValue) as T;
    },
    enabled: !!user,
  });

  const mutation = useMutation({
    mutationFn: async (preferenceValue: T) => {
      if (!user) return;
      const { error } = await (supabase as any)
        .from('user_ui_preferences')
        .upsert({
          user_id: user.id,
          preference_key: preferenceKey,
          preference_value: preferenceValue,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,preference_key' });
      if (error) throw error;
    },
  });

  return {
    preference: query.data ?? defaultValue,
    isLoaded: query.isSuccess || !user,
    savePreference: mutation.mutate,
  };
}