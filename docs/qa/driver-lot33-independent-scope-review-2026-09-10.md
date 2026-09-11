# Revisão independente de escopo — lote motorista 33 — 2026-09-10

Somente leitura de fontes locais; nenhuma execução de migrations, autorização de aplicação, alteração remota ou TSC. Este documento não substitui decisão do coordenador/revisão de aprovação.

## Composição congelada

O manifesto driver-app-hosted-deployment-manifest-2026-09-10.md contém 44 candidatas e descreve homologação em branch. Portanto ele sozinho NÃO identifica o pedido “aplicar 33”. O coordenador informou o subconjunto exato, conferido nos arquivos locais:

141902, 142606, 142613, 143355, 143433, 154758, 154811, 154838, 160603, 170631, 170901, 174335, 181353, 181420, 182124, 182454, 182855, 183025, 190649, 190950, 191008, 191452, 192455, 192744, 193642, 194438, 194846, 195852, 204500, 204602, 211000, 211200, 213021. Todos prefixados 20260910; aplicar na ordem acima apenas após comparação individual do histórico.

O JSON driver-lot33-independent-scope-hashes-2026-09-10.json contém 33 versões, nomes completos, SHA256 recalculados, tamanho e evidências por linha. Isso congela o conteúdo revisado; não verifica bytes remotos, histórico aplicado nem substitui comparação de versão do destino. O relato de 953 testes/95 cenários e build veio do coordenador; não foi repetido nesta análise.

Excluídos explicitamente deste lote: 134948 (custos canônicos no acerto), 211800 (fechamento canônico da carga), 213156 (quarentena e backfill de acertos) e 220847 (candidatos financeiros por movimentos ativos). Nenhuma dependência ausente dessas pode ser implicitamente adicionada ao lote. Também não reaplicar as fundações anteriores 131419/132149/134223/134820.

## Avaliação direta frente ao financeiro

A inspeção dos 33 arquivos não encontrou referência direta a finance_private, finance_commands, finance_fiscal_* ou payroll. A única referência a tabelas de pagamentos/títulos é em 213021: driver_settlement_payments.receipt_url e payables.receipt_url são consultados pelo predicado de retenção de Storage. Logo, 213021 não exige executar 000731→010034 nem abre o gate financeiro; exige as tabelas legadas e o subsistema de retenção já existentes.

As migrations financeiras atuais 000731/002244/003529/004550/005509/010034 têm efeitos próprios sobre folha/pagamentos/fila fiscal. Este lote não altera seus grants, filas, scheduler, projeções ou can_access. Isso é uma conclusão de referência direta, NÃO prova de que toda cadeia de triggers operacionais do catálogo remoto permanecerá sem efeitos indiretos: o writer driver_record_delivery_outcome é envolvido e continua chamando sua implementação anterior e triggers de domínio.

Não considerar gate financeiro falso como modo inativo desse lote. Escritores motorista, operadores, dispatcher e service_role continuam operacionais. O novo fiscal_snapshot do motorista é fotografia de documentos da entrega, não confirmação/autenticação/baixa do recebível fiscal.

## Efeitos ativos que impedem classificar o lote como “só estrutura”

