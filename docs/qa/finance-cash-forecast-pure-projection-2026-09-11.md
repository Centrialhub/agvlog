# Projeção pura privada de caixa — equivalência SQL/TS

Migration criada pela CLI local:20260911084618_finance_cash_forecast_pure_projection.sql. Nenhuma aplicação remota, API pública ou mudança em fontes financeiras. Manifesto de4 arquivos com hashes:finance-cash-forecast-pure-projection-allowlist-2026-09-11.json.

## Contrato e integração

finance_private.project_collected_cash_forecast(_collection jsonb) retorna {collection,projection,issues}, equivalente ao adaptador projectCollectedCashForecast. Sem contas, projection é null e há diagnóstico explícito. A função não recebe projeção calculada no navegador e não consulta tabelas. O comando futuro deve coletar e autorizar a empresa/ator/período no banco antes de invocar; pureza não constitui autorização nem validação de evidência externa.

Há auxiliar finance_private.validate_forecast_json(jsonb,jsonb). Ambas funções são SECURITY INVOKER, IMMUTABLE, search_path vazio e EXECUTE revogado de PUBLIC/anon/authenticated/service_role. Nenhuma tabela, trigger, cron ou alteração em83307/81653/84626. Helper de testes:installCashForecastPureProjection(db), em src/test/helpers/cashForecastPureProjectionDatabase.ts.

A validação exige forma JSON, tipos, identidades únicas, contagens completas, coerência base/componentes e créditos, limites monetários usados na projeção, datas/captura em America/Sao_Paulo, movimentos dentro do escopo e valores de origem não excedidos. Não faz clamp, não converte null emzero e não vincula crédito sem destino por suposição. Objetos com campos desconhecidos são rejeitados no SQL; o chamador deve fornecer o DTO canônico do coletor. Isso é mais restritivo que o strip de campos extras feito pelo Zod. Datas inválidas também são recusadas antes do caminho sem contas.

## Evidências

10 testes passaram:7 equivalência pura e3 integração com coleta real82303. Comparam o envelope inteiro, não só total. Incluem1005origens emcada frente, recebimento parcial por record_finance_movement + apply_receivable_financial_command reais, frete separado de mercadoria, escopos confirmed/expanded/all, crédito positivo e inválido, base negativa/mista/provisória/desconhecida, nenhumaconta, captura UTC que ainda pertence ao dia anterior emSP, duplicidade, contagens e moeda incoerentes. Testes negativos exigem rejeição em SQL e TS, sem normalização.

Rodada completa05:52:50 terminou saída0:10 testes/2arquivos. Após revisão pontual, timestamp24:00 foi incluído como rejeição (Postgres pode normalizar, enquanto DTO rejeita);7 testes afetados repetidos05:54:01, saída0. Os3 testes reais anteriores permanecem evidência da mesma projeção; a mudança final só restringiu a sintaxe de hora. Lint dos3 arquivos TS saiu0 antes desse acréscimo de cenário, sem alteração da estrutura.

Limites: PGlite local, não Postgres hospedado; fixture do coletor explicita exclusões de workers fiscais e FKs operacionais alheias. Não é prova de autorização do futuro snapshot. Root informou5 testes próprios de snapshot84626 com coletor/projeção reais; essa execução não é deste agente.

## Documentação consultada

[Funções do banco e privilégios](https://supabase.com/docs/guides/database/functions) orientam SECURITY INVOKER e controle explícito de EXECUTE. [Changelog oficial](https://supabase.com/changelog.md) foi consultado via HTTPS; nenhuma mudança relevante ao SQL puro identificada no índice atual. CLI local2.116.0 com ajuda de migration new consultada; upgrade não necessário para criar arquivo local.
