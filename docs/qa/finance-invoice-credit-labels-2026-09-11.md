# Fatura e liquidação por crédito — revisão de apresentação

Dois arquivos de produto alterados: ClientInvoiceLifecycleDialog apresenta Liquidado e distingue a orientação de cancelamento pela autoridade can_cancel do contexto; ClientInvoices rotula o indicador como Total liquidado. Não se infere dinheiro a partir de received_cents nem se manda estornar recebimentos quando a liquidação é crédito e o servidor permite cancelar.

Dois testes UI passaram: título com crédito40 e can_canceltrue oferece cancelamento e envia o comando com revisão exibida; título misto liquidado45/can_cancelfalse preserva bloqueio e não inventa parcela em dinheiro. Teste controla contexto porque esta etapa é de apresentação; a prova econômica SQL crédito/fatura pertence à suíte customerCreditApplication do núcleo. Não alterados comandos, schema nem regras de cancelamento. Lint dos3arquivos passou. Sem TSC global, publicação ou edição dos17arquivos frozen da devolução.
