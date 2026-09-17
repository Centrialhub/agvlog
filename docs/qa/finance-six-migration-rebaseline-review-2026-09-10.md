# Rebaseline de seis migrations financeiras — 2026-09-10

Revisão local de fonte atual completa, solicitada após incorporação do trabalho no commitf77976f7 e identificação de divergência em relação ao manifesto anterior. Não houve apply, SQL/PG, TSC ou Sites nesta revisão.

## Identidade dos arquivos

O JSON finance-six-migration-rebaseline-hashes-2026-09-10.json registra SHA256 antigo e atual, sem sobrescrever os manifestos históricos. Os seis hashes atuais foram recalculados e coincidem com os informados pelo coordenador:

| Versão | SHA256 atual |
|---|---|
| 124716 | 65da31d88b15ec57584933e8ecb0e16e3dcdc72946c0b1e38b3dd700208927e4 |
| 125034 | f8cf14a80c9cbc99371ad08020813ccde444119cc4a92b679630ca5864745523 |
| 125357 | fe87f64973c88721ca993f3039c02e3d537cba585310e28fe3eeadb2a9d67342 |
| 130032 | ef2770c883450c705a1ab0d9b8a57d823571eb90f9917a9ecd5c653aa3f5c88c |
| 130956 | 15b27ade6edb13d6352a7e33b48226f9afae580c347f915578b7bf51170cd40c |
| 132406 | 402e7da46ec96f8e582f513fdbd75a80e070bb1dc7bca10c8bc855eb74d5161a |

Não afirmar equivalência byte a byte nem mera normalização LF/CRLF: tentativa local reproduzível de LF/CRLF e0–12 linhas finais não reproduziu os hashes antigos. Script finance-six-migration-rebaseline-check-2026-09-10.mjs somente lê arquivos e grava JSON de diagnóstico.

git diff f77976f7^ f77976f7 mostra esses paths como novos, não uma alteração de fonte anterior versionada. A revisão antiga preservou hashes e análise textual, não blobs originais no Git consultado. Portanto não foi possível produzir um diff histórico byte a byte confiável de antes/depois; a conclusão abaixo é REVISÃO COMPLETA DA FONTE ATUAL comparada aos contratos documentados, sem inventar quais linhas teriam mudado.

## Revisão atual e comparação com contratos anteriores

### 124716 — já aplicada, informação do coordenador

A fonte atual apenas substitui finance_private.list_expenses(uuid,jsonb). Não tem DDL de tabela, trigger, DML persistente, grant, cron ou alteração de can_access. SECURITY DEFINER/search_path vazio; primeira guarda exige can_access. Filtros tenant/intervalo/search/contexto/categoria/trip/centro, total integral separado da página; joins de receivables/payables/centros/allocations limitados ao tenant. Totais continuam da versão anterior ao cancelamento: não anunciam semântica final da UI.

O desenho corresponde ao relatório antigo. A discrepância de hash exige registrar que o artefato aplicado foi o atual, não atribuir a aplicação ao hash velho. Verificação posterior read-only do coordenador deve comparar definição remota/ACL do reader com fonte atual (lembrar normalização pg_get_functiondef), existência do predecessor e gatefalse. Como CREATE OR REPLACE conserva ACL apenas se função existia, a inspeção de privilégios é material. Não há motivo na fonte para gerar reparação monetária ou reverter dados: não escreve dados.

### 125034 — writer manual com centro de custo

Mantém payload whitelist, tenant can_access antes/depois lock financeiro, replay por tenant/request/ator/action/payload, valor positivo até14 dígitos e validações de motivo/descrição/fornecedor. cost_center_id é UUID de centro ativo do mesmo tenant; grava nome em payables.cost_center e ID/nome na auditoria. Comprovante exige path específico do tenant, objeto em receipts e metadados permitidos. Cria payable e pode alocar saída existente via apply_payable_movement; cash_created=false.

Contrato corresponde à análise anterior. Sem grants novos; exigir record_manual_expense de120756 já presente com ACL correta. Não escanear por SQL nem interpretar metadado como engineAV; scanner continua responsabilidade do gateway. Gatefalse impede nova chamada de writer, mas não substitui futura integração de cancelamento/fechamento.

### 125357 — reader de custos registrados

