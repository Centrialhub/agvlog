# Consulta de revisão da correção de movimento

190635 prepara preview_finance_movement_correction por empresa e ID do movimento. O wrapper verifica acesso financeiro e existência da origem antes de chamar o contexto190516; também rejeita resposta de outra empresa/origem ou versão inesperada. Papéis de aplicação recebem apenas execução da consulta, sem acesso direto ao helper de contexto.

can_execute permanece false nesta etapa. A elegibilidade calculada pelo contexto não disponibiliza um comando ainda inexistente. A revisão é da operação void e seus efeitos são prospectivos: não representam uma alteração já feita nem um envio bancário.

O cliente valida o envelope e os IDs retornados. O contrato verifica direção, centavos e equação dos efeitos contra o valor original; origem comprovada exige pedido e conjuntos únicos de comando/evento. O componente de leitura não foi conectado a uma ação de produção. Os testes do componente/contrato são separados da prova SQL.

movementCorrectionPreview.test.ts executou o wrapper com a factory real do contexto: registro livre com sinais de entrada/saída, vínculo de pagamento real, histórico já invalidado e limites de acesso. Os quatro testes passaram em 10/09/2026 às 16:16 locais. Eles também validam o contrato usado pelo cliente. A revisão de completude do grafo e de readiness190516 continua; esta evidência não autoriza um comando de escrita nem equivale a validação da cadeia completa de migrations. Nenhuma alteração remota.

A reconexão Supabase foi confirmada por listagem e consulta somente leitura: PROJETO AGV LOG, qcvnsdrbcchaxvawcngk, ACTIVE_HEALTHY; 406 migrations, última20260909221751, public.finance_movements ausente. O módulo local não foi implantado no projeto remoto.
