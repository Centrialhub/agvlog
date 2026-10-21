# Conta única de motorista na AGV e LIRA — 19/10/2026

## Escopo e preservação

Uma criação por qualquer empresa reserva a identidade canônica em
`workspace_person_tenant_links` e vincula uma UUID Auth aos cadastros existentes
ativos das empresas autorizadas na mesma operação. Nenhum cadastro é criado,
apagado, fundido ou alterado em seus dados de negócio. Não há associação por
similaridade de nome ou CPF, nem compartilhamento entre workspaces.

A reserva e o consumo validam administrador ativo em cada empresa destinatária,
locks de pessoa/cadastros/memberships e a lista exata reservada. O vínculo especial
só existe durante o INSERT Auth autorizado por nonce: o BEFORE vincula a reserva
privada a `NEW.id`; o AFTER cria os vínculos e consome a autorização na mesma
transação. Os guards continuam bloqueando anexação ou troca manual depois disso.
Metadados de usuário não são autoridade. Owner/ACL/RLS e contratos existentes são
preservados. A Edge publicada continua usando a mesma assinatura e resposta.

No aplicativo, o seletor Empresa usa `activateTenantId`, espera a confirmação do
contexto assinado e volta para `/driver`, evitando manter uma rota de viagem da
empresa anterior. A troca fica indisponível offline ou enquanto outra ocorre.

## Coordenação

Thomaz autorizou explicitamente reconciliar a publicação do DOT. Sob lock do
coordenador, fonte `26217ef1` e publicação `a90eb6cc`, de árvore idêntica
`be77b5f9`, foram preservadas como pais da reconciliação `ea6dc9c3`. As 110 tarefas
foram preservadas. Backup e recibo: `F:/AGVLOG/checks/reconcile-dot-publication-20261019-*.json`.
Nenhuma alteração de produção ocorreu nessa etapa. A task própria é
`driver-shared-account-20261019`, owner `CodexDriverShared`, com preflight aprovado.

## Validações confirmadas até aqui

- 49 testes direcionados passaram: criação em ambos os sentidos, invariantes de
  cadastro/histórico, consumo da reserva, rejeição de segunda identidade,
  bloqueio de anexação e isolamento de acesso existente, seleção de empresa.
- Postgres 17.6 nativo isolado, sem rede, com fixture sintética: criação por AGV
  e por LIRA resultou em uma identidade, dois vínculos de motorista, duas
  memberships driver e uma membership de workspace; dados de negócio iguais.
- Duas sessões nativas concorrentes: a primeira manteve a criação aberta; a
  segunda foi recusada após a primeira vencer, sem segunda identidade persistida.
- A fixture usa as definições atuais das quatro funções exportadas por leitura
  de produção, com seus hashes em `src/test/helpers/driverSharedAccountProductionBefore.json`.
  É um grafo parcial sintético, não o baseline integral nem um teste GoTrue.
- Os dois manifestos históricos permanecem intactos. O suplemento acrescenta a
  migration CLI `20261019171216`; o plano de execução aceita a extensão exata de
  43 forwards e continua validando separadamente o prefixo histórico de 42.

Logs nativos e resultados de gates em `F:/AGVLOG/checks/driver-shared-*`.
Não houve aplicação da migration, deploy, criação de credenciais reais ou
alteração de cadastro em produção nesta implementação até este registro.

## Gates e aceite pendentes

Concluir validação geral, suíte completa e build no SHA final. Homologação do
fluxo completo deve cobrir criação pela API publicada, login real, seleção AGV →
LIRA → AGV com identidade e contexto corretos, tentativa de duplicata,
preservação dos 46 registros e exclusão somente da identidade de teste.
Os testes locais acima não conferem esse aceite autenticado de produção.

## Retorno

Guardar as definições anteriores e seus ACLs. Restaurar individualmente as quatro
funções somente após conferir os hashes atuais e as dependências; não restaurar
banco ou Storage. Contas compartilhadas já criadas precisam manter seus vínculos
e credenciais: o guard predecessor já suporta atualização de identidades de
workspace existentes. Suspender novas criações durante qualquer retorno para
não reintroduzir contas isoladas por empresa. Não apagar cadastros nem históricos.
