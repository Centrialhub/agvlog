import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
        Torne operational_events a fonte canônica de eventos logísticos. Incidents será gestão de caso vinculada; delivery_occurrences ficará como legado/projeção até migração. Unifique criação, classificação, resolução e anexos em RPCs idempotentes. POD deve ser imutável e versionado, com foto, assinatura, recebedor, geolocalização, hash e vínculo à parada/documentos; correções geram nova versão. Crie timeline única carga→viagem→parada→documento→evento→POD usada por operação, motorista e portal. Migre com dry-run e teste duplicidade.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
