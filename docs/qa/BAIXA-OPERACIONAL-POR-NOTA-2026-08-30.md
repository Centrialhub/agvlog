# Baixa operacional por nota — candidata local

Estado: **implementada e ensaiada localmente; não publicada nem liberada como fluxo operacional completo**.

## Escopo corrigido

`20260830102652_add_operational_document_outcomes.sql` adiciona confirmação por nota, sem marcar automaticamente as demais notas da parada. A transação exige operador ativo do tenant, viagem iniciada, parada selecionada explicitamente e chegada existente. Motivo, recebedor quando entregue e horário real informado são obrigatórios; não há preenchimento automático de início, chegada ou saída.

`get_operation_document_context` fornece contexto/revisão. `record_operation_document_outcome` revalida autorização após espera, bloqueia o grafo na ordem da viagem, compara a revisão e aceita reenvio exato pela chave de requisição. Nota, comprovante pendente, evento, histórico e auditoria são gravados juntos ou revertidos juntos. Resultado final anterior exige revisão: esta API **não implementa correção nem reentrega**.

A confirmação manual de entrega gera `manual_receipt` com `status=pending`, sem arquivo nem `received_at` fictícios. Isso não equivale a comprovante recebido/aprovado. Documento final divergente, outro tenant, horário inválido, parada sem chegada ou comprovante real já existente são recusados.

`delivery_document_outcomes` guarda snapshots imutáveis de nota, itens e comprovantes por evento. RLS restringe leitura ao operador ativo do tenant; escrita direta não é concedida aos papéis API. Helpers não têm `EXECUTE` público. O trigger de preservação recusa UPDATE/DELETE; chaves estrangeiras preservam a vinculação histórica. Não houve backfill ou alteração de registros antigos.

Quando a operação resolve uma nota e o motorista conclui as restantes, a candidata preserva o resultado e comprovante anteriores, registra somente as notas efetivamente tratadas pelo motorista e recalcula o resultado agregado. Devolução total/parcial conta apenas mercadoria restante. Histórico divergente do status atual bloqueia nova baixa em vez de virar uma segunda tentativa silenciosa.

Nos cenários de conclusão, o acerto financeiro fica `pending_review`; **zero pagamentos**. A baixa operacional não inventa saída física. Isso não é uma afirmação sobre todos os escritores legados de horários.

## Frontend e recuperação de envio

Os primeiros comandos “Entregue” e “Não Entregue” de `LoadNotesPanel` agora abrem `OperationOutcomeDialog`, com parada e horário em branco e labels associados. O resultado só aparece como confirmado após resposta completa e correspondente à solicitação.

Hook e fila persistem o payload antes do transporte, com versão, tenant, ator e chave estáveis. `OperationOutcomeRecoveryPanel`, montado no layout, recupera explicitamente a mesma solicitação após remontagem/resposta perdida. Web Locks evita envios concorrentes entre abas. Falha de armazenamento impede novo envio; resposta incerta não permite substituição silenciosa do pedido. São persistidos os campos necessários ao replay, incluindo nome do recebedor/motivo; não há token, documento pessoal ou arquivo na fila. Dados pendentes ficam até confirmação, sem reenvio automático.

As consultas de operação, motorista, financeiro e portal são invalidadas, incluindo `portal_shipment_detail_v2`. O formulário de devolução do motorista não oferece itens de notas finalizadas e explica que foram preservadas; eventos informativos continuam podendo consultar os itens. Backend mantém a decisão autoritativa.

A revisão pelas skills Supabase/PostgreSQL orientou autorização, ACLs, RLS e ordem de locks. A revisão React orientou recuperação versionada, separação de contexto e confirmação sem falso sucesso.

## Falhas reproduzidas e testes

Dois testes reproduzem o legado: marcar a nota diretamente não conclui seu grafo nem cria comprovante; reentrega pode gravar `confirmed` antes de falhar na remoção da carga. Essas reproduções **não significam que a reentrega já foi corrigida**.

Durante a revisão da candidata, quatro novas falhas foram reproduzidas antes da correção: devolução total e recusa rejeitavam o detalhamento apenas dos itens restantes; parcial aceitava a devolução de todo o restante; edição legada do status permitia sobrepor o significado de um resultado histórico. Após correção, os mesmos testes passaram.

- **77 testes adicionados em relação ao lote de preparação:** 70 em cinco arquivos novos (2 reproduções do legado, 35 SQL de negócio, 5 frontend/hook/fila/SQL reais, 14 fila/contrato e 14 recuperação) e 7 novos casos renderizados no teste existente do motorista.
- **Gate integral aprovado: 1.455 testes/128 arquivos**, Node 22.23.2 e npm 10.9.4; TypeScript, lint, baseline, sintaxe de 40 Edge Functions, build e inspeção do artefato público aprovados.
- Maior chunk: **488,3 KiB**, limite 500 KiB. Sem source maps ou material secreto reconhecido pelas regras do scanner no artefato. Não equivale a auditoria irrestrita de segredos.
- Cobertura do subconjunto configurado: 93,03% statements/linhas, 65,83% branches, 81,81% funções. Não é cobertura integral do aplicativo.
- **133 ensaios nativos aprovados:** 119 anteriores + 14 deste lote. PostgreSQL 17.11 em loopback, fixture descartável, sem conexão de produção. Encerramento do cluster confirmado após sucesso.
- Concorrência comprovada inclui requisição repetida/divergente, duas notas, revisão obsoleta, membership revogada durante espera, operação versus conclusão do motorista e devolução dos itens restantes após commit operacional.
- Recuperação espera commits de operação e motorista antes de recusar uso existente; preserva histórico, comprovantes e financeiro. Restauração/reaplicação antes do uso preservou as viagens, cerca de 460 ms nesta fixture, sem estimativa para produção.

