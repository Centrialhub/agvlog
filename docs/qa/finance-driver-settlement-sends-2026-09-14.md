# Envios ao motorista no acerto

Integração local em 14/09/2026, sem SQL novo, dados remotos alterados ou publicação.

DriverSettlementDrawer contém aba Envios ao motorista. DriverSettlementSends exige empresa ativa igual à do acerto, usuário autenticado e FinanceAccessBoundary. A consulta existente list_finance_movements recebe driver_id, direção out, página de 30 registros e datas explícitas. readFinanceMovements valida UUID antes da chamada e rejeita qualquer linha retornada de outra empresa/motorista. Chave de cache inclui empresa, ator e filtros completos.

A aba mostra data, conta, descrição, valor original, estado/correção, totais ativos e invalidados. Declara que os envios abrangem o motorista e não comprovam vínculo exclusivo com o acerto. Não marca conciliação nem gera driver_settlement_payments.

Registrar envio realizado abre MovementEntryDialog existente, com conta escolhida pelo operador e motorista pré-selecionado somente no formulário novo. Rascunho e pedido recuperados mantêm os dados/ID originais; divergência de motorista mostra aviso. Correção/exclusão reutiliza o preview e comando auditados.

Validação: 23 testes PASS em 5 arquivos (driverSettlementSends, driverMovementScope, financeMovementEntry, movementCorrectionEntry, movementVoidConfirmation), início 16:53:04, exit0. Lint dos 8 arquivos desta integração: exit0. Após os testes foi acrescentado apenas aviso textual de rascunho divergente, sem alterar fluxo. Root executará TSC/build integrado. Testes são locais de UI/contrato: não certificam autenticação real de navegador; filtro backend driver_id foi confirmado por SELECT pelo root, sem migration nesta rodada.
