# Promoção local da extinção do complemento

Candidata criada via CLI: `20260911094310_finance_open_complement_extinction_public_boundary.sql`.
SHA256 `aeb874df7a99916efeab18470c1567c6c577b0762212ee2a34ebd11134d16ab1`.
Core92319 permanece SHA `3fb732aafd84b75b99baa471bdada3e7c472ebe8c03e209a968cfd511741b263`, sem alterações nesta rodada.

## Interface

`preview_finance_open_complement_extinction(_tenant_id uuid, _charge_id uuid, _proposal jsonb)` e `extinguish_finance_open_complement(_payload jsonb)`. Wrappers SECURITY INVOKER delegam a helpers seguros SECURITY DEFINER, com search_path vazio e EXECUTE somente authenticated. O core e seus dados continuam privados.

A prévia remove `_evidence`, confirma tenant, ator, charge, expense, payable e proposta exatos. `can_execute` exige elegibilidade, permissão de correção e ACL da API/dispatcher, mantendo o raw writer sem grants. Descoberta com dispositions[] retorna as fontes canônicas em `dispositions` sem evidências privadas; permanece inelegível até cada alocação receber aplicação explícita e identidade de responsável comprovada. Mesmo no alvo igual ao alocado, a proposta deve listar as fontes.

Os parsers reais `openComplementExtinctionPreviewSchema` e `openComplementExtinctionResultSchema` validam as respostas SQL. O campo adicional `complement_extinction` no resolver foi coordenado com o agente de interface.

## Instalação guardada

O catálogo real da fixture foi capturado em `finance-complement-extinction-core-catalog-2026-09-11.json`. A promoção fixa funções por MD5 normalizado, SECURITY DEFINER, volatilidade, search_path e ACL owner-only; gatilhos por nome, relação, função, eventos, estado, deferral, WHEN ausente e zero argumentos. RLS/ACL das tabelas de journal, ticket, regularização, disposições e retornos são verificadas.

## Provas PGlite

`npx vitest run src/test/openComplementExtinctionPublicBoundary.test.ts`: **5 passaram**, com schemas de produção. Lint dos três novos arquivos TS: saída0.

- Descoberta de fontes, envio authenticated e replay exato.
- Anon, raw helper, tenant trocado, motorista misto e replay após revogação negados.
- Identidade divergente rejeitada; revogar dispatcher torna execução indisponível na prévia.
- Promoção rejeita trigger DELETE indevido, WHEN false e grant do writer privado.
- Cadeia do coletor, projeção, snapshots, leitores e comparação90341 instalada: título originalmente50 é saída futura antes da extinção e deixa de aparecer depois; o banco preserva nominal50/statuscancelled. Não se afirma comparação por fechamento nesta prova, que verifica o coletor real com a cadeia instalada.

## Prova PostgreSQL nativa

`node --experimental-strip-types scripts/test-finance-complement-extinction-native.mjs`: **5 passaram**, sessão52523 saída0, PostgreSQL17.11 descartável em loopback parado ao final. Novos arquivos preservam o runner e a evidência anteriores. Transporte da mesma fixture usa psql real, sem simular resultados de negócio.

1. Pagamento50 confirma primeiro: extinção obsoleta40001; pagamento e custo150 preservados.
2. Extinção confirma primeiro: pagamento antigo negado; nenhum pagamento inserido, nominal50 cancelled, custo80 e reserva100.
3. Aprovação com revisão confirma primeiro: extinção antiga40001.
4. Extinção confirma primeiro: aprovação antiga40001; complemento devido0, residual20.
5. Remoção da alocação original negada; reserva100 e cadeia verificada permanecem.

Os cenários concorrentes observam a sessão bloqueada antes de liberar o primeiro comando, com duas conexões e commits reais. Hashes de core/promoção são conferidos antes e depois. Não houve aplicação remota, stage, commit, TSC/build por esta tarefa, nem emissão fiscal. Não é uma prova de navegador/Auth hospedado.
