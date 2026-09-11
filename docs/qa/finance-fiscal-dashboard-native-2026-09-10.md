# Resumo fiscal — PostgreSQL nativo 2026-09-10

7 testes passaram em PostgreSQL 17.11 descartável. Execução final 41596: exit 0, servidor parado. Sem implantação remota nem alteração de SQL do produto.

Suite: `scripts/test-finance-fiscal-dashboard-native-cases.mjs`. Selector central: `finance-fiscal-dashboard`. Log: `node_modules/.cache/qa-postgres/finance-fiscal-dashboard-native-2026-09-10.log`.

## Resultados

- 1.005 CT-e autorizados alimentam a fila real e são processados pelo worker real. Total completo `100500000` centavos. Frete 1.000 prevalece sobre net_value 990 conforme base autorizada do CT-e.
- Uma NFS-e adicional com serviço 1.000 e ISS retido 50 produz líquido 950, bruto 1.000 e retenção 50, com todas as respostas validadas por `fiscalDashboardSchema` real.
- Cancelamento recebido antes do processamento mantém origem ativa, porém inválida, totais null e um job pendente. Após worker, origem cancelada sai do valor ativo.
- Mudança da access_key mantendo authorized invalida antes do worker. Após worker, origem entra em revisão, sai do crédito ativo e mantém job de revisão visível.
- Troca do pagador do título não reclassifica silenciosamente o montante: origem ativa inválida e totais null.
- Motorista, perfil misto, tenant estrangeiro e intervalo invertido são rejeitados.
- EXPLAIN ANALYZE do corpo completo executa 1.006 origens: **258,545 ms** de execução e **8,254 ms** de planejamento. Medição local isolada, não promessa de latência em produção.

## Fixture e limites

Definições baseline de recebíveis e writers financeiros reais, estendidas com os campos/tabelas de origem usados por `financeFiscalIntegrationFixture`. Instala migrations fiscais 04550, 05509, 10034, 11121, 12152 e posteriormente projeções 24438/25658/30634, inventário, auditoria e associação 45616. Processamento dos títulos não é simulado. Tabelas de emissão/NFS-e usam o recorte de campos do helper; todo o grafo de FKs não é instalado. Helper de fechamento falha caso invocado; fluxos de cobrança agrupada e devolução após cancelamento pago não fazem parte desta suite.

Este resumo cobre origens fiscais incorporadas e seus jobs; não representa toda emissão legada, saldo bancário ou autorização para fechar período. Não exercitou filtro por cliente/tipo nem fronteira diária nesta suite; esses aspectos permanecem fora desta prova nativa.

Tentativas 57313 e 7003 pararam durante preparação pela ordem de dependências do harness: patch de crédito deve anteceder projeção de recebimento; inventário/auditoria dependem da tabela desta projeção. Corrigida somente a ordem de instalação no teste, sem editar migrations; 41596 passou integralmente.

## Hashes SHA256

- 152711: `c005e52bf436e1187c046480e1adf16f15e86054f3c584628ba53e93d6aed0eb`
- 04550: `ca22534cc5e4cbdae362d97a62a35a4fb81ea0300687d9038b4cafc91e080cdf`
- 05509: `ba09c06c28da321ec456f9738032c9ed68530805ea40358a4ae9f05f132e01c1`
- 10034: `f34824f21040018028e20d4de22fc37d4b9fedecec3286496f96b7d78c6309b8`
- 145616: `c0f2ba253350a39f0c8ec117df2f4883ad655fff1e0c65eeddac486fe6fa8848`

Demais hashes de todas as migrations instaladas estão no log. Reprodução PowerShell: `$env:PG_QA_SUITE='finance-fiscal-dashboard'; node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.
