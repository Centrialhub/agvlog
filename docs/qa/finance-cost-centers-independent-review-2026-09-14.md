# Revisão independente: centros de custo, lançamento e envios

14/09/2026. Nenhuma SQL, publicação, commit ou dado remoto alterado nesta revisão.

## Autoria e escopo

CostCenterManager, useCostCenters, RecordedCosts e CostCenters já estavam modificados antes da atribuição. Root identificou a tarefa “Corrigir itens do centro de custos” e publicação Sites40; portanto são alterações existentes de outra tarefa, não entrega inédita desta revisão. Os bytes locais ainda precisam ser conciliados com o artefato dessa publicação pelo root. Não editei esses quatro arquivos.

Essas mudanças disponibilizam Adicionar despesa/Novo centro na visão principal, distinguem erro de carregamento de lista vazia, mantêm nome após erro, verificam linha retornada em alteração/exclusão, reativam cadastro inativo homônimo e explicam duplicidade/impedimento por vínculo. Não comprovam isoladamente a causa de todas as falhas da sessão real. Exclusão nova pertence ao escopo da outra tarefa; não criei nem executei DELETE.

Manual entry na conciliação: alteração do root leva o formulário canônico ao cabeçalho principal, sem depender da conta selecionada no histórico antigo. Escolha de conta continua obrigatória dentro do formulário; não se cria linha de extrato nem conciliação automática. Revisão e testes não encontraram regressão nessa composição.

Envios: autoria desta tarefa; filtro servidor driver_id validado, empresa/ator em cache, formulário existente, sem pagamento do acerto. Correção posterior ao TSC: driver_id do acerto é nullable, então a aba mostra diagnóstico e não monta consulta/formulário nesse caso; nome já tinha fallback. Não foi inventado UUID.

## Prova independente

33 testes/9 arquivos PASS em 16:57:57 (exit0): costCenterOperationsReview, useCostCenters, costCenterManager, recordedCosts, manualExpenseWorkspace, reconciliationMovementEntry, driverSettlementSends, driverMovementScope, financeMovementEntry.

Novo teste próprio costCenterOperationsReview prova: reativação de cadastro inativo sem INSERT duplicado; UPDATE com zero linhas rejeita sem toast de sucesso; DELETE com FK23503 não anuncia exclusão e orienta desativação. Mocks de transporte são explícitos: não se apresenta isso como prova de RLS/produção.

Limite residual comunicado ao root: ManualExpenseWorkspace com anexo ainda usa uploadPaymentAttachment do fluxo legado; a auditoria de upload está sob outra tarefa. Não modifiquei esse caminho nem afirmei que anexar comprovante já funciona na sessão publicada.

A allowlist separa arquivos existentes revisados de teste/QA próprios; não autoriza incluir WIP de adiantamento, SQL ou outras tarefas.
