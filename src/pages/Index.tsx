import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">AGVLog - Sistema de Gestão Logística</h1>
      <p className="max-w-2xl text-muted-foreground">
        Torne os gates reais. Troque typecheck por tsc -b ou tsc -p tsconfig.app.json; ele deve verificar todo src e falhar nos erros atuais. Substitua schema-check.py mockado por validação efetiva do schema/migrations e remova mensagens fixas de sucesso. Faça o linter analisar .ts e .tsx, todas as tabelas canônicas e todas as migrations novas, sem whitelist ampla ou retorno após o primeiro erro. Corrija os erros encontrados, incluindo assinaturas RPC incompatíveis. Só conclua com saída integral de typecheck, lint, testes, build, aplicação limpa das migrations e execução do guardrail; não declare verde sem executar.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;