| Fonte | Efeito concreto | Verificação necessária antes da execução |
|---|---|---|
| 154838:171–182,252 | Cria políticas padrão de raio/agendas por tenant. Em clientes ativos com rua/cidade, zera address_lat/address_lng/address_geocoded_at/by, marca pending, gera hash/auditoria e dispara fila por UPDATE. | Contar e capturar estado dos clientes atingidos; confirmar necessidade de invalidar geocodificação, worker/provider e plano de recuperação. Gate financeiro não impede esse bulk update. |
| 170631:6,15 | Preenche supplier_key em templates/lotes de e-mail existentes. | Conferir colisões/valores que receberão normalização e constraints resultantes. |
| 170901:114 | UPDATE de dispatch_stops que dispara rematerialização/sincronização de geofences para coordenadas elegíveis ou fences existentes. | Contar stops/geofences afetados e verificar runtime SSX/escopo antes/depois. |
| 174335:43–47 | Enfileira OCR para canhotos existentes com processed_path/hash e muda estado de receipt para queued. | Medir fila; adaptador OCR permanece sem serviço homologado. Não afirmar que OCR executou ou que job queued está concluído. |
| 181420:198 | Insere adaptador resend_email_v1 implemented=true/enabled=true e portal genérico false/false. | Seed habilitado não envia e-mail sozinho; workers/chamadas posteriores podem fazê-lo. Não publicar consumidores ativos sem verificar canal, segredo e autorização de envio. Nenhum serviço é contratado pelo SQL. |
| 190950:18,137,144 | Marca raio override histórico, dispara ressincronização de stops e cria sentinel de último ponto em geofence_states. | Capturar contagens e observar efeitos em triggers de chegada. |
| 190950:243–251 | cron.unschedule remove job chamado agvlog-schedule-tenants-every-minute se workspace_ssx_accounts, claim_workspace_ssx_dispatch_v1 e API cron existirem. | Conferir job real, command/schedule/owner e substituto workspace funcionando. Guard verifica EXISTÊNCIA, não saúde. Não remove os dois jobs financeiros, mas pode interromper tracking legado. |
| 192455:338 | Reclassifica location_verification_status de todos stops conforme coordenadas/origem/exceção. | Medir distribuição antes/depois; pode afetar elegibilidade de saída/geofence. |
| 194438:14 | Preenche metadados de lacres históricos e evidence_waived_legacy=true para registros existentes, com constraints novas. | Quantificar lacres e inconsistências; waiver é explícito, não prova fotográfica fabricada. |
| 211000:180,182,234,268,310–315 | Materializa/binda canonical_addresses em clientes, stops, fila e geofences; enfileira destinos sem cliente não verificados e não terminados; introduz ledger idempotente operacional. | Conferir volumes, ambiguidade de vínculo e impacto de locks/triggers; manter decisões por IDs. Não é patch sem dados. |
| 211200 | Renomeia writer para driver_record_delivery_outcome_without_fiscal_gate_v1, revoga API do anterior e cria wrapper com request_id, fiscal_snapshot e locks de documentos. | Testar clientes publicados/offline com snapshot atualizado; não transformar conflito em entrega confirmada. |
| 213021 | Resolução auditada de conflito, retenção dos uploads e aposentadoria explícita de dois RPCs service legados. | Ver detalhes abaixo; não estender permissão financeira por inferência. |

Não foi identificado cron.schedule nem emissão HTTP direta nos 33 SQLs; o efeito de cron identificado é retirada do scheduler legado. Há filas/triggers e grants de consumidores que podem ser usados por workers já ativos, logo ausência de HTTP dentro da migration não basta para garantir ausência de processamento posterior.

## 213021 — contrato e fronteiras específicas

- Acrescenta campos de resolução a driver_delivery_fiscal_conflicts (211200), constraints de ação discard, ID de pedido único e hash. Delivery_payload já existe na versão atual211200 e usa ADD COLUMN IF NOT EXISTS.
- Substitui storage_evidence_private.is_retained(text,text,uuid) mantendo predicados legados para POD/dispatch_events/operational_events/driver_expenses/driver_settlement_payments/payables e comprovantes de devolução. Acrescenta caminhos do delivery_payload do conflito. Conflito descartado continua retendo seus uploads.
- Depende de storage_evidence_private.array_contains_path e função/trigger de retenção/cleanup da migration20260901210627, além de proof_of_delivery, dispatch_events, operational_events, driver_expenses, driver_settlement_payments, payables, occurrence_return_sheets e pallet_return_protocols com os campos referenciados. CREATE OR REPLACE da função isolada não garante que trigger/cleanup estejam instalados: confirmar catálogo.
- Revoga todos os grants API do predicado interno e SELECT authenticated da tabela de conflitos, remove policy de leitura direta. Não concede URL assinada nem busca arquivo.
- resolve_driver_delivery_fiscal_conflict_v1 exige auth.uid, tenant ativo igual e operador/admin; ação discard, motivo10..1000, request da resolução e idempotência. Registra auditoria e devolve confirmed=false/replacement_required=true: não cria entrega substituta nem altera obrigação.
- get_driver_delivery_fiscal_conflict_v1 permite somente ao ator original autenticado, com tenant ativo. get_operations_delivery_fiscal_conflict_v1 exige operador/admin e retorna contagens/revisões, sem payload completo/paths. As funções públicas possuem EXECUTE authenticated; o predicado financeiro não é usado nem ampliado.
- Reescreve driver_finalize_delivery(uuid,text,text,text[],text,text,text) e driver_update_stop_status(uuid,text,text) para SEMPRE lançar55000 driver_legacy_delivery_contract_retired. Mantém EXECUTE apenas service_role para erro explícito; não existe bypass funcional pelo serviço. Busca em src e supabase/functions locais não encontrou chamadas atuais dessas duas funções (tipos gerados excluídos). Consumidores externos/publicação anterior não foram inspecionados.
- Postcondition verifica ausência de SELECT direto authenticated e presença das duas RPCs sanitizadas; não comprova todos os cenários RLS/tenant/ator sozinho.
- Não altera acertos, folha, custos, recebíveis, caixa, finance_private.can_access nem grants financeiros. A dependência alegada com financeiro novo não aparece neste arquivo; as referências legadas servem somente à retenção.

## Novas permissões e interfaces — escopo real

