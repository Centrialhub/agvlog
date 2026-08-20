import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-sm font-mono whitespace-pre-wrap max-w-4xl mx-auto leading-relaxed text-gray-800">
      Estabilize as fontes de verdade do AGVLog. Use exclusivamente load_items para carga–documento, dispatch_trip_loads para viagem–carga e dispatch_stop_documents para parada–documento. Campos legados como fiscal_documents.load_id, loads.trip_id e dispatch_trips.load_id podem existir só como mirrors temporários, nunca como regra de negócio. Separe estado fiscal de estado logístico: emissão no Hub, carga, viagem, parada e entrega devem ter enums e transições próprias. Proíba escrita direta de status pela UI; crie RPCs transacionais, idempotentes e auditadas. Remova implementações .js/.tsx duplicadas, defina allowJs=false e ajuste imports. Faça migration forward-only, backfill com relatório de ambiguidades e adapters temporários claramente marcados. Adicione testes de invariantes, transições inválidas, rollback e isolamento por tenant. Atualize docs/data-contract.md e só conclua com build, typecheck e testes verdes.
    </div>
  );
};

export default Index;
