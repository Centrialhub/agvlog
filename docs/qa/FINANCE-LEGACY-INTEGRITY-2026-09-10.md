# Inventário de integridade legado — validação local

Migration CLI: `20260910151011_finance_legacy_integrity_inventory.sql`.

Consulta dedicada `get_finance_legacy_integrity_inventory(_tenant_id uuid, _page integer default 1)`. Não exige conta ou intervalo e não altera registros. A autorização existente `can_access` exclui motoristas, inclusive perfil misto. Nenhuma aplicação remota foi realizada.

## Contrato

Envelope v1: `tenant_id`, `scope=tenant`, `page`, `page_size=30`, `total`, `counts_by_source`, `counts_by_issue`, `identified_account:{total,rows}`, `unknown_account:{scope:tenant,not_additive_across_accounts:true,total,rows}`, `legacy_integration_status=not_reviewed`, `can_close=false`.

Cada partição pagina até 30 registros por página, independentemente da outra, ordenando por tabela e UUID. `total` soma ambas as partições; contagens de problemas não são somáveis porque uma fonte pode ter vários problemas. Não há soma monetária entre contas.

Linhas preservam `source_table`, `source_id`, `raw_date`, `raw_amount`; `date_status` distingue valid/missing/nonfinite e `occurred_on` só existe para data finita. `account_status` distingue identified/unresolved/not_in_tenant. A última classificação não informa se o UUID é inexistente ou pertence a outra empresa; a consulta não expõe dados da outra empresa. `amount_cents` só contém inteiro positivo válido dentro do contrato monetário. Folha already_paid e status paid de adiantamento recebem valor monetário nulo por serem projeções, não movimentos independentes.

## Cobertura

Varredura das nove famílias de fontes da consulta42740, sem seu filtro temporal nem a exclusão por vínculos: recebimentos, devoluções, pagamentos de títulos, pagamentos de acertos, pagamentos de fechamento, pagamentos de carga, adiantamentos pagos, créditos already_paid da folha e transações bancárias antigas.

Diagnostica datas nulas/infinidade, valores inválidos, conta ausente/fora da empresa, pai ausente/fora da empresa, origem de folha não reconhecida, referências secundárias de recebível, incompatibilidade pai-filho de folha/devolução, alias de recebimento ausente ou divergente e divergência de conta/valor/dia/direção com banco. A comparação do banco também percorre suas fontes referenciadoras: um pagamento fora de um corte temporal não consegue esconder uma transação com outra data.

Não usa igualdade por valor/data para descobrir vínculos. Esses campos apenas verificam consistência de IDs já declarados. Para acertos, a conta só pode vir do ID exato de uma associação canônica ativa; o texto payment_account não é interpretado.

## Evidência

`src/test/financeLegacyIntegrity.test.ts`: 12 testes SQL PGlite passaram. Todas as respostas passam pelo parser real `legacyIntegritySchema`. Inclui presença positiva dos oito casos da auditoria independente42740, dados intactos omitidos, alias divergente, NaN/-infinity, origem com UUID sem tabela, ausência de vazamento entre empresas, paginação de31 registros, motorista/perfil misto, filtros inválidos e ausência de aprovação implícita.

Validação independente PostgreSQL17: cinco cenários passaram,37 IDs problemáticos presentes uma única vez. Migration SHA256 `606d077ab2ff859740ca5eebbd5526ccdd918b979768157c899db0adddeac083`; execução11482 encerrou código0 e cluster descartável foi parado. ESLint dos dois arquivos de teste/helper passou.

Fixture própria `src/test/helpers/legacyIntegrityDatabase.ts` usa definições reais baseline das nove fontes e seus pais e o livro financeiro real. FKs para estruturas financeiras externas são omitidas deliberadamente na fixture de leitura para semear histórico danificado; não é um teste de permissão para escrever essas inconsistências em produção. Os testes não alteram guardas do produto.

## Limites

Esta lista não substitui o inventário de adoção por conta/período. Fonte íntegra sem associação ainda pode exigir adoção naquele inventário. A consulta não aprova resolução nem cria dinheiro, recebimento, pagamento, link ou auditoria; apenas lista evidências para revisão. Empresa desconhecida em linhas sem tenant válido não é atribuída ao usuário por inferência. O escopo é exclusivamente o tenant solicitado e autorizado.

A consulta calcula contagens completas e verifica referências de todas as fontes desse tenant antes de paginar. A paginação limita o resultado, não o trabalho de varredura. Para volumes históricos grandes, medir no ambiente candidato antes de disponibilizar uso frequente; um índice/diagnóstico materializado pode ser uma etapa posterior sem mudar a semântica. Não há certificação de fechamento por uma resposta vazia.