141902 cria exports PDF;143433/154811/170631/181420/204500 ampliam e-mail/templates/canais/histórico;142606/182855/191008/194438 ampliam carga/lacres/custódia;142613/154838/170901/182454/190950/192455/194846/195852/211000 ampliam geofences, tracking e geocodificação;174335 é fila OCR. 154758 fornece comandos offline;182124/190649/211200 reforçam evidência de entrega. 191452/204602 cobrem NFSe sem CT-e.143355 apresenta jornada física;160603/181353 preservam qualidade/hash do canhoto;183025/192744/193642 cobrem filtros/nome PDF/observabilidade.

Várias tabelas novas têm grant all para service_role (exports, controles/evidências de carga, lotes e itens de e-mail, templates/replacements, canais/jobs, eventos físicos). Isso é escrita privilegiada deliberada e deve constar no pedido de aplicação, não ser descrito como só leitura. Authenticated recebe funções scoped e SELECT com policies próprias; a restrição financeira de motorista não deve ser aplicada indiscriminadamente a dados operacionais de sua entrega. O driver continua sem autorização financeira.

Não há criação de bucket público nos 33. Caminhos/metadata existentes são protegidos e fluxos PDF/canhoto/e-mail passam a exigir contratos completos. Scanner/upload e Edge Functions continuam requisitos separados de usabilidade; SQL não instala seu runtime.

## Bloqueios concretos para uma liberação genérica do lote

1. Pedido precisa listar os33 e hashes anexos; manifesto44 de branch não expressa sozinho o escopo real de produção.
2. Antes do primeiro apply, comparar versões individualmente e confirmar fundações excluídas já presentes: receipt131419, jornada134223 e auxiliares de workspace/auth/storage/geofence. Não preencher lacuna com outra migration por aproximação.
3. Declarar e medir os bulk updates acima; particularmente154838 invalida coordenadas ativas. Gatefalse não serve de contingência.
4. Conferir substituto do cron que190950 retira, com evidência de execução/saúde. Existência de claim function não garante tracking disponível.
5. Confirmar writer final e runtime publicado compatíveis com GPS/scan/hash/fiscal_snapshot/offline; após211200 e213021 contrato antigo não pode completar entrega.
6. Verificar RLS/ACL e service consumers das novas filas; manter OCR/portal sem alegação de sucesso e sem consumidor externo não homologado.
7. Ensaios citados pelo dono são evidência útil, mas sua correspondência aos hashes33 e ao catálogo alvo deve ser explicitada. Esta leitura não valida resultado remoto nem executou os testes.

Esses pontos descrevem verificações de escopo e execução; este relatório não constitui autorização nem conclusão de que o lote está pronto para aplicação irrestrita.

## Atualização recebida do coordenador após a análise estática

Fonte: preflight live executado pelo dono da frente motorista e transmitido pelo coordenador; NÃO repetido ou observado diretamente por esta revisão.

-154838: 501 clientes atingidos entre510 ativos; colunas de coordenadas/geocode/canonical ainda ausentes no destino. Portanto não há coordenadas nesses campos a apagar neste estado observado (0), embora a migration continue criando/enfileirando501 registros. Relatados0 casos sem número/UF/CEP/endereço curto e1 grupo duplicado com2 linhas; não inferir merge automático dessas identidades.
-174335:0 canhotos e0 jobs OCR existentes; o backfill atual é vazio. Adaptador OCR permanece fail-closed.
-190950: os nomes de jobs pesquisados estão ausentes; para esse estado, remoções esperadas0. O SQL continua contendo unschedule condicionado e isso deve permanecer no escopo/hash.
-211000:2 stops,0 coordenadas e0 geofences; impacto de dados reduzido, sem geofence existente para reescrever segundo essa coleta.
-Worker geocode ausente; default Nominatim com limite1/s e sem cron automático. Não há consumidor publicado que deva drenar a fila neste instante; publicação/execução posterior continua etapa distinta.

Essas evidências reduzem os riscos imediatos de perda de coordenadas, backfill OCR e interrupção de scheduler para o estado coletado. Os itens3/4 anteriores passam de lacunas sem medição a condições verificadas POR OUTRA FRENTE, sujeitas à mesma janela de instalação e à preservação do catálogo. A criação de501 pendências e a mudança de contratos/permissões permanecem efeitos concretos a declarar. Não se exige repetir contagens sem mudança de estado; anexar a evidência do dono com timestamp/consulta é suficiente para rastrear a decisão do coordenador.

Parecer refinado: não encontrei dependência financeira nova em213021 que justifique incluir migrations financeiras adicionais no lote33. A proposta pode ser avaliada como o conjunto exato identificado com os impactos medidos acima; não como “liberar33” genérico, não como ativação de geocode/OCR/e-mail e não como validação independente de produção por este relatório.
