# Descargas e recuperação no período — UI — 2026-09-10

`PeriodUnloadingFlowPanel` integrado como filho do pacote de dinheiro, reutilizando período e IDs das contas aplicadas. Não há segunda seleção de contas. Fornecedor opcional utiliza as opções de IDs e nomes preservados retornadas pelo servidor; nomes iguais não são identidade.

- Descargas originadas abrangem empresa/fornecedor; recebimentos e devoluções abrangem contas selecionadas. Três blocos independentes, sem soma geral ou saldo devedor inventado.
- Vencimento identificado como originalmente declarado. Evidências conhecidas nesta consulta, sem afirmar conhecimento existente no fechamento ou posição passada.
- Alocação à descarga separada do valor integral do movimento. Ponte monetária lista cada movimento informado pelo contrato uma vez e mostra eventos/fechamentos relacionados; não reapresenta dinheiro como nova receita.
- Eventos paginados em50, grupos e movimentos em20; totais sempre do conjunto integral do servidor. Revisão alterada40001 força primeira página por geração mesmo com cache infinito.
- Divergência da revisão do pacote suspende dados do filho e sinaliza junto aos valores brutos do pai que pertencem à consulta anterior. Botão de atualização executa refetch do pacote, ocultando-o durante busca, sem laço automático.
- Sidecars de crédito/correção/associação/reversão têm destaque e IDs/ator/data de registro; nenhuma data econômica, nome ou motivo ausente foi inventado. O contrato inicial expõe apenas actor_id nesses sidecars.
- Null permanece indeterminado. Datas econômicas desconhecidas continuam indicadas. Erro e atualização ocultam dados anteriores.

Arquivos: `PeriodUnloadingFlowPanel.tsx`, `PeriodUnloadingFlowDetails.tsx`, `periodUnloadingFlowLabels.ts`, integração `PeriodMoneyPackagePanel.tsx`; testes `periodUnloadingFlowPanel.test.tsx` e `periodMoneyPackagePanel.test.tsx`.

Verificação inicial: nove testes UI passaram, incluindo PIX300 com alocação100 separada, filtros herdados, mismatch da revisão com aviso no pai, revisão própria/epoch com cache infinito, sidecar sem data econômica presumida e ocultação de dados antigos. ESLint limpo. Core ainda finalizando SQL e enum de limites; rótulos provisórios cobrem os códigos já persistidos e têm fallback legível. Sem TSC ou aplicação remota nesta frente.

Revisão de rótulos final: todos os 13 códigos atualmente produzidos por `array_append` no SQL203516 cobertos, incluindo `refund_command_mismatch`; sete limitações do envelope traduzidas. Conferido SQL linha76: `original_command_id` recebe `cmd.request_id` de `finance_commands` com action `record_unloading`; a UI o identifica como **pedido original**, sem tratá-lo como ID de outra tabela ou nova transação. Nove testes child/parent passaram novamente; lint dos seis arquivos passou. Sem TSC.
