# Entregas e comunicação com operação — ensaio local

Estado atual: **etapa aditiva privada publicada; corte legado e frontend pendentes**. O ensaio inicial abaixo é histórico; publicação, 896 testes e prova no banco real estão em [rollout de entregas](DELIVERY-ROLLOUT-VERIFICATION-2026-08-30.md).

## Escopo exercitado

- Resultado final gravado em uma transação junto com documentos, comprovantes, parada, auditoria e ocorrência interna para operação.
- Viagem precisa ter início real; resultados exigem chegada, exceto cancelamento/pulo. Não se inventam horários históricos.
- Entrega parcial calcula resultados por documento a partir dos itens: uma parada compartilhada pode entregar uma carga e devolver outra. Carga só recebe resultado quando todas as suas paradas terminam; viagem só fecha quando todas terminam.
- Identificador estável por envio, replay com mesmo conteúdo, recusa de chave reaproveitada e índice único por ator/tenant. Reenvio do frontend reutiliza anexos, sem remover provas potencialmente comprometidas em uma resposta perdida.
- Comprovantes existentes não são sobrescritos. Apenas placeholders vazios `pending`/`missing`, da mesma alocação, podem ser preenchidos.
- Anexos precisam existir no bucket e prefixo exatos da parada. Itens precisam pertencer aos documentos/tenant da parada, com quantidades válidas.
- Comunicação informativa passa por RPC própria e cria ocorrência real para operação, com anexos, sem alterar status de entrega e sem conceder aprovação financeira.
- Tela preserva seleção de viagem após a última entrega, dá tratamento de loading/erro e atualiza caches interligados. Rótulos terminais distinguem recusa/devolução/entrega; horários fictícios e conversa simulada foram removidos.

## Evidências

- `src/test/driverDeliveryDatabase.test.ts`: **68 testes** PostgreSQL/PLpgSQL com fixture mínimo; aplica as funções reais de jornada e ocorrência já publicadas, além da nova migração. O logger de auditoria e parte do esquema são fixtures, não uma pilha Supabase completa.
- `src/test/driverDeliverySubmission.test.ts`: **31 testes** de payload único, retry, uploads, limpeza recuperável, rejeição inequívoca versus resposta incerta, comunicações e caches.
- `src/test/DriverDeliveriesComponent.test.tsx`: **11 testes** da tela renderizada, incluindo edição após rejeição, atualização de estado e bloqueio de novo envio para parada encerrada. Backend e alguns componentes visuais são simulados nesse conjunto.
- `scripts/test-delivery-concurrency.mjs`: **5 testes nativos multissessão**, com espera comprovada por `pg_blocking_pids()`. Reproduziu e corrigiu bloqueio ausente do vínculo e deadlock chegada/entrega. Ver [detalhes e limites](CONCORRENCIA-ENTREGAS-2026-08-30.md).
- Gate pós-hardening/reenvio: **826 testes em 85 arquivos**, além dos cinco nativos; tipos/lint/baseline/sintaxe de Edge Functions/build/inspeção pública aprovados. Cobertura configurada não mede o aplicativo inteiro.

## Pendências para liberar o lote ao motorista

Atualização: separação aditiva/corte, derivação privada, captura dos cinco contratos legados e recuperação foram concluídas e ensaiadas. A etapa aditiva foi instalada sem acesso aos papéis API; corte permanece local. Itens 1, 3 e 4 abaixo descrevem o planejamento original, agora atendido conforme o documento de rollout. As demais integrações continuam pendentes.

1. Rever `transition_stop_status_v1` e separar a derivação privada das entregas do agregador legado. A saída física `driver_register_departure` foi corrigida e publicada separadamente, com testes/recovery, sem concluir entrega. Não publicar a substituição de `derive_trip_and_load_status_v1` sem compatibilizar ou encerrar seus chamadores. Ver [verificação da saída](DEPARTURE-VERIFICATION-2026-08-30.md).
2. Ampliar o ensaio de alocações concorrentes à pilha completa, mirrors e demais escritores. Remoção/update do vínculo, replay, conflito de resultado e chegada/entrega já passaram em PostgreSQL nativo com sobreposição comprovada; isso não demonstra ausência universal de corrida/deadlock.
3. Separar publicação aditiva de RPCs da restrição dos caminhos antigos. O wrapper novo de `driver_update_stop_status` rejeita dados incompletos que o frontend antigo enviava; rollout/recarregamento de clientes antigos precisa ser explícito.
4. Capturar contratos completos e construir/ensaiar recuperação de todas as funções substituídas e índices. O rollback da RPC legada, já publicado separadamente, não é rollback do lote de entregas.
5. Compatibilizar a chegada por GPS: o frontend local chama o novo contrato, mas a migração correspondente ainda não foi aplicada. Testar geofence, precisão, captura recente e exceção operacional auditada.
6. Testar `secure-upload` real e configuração do scanner sem ativar serviços pagos. Atualmente os testes de upload são simulados. Reenvio sobrevive a falha de resposta na mesma tela, não a recarregamento/fechamento do navegador; uma fila offline durável ainda não está implementada.
7. Persistir o rascunho/fila além da vida da tela e reconciliar resultados incertos. Rejeições transacionais inequívocas já liberam edição com limpeza segura; resposta incerta continua preservada para replay. Fechar/recarregar a página ainda descarta a tentativa da memória.
8. Completar leitura de anexos e mensagens/respostas reais no detalhe/histórico da ocorrência. Persistir a comunicação inicial não equivale a chat bidirecional ou aprovação da operação.
9. Executar E2E autenticado motorista → operação → portal, incluindo ausência de exposição automática, RLS integrada e confirmação das cargas resultantes. Conta de QA ainda pendente; todas as cargas existentes foram autorizadas para teste.

Nenhuma emissão fiscal, integração SSX ou recurso pago adicional foi acionado. O ensaio inicial foi local; a etapa privada posterior executou writes em produção apenas em transações revertidas, com restauração verificada independentemente.
