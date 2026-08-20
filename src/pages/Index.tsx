import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-sm font-mono whitespace-pre-wrap max-w-4xl mx-auto leading-relaxed text-gray-800">
      Corrija o portal do cliente ponta a ponta. Ao carregar, resolva os escopos permitidos; com um único cliente, selecione-o automaticamente, e com vários exija seleção explícita persistida. Centralize uma função de acesso efetivo que aceite vínculo por client_id ou CNPJ/CPF como remetente/destinatário, conforme autorização, sem depois restringir novamente apenas por client_id. Refaça dashboard, rastreamento, próximas entregas, alertas, documentos, canhotos e ocorrências sobre as mesmas RPCs/read models, sempre com tenant, escopo e deleted_at. Não exponha dados de outros clientes nem IDs internos desnecessários. Downloads devem usar URLs assinadas e validar ownership. Diferencie ausência de dados, falta de permissão e erro. Teste usuário com um e vários clientes, remetente, destinatário, documento compartilhado, acesso cruzado negado e consistência entre lista, detalhe e contadores.
    </div>
  );
};

export default Index;
