import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">AGVLog - Sistema de Gestão Logística</h1>
      <p className="max-w-2xl text-muted-foreground">
        Depois dos gates e da segurança, consolide somente cargas e despacho; não avance para motorista, portal ou financeiro. Use load_items como composição canônica, dispatch_trip_loads como viagem-carga e dispatch_stop_documents como parada-documento. Corrija nomes conforme o schema real, remova views/RPCs inválidas e todo acesso frontend direto a loads, load_items, dispatch_trips, dispatch_stops e relações. Implemente RPCs transacionais, idempotentes e tenant-scoped para vincular, mover, planejar e transicionar estados, com optimistic locking e auditoria. Corrija mirrors sem perder carga primária e prove com testes de múltiplas cargas, concorrência, rollback e cross-tenant.
      </p>
      <div className="pt-4 text-sm text-muted-foreground max-w-2xl">
        Desative temporariamente as novas camadas de motorista, portal, ledger e Data Quality que estejam inválidas, restaurando o último fluxo funcional sem apagar dados. Não deixe placeholders: execute_data_repair_v1 não pode marcar lote como concluído sem reparar itens. Reparos exigem itens explícitos, dry-run, before/after, aprovador diferente, transação e resultado por item. Remova chamadas RPC com parâmetros inexistentes, não reutilize lista de motoristas como lista de funcionários e restaure contratos tipados. Mantenha essas áreas atrás de feature flags até seus schemas, testes e fluxos ponta a ponta serem reconstruídos após a consolidação do núcleo.
      </div>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
