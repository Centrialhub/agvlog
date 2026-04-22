import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export function useUserUiPreference<T>(preferenceKey: string, defaultValue: T) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['user_ui_preference', user?.id, preferenceKey],
    queryFn: async () => {
      if (!user) return defaultValue;
      const { data, error } = await (supabase as any)
        .from('user_ui_preferences')
        .select('preference_value')
        .eq('user_id', user.id)
        .eq('preference_key', preferenceKey)
        .maybeSingle();
      if (error) throw error;
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