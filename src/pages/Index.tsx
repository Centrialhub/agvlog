import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
        Consolide clientes, remetentes, destinatários, motoristas, funcionários, veículos e unidades. Defina identificadores canônicos, normalização de CPF/CNPJ, placa, e-mail e telefone, regras de merge e aliases legados. Elimine correspondência por nome e relações ambíguas. Centralize vínculos usuário-cliente, motorista-usuário, veículo-motorista e unidade-tenant em RPCs auditadas. Crie diagnóstico de duplicados e merge seguro por lote aprovado, preservando referências. Adicione constraints e testes cross-tenant sem tocar na emissão fiscal.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
