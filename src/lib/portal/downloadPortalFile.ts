import { supabase } from '@/integrations/supabase/client';

export interface PortalDownloadedFile {
  blob: Blob;
  filename: string;
}

export async function downloadPortalFile(body: {
  tenant_id: string;
  resource_type: 'cte' | 'nfse' | 'financial_title';
  resource_id: string;
  parent_id?: string;
  format: 'pdf' | 'xml';
  fallbackFilename: string;
}): Promise<PortalDownloadedFile> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal-download-file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      'x-agvlog-tenant-id': body.tenant_id,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('O arquivo não está disponível ou sua permissão mudou.');
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || body.fallbackFilename;
  return { blob: await response.blob(), filename };
}
