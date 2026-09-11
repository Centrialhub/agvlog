# Baixas residuais por desconto/perda — UI local (2026-09-11)

Estado: implementação local em integração com o núcleo 15046. Não publicada por este agente; sem execução SQL remota. O autor SQL confirmou que o envelope público da fatura propaga os campos de composição. Root informou testes reais da fronteira 121356 com os três parsers, replay e autorização.

## Fluxo implementado

Em Recebimentos, “Conferir desconto ou perda” abre prévia e histórico do título. A composição distingue nominal preservado, dinheiro recebido, crédito aplicado, desconto, perda, total liquidado e saldo aberto. Gestor só confirma quando a prévia atual retorna can_execute; edição/refetch/erro ocultam a permissão anterior. RPC ausente apresenta indisponibilidade.

Reversão é selecionada no histórico paginado por evento original, com valor parcial permitido pela prévia. Não há digitação de UUID nem geração de crédito ou movimento bancário. Motivo e checkbox vinculam a confirmação à revisão exibida.

Outbox por empresa/ator usa Web Locks, grava corpo e efeitos antes do transporte, repete o pedido original após resposta desconhecida e confere todos os IDs/ação/categoria/data/valor/efeitos antes de remover. Outra aba não tem registro sobrescrito ou apagado. Sucesso confirmado permanece terminal quando a atualização do cache falha. A recuperação apresenta os valores originais antes/depois armazenados.

## Compatibilidade de composição

Campos antigos received_amount/received_cents continuam significando total liquidado. Ausência conjunta de discount/loss/adjustment mantém compatibilidade com versões anteriores; presença parcial, valores nulos incoerentes, soma incorreta ou total por categoria divergente falham. Carteira agrega strings inteiras sem Number e aceita totais acima de sua precisão. Snapshot de fechamento sem composição comprovada mantém NULL, sem inventar dinheiro.

Os caches atuais de recebíveis, carteira, crédito, fatura, fechamento, auditoria e prévia/agenda da previsão são invalidados. Snapshots preservados não são reinterpretados. Histórico próprio usa revisão e epoch para reiniciar efetivamente depois de 40001, inclusive com staleTime Infinity.

## Evidência local até 09:17

44 casos distintos passaram nas suítes focais e regressões: composição/limites/NULL; contratos command/preview/result; transporte com this do SDK preservado; outbox resposta perdida/replay/ator/concorrência de abas; sucesso mais cache falho; edição/refetch; paginação histórica; totais grandes da carteira; rótulos de fatura e crédito; fechamento. Lint dos novos módulos e dos consumidores editados executados até aqui sem diagnósticos. TypeScript global/build não executados por este agente nesta rodada.

Contratos validados pelo teste SQL real executado por root (09:15:50); fatura confirmada pelo autor e parser local testado. Allowlist em finance-receivable-adjustment-ui-allowlist-2026-09-11.json. Pendentes root: TypeScript/build global e decisão de publicação após concluir demais frentes SQL. O autor SQL controla autorização gerencial, fechamento e datas mínimas; estes testes de UI não substituem as contraprovas do banco.

Revisão adicional 09:24: os rótulos de data referem a data comprovada da origem; falta de prova tem mensagem própria. Refresh agora invalida fontes atuais de previsão com snapshot_id NULL, preserva fontes históricas/snapshots e outras empresas, com teste focal. Lint dos deltas passou. Allowlist atualizada com 37 arquivos.
