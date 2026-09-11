# Edição de recebível de descarga — UI — 2026-09-10

O formulário genérico consulta a origem pela FK `finance_unloading_charges.receivable_id`, com filtro simultâneo de tenant. Não usa descrição, nome do cliente ou valor para determinar se o título é descarga. O hook valida empresa/título retornados e falha fechado em erro, resposta inválida ou consulta pendente.

Para descarga: fornecedor, valor e situação financeira ficam protegidos; origem/entrega/fornecedor/valor são exibidos a partir da charge e do snapshot preservado. XML não é oferecido. O UPDATE envia somente `description`, `due_date`, `invoice_number`, `notes`, além de autoria/data adicionadas pelo hook. Não reenvia status ou identidade congelados. O hook de update acrescenta filtro tenant ao filtro id existente.

Novo título não consulta origem. Título sem charge mantém fluxo anterior. Erro de origem oferece nova consulta, sem habilitar salvamento. Erros do guard `finance_unloading_*` usam mensagens legíveis do helper compartilhado mantido pelo coordenador.

Arquivos: `useReceivableUnloadingOrigin.ts`, `useReceivables.tsx`, `Receivables.tsx`, `receivableUnloadingEdit.test.tsx`.

Verificação: cinco cenários renderizando a página real com transporte controlado (FK+whitelist+tenant, falha, novo título, ausência de origem, consulta pendente/resposta estrangeira) e três regressões da lista paginada passaram. ESLint dos quatro arquivos passou. A validação SQL do guard está com o agente de banco; os testes desta UI não são apresentados como execução SQL nativa. Nenhum TSC ou aplicação remota nesta frente.

Aviso financeiro da origem: `ReceivableFinancialDialog` apresenta `source_issue=finance_unloading_source_mismatch` separadamente da divergência de projeções. Explica que novos recebimentos estão indisponíveis e que conciliação de saldo não corrige fornecedor/valor da descarga. Não acrescenta bloqueio à devolução autorizada pelo contexto. Teste focal usa `source_revision` de 32 caracteres, `requires_reconciliation=false`, `can_receive=false`, `can_reverse=true` e comprova envio da devolução com a revisão financeira vigente. Seis testes do painel de pagamentos passaram, lint dos dois arquivos passou. Nenhum SQL ou TSC nesta alteração.
