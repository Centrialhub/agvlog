# Revisão do baseline local — 28/09/2026

**Baseline restaurado às 18:01 UTC; comparação em andamento. Nenhum fluxo da aplicação aprovado.** Fonte e hashes brutos: [captura autoritativa](authoritative-schema-capture-2026-09-28.md). Os SQLs e relatórios detalhados permanecem em armazenamento privado.

## Composição

| Parte | Decisão |
| --- | --- |
| Aplicação | 9.520 blocos dos 13 schemas, preservados por bytes; inclui owners, ACLs, RLS, funções, índices, constraints e nove associações à publicação Realtime. |
| Complemento gerenciado | 58 blocos: três triggers de Auth, seis triggers e 41 policies de Storage, `ensure_rls`, quatro complementos de ACL e três defaults de `supabase_admin`. |
| Extensões | Cinco extensões ausentes, com versões explícitas, e 850 blocos de ACL de `extensions`, `cron` e `vault`; nenhum job ou segredo. |
| Defaults locais | Remover concessões iniciais de `postgres` para `anon`, `authenticated` e `service_role` antes de criar objetos; depois reproduzir os defaults e grants da fonte. |
| Buckets | Oito definições revisadas, todos privados; nenhum arquivo ou objeto de cliente. |
| Ledger | Conservar as 896 versões/nomes como referência externa. Não simular sua execução no ledger da CLI local. |

Os três defaults pertencentes a `supabase_admin` são restaurados com esse papel; a criação do aplicativo usa `postgres`. O gatilho `ensure_rls` também precisa ser criado sob `postgres`, mesmo quando a conexão inicial é `supabase_admin`.

## Revisão de literais

Os scanners e a revisão de candidatos não identificaram JWTs, chaves privadas, senhas, tokens conhecidos, emails ou identificadores de clientes no esquema. As ocorrências de UUID são sentinelas nulas de índices; os números extensos são sentinelas de checks. Um hash literal faz parte do contrato de prontidão financeira e foi preservado.

Existe um endpoint externo padrão em `integration_accounts.base_url`, já presente no baseline histórico. Sua definição foi preservada para permitir comparar o contrato; contas e credenciais de integração devem ser fixtures locais antes de qualquer teste desse fluxo. As ocorrências auditadas de `net.http_*`, agendamento e escrita de Vault são referências em permissões, sem chamadas de execução. O único uso de Vault em função da aplicação é uma leitura em tempo de execução.

Essas verificações são análise lexical e revisão do subconjunto restaurado; não substituem testes de autorização e de fluxos. Não copiar o dump completo de papéis nem o login temporário da CLI.

## Diferenças de plataforma registradas

- `pg_net`: produção **0.20.0**, pacote local **0.20.4**. As outras extensões necessárias estão disponíveis nas mesmas versões. Não chamar essa adaptação de paridade total.
- Auth: quatro tabelas gerenciadas novas e uma coluna de token existentes em produção não estão na imagem local. Não são objetos do aplicativo; preservar o Auth correspondente ao runtime local.
- Storage: duas colunas de ciclo de vida de buckets, duas funções e três gatilhos gerenciados existem apenas em produção. Nenhuma referência a esse conjunto foi encontrada nos schemas da aplicação. O conjunto não é transplantado parcialmente.
- Realtime: preservar a versão local, sem copiar partições datadas, coluna gerenciada adicional ou sua publicação interna. As nove tabelas publicadas da aplicação são reproduzidas.
- Papéis: os atributos dos 16 papéis permanentes coincidem. Quatro memberships locais e owners de três extensões preexistentes diferem; conservar e classificar como plataforma, conferindo autorização efetiva nos testes.

## Primeiro ensaio e correção do procedimento

O preparo real no Linux usou o commit **0fde19fa7e0cf9b940d950a7359d85e44ec8c251** e o manifesto de aprovação SHA-256 **c1c2898ebdefdeccf89e990524aeaab73e1e83fe51a2311f1acd0b57ef3201aa**. O verificador confirmou checkout limpo, nove serviços e zero tabelas públicas.

O primeiro ensaio, em **17:49:34 UTC**, executou os SQLs com `ON_ERROR_STOP` e uma única transação. A criação de `ensure_rls` sob `supabase_admin` falhou: `Superuser owned event trigger must execute a superuser owned function`. A conexão fechou e a transação foi revertida; uma consulta separada confirmou **zero tabelas públicas**. Nenhum forward ou seed foi aplicado.

