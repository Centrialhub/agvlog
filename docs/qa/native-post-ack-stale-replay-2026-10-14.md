# Retomada antiga após remoção da fila: contraprova e guard

Task `native-post-ack-stale-replay-20261014`, owner `CodexNativeOfflineQueue`; base combinada congelada `c68a128ea944412820f5af8191ff604c80f0c36e`, tree `eef0daaff0489cf4e8b70cd4bd44c0320107599d`. Quatro caminhos reservados. Stage/commit/freeze e qualquer Native pertencem à raiz; este QA não integrou nem publicou.

## Antes: comportamento quantificado na fonte 083b

Fonte anterior preservada `083b53eca5dd7c5902f6f82d439f989799052e7a`, tree `3a1d723f338c980c7361b8b28fd8a54befcd11b4`, check coordenado frozen/operation:test PASS. Três contraprovas Windows externas executaram os módulos reais da fonte, IndexedDB, Web Locks e o banner/QueryClient. O primeiro RPC foi retido por HTTP mock; as outras abas capturaram o draft com quatro uploads, payload preparado e attempts=5 antes do primeiro ACK, depois esperaram o lock real.

| Caso | Uploads totais | RPCs totais pós-ACK | IDs distintos | Novas chamadas após 100 eventos/aba +100 replays manuais +reload |
| --- | ---: | ---: | ---: | ---: |
| 2 abas, banner automático | 4 | 2 | 1 | 0 |
| 2 abas, replay manual | 4 | 2 | 1 | 0 |
| 4 abas, banner automático | 4 | 4 | 1 | 0 |

Duplicação automática finita foi observada: N abas já em espera produziram N RPCs seriais, com o mesmo requestId/payload e nenhum reupload. Não houve ciclo automático ilimitado nesses casos. Após remoção, cada snapshot antigo iniciou attempts=5 e gravou novamente attempts=6; o orçamento não acumulava entre snapshots já removidos. Uma ação manual normal de replay consulta a fila atual e não encontra esses pedidos depois da remoção. `DriverDeliveries.resetForm` também limpa submissionRef no sucesso. Uma construção externa deliberada de novo factory com snapshot antigo não é uma ação automática implementada pela UI.

Evidências anteriores: `Ctask/native-post-ack-stale-tabs-20261014/{auto-2,manual-2,auto-4}.json`, `run-result.json` e `results.json` (3/3 PASS). A primeira tentativa, erro de CSS/Tailwind no cwd externo antes de qualquer upload/RPC, foi preservada como `first-*` e não conta como PASS. Nenhum arquivo da fonte 083b foi alterado.

## Guard mínimo

Dentro da operação serializada, `run` relê a fila. Se há `options.durableDraft` capturado e o pedido já não está presente no escopo tenant/actor, lança o sinal interno `DeliveryReplaySuperseded` antes de hash, persistência, upload ou RPC. O replay conta `superseded`, não `confirmed` nem `rejected`, e calcula pending/attention/stopIds a partir da fila real restante.

Ausência local não é prova de confirmação remota: não há ACK inventado, retorno queued fictício, tombstone, cache de confirmação ou novo schema IndexedDB/SQL. Uma retomada direta antiga recebe erro conservador pedindo atualização da fila. Pedido ainda presente usa o registro latest e seus cooldowns. O botão de sincronização existente usa confirmedCount; com zero confirmações mostra “Nenhum envio confirmado”, e o banner não mostra pendência quando a fila real está vazia.

Somente driverDeliverySubmission mudou em runtime (462 linhas, limite existente preservado). Arquivos de teste e este QA completam os quatro paths. SignaturePad, gateway, políticas de retry, SDK, Auth, actor/tenant guards, migrations, ACL, SQL/Storage e cleanup não foram modificados.

## Depois: mesma contraprova no sucessor

| Caso | Uploads totais | RPCs totais | Resultado de cada retomada antiga | Gravações da fila pelas abas antigas |
| --- | ---: | ---: | --- | ---: |
| 2 abas, automático | 4 | 1 | confirmed=0, rejected=0, superseded=1, pending=0 | 0 |
| 2 abas, manual | 4 | 1 | confirmed=0, rejected=0, superseded=1, pending=0 | 0 |
| 4 abas, automático | 4 | 1 | confirmed=0, rejected=0, superseded=1, pending=0 | 0 |

Todos os IDs e o payload do primeiro ACK permanecem estáveis. Cem eventos por aba, cem replays manuais e reload acrescentaram zero uploads/RPCs. Os relatórios instrumentados em `Ctask/native-post-ack-stale-replay-20261014/counterproof-after` registram o cadastro da fila lido antes do ACK, a espera real no Web Lock, as releituras vazias e a ausência de writes nas secundárias. Os resultados são vinculados aos hashes da árvore de trabalho no handoff, antes do commit pelo coordenador.

## Gates e limites

- Vitest: 202/202 testes, 14 arquivos, zero skips/falhas. Inclui regressões de DriverSyncPending/DriverDeliveries, SDK/handler sintéticos existentes e três casos novos: corrida após remoção, 100 retomadas diretas antigas sem IO remoto/persistência, e uso do deadline latest.
- Chromium Windows: 7/7 casos do repositório, zero skips/falhas; quatro regressões anteriores preservadas e três pós-ACK. Contraprova externa depois: 3/3 PASS, independente da contagem do primeiro conjunto.
- App TypeScript, lint dos paths alterados com zero warnings, quality baseline, ownership e diff --check: PASS. Nenhuma regra ou limite foi aumentado.
- Node absoluto v22.23.2 SHA256 `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`; Chromium qualificado SHA256 `ce4635cd0e5dc0e21494542a701f347e91c1f1d821970578d97ed8df4ced50ef`. Locks byte iguais SHA256 `1b1bbf3972ac1ab07701129db51724a2ca7eb3bc918f9a72081e50c8e65e788d`; dependências copiadas por leitura com exclusão de segredos/caches. EnvDir/cache/artefatos próprios.

Os ACKs e a tabela de idempotência da contraprova são modelos HTTP sintéticos. Não qualificam SQL, scanner, Storage, SSX, Native nem produção. Nenhum desses serviços foi executado por este executor. A raiz ainda deve validar o SHA coordenado/final e os controles Native antes de POD real/publicação. Preservar 083b/c68a, evidências, dados e uploads; rollback para o cliente anterior ao anti-storm continua exigindo suspensão de replay/POD.

Runs intermediários foram preservados: novos casos browser inicialmente tinham mode=permanent e não chegaram ao primeiro RPC; o script externo after tinha literal de newline e não executou testes. Ambos foram corrigidos apenas nas fixtures, sem mudança adicional de runtime. Avisos de LF/CRLF e NO_COLOR/FORCE_COLOR são ambientais; lint final tem zero warnings.
