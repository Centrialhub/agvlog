import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-sm font-mono whitespace-pre-wrap max-w-4xl mx-auto leading-relaxed text-gray-800">
      Feche a estabilização do AGVLog com reconciliação e rollout seguro. Crie jobs idempotentes que comparem relações canônicas, status fiscal local versus Hub, viagens/cargas/paradas, PODs, documentos sem vínculo e callbacks pendentes, gerando fila de correção sem alterar dados silenciosamente. Adicione correlationId, audit log estruturado, métricas e painel de falhas por tenant, endpoint, status e idade da pendência, sem segredos ou payloads sensíveis. Implemente smoke tests ponta a ponta para cadastro/importação, planejamento, despacho, motorista, entrega, portal, faturamento, CT-e/NFS-e/MDF-e, cancelamento e arquivos. Use feature flags e rollout por tenant; cada fase precisa de rollback documentado. Atualize docs/data-contract.md, matriz de permissões, runbook fiscal e checklist operacional. Remova adapters apenas após comprovar que não há leitores legados. Entregue relatório de migrations, testes executados, riscos restantes e evidências; não declare sucesso com testes ignorados.
    </div>
  );
};

export default Index;
