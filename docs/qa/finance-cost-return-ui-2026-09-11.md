# Retorno de responsabilidades financeiras — UI local

Implementação congelada em 2026-09-11, sem publicação, commit ou escrita remota por este agente.

## Resultado

A carteira abre a responsabilidade por nome e consulta entradas já registradas, com conta, data, valores registrado/utilizado/disponível e ID de referência. O catálogo é paginado em 30 linhas e usa revisão própria; conflito reinicia na primeira página com nova geração de cache. A seleção passa pela prévia completa; falta de RPC, carregamento ou erro não preservam elegibilidade antiga.

A apresentação distingue responsabilidade original R$30, retorno registrado R$10 e pendente R$20. Campos históricos residual_cents/status não mudaram de sentido. Overlays opcionais preservam leitores antigos; ausência de saldo atualizado é exibida como não informado, nunca zero presumido. Histórico conserva ator, motivo, datas, entrada e pedido. A confirmação declara vínculo com dinheiro existente e conferência bancária separada.

O pedido é persistido antes do envio, com bloqueio entre abas, escopo empresa/ator e prova esperada. Resposta perdida permite repetir somente o pedido original; rejeição conhecida na primeira tentativa pode liberar, mas rejeição posterior a resultado incerto conserva o pedido. Confirmação valida identidades e efeitos; atualização de cache malsucedida não transforma sucesso em resultado incerto.

## Evidências

- Rodada final sessão62148: saída0; 48 testes em 10 arquivos, incluindo14 novos testes de retorno. Log: finance-cost-return-ui-final-2026-09-11.log.
- Lint dos19 arquivos da allowlist: saída0.
- Native informou validação dos três parsers puros nos testes SQL reais74603/80545; evidência desses testes pertence ao agente autor/backend.
- TSC/build global e publicação são responsabilidade da raiz, sem execução adicional deste agente.
- Não houve prova em navegador hospedado nesta rodada. Nenhuma operação bancária ou arquivo real de cliente foi enviado pelos testes UI.

## Escopo de revisão

Allowlist exata com hashes: finance-cost-return-ui-allowlist-2026-09-11.json. Os19 arquivos incluem contratos/client/outbox, diálogo/picker/histórico, integração da carteira, rótulos históricos no resumo e testes. Este documento, a allowlist e o log são os artefatos QA adicionais.

## Ajuste pontual após TSC18587

Corrigida apenas a assinatura do mock CostReturnMovementOptionsChangedError no teste: construtor sem argumentos, compatível com a classe real. A chamada do teste também não passa mensagem. Suíte afetada costDispositionReturnPanel.test.tsx:6 testes passaram, saída0 em05:17:52; lint do arquivo saiu0. Hash atualizado na allowlist. Nenhum arquivo de produto alterado; TSC global final permanece com a raiz. Build80562 passou conforme relato da raiz antes deste ajuste de teste.
