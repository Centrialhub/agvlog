# Carteira operacional a pagar — backend180040

2026-09-10. Nova migration criada pelo CLI local: `20260910180040_finance_payable_portfolio.sql`. SHA256 `51773219434d93c0a7cade674b75381f5a5e2f4dcc6dbd9bd24fd04f52c482f5`. Sem aplicação remota, sem mudança75641 ou outros cores.

## Contrato entregue

`get_finance_payable_portfolio(_tenant_id uuid,_filters jsonb default '{}',_page integer default1,_revision text defaultnull)` retorna agregado integral e página30 do mesmo conjunto, na mesma instruçãoSQL. Filtros estritos: date_basis due_date(default)|created_at,from/to ISOdate ou null,category/supplier_id ou null. Todos filtros de data referem seleção de títulos, nunca pagamentos no período. Posição é current_operational; as_of é dia atual SãoPaulo, não reconstrução histórica.

Resposta: version,tenant_id,basis,date_basis,from,to,category,supplier_id,as_of,revision,page,page_size,total_titles,cancelled_titles,invalid_titles,undated_titles,totals_valid,nominal_cents,paid_cents,open_cents,overdue_cents,status_counts,issue_counts,rows. Tipos exatos compatíveis com `payablePortfolioSchema` do frontend. Detalhes incluem título/origem/pagamentosativos por ID, valores declarados brutos, issues e source_revision. Filtro/desconhecimento de data explícito via date_in_range e undated_titles.

Página posterior envia revision. Mudança de título, pagamento, estorno, vínculo ou capacidade monetária usada muda revisão; divergência rejeita40001finance_payable_portfolio_changed. Ordenação filter_day nullslast,id explícita, IDs únicos, sem somar páginas no navegador. Hash não contém clock da consulta; inclui diaas_of pois vencido muda na virada do dia. Nenhuma imutabilidade histórica é alegada.

## Regras monetárias

Helper privado `payable_portfolio_evidence` consulta visão canônica active_payable_payments43833 e capacidade compartilhada movement_used_cents132411. Confere IDs title/payment/link/movement/account, direçãoout, não transferência, centavos inteiros, SPdate, motorista quando título especifica, banco legado vinculado quando existe e limite de capacidade. Link órfão ativo é issue; pagamentos múltiplos podem provar parcial. Declaração paid_amount e status devem corresponder ao conjunto ativo, não ao status isolado.

Reversão canônica exclui pagamento ativo mantendo histórico. Reversão de adoção legada mantém pagamento real histórico sem associação: pendência, nunca reaparece como nova saída. Cancelled sem pagamento ativo fica no detalhe e counts com valoreszero; cancelled com dinheiro ativo invalida totais. NaN/infinity/statusdesconhecido/datasinválidas permanecem visíveis. Due_date ausente significa semvencimento definido, não valor monetário inválido; é explicitamente undated e não some sob filtro. Created_at ausente/nãofinito invalida fonte.

Qualquer título inválido no conjunto faz totaisglobaisnull; linhas válidas preservam valores individuais. Não somar obrigações a movimentos/custos/folha. Reader não cria dinheiro, baixa, autorização de pagamento ou fechamento.

## Validação

**12 testes PGlite passaram**, ESLint0:

- Vaziozero e revision estável;1005títulos, agregado100500centavos e página34com15linhas, stale rejeitado.
- Pagamento parcial por comandos reais movement+applypayable e trigger baseline _recalc_payable_paid; saldo5000=2000+3000.
- Paid sem dinheiro, NaN/unknown/nonfinite e cancelado mantidos sem falsa totalização.
- Tenant/driver/misto; dataSP02:30Z ainda dia anterior; filtro due versus created; semvencimento explícito.
- Reversão canônica por RPC real03529 reduz ativo sem apagar pagamento; reversãolegada de associação preserva pendência.
- Linkórfão e compartilhamento de capacidade inválido alteram revision e impedem total confiável.
- Integração75641: lote real gera título5000; cancel_finance_expense cancela origem/título, carteiraopen0, cancelled1 e histórico preservado.

`src/test/payablePortfolio.test.ts`:11 testes, respostas analisadas pelo schemaUI real. `src/test/payablePortfolioCancellation.test.ts`:1 integração com factory real do autor; tabelas monetárias faltantes na fixture restrita são instaladas por DDL real. Estorno de adoção legada é semeado para leitura, não executa comandoadoção nesta suíte; reversão canônica usa RPC. Não houve alteração dos testes de outras frentes.

## Limites

Rodada nativa3320: **3 testes passaram em PostgreSQL17.11, exit0, servidor parado**, hash180040 confirmado.1005títulos e páginas/schema reais, partial/reversal por RPC e revisãoobsoleta, paidsemprova/driver. EXPLAINANALYZE do corpo CTE completo (não só chamada da função) com1005títulos executou em **182.150ms** na fixture local; não promessa de latência em produção. Helper por título agrega evidência completa e pode custar em carteiras maiores. Script scripts/test-finance-payable-portfolio-native-cases.mjs, selectorfinance-payable-portfolio, log node_modules/.cache/qa-postgres/finance-payable-portfolio-native-2026-09-10.log. Não há dataas_ofhistórica nem competência contábil, autenticação de comprovantes, reconstrução de dívida sem título, ou resolução automática de pagamento legado. Fornecedor/nome são metadados atuais do título, não prova bancária; source_table/source_id são origem declarada, não auditoria completa de cada domínio fiscal/manutenção.

A leitura exige can_access, inclusive exclusão de motorista/misto, e wrappers invoker chamam funções privadas definer/search_path vazio. Não expõe tabelas novas. Revisão é detecção de mudança de conteúdo, não assinatura de autenticidade.
