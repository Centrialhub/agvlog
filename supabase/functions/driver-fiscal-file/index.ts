import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { withFiscalCors } from '../_shared/fiscal-cors.ts';
import { handleDriverFiscalFile } from './handler.ts';

Deno.serve(withFiscalCors(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = Deno.env.get('SUPABASE_URL')!;
  const auth = { persistSession: false, autoRefreshToken: false };
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth, global: { headers: { Authorization: req.headers.get('authorization') || '' } },
  });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth });
  return handleDriverFiscalFile(req, caller, admin, corsHeaders, { env: name => Deno.env.get(name) });
}));
