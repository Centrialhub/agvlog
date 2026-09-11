# Correção auditada da descarga — UX mínima proposta — 2026-09-10

Revisão somente leitura do produto. Nenhum componente, SQL ou TSC alterado. Esta proposta não representa comandos já disponíveis.

## Entrada e reutilização

1. **Recebível — entrada principal mínima:** o modal de edição em `src/pages/Receivables.tsx` já consulta `finance_unloading_charges.receivable_id` pelo `useReceivableUnloadingOrigin` e apresenta charge, entrega, fornecedor e valor preservados. É o ponto mais direto para abrir uma futura **Conferência da origem da descarga**, sem liberar os campos protegidos do formulário genérico.
2. **Entrega/gasto:** `ExpenseBatchLine.tsx` escolhe entrega e mostra fornecedor; `ExpenseHistoryDetail.tsx` já tem `receivable_id` e seção Reembolso de descarga a receber. Acrescentar futuramente a mesma conferência por título é menor que introduzir uma segunda correção no lote. A entrega deve chegar ao reader por ID estável; sem resolver por nome/NF digitada. `LoadDetail.tsx` existe na rota `/loads/:id`, mas esta inspeção não encontrou interface de correção de descarga ali. Não inventar deep link de entrega nem expor a correção nas telas de motorista.
3. **Demonstrativo:** `UnloadingFlowEvent` em `PeriodUnloadingFlowDetails.tsx` já possui charge/entrega/título/fornecedor e pendências. Pode abrir a mesma consulta por IDs após o reader existir; não criar interpretação de saldo ou ação separada baseada no período.
4. **Padrões aproveitáveis:** `MovementCorrectionReview` para prévia com impedimentos por ID; `MovementVoidConfirmation` para revisão/motivo/pedido recuperável; `ReceivableHistoryDialog`/`ReceivableHistoryEvent` para antes/depois e autoria; `ReceivablePaymentsPanel` para pagamentos completos, devoluções e ações de vínculo sob demanda. Reutilizar padrões, não o comando de invalidação nem tipos de movimento para corrigir origem.

## Dois objetivos distintos

| Objetivo | Antes/depois mostrado | O que não deve acontecer |
|---|---|---|
| **Restaurar o título conforme a descarga preservada** | Título atual: fornecedor/ID, valor, status, vínculos. Origem preservada: fornecedor/ID, valor, entrega e comprovante. Resultado previsto: apenas campos que o servidor declarar reparáveis, derivados da origem, sem digitação livre de fornecedor/valor. | Não alterar a charge, criar outro recebível, mudar recibo ou reconstruir fornecedor pelas NFs atuais. Não chamar esta operação de devolução nem de conciliação de saldos. |
| **Corrigir a própria origem registrada** | Origem anterior e proposta nova com IDs, valores, documentos/entrega e justificativa; impacto em título, gasto, cobertura e demonstrativos detalhado pelo servidor. | Não fazer UPDATE silencioso da charge imutável nem reutilizar a restauração acima. Exige contrato próprio de retificação/sucessão e resolução de dependências; enquanto inexistente, apenas informar essa necessidade, sem oferecer botão que prometa corrigir. |

A ausência de recebimentos é necessária para simplificar alguns caminhos, mas não basta para assumir elegibilidade: gasto, obrigação, evento fiscal, crédito, acerto, folha, associação ou fechamento podem depender da origem. A decisão é do reader/guard, não de `received_amount===0` na tela.

## Estados e conteúdo mínimos

- **Consultando / falha:** esconder prévia anterior; confirmação inexistente ou desabilitada. Permitir atualizar. Nunca tratar erro como ausência de dependências.
- **Origem consistente:** mostrar que título e origem estão coerentes; nenhum botão de reparo redundante.
- **Título divergente, reparo permitido pelo servidor:** comparação lado a lado, campos exatos a restaurar, consequência financeira e origens preservadas. Motivo obrigatório e revisão explícita. Botão de confirmação somente quando um writer real estiver disponível e a mesma revisão continuar válida.
- **Título divergente, reparo bloqueado:** listar o impedimento, IDs e períodos afetados. Texto: “A divergência precisa ser regularizada antes de novos recebimentos.” Saldo matematicamente consistente não elimina problema de fornecedor/valor.
- **Origem efetivamente errada:** “A correção da origem exige uma regularização específica.” Exibir evidências e dependências; não orientar editar o fornecedor no formulário comum, criar segunda descarga na mesma entrega ou registrar recebimento para compensar.
- **Depois de recebimento parcial/integral:** separar dinheiro recebido, alocação ao título, crédito, correção de vínculo e devolução real. A devolução autorizada permanece acessível no fluxo existente e exige dinheiro já devolvido; não propô-la automaticamente como reparo cadastral. Uma associação histórica revertida não apaga pagamento nem prova que o reparo ficou livre.
- **Prévia desatualizada:** voltar à revisão e preservar valores originais. Se já houve envio com resposta incerta, retomar o mesmo pedido; não produzir outro request para contornar mudança.
- **Confirmado:** evento imutável de correção com quem/quando/motivo, antes/depois e IDs do título/charge/entrega. Destaque permanente “Ajuste manual”. Manter visível a origem original, mesmo se houver uma versão efetiva posterior.

## Contrato de leitura necessário, sem inventar RPC

Identidade empresa/ator autorizado/charge/receivable/entrega; revisão do conjunto; origem preservada e título atual; divergências por campo; modo suportado (restauração do título versus retificação da origem); capability separada de elegibilidade; campos derivados/permitidos; antes/depois e efeitos condicionais; dependências agrupadas por tipo com IDs e períodos; histórico de correções. Autor humano/sistema deve ser explícito; sequência/captura não viram ordem de commit.

Para o primeiro modo, a UI não precisa de seletor livre de fornecedor nem campo livre de valor: ambos vêm da origem protegida. Isso reduz o risco de transformar um reparo em troca arbitrária da dívida. Caso haja corrupção na própria origem, o reader bloqueia e aponta regularização específica.

## Aceite essencial

- Mesmo título com descrição qualquer é reconhecido como descarga exclusivamente pela FK; homônimos preservam IDs distintos.
- Reparo permitido deriva fornecedor e valor da origem, preserva um único título/uma única descarga por entrega e cria evento de autoria; nenhum pagamento/dinheiro novo.
- Origem errada não é “corrigida” por restaurar o título para um valor que o operador sabe incorreto; fluxo informa limite sem oferecer comando inexistente.
- Recebimento parcial, crédito, devolução, correção de alocação, vínculo antigo ou fechamento relevante aparecem antes de confirmar; listas completas paginadas, sem corte500.
- Aviso de origem não bloqueia devolução legítima autorizada; não habilita recebimento adicional enquanto `source_issue` persistir.
- Atualização concorrente invalida prévia; resposta perdida mantém pedido exato; histórico manual e original sobrevivem a todas as correções.
- Perfis motorista inclusive mistos não consultam nem executam; entrada por página operacional não herda autorização financeira automaticamente.

Próximo passo mínimo: reader de comparação/restauração e contrato do writer, seguidos de um único diálogo reutilizado pela entrada do recebível. A correção material da origem permanece uma capacidade distinta até ter política e dependências definidas.
