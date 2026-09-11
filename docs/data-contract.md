# AGVLog — Data Contract

Fontes de verdade obrigatórias para toda mudança operacional. Telas que tocam apenas em um espelho **estão erradas** e precisam ser corrigidas via RPC.

## Composição de carga

- **Fonte de verdade:** `load_items` (totais, itens, vínculo de NF).
- **Espelho permitido:** `fiscal_documents.load_id`.
- **Toda mutação:** via RPC.
  - `assign_fiscal_documents_to_load(_tenant_id, _load_id, _document_ids)`
  - `remove_fiscal_documents_from_load(_tenant_id, _load_id, _document_ids)`
  - `move_load_items_between_loads(_tenant_id, _src, _tgt, _item_ids)`
  - `delete_load_safely(_tenant_id, _load_id)`
- Nenhuma tela pode dar `UPDATE` direto em `load_items.load_id` nem em `fiscal_documents.load_id`.

## Vínculo viagem-carga

- **Fonte de verdade:** `dispatch_trip_loads`.
- **Espelho permitido:** `loads.trip_id`.
- **Toda criação de viagem:** via `dispatch_planned_route(_payload)`. Inserir direto em `dispatch_trips` está proibido — quebra `dispatch_trip_loads` e `dispatch_stop_documents` e cria viagens que `driver_finalize_delivery` não encontra.

## Vínculo parada-documento

- **Fonte de verdade:** `dispatch_stop_documents`.
- POD (`proof_of_delivery`) deve ser criado **a partir** de `dispatch_stop_documents`. Não confie em `fiscal_document_id` enviado direto pelo frontend.

## Status de parada

- **Fonte de verdade operacional:** `dispatch_stops.status`.
- Lista canônica de status **terminais** vive em `public.stop_terminal_statuses()` e no frontend em `src/lib/status/stopStatus.ts` (`STOP_TERMINAL_STATUSES`).
- Lista canônica de status **ativos** vive em `src/lib/status/stopStatus.ts` (`STOP_ACTIVE_STATUSES`).
- O motorista usa comandos físicos e de entrega separados: chegada por `driver_mark_arrival` com GPS, saída por `driver_register_departure`, resultado por `driver_record_delivery_outcome` e notas por `driver_record_delivery_note`. Os wrappers genéricos legados não são APIs de browser.

## Máquina operacional do App Motorista

O fluxo abaixo é uma cadeia coordenada, mas cada agregado mantém sua própria fonte de verdade. Nenhum status posterior deve ser usado para reescrever silenciosamente um anterior.

| Agregado | Transição principal | Ator autorizado | Evidência/bloqueio | Recuperação |
|---|---|---|---|---|
| Carga | atribuída → aceita → conferida → liberada | motorista designado; operação revisa divergências | veículo, volumes documentais, peso, pallets, documentos pares, lacres e fotos no Storage | comando idempotente; divergência fica pendente até revisão |
| Lacre | installed → removed/broken/missing | motorista designado instala e concilia no retorno; operação acompanha divergências | foto individual na instalação e na resolução, ator/data do servidor e motivo; uma evidência não pode provar dois lacres | estado terminal é imutável; rompimento/ausência abre divergência e bloqueia encerramento normal |
| Viagem | planejada/loading → in_transit → completed | motorista designado inicia/retorna; operação encerra | uma viagem em andamento por motorista, checklist pré/pós e custódia | outbox preserva a mesma `request_id`; conflito exige atenção |
| Parada | pending → arrived → resultado terminal | motorista designado ou entrada SSX na próxima parada | chegada sempre tem GPS ou evidência SSX/geofence; sequência é obrigatória | estado SSX interno recupera chegada quando a próxima parada já está dentro |
| Entrega | arrived → delivered/partial/returned/refused | motorista designado | total/parcial exige recebedor, scan original+processado aceito, assinatura e GPS; recusa/devolução exige foto e itens/documentos afetados | rascunho e blobs ficam no IndexedDB; reenvio conserva a chave idempotente |
| Canhoto digital | pending_upload → uploaded/pending_validation → validated/rejected | motorista captura; operacional valida | exatamente um canhoto por entrega; NF-e, NFS-e, CT-e e referência operacional são pares | rejeição gera substituição versionada, nunca sobrescrita |
| Canhoto físico | pending_return → received/missing/waived | operacional registra; exceção somente owner/admin | viagem não fecha normalmente enquanto houver papel pendente | extravio abre ocorrência; dispensa exige motivo e auditoria |
| Envio ao fornecedor | not_sent → queued/sending → sent/delivered ou failed/bounced | operacional | PDF individual ≤5 MiB, lote por fornecedor, destinatários e modelo versionados | lease, reenvio idempotente e webhook deduplicado |

Regras transversais:

