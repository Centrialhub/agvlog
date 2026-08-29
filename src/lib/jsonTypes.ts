import type { Json } from '@/integrations/supabase/types';

/** Objeto JSON gerado pelo Supabase; propriedades ausentes são `undefined`. */
export type JsonObject = { [key: string]: Json | undefined };