Em **17:51:03 UTC**, uma sondagem em transação confirmou que `SET ROLE postgres` permite criar função e event trigger com o mesmo owner. A sondagem foi revertida e a ausência de ambos os objetos foi confirmada. A revisão seguinte acrescenta apenas `SET ROLE postgres` / `RESET ROLE` ao bloco original de `ensure_rls`; as definições do gatilho e da aplicação permanecem iguais à fonte.

O procedimento mantém a primeira revisão e seus logs. A aprovação da restauração depende de nova execução completa e comparação por objeto; estes registros não aprovam o candidato ou a produção.

## Correção da consulta de comparação

A revisão encontrou um problema no próprio verificador: o primeiro ramo do `UNION` usava `pg_namespace.nspname`, do tipo PostgreSQL `name`, como chave. Concatenações longas de nomes de objetos eram convertidas para esse tipo e truncadas em 63 bytes, produzindo chaves repetidas. Os hashes agregados anteriores continuam sendo evidência histórica do resultado daquela consulta; não são um mapa inequívoco dos objetos.

A consulta versionada passou a usar `n.nspname::text` nesse primeiro ramo. A comparação da restauração deve usar a nova captura com nomes completos em ambos os ambientes, preservar multiplicidades e apontar categorias inteiras ausentes. Não aceitar um mapa que descarte silenciosamente chaves repetidas. Ordem de ACL, posições históricas de colunas e diferenças gerenciadas devem ser investigadas separadamente, mantendo owners, grantors e privilégios na prova.

Às **17:58:15.692 UTC**, uma consulta somente de leitura confirmou `objectKeyType=text`, **zero chaves duplicadas** e chaves de até **354 bytes** para rotinas. O ledger permaneceu em 896 versões, máximo `20260924155758`. SHA-256 da consulta corrigida: `d537a4ac6e96d6b1e11b8f680038f00a997fa15da165a3ba0035b7d2ba703aac`.

## Segundo ensaio — restauração concluída

Execução entre **18:01:20.365 e 18:01:25.934 UTC**, checkout Linux limpo **4850412c19bec6cc4134fb48e1f9e3b4c1ee65fd**. A [evidência sanitizada](local-baseline-restore-evidence-2026-09-28.json) fixa o hash da aprovação e do SQL combinado efetivamente executado. Os cinco arquivos foram aplicados em uma transação, com `ON_ERROR_STOP`; a conexão inicial foi `supabase_admin` e os papéis de criação foram ajustados nos blocos revisados.

Resultado: **327 tabelas públicas, zero sem RLS, oito buckets, zero jobs de cron, zero segredos no Vault e zero requisições na fila HTTP**. A primeira aprovação e seus artefatos foram preservados. A aplicação permanece sem seed, Auth hook ou Edge habilitados; os 13 forwards não foram aplicados.

O verificador de infraestrutura vazia não se aplica ao banco já restaurado: seu bloqueio por tabelas existentes é esperado. Não remover essa proteção ou zerar o banco para obter sinal verde. A próxima evidência é a comparação completa do catálogo e a evolução explícita do contrato de verificação para essa fase.

## Comparação e ensaio incremental concluídos

O [parecer por objeto](local-baseline-comparison-2026-09-28.md) fechou a comparação anterior aos forwards: equivalência da aplicação no escopo capturado, 85 diferenças de ACL explicadas, 28 colunas ativas de geofences equivalentes, oito CHECKs equivalentes e locale PostgreSQL idêntico. Diferenças gerenciadas continuam limitações explícitas de plataforma.

Os [13 forwards aprovados](local-forward-evidence-2026-09-28.json) foram aplicados entre **18:18:58.340 e 18:18:58.554 UTC**, em uma transação, pelo socket Docker local fixado. Os bytes correspondem ao manifesto. Permaneceram 327 tabelas com RLS, oito buckets e zero usuários, jobs, segredos Vault ou itens de fila HTTP. Não foram fabricados registros de execução do histórico de produção.

O contrato somente de leitura `baseline_contract.sql`, executado em **18:19:31.832–18:19:31.937 UTC**, falhou: `anon can execute 8 public functions` (saída psql 3). São funções internas preexistentes que retornam `trigger`; o resultado não significa oito endpoints RPC utilizáveis. A regra de privilégios continua exigida e será corrigida por forward novo separado, sem modificar a aprovação ou os 13 arquivos já ensaiados. Fixtures de workspace e claims de tenant também exigem atualização antes do pgTAP. Aplicação ainda não homologada.
