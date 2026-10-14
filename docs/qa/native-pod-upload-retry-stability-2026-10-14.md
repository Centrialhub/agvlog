# POD: retries limitados e scanner indisponível

Task `native-pod-upload-retry-stability-20261014`, owner `CodexNativeOfflineQueue`, checkout `F:/AGVLOG/work/native-pod-upload-retry-stability-20261014`. Base congelada `9496a02b07ba6521790350c0499ecec1c18ecb73`, tree `b4c1a9c4de4c4c5c9bd1ec3ee383f720d2c7128b`. Reserva coordenada de 13 caminhos; nenhum commit, integração ou publicação pelo executor deste QA.

## Problema e causa

O banner iniciava um refetch a cada gravação da própria fila. Cancelar a query não cancelava o upload, e falhas 400/429 voltavam ao estado queued sem prazo. A raiz observou 25 respostas 400, 2919 respostas 429 e nenhum outcome RPC no POD Native; a leitura posterior dos logs encontrou 26 TimeoutError e um StorageApiError. O timeout de 20 segundos do scanner podia atingir o catch genérico do gateway e virar 400 invalid_upload. O erro StorageApiError permanece separado; este patch não atribui sua causa ao scanner.

A raiz também comprovou um upload real único, 201, do PNG original da SignaturePad (1230x178, 6739 bytes, SHA e025635f8cf57709088c6329604726dddfedc7e345ff5ffdcb144beaa2d33748). Esses dados são evidências comunicadas pela raiz; este executor não acessou credenciais, logs privados ou Native. O caminho genérico deliveries/kind:image não impõe minHeight/minWidth. Nenhuma alteração foi feita na SignaturePad.

## Mudança

- Metadados opcionais v1 `synchronization.retry` persistem attempts, failures, nextAttemptAt, lastStatus e lastCode no mesmo envelope dos arquivos. Leitura inválida falha antes de replay. Drafts antigos sem esses campos continuam legíveis; uploadFailures histórico inicia o contador cumulativo sem reset.
- 400, 403, 404, 413, 415, 422 e demais 4xx permanentes ficam needs_attention/upload_failure. Preservam slot, código, hashes, blobs, ledger e os uploads já concluídos. Autorização e conflitos mantêm seus tratamentos existentes.
- 429 aguarda pelo menos 60 segundos, refletindo a quota atual de 10 uploads/60s por ator. Retry-After numérico ou HTTP-date maior é respeitado. Rede/5xx usam 5/10/20/40 segundos; quinta falha cumulativa é terminal. O limite total é 24 operações, incluindo cobrança conservadora de refresh de sessão compartilhado. Progresso bem-sucedido não zera o orçamento.
- Singleflight compartilha a operação real por tenant/actor/requestId. Web Locks, quando disponíveis, serializam abas; a leitura latest ocorre dentro da exclusão. O banner coalesce eventos, usa cancelRefetch:false, ignora seu progresso durante replay e cancela timers/listeners ao mudar escopo/desmontar. Prazo já vencido bloqueado por predecessor não cria timer em ciclo; o evento do predecessor retoma a fila.
- scannerAccepts mantém HTTPS, redirect:error e AbortSignal.timeout(20_000). Timeout, falha de transporte, HTTP não OK, JSON inválido ou clean ausente/não boolean retornam unavailable. O caller existente responde 503; clean:false segue 422 e não autoriza Storage.

O arquivo driverDeliverySubmission permanece abaixo de 500 linhas por extração das classificações para policy. Nenhum limite, regra de lint, ACL, migration, SignaturePad, cleanup ou registry SQL foi alterado.

## QA executado

Node Windows absoluto v22.23.2, SHA256 0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4. Chromium headless Windows qualificado SHA256 ce4635cd0e5dc0e21494542a701f347e91c1f1d821970578d97ed8df4ced50ef. Dependências copiadas por leitura, sem caches/segredos: locks fonte/destino byte iguais SHA256 1b1bbf3972ac1ab07701129db51724a2ca7eb3bc918f9a72081e50c8e65e788d; SDK 2.108.2. EnvDir/cache/artifacts exclusivos; nenhum .env ou .npmrc pessoal lido.

| Gate | Resultado | Evidência em Ctask/native-pod-upload-retry-stability-20261014 |
| --- | --- | --- |
| Vitest, 12 arquivos | 147 testes PASS; 0 skips/falhas | unit-final.json / unit-final.result.json |
| Chromium Windows | 4 casos PASS; 0 skips/falhas | browser-final-results.json / browser-final.result.json |
| App TypeScript | PASS | typescript-third.result.json |
| Lint caminhos alterados | PASS, 0 warnings | lint-second.result.json / lint-browser-final.result.json |
| Quality baseline | PASS | quality-first.result.json |
| Edge syntax | PASS | edge-first.result.json |
| Supabase release | PASS | release-first.result.json |
| Ownership e diff --check | PASS | HANDOFF.json |

Os testes medem comportamento: 400 no quarto slot mantém três uploads e todos os bytes após 100 replays; banner com QueryClient real resiste a 200 eventos; 429 não transporta antes do deadline mesmo após reload; falhas 503 e RPC incerto param na quinta preservando payload/requestId; concorrência UI/replay compartilha uma operação. Os quatro casos Chromium usam IndexedDB, FormData, hashes, PNG/SignaturePad/CSS e Web Locks reais. O caso de duas abas terminaliza 400 com quatro uploads na primeira e zero na segunda, sem outcome RPC.

O scanner é executado tanto como função real extraída por AST quanto pelo handler Edge completo com SDK real e fetch fechado sintético. Timeout/rede/schema/JSON/HTTP produzem 503 e zero Storage; clean:false produz 422/zero Storage; clean:true percorre o Storage sintético existente. Nenhum teste acessa DB, AV real, Storage real, WSL ou Native. As respostas simuladas de outcome e scanner NÃO qualificam aceitação operacional ou POD em produção.

Relatórios intermediários foram preservados: fixture inicial do banner tinha erro de sintaxe e nenhuma assertion; fixtures browser precisaram de preamble, import default da SignaturePad e CSS real. O parser permissivo de Retry-After '-5' foi detectado por teste e corrigido. Esses runs não são usados como PASS. Avisos Git de LF/CRLF e NO_COLOR/FORCE_COLOR não alteram o orçamento de replay; lint final tem zero warnings. O bundle Windows/Node/Chromium foi mantido exclusivo, sem usar um executor alternativo para contornar falha.

## Limites e próximo gate

Web Locks serializam abas e preservam o estado terminal pendente. Após uma confirmação remover a fila, uma aba que já capturou um draft antigo pode realizar HTTP serializado adicional; não há tombstone local novo. O requestId e a idempotência SQL existentes são preservados. Este QA não prova exactly-once de HTTP bem-sucedido entre todas as abas nem revalida SQL/produção.

A raiz deve revisar o delta, fazer stage explícito dos 13 caminhos, commit/freeze, compor com os paths disjuntos de CI e executar primeiro os controles Native limitados 400/429/503. Apenas depois de PASS, parar os controles e realizar POD real no SHA combinado, observando scanner e idempotência. Não repetir o POD original em loop. Evidências anteriores, uploads, perfis e dados devem ser preservados.

Rollback para o cliente 9496 ignora cooldowns e contém o loop conhecido: suspender replay/POD antes de restaurar esse frontend. Preservar SQL/Storage, blobs, IDs e metadados; avaliar compensações individualmente. Este patch e seus testes não autorizam produção nem justificam apagar a fila antiga.