- A entrega é a unidade do canhoto. Documentos são referências pesquisáveis e nunca multiplicam o comprovante.
- NFS-e pode ser associada diretamente à parada; não depende de NF-e ou CT-e intermediária.
- A confirmação captura e envia um snapshot fiscal imutável de NF-e e NFS-e vinculadas à parada. O writer trava a parada e os documentos, recalcula a revisão e rejeita realocação concorrente com conflito auditável. CT-e é referência pesquisável opcional e nunca é precondição do canhoto.
- Um conflito de snapshot não confirma a entrega e não recebe ACK. Original, processado, thumbnail, assinatura e demais fotos continuam retidos até a operação decidir pelo descarte da tentativa; o motorista então cria uma nova tentativa com novo `request_id` e snapshot atual.
- Comandos offline só liberam progressão depois que payload, vínculos fiscais e todos os blobs obrigatórios foram persistidos no aparelho.
- A outbox é reproduzida em ordem causal por viagem: chegada e demais comandos operacionais anteriores precisam receber ACK antes da entrega posterior. A tela de entregas aplica o mesmo overlay local de chegada usado pela tela de paradas.
- Sincronização aplica novamente autorização, tenant, viagem, parada e revisão no servidor. Cache offline nunca concede autorização remota.
- Evidência confirmada não é descartada em timeout, token expirado ou conflito; o registro muda para `needs_attention` quando a reconciliação automática não é segura.
- Geofences de entrega derivam da localização verificada da parada e são somente leitura no cadastro de frota. Geofences de frota são editadas pelo RPC canônico, nunca por `UPDATE` direto.
- O cursor do tracking é o par estável `(captured_at, point_key)`. O processador lê páginas limitadas até receber página vazia e preserva eventos de geofence em reconstruções idempotentes; um fast-pass somente é válido quando um único ponto profundamente interno está delimitado por dois pontos inequivocamente externos.
- O dispatcher de workspace é o único scheduler ativo do pipeline SSX/geocodificação e respeita `tenant_tracking_schedules.poll_interval_minutes` e `full_sync_interval_hours`; intervalos fixos no worker são proibidos.
- Um conflito SSX nunca sobrescreve vínculo automaticamente. `ssx_mapping_conflicts` preserva recorrência, SLA, candidatos e vínculo anterior; somente a RPC de resolução por operador/admin pode criar o novo vínculo, com ator e motivo, mantendo vínculo ativo único e o bloqueio de viagem em andamento.
- `trip_cargo_controls.status='closed'` é o gate canônico para gerar/liberar settlement, registrar pagamento, oferecer a viagem a consumidores financeiros e concluir jornadas físicas. `dispatch_trips.status='completed'` sozinho não autoriza consumo financeiro. Registros legados sem esse gate ficam em quarentena; a reconciliação histórica é administrativa, idempotente e auditável, sem recalcular acertos já aprovados, pagos ou fechados.

## Status público da mercadoria

- Calculado por `public.get_public_shipment_status(_fiscal_document_id)`.
- Considera, em ordem: ocorrência crítica visível → exceções terminais → delivered + POD → delivered sem POD → parada arrived → load in_transit → loading/loaded → planejada.
- Telas do portal usam essa função em vez de lógica TypeScript duplicada.

## Ocorrências

- `operational_events` deve apontar, quando aplicável, para:
  `dispatch_trip_id`, `dispatch_stop_id`, `fiscal_document_id`, `load_id`, `client_id`, `driver_id`, `vehicle_id`.
- Ocorrências do motorista entram por `driver_create_operational_occurrence`: a viagem é obrigatória; parada/cliente/nota/carga só são associados quando há parada explícita. A seleção vazia permanece no escopo da viagem, interna e sem esses vínculos.
- Ocorrências do cliente entram por `create_client_occurrence` — valida acesso ao cliente.
- Ocorrências do operador, com mudança de status, entram por `record_operational_event_with_status`.

## Auditoria

- Toda RPC crítica grava em `entity_audit_log` (composição, status, exceções, downloads).
- A auditoria de consistência completa do tenant é executada via `audit_data_consistency(_tenant_id)` e exibida em `/data-audit` para owner/admin.
- Antes do beta externo a expectativa é que `audit_data_consistency` retorne **zero críticos**.

## Helpers SQL relacionados

| Helper | Para que serve |
|---|---|
| `is_tenant_operator_or_admin(_tenant_id)` | Gate em RPCs de mutação interna |
| `current_driver_id(_tenant_id)` | Mapeia `auth.uid` para `drivers.id` |
| `driver_owns_trip`, `driver_owns_stop`, `driver_can_access_vehicle` | RLS do motorista |
| `portal_user_can_access_fiscal_document`, `..._view_financial`, `..._download_documents` | Gates do portal externo |
| `stop_terminal_statuses()` | Lista canônica de status terminais de parada |
| `_load_is_locked(_load_id)` | Bloqueia mutação em carga em viagem ativa ou já entregue |

## Regras absolutas

- ❌ Nunca `UPDATE` direto em `load_items.load_id`, `fiscal_documents.load_id`, `dispatch_stops.status`, `dispatch_trips.status` ou `loads.status` a partir de tela.
- ❌ Nunca `INSERT` direto em `dispatch_trips` / `dispatch_stops` / `dispatch_stop_documents` a partir de tela.
- ❌ Nunca recalcular status público no frontend para o portal — usar `get_public_shipment_status` (RPC central) ou um campo derivado de `search_client_portal_shipments`.
