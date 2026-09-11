# Reparação pública de descarga — suplemento PostgreSQL nativo

2026-09-10: **3 testes passaram em PostgreSQL 17.11**, sessão 69339 saída 0; servidor descartável encerrado. Migration212550 SHA256 `0bbf8948dbbfe8bdfd4f5cbb157be6da61558d1a8387c1036038b619e0164d74`, conferido antes da instalação. Sem edição de produto ou operação remota.

Runner: `scripts/test-finance-public-unloading-repair-native-cases.mjs`. Seletor: `PG_QA_SUITE=finance-public-unloading-repair`. Log: `node_modules/.cache/qa-postgres/finance-public-unloading-repair-native-2026-09-10.log`.

1. Fonte é criada com batch real e título divergente antes dos guards. Depois da promoção, preview público parseado mostra can_execute=true. **repair_finance_unloading_projection executa como authenticated**, resultado passa por parseUnloadingProjectionRepairResult real incluindo identidade da sessão/pedido/origem. Replay é idêntico, restaura nominal150, mantém exatamente uma reparação e nenhum ticket. JSON de custos/pagáveis e contagem de movimentos permanecem iguais. Preview posterior conserva histórico e can_execute=false.
2. Writer privado bruto continua sem grant para authenticated; anon não executa wrapper público.
3. Replay público espera finance lock; revogação da membership enquanto espera produz42501 finance_access_denied após liberação, sem nova reparação.

O suplemento usa fixture financeira restrita e dados sintéticos, sem simular sucesso dos comandos. Não é ensaio integral da plataforma/upgrade remoto nem autenticação por serviço Auth. A matriz privada de rollback e concorrência row-first foi validada separadamente nos cinco testes211156/211740 e não repetida aqui.