Cria recorded_costs+wrapper público. Gate can_access, filtros permitidos e paginação30; consolida expense_items e manual_expense por comando, usando payable_id para impedir repetição entre essas duas fontes. Manual cancelado fica em histórico e fora do total; e.amount das despesas canônicas ainda não contempla cancelamento futuro. Revoga EXECUTE geral e concede só authenticated, wrapper INVOKER.

Nenhum writer/backfill. Dependências seguem modelo de despesas/comandos/payables/centros. Valores/UUID/datas são casts diretos nesta etapa; dados inválidos podem falhar leitura e hardenings posteriores permanecem necessários. Isso já era limitação de versão intermediária, não autorização para substituir falha porzero.

### 130032 — remuneração de folha no reader

Substitui o reader125357 mantendo ACL. Acrescenta apenas créditos de remuneração base_salary/daily/hourly/commission/bonus positivos com2 casas em folha/entrada approved ouclosed, identidades tenant/period/employee coerentes nos joins. Outros créditos ficam nos contadores não classificados. Sem persistência, cron ou alteração de saldos.

Mantém distinção custo versus dinheiro e depende de payroll_entry_items/entries/periods/employees. CREATE OR REPLACE exige reader predecessor. Não é agregado final de carteira/caixa nem contém os hardenings posteriores de custo cancelado.

### 130956 — evidência e revisão de período

Cria reader de evidências OFX, tabela finance_period_evidence_reviews, índice/policy/imutabilidade, writer recuperável e wrappers. Reader usa conta do tenant, fontes native-ofx-v1, native_statement_account matched_exact, dias completos/fuso, âncoras e bank_entry_active para aritmética. Declara sempre can_close=false, authenticity_status not_attested e cobertura requer revisão. Writer exige access/revisão atual e guarda evento/snapshot/comando; não movimenta dinheiro.

ACL: SELECT autenticado na tabela; nenhuma DML API; funções revogadas de public/anon/service e EXECUTE autenticado por wrapper. Audit patch exige needle identity_reviewed_manually,identity_review_reversed e preserva identidade/ACL da função. Sem revisão gerada no apply. Predecessores: extratos/verificações/entradas, helper native_statement_account e bank_entry_active, preserve_event, comandos/eventos e audit_events. A leitura atual conserva o contrato do relatório anterior; não é fechamento bancário pronto.

### 132406 — deduplicação de origem e gerador

Cria helper privado sem EXECUTE API, exige can_access e período draft/calculated. Verifica fontes driver_expenses/driver_settlements, metadados aprovados/reembolsáveis, unicidade/valor, histórico de outras folhas e pagamentos ativos por active_payable_payments. Em chamada posterior de geração editável, remove reembolso avulso duplicado exato e não bloqueado, preserva reimbursement_sources, recomputa totais. Histórico ambíguo/consumido exige revisão. Nenhum helper é chamado durante apply.

Patch do gerador6args exige âncoras SELECT id INTO _period_id/ FROM payroll_periods e RETURN _period_id e ausência de chamada dedup anterior. Insere require_access antes/depois lock, locks dos períodos e guardas de status/pagamento. Preserva OID/assinatura/defaults/ACL do gerador. Com gatefalse geração ficará bloqueada; isso é efeito operacional imediato, já descrito anteriormente.

Necessários active_payable_payments003529, require_access e todos os campos payroll/acerto/despesa indicados na revisão anterior. Fonte ainda só aceita origem driver_expenses para reembolso;134948 adapta custos canônicos depois. Não antecipar134948 nem ativarfinanceiro por haver helper.

## Resultado para o coordenador

Não identifiquei nos seis arquivos atuais novo scheduler, backfill de dados históricos, acesso público adicional ou remoção de gate em comparação com o escopo dos relatórios anteriores. Isso permite renovar a análise de ESCOPO para esses hashes, não comprova equivalência dos blobs antigos nem é uma autorização de aplicação.

-124716 deve receber registro de evidência pós-aplicação com hash atual e definição/ACL remota.
-Os outros cinco foram relatados como ainda não aplicados: vincular preflight/ensaio e futuro registro à lista de hashes ATUAIS.
-O coordenador informou que29 testes de banco usando os arquivos atuais passaram. Evidência de OUTRA FRENTE, não repetida aqui.
-Manter can_accessfalse, workers pausados e ordem:125034→125357→130032→130540→130921→130956→131149→132406, preservando predecessores e sem usar documento antigo como prova de hash atual.
-Não alterar fontesSQL durante aplicação; recomputar SHA imediatamente antes do próximo envio e anexar o resultado ao lote.
