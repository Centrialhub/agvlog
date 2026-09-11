# Fechamento real com adiantamento/folha — validação integrada

2026-09-10. **1 teste PGlite + 2 testes PostgreSQL17.11 nativo passaram**. ESLint do teste sem erros. Nenhuma alteração de SQL core ou ambiente remoto.

- `src/test/paidProjectionRealClose.test.ts`.
- `scripts/test-finance-paid-real-close-native-cases.mjs`, selector `finance-paid-real-close`.
- Log `node_modules/.cache/qa-postgres/finance-paid-real-close-native-2026-09-10.log`.
- Handle final83692 exit0, servidor parado. Primeira8140 falhou apenas na serialização UUID[] do adaptador; ajustada para arrayPostgres e reexecutada.

## Prova positiva completa

Abertura10000, saída5000 via record_finance_movement e pagamento de título via apply_finance_payable_movement. Adiantamento com origem exata e item already_paid ligado ao adiantamento são resolvidos. Extrato da fixture tem fechamento5000 e perna−5000; contexto e comando reais conciliam essa entrada ao movimento. Abertura, aprovação de cobertura, revisão B e close usam as RPCs reais, sem snapshot{} ou ticket semeado de fechamento.

Preview é elegível sem blockers. close_finance_account_period grava snapshot que inclui IDs do adiantamento e item de folha. Leitor real get_finance_account_period_evidence passa schemaUI e confirma snapshot_matches_revision=true/dependencies_match=true. O saldo conta dinheiro uma vez.

## Corrida nativa

Após fechamento positivo, reopen_finance_account_period reabre por comando real. Captura preview atual; reverse_finance_payable_link executa na sessão detentora e close_finance_account_period disputa a trava financeira com a revisão anterior. A espera é observada por pg_blocking_pids. Reversão vence; fechamento rejeita revisão obsoleta e nenhuma closure ativa permanece. Não foi inserida reversão manualmente.

## Hashes e dependências

-72624: `81a04b56856933edce8341a07743d5b977e7a688b877d6cafebaf4fe680d4394`.
-170213: `2641e645cc06ec82195173094c88e7a67402bb9cc18a6b6de4f112a37388cd63`.

Fixture inclui abertura/cobertura/retention/guards/B/snapshot/evidence reais da suíte anterior; funções reais de capacidade e pagamento, visão ativa43833 e72624. A RPC de reversão foi instalada com o corpo03529 e sua wrapper/grants; o caso usa origem canonical. Patches posteriores específicos de adoção legada não foram reinstalados: esta prova não cobre reversão de legacy_adoption, opções da UI ou autorização de todas as variantes.

## Limites

O extrato é evidência sintética semeada com verificação controlada, como na fixture anterior: não comprova autenticidade de arquivo bancário real, integração de storage externo ou completude da implantação. Schemas baseline têm grafo restrito de dependências/FKs; origem física do adiantamento e item de folha é semeada, embora pagamento/movimento/revisões/fechamento/reabertura/reversão usem comandos reais. Não testa aqui geração/aprovação concorrente da folha, segunda ordem close-vencedor da disputa, nem toda cadeia multimonth; outras suítes cobrem partes e não substituem ensaio completo de plataforma.
