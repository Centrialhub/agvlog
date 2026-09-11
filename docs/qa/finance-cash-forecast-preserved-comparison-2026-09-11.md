# Comparação preservada de previsão × realizado — 2026-09-11

Implementação privada local, sem aplicação remota ou promoção pública. A migração 90341 não altera snapshots, carteiras, dinheiro nem os catálogos congelados de promoção.

## Contrato

`finance_private.cash_forecast_comparison(jsonb,jsonb)` compara abertura, entradas brutas, saídas brutas e fechamento separadamente. Fechamento igual com diferenças compensatórias não é coincidência integral. Cenários confirmado e ampliado mantêm disponibilidade independente. Não atribui causas automaticamente.

`finance_private.compare_cash_forecast_snapshot(uuid,uuid)` lê a captura original de 84626 e consulta `period_money_package` somente para as contas preservadas, de corte + 1 até fim preservado. Não chama o coletor ou recalcula a previsão. Retorna identidade atual do leitor, identidade/hash/revisão originais e comparison; ausência de projeção/contas retorna motivo explícito. Nenhuma função tem EXECUTE para authenticated, anon ou service_role.

## Verificação

`npx vitest run src/test/cashForecastComparisonDatabase.test.ts`: 5 PASS, saída 0, 2026-09-11 06:15:48, 3,10 s. ESLint do arquivo: saída 0.

- Equivalência SQL/TypeScript das quatro diferenças, incluindo fechamento igual com abertura/entrada divergentes.
- Disponibilidade independente dos cenários e realizado monetário indeterminado.
- Rejeição de empresa, contas, intervalo, equação da previsão e somas realizadas incompatíveis.
- Captura real, alteração posterior do título, aprovação de cobertura, revisão legada e fechamento por RPC real. A comparação usa a previsão original; reabertura torna o realizado indisponível sem alterar a captura. Outro operador autorizado recebe sua própria identidade; empresa estrangeira e motorista misto são negados.
- Captura sem contas/projeção retorna indisponibilidade explícita; ACL privada conferida.

## Limites da evidência

PGlite com os helpers financeiros reais disponíveis, não reset integral Supabase nem ensaio concorrente PostgreSQL. O extrato é fixture de evidência capturada, não download bancário. Após a captura real, os relógios clock_timestamp e statement_timestamp são avançados apenas na transação da fixture para tornar o dia encerrável; o ROLLBACK restaura ambos. Nenhum comando de fechamento, validação ou resposta é substituído. A função pura valida os campos financeiros/escopo usados na comparação; não pretende duplicar toda validação de metadados visuais do schema TypeScript. O wrapper recebe o pacote canônico real.

Dependências existentes: coletor 82303, validador/projetor 84618, journal 84626, pacote de período 193723 e seus predecessores; teste usa cashForecastCollectorDatabase e accountPeriodCloseDatabase. Não altera 84626, 85621 ou 90256.

Atualização final solicitada na revisão: cada cenário disponível inclui expected e actual com abertura/entrada/saída/fechamento, além de differences. SQL e TypeScript usam a mesma captura original e pacote canônico; cenários indisponíveis têm os três objetos null. Painel apresenta tabela Previsto / Realizado / Diferença. Contrato verifica equações previstas/realizadas e diferença campo a campo. Conjunto final: 19 testes passaram em 06:28:58; teste adicional de contraprova de valores e cabeçalhos passou depois (4 testes UI, total 20 casos distintos). ESLint final saída 0.
