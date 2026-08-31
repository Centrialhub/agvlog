# Conversas por ocorrência — contrato recuperável

Estado: implementação local não publicada, dependente do contrato de chat direto. Não equivale à liberação do aplicativo em produção.

## Reproduções e solução

Seis testes executam as políticas reais consolidadas de 25/08, com os helpers MFA de 28/08. A linha de base aceita nome informado pelo cliente, rótulo de papel administrativo incompatível, vínculo tenant/evento inconsistente, duplicação no reenvio e leitura/envio após revogação da membership do motorista. Também permite que o novo motorista da viagem leia mensagens de ocorrência ainda atribuída explicitamente ao motorista anterior. Controles negativos negam outro motorista não relacionado e administrador sem MFA. Não houve reprodução contra produção nem comprovação de exploração histórica.

A nova associação considera primeiro o motorista explícito da ocorrência. Só usa viagem/parada quando esse vínculo não existe, verificando tenant e coerência das referências. O novo motorista de uma viagem não recebe por consequência a conversa do motorista anterior. Uma política restritiva de SELECT aplica a mesma fronteira à tabela de ocorrências, além da proteção das mensagens. O detalhe do motorista consulta apenas os campos exibidos, dentro da empresa atual; não precisa mais ignorar ocorrências válidas vinculadas somente à viagem/parada.

Cada mensagem nova registra motorista e usuário destinatário naquele momento. Trocar a atribuição da ocorrência ou o usuário do cadastro não transfere automaticamente o histórico. A operação conserva o histórico autorizado. Ocorrência sem motorista permite discussão interna, identificada na tela; atribuir um motorista depois não torna essas mensagens internas visíveis a ele. Destinatário atribuído, mas inativo ou com acesso revogado, não recebe novos envios.

Identidade, papel e nome vêm do servidor. Owner/admin precisam de AAL2. As três RPCs públicas são SECURITY INVOKER; implementações ficam em `driver_chat_private`, fora dos schemas expostos. Grants são explícitos; escrita direta antiga deixa de ser uma API autorizada. Não se altera o conteúdo de mensagens legadas. Histórico sem destinatário comprovado permanece apenas com a operação, sem inferir que pertence ao usuário atual.

Requisição durável, hash do corpo e revisão de contexto permitem recuperar a confirmação exata. Locks compartilhados com conflito imediato protegem membership, ocorrência, parada, viagem, motorista e destinatário; a autorização é refeita após a espera da chave. Falha tardia não deixa uma mensagem parcial. Enviar mensagem não resolve ocorrência, baixa carga, emite documento nem gera pagamento.

## Integração das telas

- `DriverIssues`: conversa na janela de ocorrência, erros de lista explícitos, cache por empresa/ator/motorista e recuperação acessível dentro da própria janela.
- `DriverEventDetail`: conversa no detalhe, consulta com campos mínimos, estados de carregamento/erro e nova tentativa real.
- `OperationalEvents`: conversa da ocorrência usa o mesmo componente; filtros e demais ações foram preservados.
- Chat direto e chat por ocorrência compartilham a recuperação, mas validam identificadores distintos. Confirmação de outra ocorrência é recusada. Um comando pendente não é sobrescrito ao navegar para outra conversa.
- O rascunho só é limpo quando corresponde ao envio confirmado; texto novo é preservado. A janela tem título e descrição acessíveis, verificados no teste renderizado.

A primeira checagem de tipos encontrou o segundo consumidor antigo em DriverIssues; ele foi corrigido, em vez de manter um adaptador que continuasse permitindo papel/nome fornecidos pelo cliente. A busca posterior não encontrou consumidores do envio antigo no frontend/Edge Functions locais. Clientes externos continuam exigindo inventário antes de publicar.

## Verificação

- 35 testes específicos: seis de linha de base, 18 SQL e 11 de frontend ligado ao SQL real em fixture.
- Regressão focada de chat direto e contratos de ocorrência sem parada específica aprovada.
- Versão final: **274 cenários PostgreSQL 17.11 nativos aprovados**, 267 anteriores e sete desta etapa. A repetição confirmou o hash final abaixo; processo encerrado com código zero e cluster descartável parado (sessão 53202).
- Concorrência nativa: reenvio idêntico, mudança da atribuição com lock, revogação durante espera, troca do motorista da viagem, troca da conta do motorista e rollback de falha tardia. Snapshots das dez tabelas operacionais/financeiras acompanhadas preservam os registros anteriores; as novas entidades sintéticas de ocorrência/viagem/parada usadas para ensaiar atribuições são excluídas da comparação de registros anteriores.
- Gate completo aprovado: **2.267 testes em 190 arquivos**, tipos, lint, qualidade, 41 verificações de sintaxe Edge Functions, build e scanner de artefatos públicos (sessão 49778, código zero). Build em 18,63 s, maior chunk 488,3 KiB e index 353,4 KiB. A cobertura de 93,03% de linhas refere-se ao subconjunto instrumentado, não ao aplicativo inteiro.
- O inventário estático inicialmente não reconheceu os grants dentro de um bloco SQL. Cada grant/revogação foi escrito explicitamente, sem ampliar permissões nem flexibilizar o teste. Os 66 testes de SQL, frontend e inventário passaram após esse ajuste.
- Advisors locais não puderam conectar a `127.0.0.1:54322`; a stack Supabase completa não está disponível. O PostgreSQL portátil não substitui Auth/Storage/PostgREST/Realtime reais.
- Nova tentativa de conexão com o navegador falhou antes de inicializar a sessão; nenhuma página, autenticação ou configuração hospedada foi acessada. A biblioteca local está presente, mas o runtime do navegador não iniciou.
- Nenhum novo deploy, emissão fiscal, pagamento ou serviço pago foi ativado. SSX permanece inativo.

Migração: `supabase/migrations/20260830224344_make_event_chat_recoverable.sql`.
SHA-256 final: `fb3c759e5112f2bf02fc66255cc40d14adcdf9cb02135fcc5fc9b6f7d2777bda`.

Dependência de chat direto: `20260830221527_make_driver_chat_recoverable.sql`, hash `70ed39766a83b80c49c651fce9b592997735c1ab63feb754036f863f36775fa4`, preservado. Criação de despesas: hash `bdcf404396ed97340051f8c30a9d6ab21fde917b247066efb2ab8fd5818d91d7`, preservado.

## Limites e próximos critérios de liberação

Anexos ainda precisam de fluxo privado verificável; URLs legadas não são expostas pelo novo contrato. Falta reconciliar destinatários históricos, ensaiar contenção/retomada, conferir policies/ACLs/consumidores reais e executar E2E autenticado nos dois papéis. A publicação deve coordenar banco e frontend: o código novo depende das duas migrações, e fechar a escrita legada enquanto telas antigas continuam ativas quebraria o chat.

Os testes demonstram comportamento em fixtures locais, não entregas reais por Realtime nem prontidão integral da produção. A revisão individual das funções privilegiadas, MFA das APIs financeiras, Auth hospedado, fiscal, GPS e demais P1/P2 continua no objetivo.

As skills Supabase/Postgres orientaram a fronteira RLS, os privilégios privados e os ensaios de locks/revogação. React orientou o reaproveitamento do componente com cache e recuperação isolados por sessão/conversa. Referências: [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [MFA Supabase](https://supabase.com/docs/guides/auth/auth-mfa), [locks PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS).
