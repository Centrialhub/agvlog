# Proteção da origem do recebível de descarga — 2026-09-10

Migração: `20260910205941_finance_unloading_receivable_source_guard.sql`.

A cobrança preservava fornecedor e valor, mas o guard financeiro antigo só congelava o título depois de pagamento/vínculo fiscal. Agora UPDATE/DELETE de título associado preserva identidade, empresa, devedor, valor e vínculos fiscais/fechamento. Transições para ou a partir de cancelled/invoiced exigem futura correção auditada. Descrição, vencimento, número informativo, notas e autoria de atualização continuam editáveis; campos derivados de recebimento continuam sob os guards financeiros existentes.

INSERT de cobrança verifica título na mesma empresa, fornecedor e valor integral, sem vínculo fiscal/fechamento. INSERT de recebimento também verifica essa origem: legado divergente não ganha nova baixa. Devoluções e correções existentes não passam pelo novo guard de INSERT de pagamento, e foram executadas com os comandos reais. Nenhuma origem é corrigida silenciosamente.

Locks: row-first usa pg_try_advisory_xact_lock e erro 40001 finance_unloading_source_busy; INSERT da origem toma título FOR SHARE NOWAIT e converte disputa em 40001. UPDATE/DELETE de títulos ainda sem cobrança também participa da trava financeira para fechar a corrida com nova associação. Isso pode produzir novas falhas transitórias em escritores genéricos concorrentes; não espera em ordem invertida. Writer record_unloading reautoriza imediatamente depois de finance lock e antes de replay; preserva OID, ACL e restante da definição.

Seis testes PGlite reais passaram, mais ESLint: proteção antes de pagamento; edição permitida/recebimento/devolução/correção/reuso; legado divergente sem novo recebimento e devolução preservada; posição da reautorização; nova cobrança incompatível; reativação genérica negada. Fixture reutiliza a cadeia real de descarga e recebíveis do teste de fluxo; somente os dois cenários de legado danificado desabilitam temporariamente o guard específico para fabricar estado anterior à migração. Não há bypass no código de produção.

Não executado nesta frente: PostgreSQL nativo, corrida/revogação durante espera, TSC, aplicação remota. A revisão de posição do código não substitui ensaio nativo de reautorização durante espera.

Pendências: comando auditado de correção/cancelamento da própria origem; diagnóstico antecipado can_receive=false para legado divergente; reparação de estado cancelled/invoiced legado deve ter caminho auditado, não edição genérica. Este guard não transforma o fluxo em posição econômica histórica.
