# Cancelamento coordenado da descarga — UI local

2026-09-11. Entrada contextual adicionada localmente após liberação do commit Sites21. Não publicado.

## Contratos coordenados

`unloadingCancellationContract.ts`: `unloadingCancellationPreviewSchema`, command/result/expected schemas. Client chama `preview_finance_unloading_cancellation(_tenant_id,_charge_id,_effective_on)` e `cancel_finance_unloading(_payload)` conforme autor SQL53349.

Prévia aceita cobrança ativa comprovada, custo único e conta a pagar correspondente quando elegível. Efeitos independentes são comparados aos valores lidos: custo retirado, obrigação cancelada e direito de cobrança cancelado. Nenhum dinheiro novo. Cobrança previamente cancelada isoladamente permanece bloqueada; não se presume retirada zero nem correção silenciosa do custo.

## Interface e recuperação

Dialog conectado em Receivables para owner/admin, pela charge identificada na FK do título. Botão abre somente conferência; o preview controla elegibilidade e execução. Consulta escopada por empresa/ator/descarga/data; edição, carregamento e erro escondem a prévia anterior. Mostra devedor da cobrança, favorecido da obrigação, IDs, valores separados, blockers e histórico manual. Exibe também alterações anteriores da cobrança. Dados indeterminados não viram zero.

Confirmação exige motivo, revisão e declaração explícita dos três efeitos. Outbox por tenant/ator, WebLocks obrigatório, grava antes de enviar. Preserva payload e IDs/valores esperados; valida tenant/ator/request/charge/receivable/expense/payable e valores na resposta antes de reconhecer sucesso. Perda de resposta usa replay exato; primeira rejeição definitiva pode limpar, mas rejeição após incerteza conserva pedido. Não sobrescreve/remove pedido de outra aba. Sucesso permanece terminal se o cache falhar.

## Evidências

32 testes locais aprovados (02:49:54): outbox15, contrato/client3, painel/confirmação4, edição/entrada10. Lint focado sem diagnósticos. Log `docs/qa/unloading-cancellation-entry-2026-09-11.log`.

Provas incluem IDs/valores incompatíveis, isolamento entre pedidos, corrupção de armazenamento, concorrência e replay, confirmação explícita, falha de cache após sucesso, efeitos indeterminados e erro ao consultar wrapper ausente.

Nenhum TSC global, Deno, SQL remoto, publicação ou edição dos arquivos compartilhados congelados. Autor SQL recebeu os exports para validação do envelope real; aplicação e publicação dependem da integração coordenada pelo root.

## Freeze da entrada 53349

PGRST202/42883 retornam mensagem explícita de indisponibilidade, sem prévia executável. Testes confirmam charge/tenant/ator corretos, fechamento sem escrita e ausência da entrada para operador. Escopo de correção da cobrança continua independente. Extensão54915 foi comunicada pelo autor, mas não incorporada neste freeze: cobrança efetiva deve permanecer active conforme53349.

SHA256 atuais:
- Receivables.tsx: 91a33f65fd3cb1389bad5bc9eb8ca9a161e4a431ecce48623948971dfe963183
- unloadingCancellationClient.ts: ce044a69160e3beab9ee0ceff29ffc1bebca772cfc4d3499bb45ba1720ae4395
- UnloadingCancellationDialog.tsx: 336f194e5b628328aa7cbc8b4b492ad3969ede559d81216c8a9e4444c768fb85
- receivableUnloadingEdit.test.tsx: 2380f74040fa15619506ee02ead4aadcb3b72090af810803df17c7f9b174ed84

## Rótulo do snapshot original (revisão posterior)

Receivables agora identifica fornecedor devedor original e valor original da descarga, com aviso de que podem diferir da cobrança vigente após alteração auditada. Não muda o snapshot nem a projeção do título.

Teste focal mantém origem150 e título120, verifica rótulos de original e valor atual120 protegido. Arquivo completo:11testes aprovados, lint0; log receivable-unloading-original-label-2026-09-11.log. Nenhum contrato53349/54915 ou SQL foi modificado.
F:\agvlog-main\src\pages\Receivables.tsx: 01872aa86402cbba738cac44cf0c524065371fdfb7a415cf5616e66a137c261e
F:\agvlog-main\src\test\receivableUnloadingEdit.test.tsx: 523a1ef813b2deea59f6f5aea280c34dacb4c9ce239d12526eb6ef1079761a5b
