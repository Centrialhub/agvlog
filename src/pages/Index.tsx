import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
        Consolide o núcleo operacional: dispatch_trip_loads será a relação canônica viagem-carga; dispatch_stop_documents, parada-documento; dispatch_stops, execução. loads.trip_id e dispatch_trips.load_id serão apenas espelhos controlados. Remova UNIONs e fallbacks que misturam relações. Crie RPC transacional para planejar, despachar e iniciar viagem e um read model workspace com viagem, cargas, paradas, documentos, motorista e veículo. Migre os chamadores e valide tenant, ownership, versão e idempotência.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
