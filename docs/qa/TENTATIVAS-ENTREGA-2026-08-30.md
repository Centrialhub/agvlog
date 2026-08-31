# Tentativas de entrega — fundação e reentrega funcional local

Estado: **etapas A/B e conferência administrativa C implementadas localmente; nenhuma delas publicada**. A migração `20260830135338_introduce_delivery_attempt_allocations.sql` mantém o gate fechado quando aplicada sozinha. A candidata `20260830142048_enable_audited_delivery_reallocation.sql` abre a cabeça de tentativa e adapta seus consumidores, mas ainda não está liberada para implantação. Não aplicar isoladamente nem publicar toda a árvore local.

## Fundação de leitura do fechamento — avanço posterior à etapa C

O contrato e painel de prévia por tentativa estão implementados e testados localmente, **ainda não conectados à página principal nem publicados**. Preservam carga/resultado/frete originais, identificam o saldo reservado da reentrega, não herdam preço e calculam o rateio sobre todas as notas do CT-e antes dos filtros. A criação atômica/idempotente e a revisão financeira continuam pendentes antes da ativação. Ver [contrato, testes e pendências do fechamento](FECHAMENTO-TENTATIVAS-2026-08-30.md): 1.892 testes/153 arquivos no gate e 199 casos nativos aprovados. Os números abaixo são históricos das respectivas etapas.

## Etapa C — conferência administrativa por tentativa

A etapa seguinte removeu o autosave, a detecção com gravação e a substituição integral de metadados de `LoadNotesPanel`. Uma RPC auditada valida o lote inteiro, preserva o JSON não editado e recupera pedidos com resposta perdida. Canhoto exige resultado auditado, é retirado após correção e não acompanha a nota na nova tentativa; códigos de ocorrência também ficam no histórico anterior. Escritores legados de datas/resultados, inclusive aliases, são recusados no commit. O painel mantém rascunhos por sessão/carga/revisão e usa confirmação explícita. Ver [contrato, testes e pendências da conferência](CONFERENCIA-NOTAS-2026-08-30.md).

Esta etapa não conclui os consumidores financeiros/relatórios, a preservação de arquivos no Storage, a revisão fiscal/comercial ou a contenção das etapas B/C. Os resultados numéricos abaixo continuam sendo os resultados históricos da etapa B; o relatório da etapa C registra o gate mais novo.

## Etapa B — avanço local de 30/08/2026

- A RPC `request_document_redelivery` valida ator/tenant, revisão, motivo, saldo integral e medidas físicas explícitas. A transação registra evento/tentativa, aposenta o comprovante ativo e libera a nota sem apagar itens, alocações ou resultados anteriores. O replay exige a mesma chave e corpo.
- Foram materializados adaptadores canônicos de composição, preparação, planejamento, baixa/correção e portal, além do construtor financeiro e dos guards/projeções. A migração confere hashes de 43 dependências locais; isso não substitui um preflight contra o ambiente de destino.
- `get_load_operational_documents` apresenta a nota histórica da carga anterior pelo snapshot da alocação. `LoadNotesPanel` a mantém somente leitura e não a entrega ao autosave/detector de pagamento. A tela não executa mais o reset direto seguido de remoção.
- `get_driver_delivery_items` separa itens por parada/carga/tentativa. A tela do motorista verifica ator/tenant/viagem/parada, preserva notas já concluídas e permite repetir uma leitura que falhou sem descartar o formulário.
- O diálogo de reentrega exige revisão explícita do saldo. Quantidade é derivada no banco; peso, cubagem e pallets não são estimados proporcionalmente no saldo parcial. A fila local versionada é isolada por tenant/ator/nota e não descarta resposta incerta, envelope incompatível ou erro de recuperação. Versão futura de envelope também bloqueia um cliente antigo.
- O acerto anterior permanece preservado. O frete da nota original não é automaticamente reutilizado pela nova tentativa; o novo acerto nasce com revisão de precificação pendente. Nenhum pagamento ou emissão é executado pelos testes.
- Notas com CT-e/NFS-e já emitidos são recusadas **antes** de liberar o saldo. Isso evita liberar uma nota que continuaria bloqueada na anexação. O fluxo de revisão fiscal/comercial que permita prosseguir ainda precisa ser implementado; as flags antigas não são limpas.

