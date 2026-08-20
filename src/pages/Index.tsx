import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-sm font-mono whitespace-pre-wrap max-w-4xl mx-auto leading-relaxed text-gray-800">
      Reconstrua o fluxo do aplicativo do motorista usando as relações canônicas e sem updates diretos de status. Crie uma RPC de workspace que retorne viagens atribuídas ao usuário, cargas via dispatch_trip_loads, paradas, documentos via dispatch_stop_documents e itens via load_items. Implemente comandos transacionais e idempotentes para iniciar viagem, chegar, iniciar atendimento, entregar, recusar, registrar parcial, despesa e concluir. Valide motorista, tenant, sequência e máquina de estados; nunca marque entregue quando faltarem relações ou resultados. Registre resultado por documento/item, motivo, quantidade, recebedor, geolocalização e horário. POD deve ser imutável/versionado; evite arquivos órfãos. Adicione outbox offline com idempotency key, retry e resolução de conflito. A UI deve mostrar pendências e erros reais. Teste duplo toque, offline/online, carga múltipla, parcial, recusa, POD e tentativa cross-tenant.
    </div>
  );
};

export default Index;
