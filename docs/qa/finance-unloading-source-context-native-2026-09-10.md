# Contexto da origem de descarga — suplemento nativo

2026-09-10: **2 casos passaram em PostgreSQL 17.11**, sessão 63784 saída 0, cluster encerrado. Migration210433 SHA256 `6bad5b960550ad173a507cb03dce6239a63c6108ef0a13681364ba2a30238e77`; guard205941 SHA256 `b8701c4f801c6840e3d37ce1ab048cc366a98f7c10be92adf3974d673e66ee09`. Hash conferido antes da instalação; nenhuma alteração de produto ou acesso remoto.

- Runner: `scripts/test-finance-unloading-source-context-native-cases.mjs`.
- Seletor: `PG_QA_SUITE=finance-unloading-source-context`.
- Log: `node_modules/.cache/qa-postgres/finance-unloading-source-context-native-2026-09-10.log`.

O cenário é criado com comandos anteriores ao guard: charge real, edição então permitida do nominal do título sem pagamento e recebimento real. Nenhum trigger é desabilitado. Depois são instalados guard e contexto final.

1. RPC get_receivable_financial_context passa pelo **parseFinancialContext real** da interface, empacotado com dependências por esbuild. Retorna source_issue=finance_unloading_source_mismatch e source_revision; can_receive=false, can_reverse=true, requires_reconciliation=false. Assim divergência da origem não é confundida com divergência do ledger.
2. Refund real usando essa revisão funciona; contexto posterior também passa pelo parser, mostra recebido zero e conserva source_issue/can_receive=false. Devolver dinheiro não oculta nem corrige automaticamente a origem divergente.

Limites: fixture financeira restrita, sem plataforma Supabase integral. Este suplemento não repete a concorrência205941, coberta pelo relatório correspondente. A primeira tentativa75422 parou por variável duplicada no adaptador antes dos testes e encerrou PG; corrigido apenas o harness. A execução final63784 registrou os dois PASS e `Disposable PostgreSQL stopped.`.