Validação desta etapa: **17 testes SQL, 27 testes da fila, 12 testes do contrato de itens, 8 testes da tela operacional e 3 da tela do motorista aprovados**. Os testes de baixa, correção e financeiro também passaram nos três contratos (anterior, fundação e reentrega): **54 casos**, sem substituir os contratos anteriores. O financeiro renderizado continua com mutações interceptadas; não se afirma pagamento E2E.

O ensaio PostgreSQL 17.11 descartável concluiu **182 casos com código zero**, oito novos para esta etapa: migração sem alteração de negócio, grants, revisão/tenant recusados, conflito real de item, dois pedidos simultâneos idênticos, preservação de histórico/financeiro, reset legado recusado e reaplicação recusada. O cluster foi encerrado.

O gate geral final também terminou com **código zero: 1.772 testes em 146 arquivos**, 85 testes a mais que na fundação. Node 22.23.2/npm 10.9.4; tipos, lint, baseline estrutural, sintaxe de 40 Edge Functions, build e scanner de artefato aprovados. Maior chunk: 488,3 KiB (limite 500 KiB). Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches e 81,81% funções — não é cobertura integral do app. `git diff --check` passou. Não ficaram processos de teste em execução.

As primeiras execuções apontaram ajustes na fixture Blob do PGlite/DOM, uma tipagem genérica de leitura e mocks antigos do planejamento que não conheciam a nova RPC. O teste de resposta de outra viagem também motivou mensagem de erro e recarga de itens na tela do motorista. Nenhuma validação de tenant, histórico ou fiscal foi relaxada para obter os resultados finais.

As skills Supabase/PostgreSQL orientaram os locks, os helpers privados e as permissões; a skill React orientou o isolamento de contexto e os envelopes recuperáveis. As fixtures usam SQL versionado e dados sintéticos, sem novo dump de produção. Nenhum acesso fiscal, pagamento, serviço pago ou SSX foi ativado neste lote.

### Pendências obrigatórias antes de publicar a etapa B

1. A etapa C removeu os escritores diretos do painel e a herança de `rec_canhoto`, com API auditada e recuperação. Ainda revisar os demais consumidores e escritores: fechamento/relatórios por tentativa, compatibilidade da ingestão e totais financeiros manuais. Não copiar `delivered_at` ou frete antigo para a nova prestação para contornar incompatibilidade.
2. Exercitar mais de duas tentativas, retirar/reanexar/replanejar o saldo e as leituras do portal após a liberação, incluindo comprovação de arquivos e isolamento de clientes. O ajuste SQL dos leitores não prova sozinho todas essas jornadas.
3. Finalizar revisão explícita de preço/frete e vínculo fiscal da nova prestação; não desbloquear emissão mediante limpeza de flags históricas.
4. Preparar e ensaiar contenção/restauração adiante compatível com a etapa B, sem apagar tentativas e sem restaurar escritores antigos. As contenções anteriores devem recusar o contrato novo.
5. Confirmar versões/grants/triggers no destino e executar frontend/backend autenticados após cada publicação, com dois tenants e o fluxo completo operação → motorista → portal → acerto. Build local não é autorização técnica suficiente para publicar este lote.

## Contrato da etapa A

