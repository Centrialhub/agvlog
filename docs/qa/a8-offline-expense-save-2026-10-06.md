# A8: salvar despesa offline antes do transporte

Base:487cf59e94aaddf627096fc8c5108ea43b486032. Correção de fronteira frontend, sem SQL, migrations ou mudanças de Auth/RLS/outbox.

## Evidência e classificação

O revisor registrou três reproduções em UI4187: salvar offline mantém “Salvando...”; duas observações mostram mutation pending/isPaused e nenhum rascunho/PDF no IndexedDB. Referências somente de leitura: task-3/487-A8-NATIVE-ACCEPTANCE.json,487-A8-OFFLINE-UI-BLOCKER-REPRODUCTION.json e487-A8-OFFLINE-SAVE-BLOCKER.md. O bloqueio aparece antes do reload: não depende da observação posterior de falha no bootstrap offline, que continua pendente de atribuição/teste nativo.

Erros anteriores de fixture são separados: falta de dispatch_trip_loads corretamente impediu driver_start_trip; helper antigo causou erro de preparação; receipt_path na projeção de uma linha física deveria ser receipt_url. A reconciliação nativa de perda de resposta online comprovou comando/PDF preservados e um efeito com replay; não aprovou o salvamento offline.

O hook useDriverExpenseSubmission deixava a mutation submit no networkMode padrão online. Query Core pausa antes de chamar submission.submit, portanto a persistência existente nunca é executada. A correção configura networkMode always somente em submit. Persistência, validação do PDF, locks, UUID, identidade/tenant, verificação da rede, upload, ACK e replay permanecem os mesmos. Não há envio offline: submission.submit salva primeiro, retorna queued quando navigator.onLine é falso e só remove após confirmação compatível. Replay mantém seu modo original.

## Verificação local

A regressão driverExpenseOfflineUiMutation.test.tsx usa formulário e QueryClient reais com identidade, transporte e armazenamento de memória sintéticos; não substitui useMutation/useDriverExpenseSubmission. Casos: acknowledgement somente após persistir; replay do mesmo UUID/payload/PDF; falha de storage retém campos e não sinaliza salvo; mudança de actor impede acknowledgement tardio e mantém o rascunho na origem.

O script test-driver-expense-offline-ui-browser.mjs executa formulário/hook reais, configuração QueryClient da aplicação, validação/hash de PDF, Web Locks e IndexedDB em Chromium descartável. Identity/context e ACK remoto são sintéticos; toda rede externa é bloqueada. A fixture aplica offline após criar a página, como a reprodução nativa; aplicação inicial de offline na criação do contexto não mudou navigator.onLine nesta versão, e essa tentativa foi excluída da prova de produto. A prova antes usa --expect-paused sobre o hook487; a execução normal exige sucesso offline, reload real com o mesmo comando/PDF, leitura isolada por actor, reconexão sem apagar antes do ACK e storage indisponível sem falso sucesso.

A navegação servida por interceptação também redefiniu navigator.onLine no reload; a tentativa foi preservada como falha da fixture. O script reaplica offline nativo antes de montar hooks/agente de replay. A prova demonstra persistência através do reload e remount verdadeiramente offline, não inicialização de PWA sem rede.

Browser fixture não valida cache/service worker/bootstrap PWA, GoTrue, PostgREST, Edge, concorrência de banco, CI hospedado ou produção. Nenhum serviço/teste/dado do revisor é utilizado.

## Handoff e reteste

Congelar o sucessor com bundle/delta desde487 e logs do próprio SHA. Os19objetivos permanecem pendentes nesse SHA; resultados487 são histórico, sem aprovação herdada. Repetir A8 com GoTrue/contexto/PDF nativos: salvar verdadeiramente offline confirma fila durável; reload offline conserva UUID/payload/blob; reconexão envia uma despesa/upload compatíveis; resposta perdida/retry mantém idempotência; troca de usuário/empresa/revogação não envia pela identidade errada; sem armazenamento, manter entrada e erro sem confirmar salvo. Reavaliar separadamente bootstrap/PWA offline.

Os26forwards, ambos manifests e forwardA6E1/rollbackC8 permanecem byte-idênticos; nenhum SQL adicional para esse sucessor. Fontes487/987/1e/manual/task-2 e serviços do revisor permanecem protegidos. Não retirar500AuthQA nem copiar Auth/StorageA13. Sem enqueue/integrate/push/deploy/commit final de release. Retorno frontend pode usar487 preservado, com fila e banco mantidos.
