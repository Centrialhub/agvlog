import { supabase } from '@/integrations/supabase/client';
import { getCorrelationId } from '@/lib/observability/correlation';
import { type UploadKind, validateUploadContent } from '@/lib/uploadPolicy';

interface SecureUploadRequest {
  tenantId: string;
  bucket: 'receipts' | 'occurrence-return-proofs' | 'pallet-return-proofs';
  folder: string;
  file: File;
  kind: UploadKind;
  evidence?: {
    requestId: string;
    slot: string;
    sha256: string;
  };
}

export async function uploadSecureFile(request: SecureUploadRequest): Promise<string> {
  await validateUploadContent(request.file, request.kind);
  const form = new FormData();
  form.set('tenant_id', request.tenantId);
  form.set('bucket', request.bucket);
  form.set('folder', request.folder);
  form.set('kind', request.kind);
  form.set('file', request.file, request.file.name);
  if (request.evidence) {
    form.set('request_id', request.evidence.requestId);
    form.set('file_slot', request.evidence.slot);
    form.set('sha256', request.evidence.sha256);
  }

  const { data, error } = await supabase.functions.invoke('secure-upload', {
    headers: { 'x-correlation-id': getCorrelationId() },
    body: form,
  });
  if (error) {
    const source=error as {code?:unknown;status?:unknown;context?:Response|{status?:unknown}};
    let gatewayCode:unknown=source.code;
    if(source.context instanceof Response){
      try{const body=await source.context.clone().json() as {error?:unknown};gatewayCode=body.error??gatewayCode;}catch{/* status remains available */}
    }
    const wrapped=Object.assign(new Error('O upload seguro falhou. Tente novamente ou acione o suporte.'),{
      code:typeof gatewayCode==='string'?gatewayCode:undefined,
      status:typeof source.status==='number'?source.status:source.context?.status,
    });
    throw wrapped;
  }
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
