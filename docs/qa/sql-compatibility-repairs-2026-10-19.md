# Reparos de compatibilidade SQL — 19/10/2026

## Escopo autorizado

Continuar os 31 achados SQL, preservando APIs, permissões e cadastros, concluir os gates e validar a conta única AGV/LIRA. Fonte inicial integrada: a106c14de5654384bfe6e1fc2b36c07a0f23320b; publicado preservado: a90eb6ccdb5212ab4da9fe2cd48bbf4ad43d1c93.

O [inventário de consumidores](legacy-api-consumer-inventory-2026-10-19.md) permanece válido como limite de observação. Não há decisão de retirar endpoints ou ampliar permissões.

## Ambiente e segurança da validação

Tarefa sql-compatibility-repairs-20261019, owner CodexDriverShared. Ambiente descartável exclusivo: container externo agvlog-sql-compat-20261019, daemon Docker interno distinto, namespace de rede próprio, quatro CPUs e oito GiB. Sem socket do daemon do host. Entrada apenas por portas locais 57331/57527; saída externa bloqueada em OUTPUT/FORWARD IPv4 e IPv6 antes de restaurar SQL.

PostgreSQL 17.6, CLI 2.116.0, Node 22.23.2 e npm 10.9.4. Pacote privado revisado aprovado por SHA-256 501f7c02e647c5c4e6e69267812067cb0a184524f44f9db2a4e5b1853152a649, sem registros produtivos; seed sintético com sete usuários. Nenhuma alteração em produção, no checkout antigo, na tarefa de frete ou no trabalho do DOT.

A primeira restauração foi recusada antes de executar SQL: a imagem descartável tinha Docker em /usr/local/bin/docker, enquanto o verificador exige /usr/bin/docker. Foi instalado um link somente dentro do container próprio. A verificação de infraestrutura vazia passou sem modificar o verificador: zero tabelas públicas, nove serviços, rede exclusiva e bindings locais, PostgreSQL 17.6 e árvore limpa. A retomada usa o restaurador oficial, que repete os preflights; não ignora checks nem reaproveita dados de outro runtime.

## Contratos reparados e evidências do preparo

A migration foi criada pela CLI em diretório de geração isolado: 20261019214029_restore_legacy_sql_contracts.sql. Ela compara OIDs, argumentos/defaults, retornos, atributos, proprietários e ACLs antes/depois dos CREATE OR REPLACE, abortando a transação caso qualquer contrato ou permissão mude. Não cria enums, índices ou colunas nem migra cadastros.

Os reparos tipam os valores segundo o esquema canônico, corrigem nomes de relações/colunas, preservam os comandos auditados e usam resultados dinâmicos tipados em PostGIS. Casos de contexto continuam exigindo o mesmo contexto assinado. Os testes novos são nativos, com fixtures sintéticas e rollback, para conferir efeitos e erros de domínio; localizar texto SQL não é prova de execução.

| Família | Reparo e limite preservado |
| --- | --- |
| Cargas e funcionários | Enum de operação existente, UUID de viagem, CNH existente, status textual canônico e auditoria de funcionário na entidade correta; versão obsoleta e vínculos entre empresas continuam recusados |
| Numeração e repetição | Sequência existente suporta números alfanuméricos; locks por empresa e chave serializam numeração e repetição sem novo índice ou alteração de dados |
| Composição fiscal | Guardas por empresa, vínculos canônicos, projections e recálculo preservados; não se adiciona unicidade incompatível com reentrega; reparo recusa carga estrangeira |
| Despacho e workspace | Nome de coluna canônico, adaptação ao planner auditado, ID usado pela interface para busca; JSON mantém chaves legadas e representa como null o tipo de parada ausente, sem inventar um campo |
| Eventos/POD | Digest qualificado, vínculo real do documento, versão serializada e metadados de ocorrência; evidência anterior exige a correção auditada existente, sem desativar o trigger protetor |
| Despesa de acerto | Assinatura e ACL retidas; adaptação ao comando recuperável atual, com MFA, revisão pendente e procedência do comprovante. A API antiga não aprova despesa implicitamente nem aceita uma URL arbitrária |
| Rastreamento | Alias geofence usa o engine atual, com confirmação, rejeição de ponto obsoleto e escopo; overspeed aceita o limite canônico com fallback para o nome antigo e serializa a instância aberta |
| Financeiro/SSX | Iteração ordenada de tabelas mantém o SELECT original; contexto assinado é resolvido antes do planejamento, sem remover validações |
| PostGIS | Seis definições com resultados tipados, quoting de identificadores e descoberta de módulos opcionais; LockRow/AddAuth mantêm protocolo, nullable e refusas existentes |

O reparo PostGIS está separado em `supabase/platform/postgis_3_3_7_sql_compatibility.sql`, com procedência, hashes anteriores/posteriores e comparação de contrato/ACL/owner dentro de uma transação. É um backport privado de SQL da versão 3.3.7, não uma versão oficial nova. O papel `postgres` não recebe `supabase_admin`; a restauração de CI aplica esse pacote pelo proprietário existente somente depois de comprovar container, rede local exclusiva, 327 tabelas, sete usuários sintéticos, duas empresas de fixture e ausência de jobs ativos, segredos ou HTTP pendente. O comando de lint obrigatório permanece intacto.

**Produção exige implantação separada pelo proprietário da extensão.** O SQL Editor/MCP da aplicação não deve contornar a falta dessa propriedade. A produção não foi modificada. Referência: [papéis Supabase](https://supabase.com/docs/guides/database/postgres/roles), [extensões e atualização da plataforma](https://supabase.com/docs/guides/database/extensions).

No preparo nativo: o lint bruto passou de 31 achados/exit 1 para zero/exit 0; 86 assertions novas passaram. Os testes cobrem escrita, retorno, replay, estado obsoleto, efeitos reais, geofence confirmado e replay, preservação de POD, campos de audit e protocolo de locks PostGIS. Um ensaio de duas conexões reais encontrou e corrigiu a corrida anterior ao INSERT da chave: depois do reparo, dois pedidos distintos geraram números distintos, pedidos iguais tiveram uma criação/uma recusa de duplicidade e duas observações geraram uma instância aberta de alerta.

O retorno às 25 definições anteriores e a reaplicação do forward foram executados nativamente sem DML ou alteração de contas/permissões. O retorno reintroduz os defeitos legados e não é uma liberação aprovada; o pacote PostGIS tem proprietário e implantação separados. Artefatos próprios de preparo:

- `F:/AGVLOG/checks/sql-compatibility-before-lint-20261019.log`
- `F:/AGVLOG/checks/sql-compatibility-draft12-receipt-20261019.json`
- `F:/AGVLOG/checks/sql-compatibility-concurrency-20261019.json`
- `F:/AGVLOG/checks/sql-compatibility-application-return-20261019.sql`

**Resultados de preparo não aprovam o SHA final.** Os gates completos e o fluxo de conta única devem constar do recibo externo `F:/AGVLOG/checks/sql-compatibility-final-gates-20261019.json`, com o SHA exato e status final. Sem esse recibo aprovado, este relatório não declara Quality gate completo ou publicação.