- `NULL` identifica a tentativa original. As novas colunas não reescrevem vínculos, itens, resultados, comprovantes ou valores antigos.
- `delivery_attempts` preserva a relação com o resultado anterior, sua alocação/parada, ator, motivo, snapshot completo da nota, itens originais, saldo reservado e snapshot financeiro. A tabela é imutável, tem RLS, leitura por operador ativo do tenant e nenhum DML para papéis API.
- Itens e alocações registrados não podem ser alterados, excluídos ou receber acréscimos por escritores legados. Uma atualização também não pode transformar item manual em item fiscal ou trocar a identidade fiscal/tentativa.
- Os guards de alocação leem a nota com `FOR SHARE NOWAIT`. Havendo conflito, recusam com `40001`, sem manter uma alteração parcial ou esperar por um ciclo de locks.
- Views privadas distinguem itens/alocações atuais e resultados ativos. A projeção por alocação foi preparada para consultar o snapshot da tentativa encerrada; seu uso em leitores históricos ainda depende da etapa B.
- `_delivery_redelivery_remainder` calcula saldo a partir do resultado e do evento auditados. Devolução/recusa/falha/não entrega integral usam os itens originais; parcial usa quantidades por item, sem estimar peso, cubagem ou pallets proporcionalmente. O resultado substituído por correção não é elegível.
- O cálculo verifica tenant, nota, parada, viagem, carga, tentativa, alocação única, conjunto de itens e snapshot físico. Saldo inexistente, documento entregue, quantidade incompatível e origem divergente são recusados. Eventos do motorista podem conter várias notas; o saldo permanece separado por nota.
- A validação de uma reserva exige todo o saldo, IDs novos, fontes corretas, medidas explícitas não negativas e pallets inteiros. Rejeita snapshots forjados e segunda utilização do mesmo resultado/alocação. Reservas construídas pelo proprietário nos testes são sempre rollback-only; não constituem API de negócio.
- Um gate explícito impede **INSERT e UPDATE** de uma cabeça de tentativa ativa, inclusive por escritor elevado. A migração seguinte deverá substituir esse gate somente depois de concluir os consumidores. Os guards anteriores de correção continuam ativos.

O schema adiciona helpers privados, não novas APIs `SECURITY DEFINER` executáveis pelo navegador. Views usam `security_invoker=true`; FKs novas têm índices. A aplicação recusa reaplicação e divergência em seis funções reais de baixa, correção e preservação do histórico. O helper de autorização da fixture não é tratado como cópia integral do Auth/RLS hospedado.

## Testes e alcance

- Testes SQL da fundação cobrem cálculo de saldo, múltiplas notas, correção, snapshots, medidas, imutabilidade, identidade, tenant/papel, grants, views atualizáveis e gate fechado.
- As mesmas telas reais de baixa, correção/recuperação e financeiro são executadas contra **dois contratos**: o anterior e a fundação. A nova execução não substitui a cobertura anterior.
- O ensaio PostgreSQL nativo foi ampliado com casos de migração sem alteração de negócio, escrita legada, conflito no lock da nota, ativação recusada, grants, correção concorrente/idempotente e reaplicação recusada.
- Fixtures derivam do SQL versionado, capturas locais já existentes e dados sintéticos. Não houve novo dump de produção, acesso fiscal, transferência financeira ou reativação SSX.

Resultados finais, com processos encerrados e código zero:

- **43 testes SQL da fundação aprovados**. A primeira execução teve expectativas incorretas da fixture (quantidade 1, mas os itens sintéticos têm quantidade 10) e esperava o guard onde o grant já negava a escrita. As expectativas foram corrigidas; nenhuma proteção de negócio foi relaxada.
- **36 testes de telas/SQL nos dois contratos**, 18 adicionais: baixa por nota, correção com recuperação após resposta perdida e estado financeiro produzido pelo banco. As mutações financeiras da UI continuam interceptadas; a recusa SQL é testada separadamente. Não se afirma E2E financeiro hospedado.
- **Gate geral: 1.687 testes em 141 arquivos**, 61 novos em relação ao lote anterior, Node 22.23.2/npm 10.9.4. Tipos, lint, baseline de qualidade, sintaxe das 40 Edge Functions, build e scanner passaram. Maior chunk: 488,3 KiB; limite 500 KiB. Cobertura do subconjunto configurado permaneceu 93,03% linhas/statements, 65,83% branches e 81,81% funções; não é cobertura integral do app.
- **Ensaio nativo: 174 casos aprovados**, oito novos, PostgreSQL 17.11 descartável em loopback. O cluster foi encerrado e o processo terminou com código zero. Os oito novos casos ensaiam a fundação fechada, não a futura ativação/reentrega.
- `git diff --check` passou. Nenhuma alteração em produção, emissão fiscal, pagamento, novo serviço ou reintegração SSX neste lote.

