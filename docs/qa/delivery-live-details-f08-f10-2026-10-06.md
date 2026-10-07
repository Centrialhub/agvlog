# F08 e F10: detalhe atual de entrega e descrições acessíveis

Tarefa `delivery-live-details-f08-f10-20261006`, owner `CodexDelivery`, worktree `F:/AGVLOG/work/delivery-live-details-f08-f10-20261006`. Base exata `61adbbb997667396541244da147b224defb22e94`, fonte congelada preservada em `F:/AGVLOG/work/operational-chat-access-20261006`. SHA/tree de entrega e hashes do delta constam do manifesto externo `C:/Users/Thomaz/Documents/Codex/2026-10-06/task-3/handoff/candidate.json`.

## Comportamento corrigido

Detalhe, catálogo e formulário selecionam a parada por ID no contexto tenant/ator/motorista/viagem. O conteúdo aberto deriva da lista atual, incluindo documento, saída, cliente e status, sem fechar/reabrir. O formulário guarda a última identificação somente para preservar a prova de uma tentativa cuja parada desapareceu; novas ações dependem sempre da parada atual. Detalhe e catálogo removidos/reatribuídos perdem a seleção definitivamente, mesmo se o ID reaparecer.

O contexto tem uma geração por visita: respostas de uma visita anterior são descartadas mesmo após retornar ao mesmo ator. A consulta de paradas inclui ator na chave e consome AbortSignal; linhas de outro tenant/viagem não entram na visão efetiva. Snapshots exigem tenant/ator/viagem compatíveis e um resultado online autoritativo sem viagem não ressuscita uma viagem do cache. Uma leitura antiga de snapshot não atualiza a tela após perder seu contexto.

Os três sheets sinalizam atualização, erro e tentativa de recarga. Ações novas ficam bloqueadas durante atualização, erro, terminalidade ou envio pendente. O envio revalida parada/contexto/viagem após aguardar GPS e usa o status atual antes de criar uma tentativa. Retry imutável e reconciliação de confirmação de um envio já despachado permanecem preservados.

Cada sheet monta SheetDescription com o ID gerado pelo Radix, oferecendo contexto para o leitor de tela. O foco permanece no diálogo durante Tab/ShiftTab e retorna ao botão de origem ao fechar a cadeia detalhe → catálogo → formulário; quando o botão deixa de existir, o título da página é o destino de retorno.

O hook reservado `src/hooks/useDriverDeliverySelection.ts` concentra seleção, foco e projeção/persistência de snapshot. A página tem 476 linhas, abaixo do cap crítico 499 já existente; baseline não foi ampliado.

## Validação local

Node 22.23.2/npm 10.9.4; dependências próprias do lockfile no worktree desta tarefa. Configuração de execução aponta para `https://unit-tests.supabase.invalid` com chave publicável sintética. Nenhum banco, serviço, login real, réplica ou dado produtivo foi usado.

Referência antes da correção: `DriverDeliveriesComponent.test.tsx`, 26/26 testes no SHA 61adbbb9 e árvore limpa. Esse resultado é separado da validação do delta.

Código final: 124/124 testes em cinco arquivos:

- `DriverDeliveriesComponent.test.tsx`: 49. Saída/documento/status atualizados, respostas tardias, seleção diferente, fechar/reabrir, remoção/reatribuição, tenant/ator/viagem, retorno ao mesmo ator, dados ausentes, erro, rascunho e concorrência durante GPS/envio; regressões existentes preservadas.
- `DriverDeliverySheetsAccessibility.test.tsx`: 4. Três sheets reais em jsdom: aria-describedby resolve elemento existente, descrição acessível, ausência do warning específico, foco inicial, ciclos de Tab/ShiftTab, Escape, Fechar e reabertura; guard de viagem encerrada após pré-requisito assíncrono.
- `driverDeliveryEventReportedBugs.test.ts`: 4.
- `driverDeliveryItems.test.ts`: 12.
- `driverDeliverySubmission.test.ts`: 55, incluindo idempotência/retry e confirmação incerta existentes.

TypeScript, lint dos sete arquivos de código/testes com zero warnings, baseline estrutural geral, build de produção, orçamento de bundle, verificação do artefato público e diff-check passaram. Logs/comandos/horários e relatório Vitest ficam no diretório externo `handoff`; o manifesto associa os hashes de código verificados ao commit entregue.

## Limites e handoff

Os testes de tela usam transporte, identidade e operações simulados; os componentes Radix são reais. Não são prova de SQL/RLS, Auth nativo, realtime WebSocket, concorrência de banco, navegador/leitor de tela nativo, homologaçāo autenticada, Quality gate completo hospedado ou produção. O revisor 01a0f93e continua dono dos testes na réplica. Retestes integrados devem usar o mesmo SHA/tree/contrato final combinado.

Não houve alteração de regra de negócio, banco, Edge Functions, serviços compartilhados, emissão fiscal, F06/F07, F05 fiscal, changed_by, AGENTS ou UI Sheet global. Sem enqueue, integrate, push ou deploy. Integração é responsável pelo congelamento formal; não foi criado um sucessor artificial.

Nota própria: `F:/Vault/Main Vault/05 Sessoes/Correção AGVLOG/2026-10-06-0945-CodexDelivery-f08-f10-detalhe-atual-aria.md`. Índice comum e notas alheias preservados.
