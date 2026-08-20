import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-sm font-mono whitespace-pre-wrap max-w-4xl mx-auto leading-relaxed text-gray-800">
      Trabalhe no AGVLog/Logistics Navigator somente na contenção P0. Não altere UI nem faça restauração global. 1) Audite a migration 20260815070209_da1a17dc-d2ad-48c1-a18c-798a87c6feba.sql, que arquivou fiscal_documents sem tenant; crie dry-run, lote auditável e restauração apenas de IDs aprovados, sem editar migration histórica. 2) Torne tenantId obrigatório no hub-fiscal-proxy e valide JWT, membership, capability e ownership antes do service role. 3) Refaça o webhook conforme Hub Fiscal: raw body, HMAC-SHA256(timestamp.corpo), janela de 5 min, deduplicação por delivery e inbox para unmatched/failed. 4) Corrija/revogue RPCs SECURITY DEFINER fiscais sem tenant. Nunca exponha chaves nem aceite callback sem segredo. Entregue migration forward-only, testes cross-tenant, HMAC, replay, idempotência e relatório de arquivos alterados. Não avance se build, typecheck ou testes falharem.
    </div>
  );
};

export default Index;
