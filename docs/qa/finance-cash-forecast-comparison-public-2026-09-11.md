# Comparação pública da previsão preservada — 2026-09-11

Migração CLI 92206, somente local. Nenhuma aplicação remota, stage ou publicação. Preserva 90256/90341/84626.

API `get_finance_cash_forecast_comparison(_tenant_id uuid,_snapshot_id uuid)` é SECURITY INVOKER, com EXECUTE apenas authenticated. Adapter privado SECURITY DEFINER usa require_access e confirma tenant/actor/snapshot no resultado. As duas funções brutas 90341 continuam sem grants. Preflight exige hashes normalizados, volatility, definer/config/ACL exatos de cinco predecessores, RLS/ACL do journal e trigger de imutabilidade com tipo/evento/condição exatos. O pacote de período mantém seu grant authenticated preexistente, sem ampliação.

Contrato cashForecastComparisonResultSchema valida identidade, escopo, datas, disponibilidade, soma das diferenças e coincidência dos quatro valores. Cliente verifica tenant/actor/snapshot solicitados. Painel recebe {tenant,actor,snapshotId}, usa FinanceAccessBoundary e cache separado por essas três identidades; durante refetch/erro esconde dados anteriores. Diferenças significam realizado menos original; base provisória e contas parciais ficam explícitas. Indisponibilidade não vira zero. Não atribui causa às diferenças.

Verificação: 8 testes PASS (4 SQL, 3 UI, 1 cliente), saída 0, 06:26:32, duração 3,33 s; lint dos seis arquivos TS/TSX passou antes da última adição de testes ACL, repetido ao finalizar.

SQL: captura preservada real → título alterado → fechamento real → comparação pública authenticated igual ao cálculo TypeScript original → reabertura torna comparação indisponível; identidade de outro operador autorizado, cross-tenant/motorista misto, anônimo e raw privado negados. Testes de deriva de corpo e grant abortam antes de criar wrapper. UI: diferenças compensatórias não são match, cenário indisponível e ausência de projeção sem valores fabricados. Cliente: vinculação das três identidades e propagação de recusa.

Limites: banco PGlite com fixtures financeiras reais existentes; extrato capturado é fixture, sem download bancário. Relógios apenas da transação de teste avançam após captura para permitir fechamento do dia, restaurados por rollback. Sem prova de navegador/publicação nesta sub tarefa. A integração da página pertence à raiz. Catálogo JSON adjacente registra os cinco predecessores pinados.

Atualização final solicitada na revisão: cada cenário disponível inclui expected e actual com abertura/entrada/saída/fechamento, além de differences. SQL e TypeScript usam a mesma captura original e pacote canônico; cenários indisponíveis têm os três objetos null. Painel apresenta tabela Previsto / Realizado / Diferença. Contrato verifica equações previstas/realizadas e diferença campo a campo. Conjunto final: 19 testes passaram em 06:28:58; teste adicional de contraprova de valores e cabeçalhos passou depois (4 testes UI, total 20 casos distintos). ESLint final saída 0.
