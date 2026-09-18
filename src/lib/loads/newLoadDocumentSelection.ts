import { getErrorMessage } from '@/lib/errors';

type LoadDocumentCandidate = {
  load_id?: string | null;
};

export const canSelectDocumentForNewLoad = (document: LoadDocumentCandidate) => !document.load_id;

export const getNewLoadCreationErrorMessage = (error: unknown) => {
  const message = getErrorMessage(error);

  if (message.includes('document_already_linked')) {
    return 'Uma das notas já está vinculada a outra carga. Abra a carga atual e use a opção de mover ou replanejar a nota.';
  }
  if (message.includes('selected_document_not_found')) {
    return 'Uma das notas selecionadas não está mais disponível. Atualize a lista e tente novamente.';
  }

  return message;
};
