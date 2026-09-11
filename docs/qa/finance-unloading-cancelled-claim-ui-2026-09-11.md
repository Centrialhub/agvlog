# UI54915 — resolver custo após cobrança já cancelada

Alterações locais em 2026-09-11, sem publicação pelo agente.

Preview aceita origem cancelled somente com cadeia auditada verificada, último evento cancel_origin, supplier preservado e revision_after igual à revisão da origem. Não soma versões para produzir saldo. Efeito de nova retirada da cobrança deve ser exatamente0; custo/obrigação continuam comparados aos valores do preview. Active permanece compatível sem campo prior.

Payload acrescenta prior_origin_amendment_id somente no caso cancelled. Outbox preserva o ID explícito e os três efeitos; resposta deve retornar origin_amendment_id igual ao pedido anterior e collection_cancelled_cents0. Resultado incompatível não apaga a pendência. Replay repete o corpo original, sem usar nova revisão ou criar outro evento de cobrança.

Interface: 'Cobrança já cancelada; cancelar custo e obrigação'. Declaração confirma somente efeitos restantes, com referência ao evento anterior. Mensagem confirmada não afirma novo cancelamento da cobrança. Pendência exibe ID do evento, motivos, valores e data do pedido preservado.

26 testes locais aprovados em03:00:58 (contract4/outbox17/panel5), exit0, lint0. Log unloading-cancelled-claim-ui-2026-09-11.log. Casos: cadeia quebrada/ausente, revisão divergente, dupla retirada rejeitada, prior obrigatório/vedado no contexto inadequado, resposta com outro originID preserva pedido, replay exato, confirmação sem nova retirada e regressões active anteriores.

SQL real54915/fechamento/reabertura é validado pelo autor em paralelo; não declarado como executado por este agente. Nenhum TSC global, build, remoto ou Sites nesta entrega.

HashesSHA256:
- unloadingCancellationContract.ts 128779b7d7848898e48d287fe95c6a6cf96160b853e2612c6f7bbbe5e378aceb
- unloadingCancellationOutbox.ts 65eed04af4c2ad29c8968093bd897f92ea9190ba134ca504fdd1c6f6f72f6baa
- UnloadingCancellationConfirmation.tsx be253a6477e146b464ad7d9be1cc6071ae2ea4b311c00eb22ed7ebb433a40e73
- UnloadingCancellationDialog.tsx 5e157b91d4ffd5c7b908b622a41f75c16f44dfda35414fdffe497c5d2dacf6be
