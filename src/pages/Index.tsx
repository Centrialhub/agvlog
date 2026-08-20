import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-sm font-mono whitespace-pre-wrap max-w-4xl mx-auto leading-relaxed text-gray-800">
      Corrija filtros, buscas e paginação do AGVLog sem filtrar conjuntos parciais no navegador. Crie read models/RPCs server-side para cargas, documentos, faturamento e CT-e, sempre com tenant, deleted_at, permissões, filtros e ordenação aplicados antes da paginação. Use cursor ou paginação estável e retorne rows + total coerente. Remova limites arbitrários, janela padrão oculta de 30 dias, junções client-side entre tabelas e listas hardcoded de notas problemáticas. Normalize busca por número, chave, CNPJ/CPF, nome, placa, romaneio e identificadores, aceitando máscara ou somente dígitos. Todos os filtros exibidos devem atuar sobre campos canônicos e persistir na URL. Estados de vazio, erro e carregamento devem ser distintos. Crie testes com registros fora da primeira página, múltiplos tenants, datas-limite, acentos, máscaras e combinações de filtros. Não altere dados para fazer itens “aparecerem”.
    </div>
  );
};

export default Index;