As execuções iniciais com falha não foram contadas como gates aprovados. Uma incompatibilidade de `replaceAll` com o alvo TypeScript foi corrigida no teste; os ensaios diagnósticos da recuperação encontraram a diferença de catálogo descrita abaixo.

### Limites da evidência

PGlite/PostgreSQL 18.3 executa schema mínimo e SQL real. O ensaio nativo usa chaves, funções e triggers capturados, mas não substitui pilha Supabase completa, Auth/HTTP, Storage real, PostGIS ou Axe autenticado. A chegada da fixture é preparada para o teste, não evidencia GPS. Frontend/SQL integrado utiliza pontes de transporte de teste; não é E2E autenticado. Nenhuma requisição fiscal ou cobrança foi realizada.

## Recuperação protegida e contratos

[Contratos locais](OPERATION-OUTCOMES-LOCAL-CONTRACTS-2026-08-30.json) e [recuperação local](OPERATION-OUTCOMES-RECOVERY-2026-08-30.sql) não são captura nem rollback executado em produção.

O roteiro verifica 11 funções/ACLs, o cache protegido, schema/RLS/políticas/privilégios do histórico e triggers. Recusa uso registrado em histórico, cache ou auditoria, mesmo após espera por transações em andamento. Não apaga negócios para permitir rollback. Antes do uso restaura as duas funções predecessoras e remove os objetos novos. Após uso, exige correção adiante. Recuperações anteriores de itens/documentos agora recusam execução enquanto esta camada existir.

O hash original falhou no PostgreSQL nativo porque PostgreSQL 18 passou a registrar `NOT NULL` de tabelas em `pg_constraint`; PostgreSQL 17 registra a propriedade em `pg_attribute`. A comparação foi normalizada para ler `attnotnull` em ambas as versões e excluir apenas a duplicação `contype=n`. **Não foi removida a checagem de obrigatoriedade:** remover `NOT NULL` continua bloqueando recuperação em PGlite e no ensaio nativo. O restante do schema coincidiu. Referências primárias: [catálogo do PostgreSQL 17](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) e [PostgreSQL 18](https://www.postgresql.org/docs/18/catalog-pg-constraint.html).

Hashes locais de definição, normalizados para LF:

- `driver_record_delivery_outcome`: predecessor `381e01547f4b7b67d1945018151ff3e2`; candidata `6664818c64d992c324fa57bc2cdfd535`.
- `record_operation_document_outcome`: `11ae3f47818aaf4a239279ab33926b4f`.
- `_delivery_result_from_statuses`: `2acc28ff3b14abf6153a535f8b3c23f6`.
- Schema normalizado do histórico: `b7104361d58d881172a72b2edb849d7f`.

## Produção e próximos passos obrigatórios

Leitura independente de produção nesta etapa: PostgreSQL 17.6; `record_operation_document_outcome`, `delivery_document_outcomes` e `save_load_item_preparation` ausentes; API de entrega com hash predecessor e `authenticated=false`. **Nenhuma escrita ou publicação de produção neste lote.**

Pendências que impedem liberar este conjunto:

1. A camada posterior de [correção auditada](CORRECAO-AUDITADA-ENTREGAS-2026-08-30.md) remove `clearDeliveryStatus` e adiciona correção transacional/recuperável da mesma tentativa. `confirmRedelivery`, autosave/detecção de metadados e `saveAll` ainda têm escritores diretos/legados. Fechar esses caminhos e implementar reentrega sem reset nem perda de histórico.
2. Modelar tentativa/vínculo ativo e comprovantes históricos antes de reentrega. Produção ainda mantém unicidade de comprovante por nota. O lote local seguinte implementa versionamento e leitores de comprovantes, sem publicar ou concluir nova tentativa: ver [versionamento e limites](VERSIONAMENTO-COMPROVANTES-2026-08-30.md).
3. Fechar escritores DML/RPC alternativos, mantendo consumidores compatíveis. A tabela de itens já nega escrita direta, mas isso não vale para notas, paradas, alocações e comprovantes.
4. Completar fila durável do motorista, upload real, respostas/anexos e testes operação → motorista → portal, incluindo mudança de contexto, offline e recuperação.
5. Concluir fluxo manual, ingestão e exclusão; testar Auth/RLS/Storage/PostGIS e exceção operacional de GPS, jornada concorrente, despesas/Axe, política de convites e revisão individual de privilégios.
6. Ensaiar e publicar banco/Edge/frontend em ordem compatível. Não publicar este frontend contra RPCs ausentes nem contornar a rejeição anterior dos triggers amplos. Repetir regressão e smoke autenticado depois de cada aplicação.

Todas as cargas existentes estão autorizadas para testes. Autorização de produção continua limitada a **nenhum gasto extra**: nenhum serviço pago adicional, emissão fiscal real, pagamento ou reativação SSX foi acionado.
