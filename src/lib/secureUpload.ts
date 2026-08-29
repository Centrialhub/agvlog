import { supabase } from '@/integrations/supabase/client';
import { getCorrelationId } from '@/lib/observability/correlation';
import { type UploadKind, validateUploadContent } from '@/lib/uploadPolicy';

interface SecureUploadRequest {
  tenantId: string;
  bucket: 'receipts' | 'occurrence-return-proofs' | 'pallet-return-proofs';
  folder: string;
  file: File;
  kind: UploadKind;
}

export async function uploadSecureFile(request: SecureUploadRequest): Promise<string> {
  await validateUploadContent(request.file, request.kind);
  const form = new FormData();
  form.set('tenant_id', request.tenantId);
  form.set('bucket', request.bucket);
  form.set('folder', request.folder);
  form.set('kind', request.kind);
  form.set('file', request.file, request.file.name);

  const { data, error } = await supabase.functions.invoke('secure-upload', {
    headers: { 'x-correlation-id': getCorrelationId() },
    body: form,
  });
  if (error) throw new Error('O upload seguro falhou. Tente novamente ou acione o suporte.');
  if (!data || typeof data.path !== 'string') throw new Error('O gateway de upload retornou uma resposta inválida.');
  return data.path;
}

export async function removeSecureFiles(
  tenantId: string,
  bucket: SecureUploadRequest['bucket'],
  paths: string[],
) {
  if (paths.length === 0) return;
  const { error } = await supabase.functions.invoke('secure-upload', {
    headers: { 'x-correlation-id': getCorrelationId() },
    body: { action: 'cleanup', tenant_id: tenantId, bucket, paths },
  });
  if (error) throw new Error('Não foi possível remover os arquivos órfãos com segurança.');
}