A aplicação das skills Supabase/PostgreSQL orientou RLS, revogação explícita de helpers/views, índices de FKs, locks sem inversão de ordem e ativação separada dos leitores/escritores ainda incompatíveis. Testes locais não comprovam E2E autenticado hospedado nem garantem preservação dos arquivos no Storage.

## Contrato planejado da etapa B — referência

A lista abaixo registra o escopo definido na fundação. O avanço e as pendências atuais estão no início deste documento; implementar a candidata local não autoriza abrir o gate em produção antes de concluir a validação coordenada.

1. **RPC única de reentrega:** validar papel/membership, revisão esperada e chave idempotente; travar viagem/grafo, nota, itens/provas e acerto em ordem consistente; registrar evento e tentativa; aposentar comprovante ativo; avançar a cabeça e liberar a nota numa única transação. Resposta perdida deve ser recuperável com a mesma chave. Sem inventar horários de chegada/saída ou reabrir uma viagem concluída.
2. **Composição/preparação/planejamento:** adaptar `_sync_fiscal_document_load_mirror`, `_change_load_documents`, movimento/replanejamento, `upsert_load_item_v3` e `dispatch_planned_route` para considerar somente itens/alocações atuais. A anexação materializa os IDs e quantidades reservados. Itens antigos continuam na carga anterior; uma desmontagem da nova carga não pode excluir esses itens.
3. **Entrega e histórico:** adaptar locks/validações de grafo, baixa operacional, correção, baixa do motorista, captura do resultado e agregadores. Leituras de viagem antiga usam estado por alocação. Permitir que o motorista conclua outras notas da viagem antiga enquanto a reentrega é planejada; não exigir artificialmente o encerramento de toda a viagem para liberar uma nota finalizada.
4. **Financeiro:** preservar valores, itens, pagamentos e snapshots da viagem anterior. A nova tentativa não pode duplicar automaticamente o frete da nota original; tratamento da nova prestação deve exigir revisão explícita. Não limpar flags fiscais, emitir, pagar ou recalcular acerto aprovado/pago como efeito colateral da liberação.
5. **Leitores:** atualizar documento operacional da carga, lista de itens do motorista, portal e construtor do acerto. Consultas globais por `fiscal_document_id` hoje podem misturar itens de tentativas. A nota histórica da carga anterior deve ficar somente leitura; não alimentar seus editores com o registro atual da nota.
6. **Interface e recuperação:** substituir `confirmRedelivery` por diálogo com saldo, medidas físicas e motivo; congelar contexto e persistir envelope versionado por tenant/ator/documento. Remover resets diretos. Revisar autosave/detecção de pagamento e `saveAll`, que ainda são caminhos legados separados.
7. **Publicação coordenada:** testes frontend/backend após cada aplicação, prova de restauração adiante sem apagar histórico, contenção compatível, navegador autenticado, dois tenants e fluxo corrigir → liberar saldo → anexar → despachar → entregar → portal → acerto. Só então abrir o gate da etapa A e disponibilizar o comando de reentrega.

O objetivo integral permanece ativo. Continuam pendentes Storage referenciado, fila durável do motorista, GPS/PostGIS/exceções, jornada concorrente, despesas/Axe, comunicação/anexos, convites/Auth, revisão individual das funções e ambiente fiscal seguro, conforme o plano prioritário. Todas as cargas podem ser usadas para teste; produção continua condicionada a **nenhum gasto extra**.
