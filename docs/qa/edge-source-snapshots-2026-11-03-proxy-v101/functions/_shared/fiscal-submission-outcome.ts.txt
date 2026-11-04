type Data = Record<string, unknown>;
const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};

/** A provider message or HTTP 502 alone does not attest that transmission never happened. */
export function isConfirmedSubmissionFailure(value: unknown): boolean {
  const response = record(value), document = record(response.document), error = record(response.error ?? document.error);
  // success belongs to the HTTP operation: GET uses true and callbacks omit it.
  const facts = { ...document, ...response };
  const consistent = ['processing', 'terminal', 'requiresReconciliation', 'submissionOutcome']
    .every(key => !(key in response && key in document) || response[key] === document[key]);
  return consistent && facts.processing === false && facts.terminal === true
    && facts.requiresReconciliation === false && document.status === 'error'
    && (facts.submissionOutcome === undefined || facts.submissionOutcome === 'not_submitted')
    && typeof document.id === 'string' && document.id.length > 0
    && typeof document.idIntegracao === 'string' && document.idIntegracao.length > 0
    && error.submissionOutcome === 'not_submitted'
    && error.automaticRetry === false;
}

/** Use the committed state: callbacks may supersede the HTTP receipt. */
export function fiscalOperationResponse(committed: Data, response: unknown, recovered = false) {
  const receipt = record(response), provider = record(receipt.document);
  const status = String(committed.status || '');
  const confirmedFailure = status === 'error' && committed.dispatch_state === 'recorded'
    && isConfirmedSubmissionFailure(committed.last_response);
  const rejected = ['rejected', 'denied', 'inutilized'].includes(status) && committed.dispatch_state === 'recorded';
  const requiresReconciliation = !confirmedFailure && (committed.dispatch_state === 'uncertain'
    || ['provider_unknown', 'interrupted', 'error'].includes(status));
  const processing = requiresReconciliation || ['pending', 'draft', 'processing', 'transmitting', 'submitted', 'queued', 'cancel_processing'].includes(status);
  const submissionOutcome = confirmedFailure ? 'not_submitted' : requiresReconciliation ? 'unknown'
    : ['processing', 'authorized', 'rejected', 'denied', 'cancelled', 'inutilized', 'cancel_processing', 'cancel_rejected'].includes(status) ? 'accepted' : 'unknown';
  const facts = { processing, terminal: !processing, requiresReconciliation, submissionOutcome };
  const document = { ...provider, ...facts, id: committed.hub_document_id, status, accessKey: committed.access_key,
    authorizationProtocol: committed.authorization_protocol, number: committed.number, series: committed.series,
    pdfUrl: committed.pdf_url, xmlUrl: committed.xml_url, message: committed.message };
  const persisted = record(committed.last_response);
  const failure = confirmedFailure ? record(persisted.error ?? record(persisted.document).error) : rejected ? {
    code: 'FISCAL_DOCUMENT_REJECTED', message: committed.message || 'Documento fiscal rejeitado.', automaticRetry: false,
  } : undefined;
  return {
    status: confirmedFailure ? 502 : rejected ? 422 : processing ? 202 : 200,
    data: { success: !failure, ...facts,
      ...(failure ? { error: failure } : {}), hub: { document, ...(failure ? { error: failure } : {}) },
      emission: { id: committed.id }, recovered },
  };
}
