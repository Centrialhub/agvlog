import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
Unifique a roteirização: route_templates e operational_routes representam definições; route_planning_drafts, planejamento; dispatch_trips e dispatch_stops, execução. Crie DTO/read model único e operação transacional que converta rascunho aprovado em viagem, cargas, paradas e documentos sem duplicar vínculos. Refatore mapa, planejamento e central de operações para a mesma execução e estados. Preserve trips como telemetria, sem misturá-la ao despacho. Teste replanejamento, múltiplas cargas, parada removida, concorrência e retomada.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
