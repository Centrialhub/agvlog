# Aprovação da obrigação com revisão preservada — UI local

## Comportamento entregue

A página Contas a Pagar oferece **Conferir aprovação** no editor da conta selecionada. A consulta identifica favorecido/ID, valor nominal, pago e situação; quando há custo, mostra custo original e vigente separadamente. A obrigação pode ser apenas complemento do custo. Aprovação não realiza pagamento nem altera valores.

O status aprovado deixou de ser uma opção de transição do formulário genérico. A edição de uma conta já aprovada não reenvia esse status ao salvar outros campos. `useUpdatePayable` rejeita status approved e metadados de aprovação antes de chamar banco, e restringe updates pela empresa ativa. Demais updates continuam disponíveis. Não há fallback raw se as novas RPCs estiverem indisponíveis.

Prévia: `preview_finance_payable_approval(_tenant_id,_payable_id)`; comando: `approve_finance_payable(_payload)`. Contrato alinhado com native85400. O resultado exige status approved, valor, empresa, ator, conta, pedido e revisão do custo iguais aos preservados. O parser puro está disponível para testes SQL reais.

A confirmação owner/admin exige prévia fresca, can_execute, razão entre10 e2000 caracteres e reconhecimento explícito. Refetch/loading/erro ocultam elegibilidade anterior. Uma rejeição por revisão obsoleta exige nova conferência e confirmação, sem aprovação automática da nova quantia.

Outbox local por empresa/ator, WebLocks, comparação do registro antes de substituir/remover, persistência antes de enviar. Pedido incerto mantém UUID, valor, revisão e motivo originais; recuperação não toma valores da nova tela. Rejeição definitiva na primeira tentativa pode liberar; rejeição ao recuperar pedido antes incerto preserva-o. Outro ator/título na resposta mantém pendência. Sucesso confirmado permanece terminal mesmo quando a atualização da consulta falha.

## Evidência local

- 06:03:01: `payableApprovalPanel`4 + `payableApprovalOutbox`5 passaram.
- 06:04:22: `payableApprovalClient`2 + `payableApprovalUpdateGuard`2 + `payablesServerManagement`3 passaram.
- Total16 testes em5 arquivos. Testes comportamentais incluem R$50→rejeição40001→nova préviaR$20, sem envio automático; recuperação após perda de resposta e erro de cache; bloqueio de resposta com status/valor/tenant/ator/cost_revision incompatíveis; ausência de API; refetch; operador sem confirmação; edição comum de conta já aprovada sem reenviar status.
- ESLint14 arquivos: saída0, sem avisos.
- TSC global: coordenação com root, ainda não executado por esta subtarefa.

## Limites

Não houve aplicação SQL, publicação frontend, acesso a Sites ou operação monetária remota. UI usa transporte controlado nos testes; native executa regressões SQL reais85400 incluindo concorrência. Esta evidência não substitui a promoção coordenada da API e da UI. A revisão de autorização definitiva continua no backend.

Allowlist SHA256: `finance-payable-revision-approval-ui-allowlist-2026-09-11.json`.
