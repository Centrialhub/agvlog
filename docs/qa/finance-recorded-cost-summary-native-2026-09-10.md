# Resumo de custos — PostgreSQL nativo 2026-09-10

8 testes passaram no PostgreSQL 17.11 local descartável. Handle final 90521: exit 0 e servidor parado. Não houve acesso remoto nem alteração em SQL de produto.

Suite: `scripts/test-finance-recorded-cost-summary-native-cases.mjs`; selector `finance-recorded-cost-summary` no runner central. Log: `node_modules/.cache/qa-postgres/finance-recorded-cost-summary-native-2026-09-10.log`.

## Provas

- 1.005 itens canônicos de 101 centavos produzem exatamente `101505`, sem amostragem nem limite de mil fontes. Resposta validada com `recordedCostSummarySchema` real, incluindo categorias e meses.
- Obrigação manual apontada pelo `payable_id` exato de um item é contada apenas pelo lote. Manual cancelado aparece na contagem, sem custo adicional.
- Salário de 3.000 e comissão de 50 entram uma vez; adiantamento já pago, desconto e título projetado de folha não acrescentam custo. Total combinado esperado confirmado: `406606` centavos.
- Data de registro usa fronteira São Paulo: 02:59:59 UTC e 03:00 UTC ficam em dias distintos; categoria e centro não atribuído filtram corretamente.
- Custos do outro tenant não alteram o envelope. Motorista, perfil misto, tenant estrangeiro, data não finita no filtro e centro inexistente são rejeitados.
- Divergência entre obrigação e comando manual, mais data infinity: ambos permanecem inválidos; total e todos os agrupamentos ficam null.
- Créditos de folha para reembolso/acerto permanecem visíveis como não classificados, invalidando o total; não são convertidos indevidamente em remuneração.

## Plano completo

EXPLAIN ANALYZE executou o corpo real da consulta, substituindo somente parâmetros PL/pgSQL por literais equivalentes. 1.011 origens após composição manual/lote/folha: planejamento **14,381 ms**, execução **7,069 ms**. É uma medição de fixture local; não constitui orçamento de latência em produção.

## Dependências e limites

Replica as definições baseline e migrations da fixture `createRecordedCostSummaryDatabase` / `createLegacyPayableAssociationDatabase`, adaptadas ao PG nativo, além do schema storage mínimo do runner. As consultas de custos 125357, 130032 e 152557 são reais. Fontes são semeadas diretamente com privilégios de QA; esta suite valida agregação e autorização da consulta, não os comandos de criação nem concorrência da folha. Não instala todo o grafo de FKs nem lifecycle atual da folha. A autorização financeira usa `can_access` real; helper legado `is_tenant_admin` da fixture não é prova de políticas legadas.

Cobertura permanece explicitamente incompleta: não inclui custos antigos de motorista, manutenção, composição do acerto e créditos de folha sem classificação segura. Dinheiro bancário é excluído. Nenhuma leitura libera fechamento.

Primeira tentativa 23599 terminou por variável duplicada no harness antes dos casos; corrigida exclusivamente a suite, execução 90521 passou integralmente.

## Hashes SHA256

- 152557: `1cc424b40ea451f602949ce6e68d4a23e76943252119badb86592725f66bf611`
- 125357: `4ff64ddafb49126e05b1e7ddc5925fe76dd63df00a1f380e0e6bd9e8db10099c`
- 130032: `e0d51628df54abeedfa0d78cd7b48632b7daf19ff43ae28dffe9875e77ceebae`
- 143833: `2948e859d766cbff838a170ab288b543bf0d133412e9ba526d1f7fdb3125e529`

Reprodução PowerShell: `$env:PG_QA_SUITE='finance-recorded-cost-summary'; node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.
