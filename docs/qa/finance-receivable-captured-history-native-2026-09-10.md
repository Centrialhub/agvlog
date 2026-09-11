# Histórico capturado de recebíveis — suplemento PostgreSQL nativo

2026-09-10: **3 testes passaram em PostgreSQL 17.11**, sessão 54067, servidor descartável encerrado. Nenhum SQL de produto alterado e nenhum acesso remoto.

- Migration: `20260910201323_finance_receivable_captured_history.sql` SHA256 `8a94f49b025db40e3a1629b091c0e33180720579e37c8fa04149cd28bca80fe6`, assert antes da instalação.
- Fundação195941 instalada: `8246ff32ae6d1e95ed9b4dda8495315c08328e002266253dd2258b04a86269c3`.
- Runner: `scripts/test-finance-receivable-captured-history-native-cases.mjs`.
- Reprodução: `PG_QA_SUITE=finance-receivable-captured-history node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.
- Log: `node_modules/.cache/qa-postgres/finance-receivable-captured-history-native-2026-09-10.log`.

## Provas

1. 55 eventos reais de INSERT na origem, capturados pelo trigger temporal; RPC pública como authenticated retorna páginas de 50 e 5, ambas parseadas pelo `receivableHistorySchema` real da interface.
2. Sessão A atualiza título e captura sequência menor, mantendo transação aberta. Sessão B atualiza outro título, captura sequência maior, consulta página1 e confirma antes de A. A consulta de B vê56 eventos. Após commit de A, consulta vê57, mantendo a mesma maior sequência (primeiro evento público em ordem decrescente). A revisão muda; página2 com revisão anterior falha com **40001 finance_history_changed**. A nova revisão entrega os7 eventos restantes. Nenhum grant privado foi necessário para obter a primeira página.
3. Motorista e papel misto são negados. Após obter revisão válida, revogar membership atual impede página2, mesmo apresentando aquela revisão. A revisão não congela permissão de acesso.

## Limites

Este suplemento não repete os oito testes de instalação/rollback da fundação195941. Reutiliza a fixture financeira restrita com baseline e migrations reais de recebimentos; relações externas e instalação integral da plataforma continuam fora do escopo. A origem é semeada localmente pelo owner e a leitura ocorre pela RPC pública autenticada; não são dados remotos.

A corrida comprova que o hash inclui o conjunto visível inteiro, não apenas max(event_order). Não transforma captured_at nem sequência em ordem de commit; o produto continua um diário de versões capturadas, sem saldo histórico as_of ou certificação de fatos anteriores à baseline.
