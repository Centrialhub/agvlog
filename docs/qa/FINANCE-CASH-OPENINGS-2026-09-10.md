# Abertura física por contagem

Implementação local em `supabase/migrations/20260910141240_finance_cash_opening_counts.sql`, criada pela CLI. A migration `140010` permaneceu intacta. Sem banco remoto, execução bancária, UI ou fechamento de período.

## Contrato integrado

`record_finance_cash_opening` recebe JSON estrito:

```json
{
  "version": 1,
  "tenant_id": "UUID",
  "request_id": "UUID",
  "account_id": "UUID",
  "effective_from": "2026-09-01",
  "custodian_name": "Responsável pelo caixa",
  "reason": "Contagem inicial de cédulas e moedas",
  "counts": [
    {"denomination_cents": 10000, "quantity": 2},
    {"denomination_cents": 20000, "quantity": 0}
  ]
}
```

Conta ativa `cash`, no tenant autorizado. `effective_from` é o início do dia civil de São Paulo, não saldo de fim do dia; data futura recusada. Custodiante informado com 2–200 caracteres; motivo com 10–2000. Autor é derivado da sessão e distinto do custodiante declarado. O nome do custodiante é uma declaração preservada, não vínculo validado com empregado nem segunda aprovação.

Counts tem 1–13 linhas, denominações únicas em centavos `[1,5,10,25,50,100,200,500,1000,2000,5000,10000,20000]`, quantidade inteira 0–999999999. Strings numéricas, fracionários, negativos, campos extras e total fornecido pelo cliente são rejeitados. Linhas com zero são preservadas; zero total é permitido. Cálculo usa bigint antes da multiplicação e acumulador numeric; limite de total 99999999999999. O enum representa valores nominais aceitos pela aplicação, sem promessa de disponibilidade de todas as moedas/cédulas no caixa.

Retorno: `version`, `tenant_id`, `request_id`, `opening_id`, `balance_cents` string, `evidence_type:cash_count_v1`, `confirmed:true`, `cash_created:false`.

Reusa `finance_account_openings`, abertura ativa única, imutabilidade e `reverse_finance_account_opening`. Nova coluna `evidence_type` identifica `bank_statement_v1` (default para histórico bancário) e `cash_count_v1`. Leitura `get_finance_account_opening` acrescenta `evidence_type` e `evidence` tanto em opening como history, preservando evidência após reversão. Banco retorna subset `{opening_anchors:[...]}`; caixa retorna:

```json
{
  "version": 1,
  "type": "cash_count_v1",
  "currency": "BRL",
  "effective_from": "2026-09-01",
  "timezone": "America/Sao_Paulo",
  "counted_at_boundary": "start_of_day",
  "custodian_name": "Responsável pelo caixa",
  "counts": [
    {"denomination_cents": 10000, "quantity": 2},
    {"denomination_cents": 20000, "quantity": 0}
  ],
  "total_cents": "20000"
}
```

Counts são ordenados crescentemente no armazenamento, sem remover zeros. Cash `evidence_status=valid` significa snapshot estruturalmente íntegro e coerente com abertura, e conta ainda classificada como cash. Não significa atestação externa, dupla conferência ou certificação de períodos seguintes. `can_close=false` permanece. Reclassificar a conta posteriormente produz `requires_review`; não converte contagem em âncora OFX. Banco continua validando a evidência nativa anterior, inclusive saldo negativo permitido apenas no ramo bancário.

## Verificação executada

- `src/test/financeCashOpenings.test.ts`: 12 testes SQL PGlite, migrations reais do ledger/imports/evidência/abertura/contagem sobre fixture estreita de dependências. Contagem, zeros, bigint, replay, autoria, reversão/histórico, motoristas e perfis mistos, tenant, limites/formato, DML/imutabilidade, continuidade do livro, reclassificação e ramo bancário com âncora real após extensão.
- `src/test/financeAccountOpenings.test.ts`: 14 testes anteriores passaram; complementados pelo caso bancário novo acima que aplica `41240`.
- `scripts/test-finance-cash-openings-native-cases.mjs`: 6 testes PostgreSQL 17.11 real descartável. Replay simultâneo; chaves diferentes disputando abertura única; RPC bancária aguardando contagem; permissão revogada durante espera; conta reclassificada durante espera; reversão seguida de recontagem concorrente. Espera real verificada pelo helper `contested` com `pg_blocking_pids`, sem sleep como prova.
- Selector opt-in `PG_QA_SUITE=finance-cash-openings` no runner existente, coordenado com agente da abertura bancária. Resultado nativo: 6/6; cluster parado, processo exit0.
- ESLint do teste e `npx tsc --noEmit`: exit0.

Log local: `node_modules/.cache/qa-postgres/finance-native-cash-openings-2026-09-10.log`. SHA256 migration testada: `53cd98728a42edb363418b4aba292bf6d1ed9ed754739e3056f1eef644444b0a`.

Limitações: sem homologação de uma contagem real, sem aplicação remota, sem conferência de caixa de períodos seguintes, sem assinatura/segunda pessoa/comprovante externo da contagem. Fixture não é restore integral de produção. O saldo inicial não cria receita, movimento, pagamento, import ou lançamento bancário. Proteção de futuro fechamento segue especificação separada; não foi adicionada aqui.
