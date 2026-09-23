import { getErrorMessage } from '@/lib/errors';

type LoadDocumentCandidate = {
  load_id?: string | null;
  status?: string;
  deleted_at?: string | null;
  current_delivery_attempt_id?: string | null;
  cte_emitted_at?: string | null;
  cte_emitted_outbound_id?: string | null;
  nfse_emitted_at?: string | null;
};

export const isIssuedLoadDocument = (document: LoadDocumentCandidate) =>
  !!(document.cte_emitted_at || document.cte_emitted_outbound_id || document.nfse_emitted_at);
export const canSelectDocumentForNewLoad = (document: LoadDocumentCandidate) => !document.load_id && !document.deleted_at
  && (!document.status || document.status === 'confirmed')
  && !(document.current_delivery_attempt_id && isIssuedLoadDocument(document));

export const getNewLoadCreationErrorMessage = (error: unknown) => {
  const message = getErrorMessage(error);

  if (message.includes('document_already_linked')) {
    return 'Uma das notas já está vinculada a outra carga. Abra a carga atual e use a opção de mover ou replanejar a nota.';
  }
  if (/selected_document_not_found|selected_document_not_available/.test(message)) {
    return 'Uma das notas selecionadas não está mais disponível. Atualize a lista e tente novamente.';
  }
  if (/replanning_requires_fiscal_review|replanning_has_delivery_evidence/.test(message)) {
    return 'Uma nota possui operação anterior ou evidência de entrega. Revise o histórico antes de vinculá-la a outra carga.';
  }
  if (/request_payload_mismatch|legacy_load_creation_requires_review/.test(message)) {
    return 'Este pedido já foi utilizado. Confira a carga criada ou recupere o pedido original antes de enviar outra criação.';
  }

  return message;
};
