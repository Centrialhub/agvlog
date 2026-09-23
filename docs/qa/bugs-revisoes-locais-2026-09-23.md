# Registros de bugs das revisões locais — 23/09/2026

Este registro preserva os achados locais posteriores ao Bug 1609. Sua numeração foi criada em paralelo ao histórico de `docs/bugs.md` do `main` remoto e pode se sobrepor a ele.

RESOLVIDO
###############

Bug 1610

Sintoma: Gerar qualquer arquivo DOCCOB pela versão atual termina com `doccob_bundle_mismatch`, impedindo registrar e baixar até arquivos válidos.
Provável causa: `doccobGenerator.generateDoccob` envia em `contentHash` um hash proprietário de 13 caracteres produzido por `simpleHash`. A migração `20260917030000_fix_reported_billing_closing_integrity.sql` passou a exigir que `_content_hash` seja o SHA-256 hexadecimal de 64 caracteres de `_generated_content`; os dois algoritmos nunca produzem o mesmo valor.

RESOLVIDO
###############

Bug 1611

Sintoma: Uma fatura que possui detalhes vinculados a uma cobrança cancelada não consegue gerar DOCCOB, mesmo quando todas as cobranças ativas e seus detalhes estão corretos.
Provável causa: O gerador inclui somente cobranças com `cancelled_at IS NULL` e, consequentemente, conta somente os detalhes delas. A validação autoritativa de `register_doccob_export`, porém, compara `_detail_count` com todos os `client_invoice_details` das faturas, sem restringir aos `charge_id` das cobranças não canceladas, produzindo `doccob_bundle_mismatch`.

RESOLVIDO
###############

Bug 1612

Sintoma: Um operador pode registrar uma exportação DOCCOB do próprio tenant apontando `profile_id` ou `client_id` para registros de outra empresa, deixando o histórico com referências cruzadas e perfil/pagador incompatíveis com as faturas incluídas.
Provável causa: `register_doccob_export` valida o tenant de `_client_invoice_ids`, mas insere `_profile_id` e `_client_id` exatamente como recebidos. As FKs de `billing_edi_exports` referenciam apenas o `id`, e a função `SECURITY DEFINER` não confirma que perfil e cliente pertencem a `_tenant_id`.

RESOLVIDO
###############

Bug 1613

Sintoma: Quando existem dois perfis DOCCOB ativos para o mesmo cliente — ou mais de um perfil global — a geração escolhe silenciosamente um deles pela ordem alfabética do nome, podendo usar banco, destino, layout e padrão de arquivo errados.
Provável causa: Não há unicidade para perfil ativo por `(tenant_id, client_id)` nem bloqueio na gravação. `useEdiProfiles` ordena por `name` e `clientProfile` usa o primeiro `find` habilitado, sem detectar ou pedir resolução da ambiguidade.

RESOLVIDO
###############

Bug 1614

Sintoma: O DOCCOB aceita como CNPJ da transportadora qualquer sequência não vazia, inclusive um único dígito ou um documento com dígitos verificadores inválidos, e gera o registro 351 com esse identificador artificialmente preenchido até 14 posições.
Provável causa: `handleGenerate` verifica apenas se sobra algum dígito e `validateDoccobExportInput` testa apenas presença. Não existe validação de comprimento ou dígitos verificadores antes de `generateRecord351` formatar o valor como campo numérico fixo de 14 caracteres.

RESOLVIDO
###############

Bug 1615

Sintoma: Pela API, um operador pode cancelar um DOCCOB já cancelado repetidas vezes, cancelar um arquivo já enviado ou registrar cancelamento sem motivo; um ID inexistente também retorna sucesso sem alterar nada.
Provável causa: `cancel_doccob_export` não normaliza/valida `_reason`, não bloqueia a linha, não restringe o status de origem e não confere `ROW_COUNT`. A função sempre executa os `UPDATE`s e retorna normalmente, inclusive quando nenhuma exportação de `_tenant_id` corresponde ao ID informado.

RESOLVIDO
###############

Bug 1616

Sintoma: Um CT-e cuja consulta ao provedor expirou pode aparecer como autorizado na Pesquisa e no Monitor apenas porque recebeu um ID remoto, liberando ações de download e cancelamento sem confirmação de autorização da SEFAZ.
Provável causa: `mapSearchOutboundStatus` e `mapOutboundStatus` convertem `sefaz_status = 'status_timeout'` em `processed` sempre que `hub_document_id` existe. O ID identifica a operação no Hub, mas não prova resultado fiscal; as próprias rotinas de limpeza classificam `status_timeout` como falha terminal.

RESOLVIDO
###############

Bug 1617

Sintoma: Após solicitar com sucesso o cancelamento pela Pesquisa de CT-e, a linha continua exibida como autorizada e o botão “Cancelar CT-e” permanece disponível, permitindo repetir a ação até uma atualização manual ou outro evento externo.
Provável causa: `useCancelCTe.onSuccess` invalida documentos fiscais, Monitor, lotes e visões financeiras, mas omite a query `cte_search` usada pela página que disparou o comando. O caminho de erro também omite essa invalidação, embora o proxy possa ter persistido um novo estado fiscal.

RESOLVIDO
###############

Bug 1618

Sintoma: Um CT-e transmitido e associado ao seu rascunho pode continuar mostrando e exportando chave de acesso vazia; downloads recebem então nome baseado apenas no número ou UUID, embora a chave autorizada exista em `fiscal_documents`.
Provável causa: Ao unir um `cte_documents` a seu `fiscal_documents`, `useCteSearch` usa o registro correspondente para IDs e status, mas monta `access_key: r.access_key` sem fallback para `match.access_key`. A chave autoritativa é descartada especificamente nas linhas mescladas.

RESOLVIDO
###############

Bug 1619

Sintoma: Na Pesquisa e no Monitor de CT-e, documentos existentes somente em `fiscal_documents` exibem o remetente como “Pagador”, mesmo quando o tomador do frete é destinatário, expedidor, recebedor ou terceiro; busca e CSV também atribuem a cobrança à parte errada.
Provável causa: A construção de `hubRows` define incondicionalmente `payer_name: d.remitter`. O snapshot `cte_payload` contém `tomador.role` e os dados da parte correspondente, mas esses campos não são interpretados para determinar o pagador.

RESOLVIDO
###############

Bug 1620

Sintoma: Operações com estado remoto “À Cancelar” (`cancel_pending`) podem ficar indefinidamente apresentadas apenas como “Pendente”, sem sincronização automática para descobrir se o cancelamento foi aceito ou rejeitado.
Provável causa: Os mapeadores de status reconhecem `cancelling`, mas não `cancel_pending`, que cai no retorno padrão `pending`. O polling automático da Pesquisa consulta exclusivamente linhas mapeadas como `cancelling` ou `processing`, portanto uma linha com ID no Hub nesse estado nunca entra no intervalo de sincronização.

RESOLVIDO
###############

Bug 1621

Sintoma: Usuários de leitor de tela não conseguem distinguir os botões de visualizar DACTE, baixar PDF/XML, cancelar, recuperar ou excluir em cada linha da Pesquisa de CT-e; eles são anunciados como controles sem nome.
Provável causa: Os botões de ação contêm somente ícones decorativos e atributo `title`, sem texto visível, `aria-label` ou descrição associada. `title` não fornece um nome acessível confiável para tecnologias assistivas e tampouco identifica a qual CT-e cada ação pertence.

RESOLVIDO
###############

Bug 1622

Sintoma: Se um acerto for aprovado, pago, recalculado ou alterado enquanto o usuário avança na paginação, a página seguinte pode falhar e ocultar todos os dados com a mensagem genérica de indisponibilidade, em vez de avisar que a coleção mudou e reiniciar automaticamente na primeira página.
Provável causa: `list_driver_settlements_v2` agora rejeita o cursor antigo com `settlement_snapshot_changed`, mas `useDriverSettlements` repassa qualquer erro da RPC sem convertê-lo em `DriverSettlementSnapshotChangedError`. O efeito de recuperação de `DriverSettlements` depende exclusivamente de `instanceof DriverSettlementSnapshotChangedError`; a conversão existente foi implementada apenas na consulta das opções de filtro, e o teste aceita esse falso positivo por procurar as strings no arquivo inteiro.

RESOLVIDO
###############

Bug 1623

Sintoma: Depois de avançar ao menos uma vez no Histórico de Importações, novos relatórios deixam de aparecer mesmo ao voltar à primeira página ou usar “Tentar novamente”; sem filtros ativos, o usuário precisa sair da tela e entrar novamente para renovar a listagem.
Provável causa: Ao clicar em “Próxima”, `IngestionReports` fixa `snapshotAt` com o instante da primeira resposta e nunca mais o limpa ao navegar entre páginas nem ao refazer a query. O único caminho que chama `resetPage` é alterar ou limpar filtros, portanto todas as consultas posteriores continuam enviando o snapshot antigo e o RPC exclui relatórios criados depois dele.

RESOLVIDO
###############

Bug 1624

Sintoma: Ao percorrer as páginas da consulta antiga de Centros de Custo enquanto lançamentos são criados ou alterados, linhas podem se repetir, ser puladas ou mudar de página, e os totais/gráfico exibidos em uma página podem representar um conjunto diferente daquele usado nas páginas já consultadas.
Provável causa: `get_legacy_cost_center_report_v1` recompõe cinco tabelas vivas em cada chamada e pagina com `LIMIT/OFFSET` ordenado por `occurred_at`, `source_type` e `id`, sem snapshot ou revisão da coleção. `LegacyCostCenters` guarda somente o número da página, de modo que inserções e alterações entre requisições deslocam os offsets e recalculam agregados sobre outro universo.

RESOLVIDO
###############

Bug 1625

Sintoma: Pesquisar literalmente `%` ou `_` em Cercas Virtuais pode retornar cercas que não contêm esses caracteres — `%` pode inclusive fazer todas as categorias corresponderem — tornando a busca incapaz de localizar nomes com esses símbolos de forma confiável.
Provável causa: `get_geofence_dashboard_v1` escapa barra invertida e `%` somente no predicado de `geofence.name`, mas não escapa `_`; no predicado alternativo de `category`, concatena `search_text` diretamente ao `ILIKE`. Assim, os dois metacaracteres continuam sendo interpretados como curingas em pelo menos um dos ramos da busca.

RESOLVIDO
###############

Bug 1626

Sintoma: Ao navegar pelas páginas de Cercas Virtuais enquanto outra pessoa cria, remove ou altera uma cerca, registros podem aparecer novamente, ser pulados ou mudar de página; a contagem e o número máximo de páginas também podem mudar durante a mesma travessia sem avisar que o conjunto deixou de ser consistente.
Provável causa: `get_geofence_dashboard_v1` pagina a tabela viva com `LIMIT/OFFSET` ordenado por `created_at, id`, sem snapshot, cursor ou revisão esperada. `Geofences` conserva apenas o número da página e cada requisição recalcula `matched` e `total`, portanto qualquer mutação anterior ao offset desloca as fronteiras já percorridas.

RESOLVIDO
###############

Bug 1627

Sintoma: Se a correção da conta de um extrato for confirmada no banco mas a resposta se perder, repetir a ação pode registrar novamente a mesma “correção” e criar eventos de auditoria duplicados, embora a conta já esteja no estado solicitado; uma chamada direta também consegue reatribuir o extrato à própria conta atual como se houvesse mudança.
Provável causa: `reassign_finance_statement_account_v1` não recebe `request_id`, não mantém resultado idempotente e não rejeita `_account_id = statement_import.bank_account_id`. Cada chamada válida executa os dois `UPDATE`s e insere incondicionalmente outro `finance_events`, usando apenas locks para serialização, sem distinguir repetição da intenção já concluída.

RESOLVIDO
###############

Bug 1628

Sintoma: Quando um funcionário possui mais de um contrato dentro da mesma competência, a folha calcula um único item salarial com a soma proporcional de todos eles, mas atribui esse valor inteiro somente ao contrato mais recente; auditorias e correções posteriores não conseguem identificar quais contratos realmente compuseram o salário.
Provável causa: A versão atual de `generate_payroll_period` soma todos os segmentos sobrepostos em uma subconsulta de `employee_contracts`, porém conserva `source_table = 'employee_contracts'` e `source_id = _emp.contract_id` no único `payroll_entry_items` inserido. `_emp.contract_id` vem do `LEFT JOIN LATERAL ... ORDER BY start_date DESC LIMIT 1`, portanto os demais contratos usados no cálculo não recebem vínculo nem decomposição própria.

RESOLVIDO
###############

Bug 1629

Sintoma: Depois de avançar ao menos uma vez na paginação dos períodos da Folha de Pagamento, folhas criadas posteriormente por outro usuário continuam invisíveis mesmo ao voltar à primeira página ou quando a consulta é atualizada automaticamente; sem provocar um erro ou mudar algum filtro, não há ação de atualização explícita para renovar esse recorte.
Provável causa: Ao clicar em “Próxima”, `Payroll` fixa `snapshotAt` e `collectionRevision` em `periodPaging` e preserva ambos ao navegar para trás. Todas as consultas seguintes continuam excluindo períodos com `created_at` posterior ao snapshot; a revisão também é calculada somente sobre os candidatos anteriores a esse instante, então uma nova folha não gera conflito que ofereça o botão de reinício.

RESOLVIDO
###############

Bug 1630

Sintoma: Se alterar o status ou o responsável de uma Falta de Mercadoria for rejeitado — por conflito de revisão, transição inválida, referência incompatível ou indisponibilidade — a tela não mostra erro nem orienta a atualizar; a seleção aparenta simplesmente não persistir e pode gerar rejeição assíncrona não tratada no navegador.
Provável causa: Os `onValueChange` da tabela chamam `updateStatus.mutateAsync(...)` diretamente, sem `try/catch`, e `useUpdateShortageStatus` não define `onError`. Isso afeta status, tipo de responsável, motorista e fornecedor, inclusive o novo erro `shortage_case_revision_changed` introduzido pela concorrência otimista.

RESOLVIDO
###############

Bug 1631

Sintoma: Se uma importação de Faltas de Mercadoria for concluída no banco mas a resposta se perder, tentar novamente com a mesma prévia não recupera o resultado: a tela recebe `shortage_import_file_identity_mismatch` e apresenta falha, embora os casos já tenham sido criados.
Provável causa: `commitImport` gera `crypto.randomUUID()` dentro de cada tentativa e não preserva o `request_id` junto de `preview`/`previewFingerprint`. O backend só reconhece replay quando o mesmo request ID acompanha o mesmo payload; ao ver o mesmo `file_hash` com outro ID, rejeita deliberadamente a chamada, tornando a idempotência inacessível ao frontend após resposta incerta.

RESOLVIDO
###############

Bug 1632

Sintoma: Se coletas, canhotos ou ocorrências do portal mudarem enquanto o cliente carrega a página seguinte, toda a lista já carregada é substituída por um erro genérico; o botão específico “A lista mudou — atualizar”, criado para reiniciar o snapshot, não chega a aparecer.
Provável causa: `PortalPickups`, `PortalPods` e `PortalOccurrences` testam a propriedade geral `error` antes de renderizar os dados. Uma falha de `fetchNextPage`, inclusive `portal_list_snapshot_changed`, preenche essa propriedade junto de `isFetchNextPageError`; porém o controle de recuperação fica dentro do ramo de sucesso da lista (e, em Canhotos, ainda exige `!error`), tornando-o inalcançável justamente no conflito que deveria tratar.

RESOLVIDO
###############

Bug 1633

Sintoma: Downloads autenticados de CT-e, NFS-e e títulos no portal ignoram o nome de arquivo calculado pelo servidor; em especial, o PDF de um título é salvo com o UUID (`titulo-<id>.pdf`) em vez do número da cobrança, dificultando identificar o documento baixado.
Provável causa: `downloadPortalFile` tenta ler `Content-Disposition` da resposta cross-origin da Edge Function, mas os `corsHeaders` compartilhados não incluem `Access-Control-Expose-Headers: Content-Disposition`. Como esse cabeçalho não é exposto ao JavaScript pelo navegador, `response.headers.get('content-disposition')` retorna `null` e o frontend usa sempre o `fallbackFilename`.

RESOLVIDO
###############

Bug 1634

Sintoma: Para empresas configuradas fora do fuso de São Paulo, registrar manualmente entregas do dia pode rejeitar a data civil correta perto da meia-noite ou gravar o horário de término com deslocamento, alterando `last_update_at` e a classificação da rota como “Sem atualização”.
Provável causa: A migração `20260917152400_use_operational_date_for_driver_progress.sql`, posterior à correção de fuso do monitoramento, recria `private.add_driver_progress_unsafe_20260917` usando novamente `America/Sao_Paulo` tanto em `v_today` quanto no `AT TIME ZONE` de `v_update_at`. Esse escritor não consulta `private.driver_monitor_tenant_timezone(v_tenant)`, embora previsão, importação e cálculo de status tenham sido migrados para o fuso do tenant.

RESOLVIDO
###############

Bug 1635

Sintoma: Em um fechamento com mais de 30 movimentos, “Documentos identificados” e “Movimentos sem comprovante vinculado no fechamento” mostram apenas os resultados da página atual como se representassem o registro inteiro; ao avançar os movimentos, as contagens e os documentos preservados mudam, ocultando comprovantes das outras páginas.
Provável causa: `get_finance_account_period_evidence_page` substitui `snapshot.facts.movements` pelo recorte paginado antes de devolver a evidência. `AccountPeriodEvidenceIndexPanel` passa esse snapshot parcial a `buildAccountPeriodEvidenceIndex`, que calcula documentos e comprovantes ausentes exclusivamente sobre esses movimentos e ainda oferece uma segunda paginação local baseada no tamanho parcial, sem usar `movement_page.total` nem acumular as páginas do fechamento.

RESOLVIDO
###############

Bug 1636

Sintoma: Após uma falha de rede incerta ao reverter uma devolução de crédito, se outra sessão concluir a reversão antes da recuperação, a tentativa local passa a responder `refund_reversal_unavailable` para sempre e não oferece forma de encerrar ou descartar o pedido preservado, embora o vínculo já esteja revertido.
Provável causa: `reverseCustomerCreditRefund` mantém o registro em `localStorage` quando ele já estava marcado como `uncertain`, mesmo que a repetição receba um erro definitivo como `55000`. Como o RPC verifica primeiro o mesmo `request_id`, esse retorno prova que a tentativa preservada não foi a que confirmou a reversão; ainda assim a chave não é removida, todas as chamadas seguintes reutilizam o pedido obsoleto e `CustomerCreditRefundPanel` não expõe ação de descarte.

RESOLVIDO
###############

Bug 1637

Sintoma: A suíte `productionConfiguration.test.ts` falha no contrato de dependências de todas as Edge Functions ao chegar à recém-adicionada `portal-download-file`, impedindo a verificação de produção de passar.
Provável causa: `supabase/functions/portal-download-file/deno.json` fixa somente `@supabase/supabase-js`; é o único dos 48 arquivos `deno.json` de funções que não declara também o alias versionado `@supabase/supabase-js/cors`, exigido pelo inventário comum da suíte.

RESOLVIDO
###############

Bug 1638

Sintoma: A suíte `productionConfiguration.test.ts` falha no contrato que inventaria handlers com credencial administrativa, mesmo quando executada apenas com os testes do novo proxy de download e de configuração.
Provável causa: `portal-download-file/index.ts` usa `SUPABASE_SERVICE_ROLE_KEY`, mas a lista literal `serviceRoleHandlers` do teste não foi atualizada para incluir `portal-download-file`; o inventário esperado tem 45 nomes e a varredura atual encontra 46.

RESOLVIDO
###############

Bug 1639

Sintoma: A suíte `supabaseBaselineContract.test.ts` falha em “makes every forward public-table Data API decision explicit” e bloqueia a checagem agregada ao apontar `portal_download_audit:missing_grant_or_private_decision`.
Provável causa: A migração `20260917152500_proxy_and_audit_portal_downloads.sql` cria a tabela pública com RLS e revoga o acesso da Data API, mas `portal_download_audit` não foi incluída em `intentionallyPrivateForwardTables` e tampouco recebe um grant deliberado; assim, o contrato não consegue distinguir a decisão intencional de mantê-la exclusiva ao service role de uma omissão de permissão.

RESOLVIDO

###############

Bug 1640

Sintoma: A suíte `allRoutesSmokeContract.test.ts` falha e a página protegida de ajuda pode quebrar em produção sem que o smoke E2E de todas as rotas carregue seu chunk ou detecte a tela de erro.
Provável causa: `AppRoutes.tsx` registra a rota absoluta `/help`, mas `e2e/all-routes-smoke.spec.ts` não inclui `"/help"` em `internalRoutes`; o contrato de cobertura compara as rotas declaradas com esse inventário e acusa explicitamente `missing smoke route for /help`.

RESOLVIDO

###############

Bug 1641

Sintoma: Na tela Clientes e Fornecedores, pesquisar literalmente `%` retorna todos os cadastros; `_` também funciona como curinga de um caractere e a barra invertida pode alterar o padrão, tornando impossível buscar esses símbolos de forma confiável.
Provável causa: O frontend remove `%` e barra invertida antes de chamar `list_operator_clients_page_v1`, convertendo uma busca composta só por esses caracteres em busca vazia. O RPC aplica o texto recebido diretamente em `ILIKE`, no qual `%`, `_` e barra invertida possuem significado especial. A correção preserva o texto digitado e escapa os metacaracteres antes de enviá-lo ao leitor paginado.

RESOLVIDO

###############

Bug 1642

Sintoma: Em navegadores configurados fora do fuso de São Paulo, registrar abastecimento, despesa, coleta ou ORT com uma data/hora válida pode falhar imediatamente com “Data e hora local inválida”, sem enviar o formulário; no próprio fuso de São Paulo o mesmo valor é aceito.
Provável causa: `localDateTimeInputToIso` calcula corretamente o instante de `datetime-local` em `America/Sao_Paulo`, mas valida o resultado chamando `localDateTimeInputValue`, que monta ano, mês, dia e hora com `Date#getFullYear`, `getMonth`, `getDate` e `getHours` no fuso do navegador. A comparação final só coincide quando o dispositivo usa o mesmo relógio de São Paulo; a função é usada por `FuelingTab`, `DriverExpenseForm`, `ExpenseCreationForm`, `NewPickupOrderDialog` e `NewManualOrtDialog`.

RESOLVIDO

###############

Bug 1643

Sintoma: Em telas estreitas, abrir conferência ou evidências de fechamento no Financeiro pode alargar toda a página para pelo menos 44rem e deslocar cabeçalho, navegação e demais controles para uma rolagem horizontal global, em vez de limitar a rolagem à tabela.
Provável causa: `finance-workspace.css` aplica `min-width: 44rem` a todo `table` descendente. Tabelas nativas como as de `AccountPeriodClosePreview`, `AccountPeriodEvidencePanel`, `CashPeriodEvidenceSummary` e `CashForecastComparisonPanel` não estão dentro do contêiner rolável do componente `Table` nem de um wrapper `overflow-x-auto`; portanto o mínimo global transborda diretamente de `.finance-workspace` em viewports móveis.

RESOLVIDO

###############

Bug 1644

Sintoma: Ao abrir Extratos importados, Auditoria financeira, Previsão de caixa, Recebíveis fiscais, Faturas por cliente, Arquivo de cobrança, Fechamentos, Aprovação de despesas ou Centros de custo, a barra “Áreas do financeiro” não contém a página atual e nenhum item fica marcado como ativo, prejudicando orientação e navegação entre áreas correlatas.
Provável causa: `isFinancialPath` inclui essas rotas e faz `AppLayout` renderizar `FinanceWorkspace` nelas, mas o array `destinations` possui apenas oito destinos. Além disso, todos os `NavLink` usam `end`, então o item `/financial` também não serve como indicador para as subrotas omitidas.

RESOLVIDO

###############

Bug 1645

Sintoma: Depois da atualização que isola presets de Ocorrências Operacionais por empresa, todos os presets personalizados já salvos somem do menu sem aviso e precisam ser recriados manualmente, embora os dados antigos continuem ocupando o `localStorage`.
Provável causa: A tela deixou de ler `opEvents.presets.v1.<user_id>` e passou a consultar exclusivamente `opEvents.presets.v2.<user_id>.<tenant_id>`. Não existe fallback, migração ou mensagem sobre a chave anterior; o efeito de inicialização interpreta a ausência da nova chave como lista vazia e nunca oferece os presets v1 para atribuição ao tenant atual.

RESOLVIDO

###############

Bug 1646

Sintoma: Ao abrir a Central de Ajuda a partir de uma área e depois selecionar uma categoria diferente, o cartão “Ajuda para esta área” continua oferecendo “Ver orientação”, mas o clique não leva a conteúdo algum porque o guia indicado não está mais presente na página.
Provável causa: `currentGuide` é calculado apenas pelo parâmetro `from` e o cartão contextual ignora o estado `category`; já a lista `results` remove guias de outras categorias. A âncora continua apontando para `#<currentGuide.id>` mesmo quando nenhum elemento com esse `id` foi renderizado.

RESOLVIDO

###############

Bug 1647

Sintoma: Quando uma busca não encontra guias dentro da categoria selecionada, clicar em “Ver todos os guias” pode continuar exibindo apenas os poucos guias daquela categoria, em vez de restaurar a coleção completa como o botão anuncia.
Provável causa: O estado vazio chama somente `setQuery('')`; o estado `category` permanece com o filtro anterior. Assim, `results` continua exigindo `guide.category === category` mesmo depois da ação “Ver todos os guias”.

RESOLVIDO

###############

Bug 1648

Sintoma: Abrir a visão geral do Financeiro dispara imediatamente as consultas de destinação de custos, conferência do período e fretes a faturar mesmo com as três seções recolhidas; a tela continua pagando o custo e aguardando quatro leituras que o usuário pode nunca abrir.
Provável causa: `FinanceSection` usa apenas um `<details>` fechado para ocultar visualmente os filhos, mas sempre renderiza seu conteúdo. Por isso `CostDispositionsPanel`, `PeriodMoneyPackagePanel` e `UnbilledFreightPanel` são montados na carga inicial e seus hooks executam, respectivamente, uma, uma e duas queries independentemente do estado aberto do `<details>`.

RESOLVIDO

###############

Bug 1649

Sintoma: Durante a abertura do Dashboard, os gráficos semanais podem afirmar “Sem dados de métricas”, as listas podem informar “Nenhum alerta”, “Nenhum evento nas últimas 24h” e “Nenhum veículo está offline” enquanto as respectivas consultas ainda estão em andamento; segundos depois, esses estados aparentemente definitivos são substituídos pelos dados reais.
Provável causa: `weeklyMetrics`, `recentAlerts`, `recentEvents` e `vehiclesForChart` recebem `[]` enquanto suas queries estão pendentes, mas esses blocos verificam apenas `isError` antes de renderizar o estado vazio. Diferentemente dos cards de KPI, eles não tratam `isPending`/`isLoading` nem exibem um estado de carregamento.

RESOLVIDO

###############

Bug 1650

Sintoma: Se o Dashboard permanecer aberto durante a virada do dia, “Km hoje”, “Viagens hoje”, os gráficos de sete dias e a lista de eventos das últimas 24 horas continuam usando o recorte do dia anterior; novos dados também podem não aparecer enquanto o usuário permanece na tela ativa, até recarregar, trocar o foco ou ocorrer alguma invalidação externa.
Provável causa: As queries `dashboard_metrics`, `dashboard_weekly`, `dashboard_recent_alerts` e `dashboard_recent_events` calculam datas relativas apenas dentro de `queryFn`, não incluem o dia civil na `queryKey` e não configuram `refetchInterval` nem agendamento para a próxima meia-noite. Permanecer montado não provoca nova execução quando o relógio cruza o limite do período.

RESOLVIDO

###############

Bug 1651

Sintoma: Em empresas configuradas fora de `America/Sao_Paulo`, a ficha do veículo pode preencher uma data diferente do “hoje” da empresa e incluir ou excluir posições, viagens, paradas, excessos de velocidade e combustível nas horas próximas à meia-noite; os KPIs “Km hoje” e “Viagens” também podem consultar o dia civil errado.
Provável causa: `VehicleDetails` chama `localDateInputValue()` e `optionalLocalDateUtcRange(historyDate)` sem fornecer `currentTenant.timezone`. Ambos usam o fallback fixo `America/Sao_Paulo`, embora a empresa ativa exponha seu próprio fuso e os filtros consultem colunas temporais UTC.

RESOLVIDO

###############

Bug 1652

Sintoma: Abrir a ficha de um veículo apenas na aba “Visão Geral” já pode baixar milhares de posições e todos os registros do dia de viagens, paradas, excessos de velocidade e combustível, além do catálogo inteiro de POIs, deixando a abertura lenta e consumindo banco/rede para abas que o usuário pode nunca visitar.
Provável causa: `historyQuery`, `tripsQuery`, `stopsQuery`, `overspeedQuery`, `fuelQuery` e `poisQuery` ficam habilitadas sempre que há empresa, veículo e data válidos; nenhuma delas considera `activeTab` nem a abertura do diálogo de POI. Apenas as queries de Alertas e Geofences foram condicionadas às respectivas abas.

RESOLVIDO

###############

Bug 1653

Sintoma: Duas viagens legítimas do mesmo veículo separadas por menos de cinco minutos aparecem como uma única viagem na ficha, reduzindo a contagem e criando uma linha artificial que soma distância e tempos de movimentos distintos; registros produzidos por modos diferentes também podem ser fundidos.
Provável causa: `consolidatedTrips` mescla incondicionalmente o próximo registro quando `gap < 5`, usando somente a diferença entre `current.end_at` e `next.start_at`. O algoritmo não exige IDs/origens equivalentes, sobreposição, mesmo modo de detecção ou qualquer outra evidência de que os registros sejam fragmentos da mesma viagem.

RESOLVIDO

###############

Bug 1654

Sintoma: Se as leituras de combustível de um veículo mudarem entre percentual e litros no mesmo dia, a ficha pode exibir o valor final com a unidade errada e calcular uma “Variação” sem significado, por exemplo subtraindo 40 litros de 80% e apresentando o resultado como se as grandezas fossem comparáveis.
Provável causa: O cartão “Fim do dia” usa `fuelReadings[0].fuel_unit` para rotular a última leitura, e o cartão “Variação” subtrai diretamente o primeiro e o último `fuel_value` sem verificar `fuel_unit`. A tabela aceita qualquer texto em `fuel_unit` e não existe normalização ou bloqueio de séries com unidades distintas.

RESOLVIDO

###############

Bug 1655

Sintoma: Na aba Paradas da ficha do veículo, “Salvar como POI” pode falhar para qualquer novo ponto com o erro de que não existe restrição única compatível com `ON CONFLICT`, impedindo cadastrar o local mesmo quando ainda não há POI naquela coordenada.
Provável causa: `savePOIMutation` executa `upsert(..., { onConflict: 'tenant_id,dedupe_key' })`, mas o esquema não possui uma constraint única integral nessas colunas; existe somente o índice único parcial `idx_pois_tenant_dedupe ... WHERE dedupe_key IS NOT NULL`. O `ON CONFLICT (tenant_id, dedupe_key)` gerado não inclui esse predicado e não consegue inferir o índice parcial como árbitro.

RESOLVIDO

###############

Bug 1656

Sintoma: Um operador comum consegue abrir “Gerenciar POI” na ficha do veículo e tentar salvar um novo ponto ou vincular a parada a um existente, mas ambas as ações terminam em erro de permissão apesar de a interface apresentá-las como disponíveis.
Provável causa: A rota `/vehicles/:vehicleId` e o item Veículos aceitam qualquer papel interno, e `VehicleDetails` não verifica `currentRole` antes de renderizar os comandos. Entretanto, as únicas policies de escrita de `pois` e `trip_stops` exigem `is_tenant_admin(tenant_id)`; membros não administradores possuem apenas `SELECT` nessas tabelas.

RESOLVIDO

###############

Bug 1657

Sintoma: Um operador comum pode abrir a aba Abastecimento da ficha do veículo, preencher “Novo Abastecimento” e enviar o formulário, mas a gravação sempre falha com `admin_required`, embora a interface apresente o comando como permitido.
Provável causa: `/vehicles/:vehicleId` está disponível a qualquer papel interno e `FuelingTab` renderiza o botão e o diálogo sem consultar `currentRole`. Já `create_vehicle_fueling_with_odometer_v1`, chamado por `useCreateFueling`, rejeita explicitamente quem não satisfaz `is_tenant_admin(t)`; as policies de `vehicle_fueling` também reservam escrita a administradores.

RESOLVIDO

###############

Bug 1658

Sintoma: Um operador comum consegue abrir “Nova Manutenção” e “Nova Leitura” de odômetro na ficha do veículo, preencher os diálogos e tentar salvar, mas as duas operações são rejeitadas por permissão somente depois do envio.
Provável causa: `MaintenanceTab` e `OdometerTab` não verificam o papel do usuário e são montadas na rota interna compartilhada `/vehicles/:vehicleId`. Seus hooks gravam diretamente em `vehicle_maintenance` e `vehicle_odometer`, cujas únicas policies de `INSERT`/`UPDATE` exigem `is_tenant_admin(tenant_id)`; membros comuns possuem apenas leitura.

RESOLVIDO

###############

Bug 1659

Sintoma: No Resumo de Notas Importadas, notas de uma carga finalizada como entrega parcial, devolvida, recusada ou falha podem aparecer como “Processado” em vez de refletir que a entrega não foi concluída normalmente, especialmente quando o documento não recebeu `delivery_meta` individual.
Provável causa: `resolveNoteStatus` reconhece em `loads.status` somente `in_transit`, `delivered` e os estados preparatórios. Os estados terminais canônicos `partial_delivery`, `returned`, `refused` e `failed` não possuem ramificação; como a nota ainda tem `load_id`, o fallback posterior devolve `processed`.

RESOLVIDO

###############

Bug 1660

Sintoma: Ao abrir no Excel o CSV do Resumo de Notas Importadas, um remetente, destinatário, cidade, número de documento ou outro valor importado iniciado por `=`, `+`, `-` ou `@` pode ser interpretado como fórmula, permitindo conteúdo ativo controlado pelo arquivo fiscal dentro da planilha exportada.
Provável causa: `exportImportedNotesCsv` apenas duplica aspas internas e envolve cada célula em aspas duplas. Ele não usa `csvSafeCell` nem prefixa valores perigosos para neutralizar fórmulas; aspas de CSV delimitam o campo, mas não impedem que aplicativos de planilha interpretem seu conteúdo como expressão.

RESOLVIDO

###############

Bug 1661

Sintoma: Para uma empresa configurada em um fuso diferente de `America/Sao_Paulo`, o horário informado em abastecimentos, despesas, coletas e ORTs é salvo deslocado em relação ao relógio operacional da empresa; uma coleta marcada às 10h em Manaus, por exemplo, é interpretada como 10h de São Paulo.
Provável causa: `localDateTimeInputValue` e `localDateTimeInputToIso` não aceitam um timezone e usam sempre `APP_TIME_ZONE` (`America/Sao_Paulo`). `FuelingTab`, `DriverExpenseForm`, `ExpenseCreationForm`, `NewPickupOrderDialog` e `NewManualOrtDialog` chamam esses helpers sem consultar `currentTenant.timezone`.

RESOLVIDO

###############

Bug 1662

Sintoma: O guia “Usar o aplicativo do motorista” da Central de Ajuda não pode ser utilizado pelo público a que se destina: motoristas não conseguem abrir a Central, e usuários internos que veem o guia são expulsos dos três atalhos do aplicativo ao clicar neles.
Provável causa: `/help` usa `ProtectedRoute` com o gate interno padrão, que redireciona o papel `driver` para `/driver`. Ao mesmo tempo, o guia aponta para `/driver`, `/driver/loads` e `/driver/stops`, rotas protegidas por `DriverRoute`; `RequireDriverRole` redireciona qualquer owner/admin/operator de volta para `/`.

RESOLVIDO

###############

Bug 1663

Sintoma: Ao abrir a Central de Ajuda, o cabeçalho perde o breadcrumb que identifica a página e o título da aba do navegador fica “AGVLog · AGVLog”, em vez de indicar que o usuário está na ajuda.
Provável causa: A rota `/help` existe em `AppRoutes`, mas não há item correspondente no catálogo de `navigation.ts`. Tanto `PageBreadcrumbs` quanto o efeito de `AppLayout` dependem de `findNavigationPage(location.pathname)`; quando ele retorna `undefined`, o breadcrumb não é renderizado e o título usa o fallback genérico `AGVLog`.

RESOLVIDO

###############

Bug 1664

Sintoma: Usuários que navegam apenas pelo teclado não conseguem ordenar dezenas de tabelas, e leitores de tela não informam qual coluna está ordenada nem a direção atual, embora a interface ofereça setas e ordenação por clique.
Provável causa: `TableHead` aplica `onClick` diretamente ao elemento `<th>` quando recebe `onSort`/`sortKey`, mas não adiciona botão, `tabIndex`, handler de Enter/Espaço ou `aria-sort`. Como `<th>` não é interativo nem focável por padrão, os 57 usos atuais de cabeçalhos ordenáveis ficam restritos ao mouse e sem semântica de estado.

RESOLVIDO

###############

Bug 1665

Sintoma: No Monitor de CT-e, pesquisar literalmente `%` ou `_` em número, pagador, referência, protocolo, motorista, filial ou grupo pode retornar muitos documentos que não contêm esses caracteres; `%` isolado pode fazer o campo corresponder a praticamente todo o histórico.
Provável causa: `useCteMonitor` interpola diretamente os textos dos filtros em padrões PostgREST `.ilike(..., `%${valor}%`)`, sem escapar os metacaracteres SQL LIKE `%`, `_` e barra invertida. Assim, a entrada do usuário é interpretada como padrão em vez de texto literal, tanto na consulta de `cte_documents` quanto na filtragem local posterior.

RESOLVIDO

###############

Bug 1666

Sintoma: Na Pesquisa de CT-e, pesquisar literalmente `%` ou `_` em remetente, destinatário, cidade, consignatário, pagador, motorista, seguradora, contrato, viagem, referência ou Romexp pode devolver documentos sem esses caracteres; um percentual isolado pode tornar o respectivo filtro praticamente inoperante.
Provável causa: `useCteSearch` insere diretamente os valores digitados em treze chamadas `.ilike(..., `%${valor}%`)`, sem escapar `%`, `_` ou barra invertida antes de montar o padrão PostgREST. A consulta interpreta esses caracteres como metacaracteres SQL LIKE, e o filtro local posterior não consegue restaurar a correspondência literal pretendida.

RESOLVIDO

###############

Bug 1667

Sintoma: Mesmo após os filtros de data do Monitor e da Pesquisa de CT-e passarem a consultar o intervalo correto no fuso da empresa, usuários cujo dispositivo esteja em outro fuso ainda podem perder documentos das primeiras ou últimas horas do dia selecionado.
Provável causa: `useCteMonitor` e `useCteSearch` aplicam corretamente `dateOnlyUtcRange(day, tenantTimezone)` no servidor, mas depois submetem todas as linhas mescladas novamente a `matchesCteMonitorFilters`/`matchesCteSearchFilters`. Esses filtros chamam `matchesDateRange`, cuja `calendarDay` converte timestamps por `Date#getFullYear/getMonth/getDate` no fuso local do navegador, sem receber o timezone do tenant; a segunda passagem pode contradizer e desfazer o recorte correto da consulta.

RESOLVIDO

###############

Bug 1668

Sintoma: Em celulares ou janelas de pouca altura, o detalhe de um CT-e no Monitor pode ultrapassar o viewport e deixar o cabeçalho, o botão de fechar ou as ações de download/cancelamento inacessíveis, sem permitir rolar o diálogo inteiro.
Provável causa: O detalhe usa `DialogContent className="max-w-3xl"` sem `max-height` nem `overflow-y-auto`, embora contenha cabeçalho, ações, doze campos, mensagem de erro, histórico com até 16rem e rodapé. O `DialogContent` global é fixo e centralizado, mas também não define limite vertical ou rolagem; somente a lista interna de eventos rola.

RESOLVIDO

###############

Bug 1669

Sintoma: O detalhe do Monitor de CT-e mostra o mesmo “Protocolo” duas vezes na grade de informações, ocupando espaço e sugerindo ao usuário que deveriam existir dois valores distintos.
Provável causa: `CteDetail` renderiza duas células separadas com o rótulo “Protocolo” e ambas exibem exatamente `row.protocol_number`; não há outro campo ou condição que diferencie a segunda ocorrência.

RESOLVIDO

###############

Bug 1670

Sintoma: Usuários com papel `operator` veem “Equipe e acessos” no menu e nos atalhos da Central de Ajuda, mas ao abrir a tela recebem “Apenas administradores podem gerenciar a equipe”; mesmo sem acesso, a página ainda inicia leituras de membros, perfis, motoristas e a chamada administrativa antes de mostrar o bloqueio.
Provável causa: O item `/team` não declara `roles` no catálogo de navegação e a rota usa apenas o `ProtectedRoute` interno, que aceita operadores. `TeamManagement` verifica `isAdmin` somente depois de instanciar `useQuery`, `useDrivers` e as demais hooks, e a query de membros usa `enabled: !!currentTenant` em vez de também exigir permissão administrativa.

RESOLVIDO

###############

Bug 1671

Sintoma: Usuários em um fuso diferente do tenant podem ver a emissão de um CT-e e seus eventos SEFAZ com horário — e até data — diferentes do calendário operacional; na Pesquisa, uma linha incluída no dia filtrado pode exibir o dia anterior ou seguinte.
Provável causa: `CteMonitor` formata `issued_at` e `occurred_at` com `new Date(...).toLocaleString('pt-BR')`/`toLocaleDateString('pt-BR')`, e `CteSearch` usa `fmtDateSafe`, que também chama `toLocaleDateString` sem `timeZone`. Embora os limites de consulta agora usem `currentTenant.timezone`, a apresentação volta a depender exclusivamente do fuso do navegador.

RESOLVIDO

###############

Bug 1672

Sintoma: Em Ocorrências Operacionais, os períodos rápidos “Hoje”, “7 dias”, “30 dias” e “90 dias” e os presets “Críticas hoje”/“últimos 7 dias” incluem ocorrências datadas no futuro; “Críticas hoje”, por exemplo, pode mostrar também eventos críticos de amanhã ou de qualquer data posterior.
Provável causa: Todos esses atalhos preenchem somente `dateFrom`/`dateFromISO`. Os botões executam explicitamente `setDateTo(undefined)` e os presets nativos não possuem `dateToISO`, portanto `operationalEventFilters` envia `date_from`, mas nenhum `date_to` que encerre o intervalo no fim do dia atual do tenant.

RESOLVIDO

###############

Bug 1673

Sintoma: Em dispositivos com fuso diferente do tenant, Ocorrências Operacionais pode exibir e exportar uma ocorrência em outro dia/horário e contabilizá-la no mês errado no gráfico, mesmo que o filtro de período a tenha incluído corretamente pelo calendário da empresa.
Provável causa: A consulta usa `tenantTimezone`, mas a tabela, o detalhe e o XLSX formatam `created_at`/`resolved_at` com `date-fns format(new Date(...))`, e o gráfico mensal produz a chave com `format(new Date(e.created_at), 'yyyy-MM')`. Essas operações usam o timezone local do navegador e não recebem o fuso do tenant.

RESOLVIDO

###############

Bug 1674

Sintoma: Em Ocorrências Operacionais, escolher uma data inicial posterior à final, informar impacto negativo, definir o mínimo acima do máximo ou colar uma busca com mais de 200 caracteres derruba a lista com erro de consulta, em vez de impedir a entrada e indicar qual filtro precisa ser corrigido.
Provável causa: Os calendários não relacionam `from`/`to`, os inputs numéricos não possuem `min`, os dois campos de busca não possuem `maxLength` e a página não valida esses valores antes de montar `useOperationalEventsFiltered`. O RPC `list_operator_events_page_v1` rejeita expressamente datas invertidas, impactos negativos/invertidos e busca acima de 200 caracteres com `operational_event_list_invalid_filters`, transformando entradas previsíveis da interface em falha integral da tabela.

RESOLVIDO

###############

Bug 1675

Sintoma: O botão “Ir para Detalhamento” e o link direto `#detalhamento-ocorrencias` podem levar ao rodapé dos filtros avançados — inclusive a uma área recolhida — em vez de posicionar a tela na busca e na tabela detalhada prometidas.
Provável causa: `OperationalEvents` atribui o mesmo `id="detalhamento-ocorrencias"` a dois elementos: a linha de “Período rápido” dentro do `CollapsibleContent` e o bloco de filtros acima da tabela. `document.getElementById` e a resolução nativa do fragmento escolhem a primeira ocorrência, tornando a âncora ambígua e o HTML inválido.

RESOLVIDO

###############

Bug 1676

Sintoma: Na tabela de Ocorrências Operacionais, usuários de leitor de tela não conseguem identificar com segurança as ações de abrir conversa, resolver ou navegar entre páginas; pelo teclado, a linha que abre o detalhe também não recebe foco nem responde a Enter/Espaço.
Provável causa: As ações de cada ocorrência são botões apenas com ícone que usam somente `title`, sem `aria-label` associado ao registro, e os quatro botões iconográficos da paginação não possuem nem `title` nem nome acessível. O `TableRow` recebe `onClick`, mas não recebe semântica interativa, `tabIndex` ou handler de teclado.

RESOLVIDO

###############

Bug 1677

Sintoma: Se o relógio do dispositivo estiver mais de um minuto adiantado, Acerto de Motoristas não carrega e “Atualizar” repete a falha; se estiver atrasado, acertos recentes desaparecem da lista e dos totais mesmo após atualizar.
Provável causa: `DriverSettlements` cria e renova `snapshotAt` com `new Date().toISOString()` no navegador e sempre envia esse instante à RPC. `list_driver_settlements_v2` usaria `statement_timestamp()` quando o parâmetro fosse omitido, mas rejeita snapshots mais de um minuto no futuro e exclui `created_at > v_snapshot`; assim, a paginação depende indevidamente da precisão do relógio cliente.

RESOLVIDO

###############

Bug 1678

Sintoma: Em Acerto de Motoristas, pesquisar literalmente `%` ou `_` pode retornar motoristas, placas, rotas, romaneios e notas que não contêm esses caracteres; um percentual isolado torna a busca praticamente equivalente a listar tudo.
Provável causa: `useDriverSettlements` envia `filters.search.trim()` sem escape, e `list_driver_settlements_v2` concatena `v_q` diretamente a padrões `ILIKE '%' || v_q || '%'` em nomes, placa, rota e descrições dos itens. Os metacaracteres `%`, `_` e barra invertida são interpretados como sintaxe SQL LIKE, não como texto literal.

RESOLVIDO

###############

Bug 1679

Sintoma: Os filtros “Finalizada de/até” de Acerto de Motoristas voltam a incluir horas do dia vizinho e excluir parte da data escolhida para operações no fuso de São Paulo, apesar de a correção anterior constar como aplicada.
Provável causa: A migração `20260917083458_fix_settlement_local_date_filters.sql` corrigiu os limites com `AT TIME ZONE 'America/Sao_Paulo'`, mas a migração posterior `20260917133000_page_driver_settlements_with_snapshot.sql` recria integralmente `list_driver_settlements_v2` e restaura as comparações diretas `trip_completed_at >= _date_from` e `< _date_to + interval '1 day'`. As revisões seguintes alteram apenas o controle de snapshot e não reaplicam a conversão civil.

RESOLVIDO

###############

Bug 1680

Sintoma: Se a coleção de motoristas ou veículos dos filtros mudar enquanto o usuário consulta a segunda página ou posterior, as opções entram em erro e o botão “Atualizar” recomendado pela tela repete indefinidamente a mesma falha; voltar à primeira página é a única recuperação disponível, mas não é orientada pela interface.
Provável causa: `useDriverSettlementFilterOptions` converte a divergência de revisão em `DriverSettlementSnapshotChangedError`, porém `DriverSettlements` não trata esse erro para zerar `driverOptionPage`/`vehicleOptionPage` nem renovar a primeira página. “Atualizar” apenas chama `refetch()` na página atual, que reutiliza a revisão antiga guardada em `settlementFilterRevisions` e volta a ser rejeitada pelo RPC.

RESOLVIDO

###############

Bug 1681

Sintoma: No novo acerto manual, é possível selecionar romaneios de motoristas diferentes em uma página, avançar para outra, selecionar um romaneio de um terceiro motorista e ver o envio ser habilitado; ao criar, o banco responde `load_driver_mismatch`, enquanto os romaneios incompatíveis permanecem selecionados porém invisíveis.
Provável causa: `LoadPicker` preserva `selectedIds` entre páginas, mas `onLoadsChange` entrega ao pai somente as linhas da página corrente. `selectedLoads` e `selectedDriverIds` são então recalculados apenas sobre esse recorte; ao encontrar um único motorista na nova página, o efeito chama `setDriverId` diretamente e não limpa os IDs antigos como o handler manual do seletor faria. A validação local deixa de detectar a mistura, embora o RPC corretamente a rejeite.

RESOLVIDO

###############

Bug 1682

Sintoma: Se falhar a consulta dos romaneios elegíveis ao criar ou editar um acerto manual, o diálogo informa “0 romaneio(s) disponível(is)” e “Nenhum romaneio disponível”, fazendo uma indisponibilidade parecer que todas as cargas já foram acertadas ou que não há dados; não existe tentativa de recarga contextual.
Provável causa: `LoadPicker` desestrutura somente `data` e `isLoading` de `useAvailableLoadsForSettlement`, substitui a resposta ausente por `rows = []`/`total = 0` e nunca observa `isError`, `error` ou `refetch`. O estado de erro percorre exatamente o mesmo ramo visual de um resultado vazio confirmado.

RESOLVIDO

###############

Bug 1683

Sintoma: Uma justificativa digitada e depois cancelada para aprovar com exceção, quitar sem pagamento, fechar ou excluir um acerto reaparece ao abrir a mesma ação em outro acerto, facilitando registrar no motorista seguinte um motivo pertencente ao anterior.
Provável causa: `DriverSettlementDrawer` permanece montado ao fechar e trocar `settlementId`; os estados `exceptionReason`, `zeroReason`, `closeReason` e `deleteReason` não são reinicializados por `open` nem pelo ID. Os handlers de cancelar apenas fecham seus diálogos, e os textos são limpos somente depois de uma mutation bem-sucedida.

RESOLVIDO

###############

Bug 1684

Sintoma: Um administrador não consegue usar pela interface o fluxo excepcional “Fechar acerto sem pagamento” para um acerto aprovado, embora o diálogo, a justificativa obrigatória e a autorização correspondente já existam; a única ação oferecida é registrar/quitar pagamento.
Provável causa: `allowedTransitions('approved')` retorna somente `['paid']`. O ramo que renderizaria “Fechar” exige `next === 'closed' && s.status === 'approved'`, condição inalcançável com essa lista, enquanto `update_driver_settlement_status` aceita explicitamente a transição `approved → closed` para administrador com motivo.

RESOLVIDO

###############

Bug 1685

Sintoma: Em um acerto manual já aprovado ou pago, a aba de romaneios ainda oferece “Adicionar romaneio” e o botão para remover cada romaneio; qualquer uma dessas ações termina em erro de acerto bloqueado, apesar de a própria interface apresentá-las como disponíveis.
Provável causa: `DriverSettlementDrawer` decide exibir os controles por `!isLocked(status)`, e `isLocked` considera bloqueado somente o estado `closed`. A RPC `attach_loads_to_driver_settlement` e a rotina de desvinculação, porém, aceitam alterações de romaneios apenas nos estados `pending_review`, `in_review` e `reopened`, lançando `settlement_locked` para `approved` e `paid`.

RESOLVIDO

###############

Bug 1686

Sintoma: Em um acerto aprovado ou pago, o botão “Nova despesa” continua habilitado e abre normalmente o formulário, mas o conteúdo então informa que o acerto não aceita novas despesas e impede o registro; a ação apresentada como disponível leva apenas a um diálogo sem operação possível.
Provável causa: O botão no `DriverSettlementDrawer` é desabilitado somente quando `isLocked(status)` retorna verdadeiro, o que atualmente ocorre apenas para `closed`. Já `_expense_creation_source` define `can_create` para acertos exclusivamente nos estados `pending_review`, `in_review` e `reopened`, e `ExpenseCreationForm` obedece a essa resposta mais restritiva.

RESOLVIDO

###############

Bug 1687

Sintoma: Ao excluir um acerto de motorista, a interface exige uma justificativa e a envia ao servidor, mas o motivo não fica registrado; além disso, desaparecem também todos os eventos que poderiam explicar quem alterou ou excluiu o acerto, deixando a remoção financeira sem trilha de auditoria consultável.
Provável causa: A implementação vigente de `delete_driver_settlement(_settlement_id, _reason)` nunca lê, valida nem persiste `_reason`. A função executa exclusões físicas de `driver_settlement_loads`, `driver_settlement_items`, `driver_settlement_events`, `driver_settlement_payments` e finalmente `driver_settlements`, sem criar antes um registro imutável de exclusão ou preservar o histórico informado pelo usuário.

RESOLVIDO

###############

Bug 1688

Sintoma: Um operador com acesso financeiro consegue abrir um acerto já pago, recebe o botão “Excluir acerto”, preenche a justificativa e confirma a ação, mas a exclusão falha somente no servidor com `cannot_delete_settled_record`.
Provável causa: A rota, a listagem de acertos e `FinanceAccessBoundary` incluem o perfil `operator`, enquanto `DriverSettlementDrawer` mostra o botão de exclusão para todo acerto cujo estado não seja `closed`, sem considerar o perfil atual. A RPC `delete_driver_settlement`, contudo, permite excluir registros `paid` ou `closed` somente quando `is_tenant_admin` é verdadeiro.

RESOLVIDO

###############

Bug 1689

Sintoma: Na aba “Pagamentos”, um acerto pendente, em conferência, reaberto ou fechado ainda oferece “Registrar ou retomar pagamento”; ao tentar iniciar um novo registro, a consulta das saídas falha com a exigência de revisão do acerto, apesar de a ação ter sido apresentada como disponível.
Provável causa: O botão da aba abre `SettlementPaymentDialog` com `allowNew` baseado apenas em `!needsRecalc`, sem verificar o status. Em contraste, `new_settlement_payment_candidates` e `record_settlement_payment` aceitam novos pagamentos somente quando o acerto está em `approved` ou `paid`, lançando `finance_settlement_requires_review` nos demais estados.

RESOLVIDO

###############

Bug 1690

Sintoma: Acertos aprovados ou pagos continuam exibindo o botão “Recalcular” habilitado; ao acioná-lo, tanto em acerto automático quanto manual, a operação falha com `settlement_locked` em vez de recalcular ou de indicar previamente que o estado é imutável.
Provável causa: O botão usa apenas `isLocked(status)`, que retorna verdadeiro somente para `closed`. Entretanto, `_build_driver_settlement` e `_build_manual_driver_settlement`, chamados respectivamente por `generate_driver_settlement` e `recalculate_manual_expense_settlement`, aceitam reconstruir um acerto existente apenas em `pending_review`, `in_review` ou `reopened`.

RESOLVIDO

###############

Bug 1691

Sintoma: Um operador financeiro recebe a ação “Reaberto” em acertos pagos e fechados, mas ao acioná-la obtém `invalid_transition`; a interface não informa que reabrir esses estados é uma operação exclusiva de administrador.
Provável causa: `allowedTransitions` inclui `reopened` para os estados `paid` e `closed` independentemente do perfil atual. Já `update_driver_settlement_status` condiciona `paid → reopened` e `closed → reopened` a `is_tenant_admin`, embora permita que operadores acessem normalmente a listagem e o drawer.

RESOLVIDO

###############

Bug 1692

Sintoma: Depois que um acerto é colocado “Em conferência”, não há na interface nenhuma ação para devolvê-lo a “Pendente”; o operador fica limitado a aprovar, excluir ou manter o registro nessa etapa, mesmo quando a conferência foi iniciada por engano ou precisa ser devolvida à fila.
Provável causa: `allowedTransitions('in_review')` retorna somente `['approved']`, enquanto `update_driver_settlement_status` aceita explicitamente as transições `in_review → approved` e `in_review → pending_review`. Assim, um caminho de estado previsto pelo servidor nunca é renderizado pelo drawer.

RESOLVIDO

###############

Bug 1693

Sintoma: Operadores recebem o botão “Aprovar c/ exceção”, conseguem abrir o diálogo e preencher a justificativa, embora o próprio texto informe que a ação exige `admin/owner`; quando o acerto possui uma pendência que realmente requer exceção, a confirmação termina em `approval_blocked`.
Provável causa: `DriverSettlementDrawer` renderiza a variante de aprovação excepcional para qualquer perfil que possa abrir o acerto, sem consultar `currentRole`. No servidor, `update_driver_settlement_status` só ignora os bloqueios de aprovação quando `_allow_exceptions` é verdadeiro e `is_tenant_admin` confirma perfil administrativo.

RESOLVIDO

###############

Bug 1694

Sintoma: Na aba “Envios ao motorista”, informar uma data inicial posterior à data final e clicar em “Filtrar envios” remove a listagem e exibe um erro; “Atualizar envios” apenas repete a falha, sem explicar que o intervalo precisa ser corrigido.
Provável causa: `DriverSettlementSendsWorkspace` envia `from` e `to` sem validar a ordem nem bloquear o submit. `finance_private.list_movements` rejeita `date_from > date_to` com `finance_invalid_filters`, e o tratamento genérico da consulta não traduz essa condição nem oferece restauração do último filtro válido.

RESOLVIDO

###############

Bug 1695

Sintoma: Se falhar a consulta paginada de motoristas ou veículos dentro de “Novo acerto manual” — inclusive depois de pesquisar ou avançar opções — o seletor correspondente fica vazio e os botões de paginação são desabilitados, sem informar a falha nem oferecer nova tentativa; o usuário pode interpretar que não existem cadastros elegíveis.
Provável causa: `NewManualSettlementDialog` transforma `driverOptions.data?.rows` e `vehicleOptions.data?.rows` ausentes em arrays vazios e nunca renderiza `isError`, `error` ou `refetch` dessas consultas. Como os controles dependem apenas de `data`, erro e resultado vazio confirmado percorrem o mesmo estado visual.

RESOLVIDO

###############

Bug 1696

Sintoma: Usuários de leitor de tela não conseguem distinguir o checkbox que seleciona todos os romaneios dos checkboxes de cada linha, nem saber qual número de romaneio cada controle marca; todos podem ser anunciados apenas como caixas de seleção sem nome.
Provável causa: `LoadPicker` renderiza o checkbox do cabeçalho e os checkboxes das linhas sem `aria-label`, texto associado por `<label>` ou `aria-labelledby`. A célula do cabeçalho também não possui rótulo textual, e o número exibido em outra célula da linha não é programaticamente associado ao controle.

RESOLVIDO

###############

Bug 1697

Sintoma: Um operador autenticado consegue anexar a um acerto manual romaneios pertencentes a outro motorista chamando diretamente a RPC; a mesma inconsistência pode ocorrer se o motorista da carga mudar entre a consulta do diálogo e a confirmação, fazendo o acerto agregar documentos, peso e frete do condutor errado.
Provável causa: `attach_loads_to_driver_settlement` confirma que as cargas existem no mesmo tenant e estão disponíveis, mas nunca compara `loads.driver_id` com `driver_settlements.driver_id`. O filtro por motorista existe somente no `LoadPicker` e não constitui uma garantia atômica; `_load_available_for_settlement` verifica apenas vínculos anteriores, não a identidade do motorista.

RESOLVIDO

###############

Bug 1698

Sintoma: Solicitar a remoção de um romaneio que não está vinculado ao acerto — por chamada direta, repetição concorrente ou tentativa já concluída em outra sessão — retorna sucesso e cria no histórico um evento `load_detached`, embora nenhuma associação tenha sido removida.
Provável causa: `detach_load_from_driver_settlement` executa o `DELETE`, mas não consulta `ROW_COUNT` nem lança erro quando zero linhas são afetadas. Em seguida registra incondicionalmente `load_detached` e reconstrói o acerto, produzindo uma trilha de auditoria que afirma uma mudança inexistente.

RESOLVIDO

###############

Bug 1699

Sintoma: Reenviar para um acerto um romaneio que já está vinculado retorna sucesso e cria outro evento `loads_attached`; enviar o mesmo ID repetido no array pode registrar que vários romaneios foram anexados, embora o vínculo físico continue sendo apenas um.
Provável causa: `_load_available_for_settlement` ignora vínculos pertencentes ao próprio `_allow_settlement_id`, e a inserção usa `ON CONFLICT (load_id) DO NOTHING` sem contabilizar linhas efetivamente criadas. Mesmo assim, `attach_loads_to_driver_settlement` grava no evento `count = array_length(_load_ids, 1)`, usando a quantidade solicitada em vez da quantidade inserida e sem deduplicar o array.

RESOLVIDO

###############

Bug 1700

Sintoma: Enquanto um usuário percorre as páginas de romaneios disponíveis para criar ou editar um acerto, outra sessão que vincule ou libere uma carga pode fazer um romaneio aparecer novamente ou nunca aparecer nas páginas seguintes, tornando a seleção incompleta sem qualquer aviso.
Provável causa: `list_available_loads_for_settlement_v2` recalcula a cada chamada o conjunto elegível e pagina com `LIMIT ... OFFSET (page-1)*page_size`, sem snapshot, revisão esperada ou cursor estável. `LoadPicker` navega apenas pelo número da página e pelo total mais recente, portanto mudanças concorrentes deslocam as posições entre consultas.

RESOLVIDO

###############

Bug 1701

Sintoma: Ao navegar pelas páginas de “Gastos conferidos da viagem”, um gasto criado, cancelado ou corrigido em outra sessão pode fazer uma linha já vista reaparecer ou outra ser pulada; os totais do cabeçalho também podem mudar entre páginas sem avisar que a consulta deixou de representar o mesmo conjunto.
Provável causa: `finance_private.settlement_expense_context` recompõe os gastos ativos e aplica `LIMIT 30 OFFSET (page-1)*30` em cada chamada, sem snapshot, cursor ou revisão esperada. `SettlementExpenseContextPanel` conserva apenas o número da página e aceita cada nova resposta como continuação da anterior.

RESOLVIDO

###############

Bug 1702

Sintoma: Abrir a aba de despesas de um acerto com muitos gastos vinculados fica progressivamente lento, mesmo que o painel mostre somente 30 gastos por página; avançar a página repete o processamento integral do histórico da viagem.
Provável causa: `finance_private.settlement_expense_context` materializa todos os gastos antes do `LIMIT/OFFSET` e, para cada linha, chama `expense_cost_coverage` duas vezes, além de `expense_cost_effective` e `effective_cost_amount`. A própria cobertura volta a calcular o custo efetivo, e totais e pendências percorrem novamente todo o conjunto materializado; a paginação limita apenas o JSON final.

RESOLVIDO

###############

Bug 1703

Sintoma: Se o pedido de ajuste salvo no navegador estiver corrompido, grande demais, em versão antiga ou incompatível, a aba informa que a recuperação está indisponível e bloqueia todos os novos ajustes indefinidamente; não existe botão para descartar o registro inválido, e recarregar a página mantém o bloqueio.
Provável causa: `pendingSettlementAdjustment` lança erro ao encontrar qualquer entrada inválida ou chave antiga, `useSettlementAdjustment` converte isso em `recoveryError`, e o editor considera `recoveryError` um estado pendente que desabilita o formulário. O outbox e o hook expõem somente `submit` e `recover`, sem operação `abandon`/remoção, enquanto `SettlementAdjustmentRecovery` apenas exibe a mensagem quando não há payload recuperável.

RESOLVIDO

###############

Bug 1704

Sintoma: Depois de uma falha ambígua ao enviar um ajuste, se a recuperação retornar uma rejeição definitiva — por exemplo porque a revisão do acerto mudou e o pedido original não foi aplicado — o mesmo pedido permanece pendente para sempre; “Recuperar ajuste do acerto” repete a falha e nenhum novo ajuste pode ser iniciado.
Provável causa: No primeiro reenvio de uma entrada existente, `createSettlementAdjustmentOutbox` define `uncertain = true`. O ramo de erro remove o registro para códigos determinísticos (`40001`, `23514`, `42501` etc.) somente quando `!uncertain`; em uma recuperação ele preserva até pedidos que o banco confirmou como rejeitados. Como não há `abandon` e o payload conserva o `expected_revision` antigo, atualizar o contexto não torna esse pedido recuperável.

RESOLVIDO

###############

Bug 1705

Sintoma: Um comprovante de despesa em HEIC ou HEIF é aceito e armazenado normalmente, mas, em navegadores sem suporte nativo a esses formatos, o diálogo “Ver comprovante” exibe uma imagem quebrada em vez de uma pré-visualização utilizável; o usuário só consegue tentar abrir o arquivo pelo link externo.
Provável causa: A política de upload aceita `image/heic` e `image/heif`, enquanto `ExpenseReceiptDialog` trata todo arquivo que não termina em `.pdf` como imagem diretamente renderizável em `<img>`, sem conversão para formato compatível, detecção de falha ou fallback específico.

RESOLVIDO

###############

Bug 1706

Sintoma: Se o diálogo de comprovante permanecer aberto por mais de cinco minutos, clicar em “Abrir arquivo do comprovante” leva a um link expirado; a interface continua exibindo a ação como válida e não oferece renovação, atualização ou aviso de expiração.
Provável causa: `ExpenseReceiptDialog` cria a URL assinada uma única vez com validade fixa de 300 segundos e a conserva no estado durante toda a vida do diálogo. Não há temporizador de renovação, nova assinatura no clique nem tratamento da expiração do link já exibido.

RESOLVIDO

###############

Bug 1707

Sintoma: Se o envio de um comprovante de recebimento for concluído, a operação financeira falhar e a exclusão compensatória do arquivo também falhar, selecionar outro comprovante abandona silenciosamente a referência ao primeiro; esse arquivo permanece no storage sem vínculo e já não pode ser limpo ao voltar ou fechar o diálogo.
Provável causa: Após a falha de `deletePaymentAttachment`, `ReceivableFinancialDialog` conserva o caminho em `attachment`, mas o `onChange` do campo de arquivo executa imediatamente `setAttachment(null)` sem tentar excluir, enfileirar ou persistir o objeto anterior. A rotina `close` só conhece o valor atual de `attachment`, portanto perde definitivamente o caminho substituído.

RESOLVIDO

###############

Bug 1708

Sintoma: Depois de uma resposta ambígua ao registrar, estornar ou conciliar um recebível, se “Recuperar operação” receber uma rejeição definitiva — por exemplo porque a revisão do título mudou e o pedido original não foi aplicado — a mesma operação permanece pendente indefinidamente e bloqueia todas as novas operações financeiras desse usuário na empresa.
Provável causa: `createFinancialOutbox` marca qualquer entrada já existente como `uncertain` e, no ramo de erro, só remove o outbox para códigos determinísticos quando `!uncertain`. Assim, uma recuperação conserva até pedidos explicitamente rejeitados pelo banco; `ReceivableFinancialRecoveryPanel` oferece descarte apenas quando o conteúdo é incompatível, não quando um payload válido recebe rejeição final.

RESOLVIDO

###############

Bug 1709

Sintoma: Consultar ou avançar o histórico paginado de recebimentos de um título fica progressivamente lento conforme aumenta a quantidade de baixas, embora cada página exiba no máximo 50 itens; todas as páginas repetem praticamente o mesmo custo integral.
Provável causa: `finance_private.receivable_payments_page` chama `receivable_payment_page_rows` uma vez sem limite para contar e gerar a revisão, serializando cada linha em JSON e calculando hashes, e chama a função novamente para aplicar `LIMIT 50 OFFSET`. Não há snapshot ou revisão materializada reutilizável, portanto cada página recompõe e percorre todo o histórico antes de buscar seu pequeno recorte.

RESOLVIDO

###############

Bug 1710

Sintoma: Depois de uma falha ambígua ao corrigir o vínculo de uma baixa, se “Retomar mesma correção” receber uma recusa definitiva — por exemplo porque a revisão do título mudou ou o recebimento já foi corrigido — esse pedido continua preservado indefinidamente e a correção daquele pagamento não pode ser reiniciada com o contexto atual.
Provável causa: `ReceiptAllocationCorrection.submit` considera toda execução com `pending` uma recuperação incerta e remove a chave do `sessionStorage` após `FinanceRejectedError` somente quando `!uncertain`. Uma rejeição determinística durante a retomada mantém `pending`; o descarte existente é renderizado apenas para `recoveryError` de conteúdo incompatível, não para um comando válido definitivamente recusado.

RESOLVIDO

###############

Bug 1711

Sintoma: Se a consulta da distribuição de um recebimento por parcelas falhar temporariamente ou detectar que a revisão mudou durante a paginação, a seção passa a mostrar apenas “Não foi possível conferir” e não permite atualizar nem voltar à primeira página; para tentar novamente, o usuário precisa descobrir que deve ocultar e reabrir todos os vínculos da baixa.
Provável causa: `ReceivablePaymentInstallments` usa `retry: false` e, no estado `query.error`, retorna somente um parágrafo de alerta. Não existe botão para `refetch`, limpeza de `offset/revision` ou tratamento específico da revisão divergente, embora a consulta paginada possa rejeitar legitimamente com `finance_agreement_history_changed`.

RESOLVIDO

###############

Bug 1712

Sintoma: Se uma recuperação local de “desfazer associação” estiver sob a chave de um recebimento, mas contiver o `link_id` válido de outro recebimento da mesma empresa, clicar em “Retomar associação original” desfaz o vínculo do outro registro; só depois da mutação a interface acusa que a resposta veio fora do recebimento e passa a tratá-la como não confirmada.
Provável causa: Ao restaurar `LegacyReceivableAssociationWorkspace`, o ramo `reverse` confere empresa, ator e a chave externa `saved.payment`, mas não verifica que `pending.command.link_id` pertence ao `payment` atual. O comando enviado ao banco contém apenas `link_id`, e `manage_legacy_receivable_association` resolve e reverte livremente o recebimento desse vínculo; a comparação com `result.payment_id` acontece apenas no frontend, após o commit.

RESOLVIDO

###############

Bug 1713

Sintoma: Abrir ou paginar “Associar entrada existente” para um recebimento antigo fica progressivamente lento em empresas com muitas entradas no mesmo dia e conta, mesmo que a tela mostre somente 20 candidatas por página.
Provável causa: `legacy_receivable_association` primeiro chama `legacy_receivable_catalog_revision`, que agrega todas as entradas compatíveis e executa `receipt_movement_used_cents` para cada uma. Em seguida materializa novamente todas as candidatas, chama outra vez `receipt_movement_used_cents` por entrada para calcular e filtrar o saldo, conta o conjunto inteiro e só então aplica `LIMIT 20 OFFSET`; nenhum desses resultados é reutilizado entre revisão, filtro e página.

RESOLVIDO

###############

Bug 1714

Sintoma: Em “Associar saída existente”, um pagamento antigo de um fornecedor pode ser vinculado a uma saída cujo favorecido é outra pessoa ou empresa, desde que conta, data e saldo coincidam; o título passa a usar como evidência monetária um movimento pertencente a outro destinatário.
Provável causa: Para contas a pagar sem `driver_id`, `legacy_payable_association` lista qualquer movimento de saída não-transferência da mesma conta e data, e `manage_legacy_payable_association` repete apenas essas validações, sem confrontar `payables.supplier_name`/identidade com `finance_movements.beneficiary_name`. Diferentemente do fluxo legado de recebimentos, o formulário também não exige uma declaração explícita de correspondência integral antes de enviar.

RESOLVIDO

###############

Bug 1715

Sintoma: Depois de selecionar uma saída em “Vincular saída já registrada”, mudar a busca ou avançar para outra página mantém a seleção anterior; o usuário vê uma lista diferente, mas “Revisar vínculo” prepara a baixa com a saída antiga que já não aparece entre as candidatas atuais, podendo associar o título ao movimento errado.
Provável causa: `PayableMovementLink` conserva `choice` ao executar `setTerm(search)`, `setPage(1)`, `setPage(page-1)` ou `setPage(page+1)`. `prepare` só exige que exista qualquer `choice` e usa seus dados congelados, sem conferir se seu ID ainda pertence a `query.data.rows` da busca e página vigentes.

RESOLVIDO

###############

Bug 1716

Sintoma: Ao paginar as saídas disponíveis para vincular a uma conta a pagar, uma baixa concorrente que consuma ou libere saldo — ou a inclusão de uma nova saída — pode deslocar o conjunto entre requisições; o usuário vê movimentos repetidos ou deixa de ver candidatos sem receber aviso de que a lista mudou.
Provável causa: `finance_private.payable_movement_options` ordena o conjunto mutável e aplica `LIMIT 30 OFFSET (page-1)*30`, mas o contrato e `readPayableMovements` trafegam apenas o número da página. Não existe revisão do catálogo, cursor estável ou snapshot esperado para detectar alterações entre a primeira página e as seguintes.

RESOLVIDO

###############

Bug 1717

Sintoma: Ao navegar pelo histórico de baixas de uma conta a pagar, a inclusão concorrente de um novo pagamento pode deslocar as páginas; uma baixa já vista reaparece na página seguinte ou outra é omitida, sem aviso de que o histórico mudou.
Provável causa: `finance_private.payable_payment_history` ordena pagamentos por `paid_at desc, id desc` e aplica `LIMIT 30 OFFSET (page-1)*30` sobre dados mutáveis. O endpoint, o contrato `payablePaymentHistorySchema` e o consumidor conservam somente o número da página, sem revisão esperada, cursor estável ou snapshot entre requisições.

RESOLVIDO

###############

Bug 1718

Sintoma: Uma baixa de conta a pagar vinculada a uma saída com comprovante preserva o caminho do arquivo no banco, mas o histórico do título não indica que há anexo nem permite abri-lo ou baixá-lo; a evidência fica invisível justamente na tela usada para revisar e corrigir o pagamento.
Provável causa: `apply_payable_movement` grava `finance_movements.receipt_path` em `payables_payments.attachment_url`, porém `finance_private.payable_payment_history` não projeta esse campo no JSON. `payablePaymentHistorySchema` e `PayablePaymentDialog` também não possuem propriedade ou ação de comprovante, portanto o vínculo armazenado nunca chega à interface.

RESOLVIDO

###############

Bug 1719

Sintoma: Se a carteira de contas a pagar mudar enquanto o usuário navega com títulos marcados para baixa em lote, a lista volta à primeira página mas mantém as seleções e os saldos anteriores; abrir o lote usa esses valores obsoletos e, se o saldo de um título aumentou, pode registrar uma baixa parcial menor que o saldo atual sem o usuário perceber a diferença.
Provável causa: O efeito que trata `finance_payable_portfolio_changed` atualiza o aviso e executa `setList({page:1, revision:null})`, mas não limpa `selected`. `PayableBulkSettlementDialog` inicializa `amounts` a partir de `PayableBulkSelection.open_cents` congelado nessa seleção antiga, e a prévia autoritativa aceita qualquer valor positivo que ainda caiba no saldo vigente, sem exigir que corresponda ao saldo originalmente pretendido.

RESOLVIDO

###############

Bug 1720

Sintoma: Depois de uma falha ambígua ao confirmar uma baixa em lote, se “Retomar mesma baixa” receber uma rejeição definitiva — por exemplo porque um título ou a saída mudou e o lote original não foi aplicado — o pedido permanece pendente indefinidamente e impede iniciar qualquer outro lote para o mesmo usuário e empresa.
Provável causa: `createPayableBulkSettlementOutbox` define `uncertain` quando encontra um pedido salvo e, no tratamento de erro, executa `forget()` para rejeições definitivas somente quando `!uncertain`. A retomada conserva até comandos explicitamente recusados; o diálogo oferece descarte apenas para armazenamento corrompido (`corrupt`), enquanto um payload válido rejeitado mostra apenas “tente retomá-lo novamente”.

RESOLVIDO

###############

Bug 1721

Sintoma: Duas ou mais contas a pagar sem fornecedor identificado podem ser selecionadas e liquidadas juntas como se pertencessem ao mesmo favorecido, usando uma única saída; o lote é aceito mesmo sem existir identidade que comprove que os títulos têm o mesmo destinatário.
Provável causa: `payable_portfolio_evidence` não considera `supplier_id` e `supplier_name` ausentes uma pendência, portanto esses títulos continuam selecionáveis. Em `payable_bulk_context`, a contagem de favorecidos usa `coalesce(supplier_id::text, 'name:' || lower(trim(coalesce(supplier_name,''))))`; todos os títulos sem ID e com nome vazio viram a mesma chave literal `name:`, fazendo `beneficiary_count = 1` e liberando o lote.

RESOLVIDO

###############

Bug 1722

Sintoma: Uma conta criada manualmente em “Gerenciar contas a pagar” não aparece ao filtrar a carteira por “Origem: Avulsa”; ela aparece como “Operacional”, misturando cadastros humanos com obrigações geradas pelo sistema.
Provável causa: `Payables.handleSave` e `useCreatePayable` inserem a conta sem preencher `payables.source`. A coluna usa o valor padrão `system`, enquanto `payable_portfolio` classifica como “Avulsa” somente contas com `source = 'manual'` e como “Operacional” aquelas com `source = 'system'`.

RESOLVIDO

###############

Bug 1723

Sintoma: Um operador pode criar ou editar um protocolo de devolução com itens de pallet sem código ou sem nome, deixando o protocolo, o histórico e os relatórios com tipos de pallet vazios e impossíveis de identificar.
Provável causa: `create_pallet_return_protocol` e `edit_pallet_return_protocol_v1` validam apenas a presença da lista e as quantidades; ambas copiam `pallet_type_code` e `pallet_type_name` diretamente do JSON. As colunas são somente `NOT NULL`, sem restrição contra texto vazio, e a validação existente apenas no formulário pode ser contornada chamando os RPCs autenticados diretamente.

RESOLVIDO

###############

Bug 1724

Sintoma: Um protocolo de devolução de pallets pode ser criado ou editado com a data de devolução anterior à data de lançamento, produzindo uma cronologia impossível nos detalhes, exportações e relatórios.
Provável causa: O formulário não relaciona os limites dos campos `issue_date` e `returned_at`; `create_pallet_return_protocol` e `edit_pallet_return_protocol_v1` convertem e gravam as duas datas separadamente, sem exigir `returned_at >= issue_date`, e a tabela também não possui uma restrição que imponha essa ordem.

RESOLVIDO

###############

Bug 1725

Sintoma: O usuário não consegue consultar o histórico de um protocolo de devolução de pallets — incluindo edições, mudanças de status, cancelamento, motivo e autor — e o detalhe apresenta somente o estado atual, sem trilha visível para auditoria.
Provável causa: As operações gravam eventos em `pallet_return_history` e existe o hook `usePalletHistory`, mas nenhum componente o utiliza. `PalletReturns` abre o diálogo de detalhes apenas com a linha atual e seus itens, sem consultar nem renderizar os registros históricos.

RESOLVIDO

###############

Bug 1726

Sintoma: Um operador pode deixar um protocolo confirmado com um “comprovante assinado” inexistente, pertencente a outro caminho ou incompatível com o protocolo; a tela passa a oferecer o link, mas ele falha ao abrir e a auditoria aparenta possuir uma evidência que nunca foi validada.
Provável causa: O RPC autenticado `update_pallet_return_status` copia diretamente `_payload.signed_proof_url` para o protocolo. Ele não exige que o caminho pertença ao tenant e à pasta do protocolo, não comprova a existência do objeto em `pallet-return-proofs` nem vincula o resultado do gateway de upload seguro; essas verificações existem somente no fluxo normal do navegador e podem ser contornadas chamando o RPC diretamente.

###############

Bug 1727

Sintoma: Se a importação de protocolos de pallets for interrompida após iniciar — por perda de rede, falha ao carregar clientes ou erro ao finalizar — o lote permanece indefinidamente como “processing”, mesmo que parte dos protocolos já tenha sido criada, sem opção visível para retomar, reconciliar ou encerrar o processamento.
Provável causa: `useImportPalletReturns` insere primeiro uma linha em `pallet_return_import_batches` com status `processing`, executa consultas e um RPC independente para cada protocolo e somente na última requisição atualiza o lote para um estado terminal. Não há comando atômico, `finally` compensatório ou recuperação do lote; a página também não consulta nem expõe esses lotes pendentes.

###############

Bug 1728

Sintoma: Uma planilha de devolução com quantidade fracionária pode importar um número diferente de pallets sem avisar — por exemplo, `1,6` vira `2` — quando o documento não traz um total declarado capaz de denunciar a divergência.
Provável causa: `parsePalletReturnRows` aplica `Math.round(qty)` ao montar cada item, antes da prévia e da validação de quantidade inteira. `palletReturnValidationErrors` não conserva nem verifica o valor original; assim a interface e `create_pallet_return_protocol` recebem apenas o inteiro arredondado e não conseguem rejeitar a alteração silenciosa.

###############

Bug 1729

Sintoma: Ao importar uma planilha de devolução criada com o sistema de datas 1904 do Excel, a data do protocolo é deslocada em aproximadamente quatro anos e um dia para trás, embora a prévia a apresente como uma data válida e permita concluir a importação.
Provável causa: `parsePalletReturnWorkbook` não lê `workbook.Workbook.WBProps.date1904`, e `excelSerialToISO` converte todo número usando exclusivamente a base 1900 (`v - 25569`). Diferentemente do importador de extratos, o parser de pallets não ajusta os seriais conforme o calendário declarado pelo arquivo.

###############

Bug 1730

Sintoma: O mesmo fornecedor pode aparecer dividido em várias linhas nos relatórios de pallets — e ser contado várias vezes no ranking — após mudança de nome, diferença de maiúsculas ou acentuação, fragmentando seus totais mesmo quando todos os protocolos apontam para o mesmo cadastro.
Provável causa: `buildSupplierReport` e `buildMonthlyReport` usam `supplier_name_snapshot` bruto como chave de agrupamento, enquanto `buildPalletTypeRanking` usa esse mesmo texto no conjunto de fornecedores. As funções ignoram o `supplier_id` disponível e não normalizam o nome quando o ID está ausente.

###############

Bug 1731

Sintoma: O PDF de um protocolo de pallets com muitos tipos pode cortar o bloco de assinatura, a data e as observações ou sobrepô-los ao rodapé da última página, deixando o documento gerado sem espaço utilizável para assinatura.
Provável causa: `autoTable` pagina a tabela de itens, mas `generatePalletReturnProtocolPdf` calcula o bloco seguinte apenas como `getAutoTableFinalY(...) + 12` e desenha linhas e textos adicionais sem comparar a posição com a altura da página nem criar uma nova página. A quantidade de itens do protocolo não possui limite que garanta espaço residual.

###############

Bug 1732

Sintoma: Uma empresa com um identificador de fuso inválido fica sem o Painel Operacional — e pode quebrar outros relatórios e sequências dependentes da data civil — porque as consultas passam a falhar ao converter horários.
Provável causa: `create_workspace_tenant_v1` e `update_workspace_tenant_v1`, executáveis por administradores autenticados, gravam `_timezone` após apenas remover espaços, sem validar o valor em `pg_timezone_names`; a tabela também não impõe essa referência. `operations_dashboard_summary_v1` lê o texto e o usa diretamente em `statement_timestamp() AT TIME ZONE v_timezone`, que lança erro para uma zona inexistente em vez de aplicar o fallback.

###############

Bug 1733

Sintoma: O Relatório de Produtividade omite silenciosamente motoristas, clientes e veículos além dos primeiros 100 de cada ranking; a paginação termina na centésima linha como se o conjunto estivesse completo, enquanto os KPIs superiores continuam calculados sobre todos os registros e deixam de corresponder ao detalhamento disponível.
Provável causa: `productivity_report_summary_v1` aplica `LIMIT 100` separadamente a `driver_metrics`, `client_divergences` e `vehicle_efficiency`, mas não devolve contagem total nem sinal de truncamento para esses conjuntos. `ProductivityReports` executa apenas paginação local sobre os arrays recebidos e informa como total o tamanho truncado.

###############

Bug 1734

Sintoma: Ao navegar pelas páginas de itens ou do histórico de estoque enquanto outra movimentação é registrada ou um item é renomeado, linhas podem aparecer repetidas, ser puladas ou trocar de página sem qualquer aviso.
Provável causa: `stock_items_page_v1` e `stock_movements_page_v1` paginam conjuntos vivos com `LIMIT ... OFFSET`, ordenados respectivamente por `name, id` e `moved_at DESC, id`. As respostas não fornecem revisão ou instante de snapshot, e o frontend envia somente o número da página; inserções ou mudanças na ordenação entre requisições deslocam os offsets já percorridos.

###############

Bug 1735

Sintoma: Uma saída, consumo, devolução ou ajuste de estoque pode ser registrado com o motivo “Compra” — e outras combinações contraditórias de tipo e motivo também são aceitas — produzindo um histórico operacional incoerente e relatórios sem semântica confiável.
Provável causa: O formulário inicia `reason` como `purchase` e, ao trocar `movement_type`, altera somente o tipo, sem redefinir nem restringir os motivos compatíveis. No servidor, `create_stock_movement_v1` valida o tipo isoladamente, mas a função interna persiste qualquer texto recebido em `reason` sem verificar a relação entre os dois campos.

###############

Bug 1736

Sintoma: Ao registrar uma movimentação sem preencher “Custo Unitário”, o sistema grava custo unitário e total iguais a zero em vez de indicar que o valor não foi informado; aquisições e consumos sem preço conhecido passam a parecer operações comprovadamente gratuitas e deixam os inventários financeiros subavaliados.
Provável causa: O campo não é marcado como obrigatório e o banco aceita `unit_cost` nulo, mas `handleSaveMovement` converte a string vazia com `Number(movForm.unit_cost) || 0` e sempre envia `unit_cost: 0` e `total_cost: 0`. Os leitores financeiros distinguem `NULL` como “Não determinado”/“A revisar”, distinção que o formulário elimina antes de chamar `create_stock_movement_v1`.

###############

Bug 1737

Sintoma: Renomear um item de estoque altera retroativamente o nome exibido em todas as movimentações antigas, fazendo registros históricos parecerem ter sido realizados com a nova descrição e prejudicando a rastreabilidade de compras, consumos e ajustes.
Provável causa: `stock_movements` preserva somente `stock_item_id` e, mais recentemente, `unit_snapshot`; não existe instantâneo do nome ou código no momento da movimentação. `stock_movements_page_v1` monta cada linha juntando o movimento ao `stock_items.name` atual, portanto qualquer edição posterior reescreve a identidade apresentada para todo o histórico.

###############

Bug 1738

Sintoma: Reservar uma quantidade de estoque reduz imediatamente o saldo como uma saída definitiva, mas não existe ação para liberar, cancelar ou converter essa reserva; se o material reservado for depois registrado como consumo ou saída, a mesma quantidade é descontada pela segunda vez.
Provável causa: `reserve` é oferecido como tipo comum no formulário e `create_stock_movement_v1` calcula seu delta pelo ramo genérico de subtração usado por saídas e consumos. O modelo guarda apenas uma movimentação imutável, sem entidade, estado ou referência de reserva, e nenhuma interface ou RPC implementa sua liberação ou conversão vinculada.

###############

Bug 1739

Sintoma: O filtro “Abaixo ou no mínimo” pode listar mais itens do que o cartão “Estoque Baixo” informa, incluindo produtos inativos que o indicador deliberadamente não contabiliza; a mesma tela apresenta dois totais incompatíveis para a aparente mesma condição.
Provável causa: `stock_workspace_metrics_v1` calcula `low_stock_count` somente para itens com `active IS DISTINCT FROM false`, enquanto o ramo `_availability = 'low'` de `stock_items_page_v1` verifica apenas mínimo e saldo, sem aplicar o estado ativo. O frontend exibe o primeiro no cartão e o total do segundo na lista filtrada sem explicar que os universos são diferentes.

###############

Bug 1740

Sintoma: Depois que uma confirmação de endereço é rejeitada ou precisa ser refeita com outra opção, o item pode ficar preso em `operator_command_pending_conflict`; a página não mostra o pedido preservado nem oferece retomá-lo ou descartá-lo, impedindo confirmar a nova localização pelo fluxo normal.
Provável causa: `AddressResolution` persiste um comando `resolve_address` por `queue_id` antes da RPC, mas no `onError` apenas exibe um toast e conserva o slot local inclusive para rejeições definitivas. A tela não lê `readDurableOperatorCommand` nem renderiza ações de recuperação/descarte; como `prepareDurableOperatorCommand` rejeita qualquer payload diferente enquanto o slot existir, escolher outro candidato, coordenada ou estado anterior não consegue avançar.

###############

Bug 1741

Sintoma: Um único candidato geográfico malformado armazenado em uma página da fila faz toda a página “Endereços para validar” falhar, ocultando também os demais destinos válidos e impedindo que o administrador os resolva.
Provável causa: `ack_address_resolution_queue_item_v2` aceita e persiste `candidates` verificando apenas se o valor é um array com até cinco elementos; candidatos múltiplos não têm estrutura, coordenadas, precisão ou confiança validadas. Na leitura, `parseQueue` rejeita a resposta inteira se qualquer elemento não satisfizer `isCandidate`, em vez de isolar e sinalizar somente a linha corrompida.

###############

Bug 1742

Sintoma: Em execuções lentas do processador de endereços, os últimos itens de um lote podem falhar com `address_queue_lease_lost` mesmo após o provedor responder, permanecendo na fila e sendo geocodificados novamente em execuções posteriores.
Provável causa: `process-address-resolution-queue` reivindica por padrão cinco itens com um único lease de 45 segundos e os processa sequencialmente, aguardando 1,1 segundo entre eles. Cada chamada ao geocodificador pode consumir até 8 segundos só no `fetch` externo; cinco timeouts mais as esperas já somam aproximadamente 44,4 segundos, sem contar a reivindicação, chamadas HTTP internas, parsing e acknowledgements. O último `ack_address_resolution_queue_item_v2` exige que `lease_expires_at` ainda esteja no futuro e não existe renovação do lease durante o lote.

###############

Bug 1743

Sintoma: Clientes estrangeiros podem permanecer sem localização ou receber sugestões brasileiras incompatíveis, mesmo quando o cadastro informa corretamente país, cidade e endereço no exterior.
Provável causa: O cadastro aceita `person_type = 'EX'` e edita `clients.country_name`, mas `geocode-address` consulta outro campo, `address_country_name`, usando “Brasil” quando ele está vazio. Além disso, toda chamada ao Nominatim define incondicionalmente `countrycodes=br`, restringindo a pesquisa ao Brasil independentemente do país estruturado ou do tipo estrangeiro do cliente.

###############

Bug 1744

Sintoma: A página “Saúde da Integração SSX” pode exibir o estado global `healthy` mesmo havendo endereços com erro ou aguardando decisão por ambiguidade, embora a própria tela apresente essas pendências operacionais logo abaixo.
Provável causa: `get_tracking_observability_v1` contabiliza separadamente `addresses.pending`, `addresses.ambiguous` e `addresses.error`, mas `operationalStatus` não considera nenhum desses indicadores. O cálculo bloqueia `healthy` somente por erros da fila de veículos (`queue.errors`) e por outros gates, sem incluir o estado da fila de resolução de endereços.

###############

Bug 1745

Sintoma: Quando outro administrador altera o agendamento SSX primeiro, a tentativa atual falha e novas tentativas imediatas continuam sendo rejeitadas, sem a tela carregar a configuração vencedora; o operador precisa aguardar a atualização automática ou recarregar a página para conseguir editar novamente.
Provável causa: `update_tracking_schedule_v1` rejeita corretamente uma revisão obsoleta com `tracking_schedule_revision_conflict`, mas o `onError` de `scheduleMutation` apenas mostra o erro. Ele não invalida nem refaz `tracking-observability`, portanto os seletores e o botão continuam reutilizando o mesmo `configurationUpdatedAt` vencido em todas as tentativas seguintes até o `refetchInterval` de 30 segundos ocorrer.

###############

Bug 1746

Sintoma: Usar “Auto-sugerir” no mapeamento de telemetria pode transformar sinais como nível de bateria, água ou intensidade de sinal em percentual de combustível; variações desses sensores passam então a gerar leituras e até eventos falsos de abastecimento ou drenagem.
Provável causa: `autoSuggestCanonical` retorna `fuel_level_percent` para qualquer nome ou descrição que contenha a palavra genérica `nível`, sem exigir referência a combustível e sem apresentar uma prévia para confirmação. A sugestão é persistida diretamente em `telemetry_mapping`, e `agvlog-run-queue` usa todo valor mapeado nessa chave no processamento de combustível, limitando-o a 0–100 e interpretando deltas de oito pontos como abastecimento ou drenagem.

###############

Bug 1747

Sintoma: Empresas com muitos mapeamentos de telemetria ou modelos de rota ativos podem deixar de processar parte dos sinais e de avaliar parte das rotas, mas os veículos ainda recebem confirmação de processamento bem-sucedido sem aviso de catálogo incompleto.
Provável causa: Antes de consumir a fila, `agvlog-run-queue` carrega `telemetry_mapping` e `route_templates` com um único `select` por tabela, sem paginação, contagem, ordenação ou detecção de resposta saturada. Apenas o subconjunto devolvido pelo limite do PostgREST forma `mappingMap` e é enviado a `processVehicle`; uma resposta truncada é indistinguível de um catálogo completo e não impede o ACK positivo.

###############

Bug 1748

Sintoma: Quando dois provedores usam o mesmo identificador de telemetria com significados diferentes, o processamento SSX pode aplicar ao sinal o mapeamento canônico do outro provedor, gerando combustível, hodômetro, ignição ou capacidades incorretos de forma não determinística.
Provável causa: A configuração e a restrição única de `telemetry_mapping` identificam cada sinal por `(tenant_id, provider, telemetry_id)`, mas `agvlog-run-queue` nem seleciona `provider` e constrói `mappingMap` somente por `telemetry_id`. Linhas de provedores distintos colidem no `Map`; como a consulta também não possui ordenação, a última linha recebida sobrescreve as demais e `extractCanonicalSignals` não tem contexto de provedor para escolher a configuração correta.

###############

Bug 1749

Sintoma: Um sinal de telemetria que exige conversão de unidade, escala ou outra transformação configurada é processado com o valor bruto; combustível, hodômetro, temperatura e eventos derivados podem ficar numericamente incorretos apesar de o mapeamento armazenar a transformação esperada.
Provável causa: `agvlog-run-queue` seleciona a coluna `transform` de `telemetry_mapping`, mas ao construir `mappingMap` preserva somente `telemetry_id -> canonical_key`. `extractCanonicalSignals` executa apenas `parseFloat` e atribui diretamente o resultado à chave canônica, sem receber nem aplicar o objeto `transform`; o campo lido do banco fica completamente sem uso.

###############

Bug 1750

Sintoma: Um veículo que possui leituras históricas de combustível pode passar a mostrar “Este rastreador não possui sensor de combustível mapeado” e impedir a consulta desses dias antigos quando o sinal deixa de aparecer temporariamente nas posições recentes.
Provável causa: `detectCapabilities` recria todas as capacidades a partir somente da janela móvel de posições das últimas 24,5 horas, inicializando `fuel` como falso, e sobrescreve integralmente `vehicle_capabilities` a cada processamento. `VehicleDetails` condiciona toda a aba histórica de combustível a `capabilities.fuel === true`, em vez de considerar as leituras do dia selecionado ou a capacidade já observada; assim a ausência recente apaga a disponibilidade visual do histórico preservado.

###############

Bug 1751

Sintoma: Viagens detectadas automaticamente podem terminar cerca de 30 minutos depois do instante em que o veículo realmente parou, enquanto esses mesmos 30 minutos não aparecem em `stopped_time_seconds`; duração, horário final e composição dos tempos ficam incompatíveis.
Provável causa: `detectTrips` só encerra uma viagem após `consecutiveStopped >= 1800`, mas grava `end` com o timestamp do ponto que atingiu o limiar e inclui toda a cauda parada em `points`. Ao fechar por esse ramo, porém, não soma `consecutiveStopped` a `stoppedTime`; essa soma ocorre apenas quando o movimento recomeça antes do limiar. O período terminal usado para atrasar o fim desaparece do total de tempo parado.

###############

Bug 1752

Sintoma: A análise de corredor pode enviar quase 400 pontos por viagem apesar de declarar uma amostra máxima de 200, multiplicando operações geoespaciais por modelo de rota e aumentando o risco de lentidão ou timeout no processamento da fila.
Provável causa: `matchRoute` calcula `sampleStep` com `Math.floor(trip.points.length / 200)` e conserva todo índice divisível pelo passo. Entre 201 e 399 pontos o passo continua sendo 1, portanto nenhuma amostragem ocorre; 399 pontos são enviados. Em outras faixas o teto também é excedido, como 300 pontos para uma viagem de 599. O RPC `count_points_in_geofence` percorre sequencialmente cada elemento para cada rota, de modo que o erro aumenta diretamente o trabalho espacial.

###############

Bug 1753

Sintoma: Abrir a Central de Ajuda a partir de telas específicas pode destacar um guia genérico ou de outro fluxo; por exemplo, Extratos importados e Movimentações financeiras oferecem “Lançar e acompanhar contas a pagar e receber” no lugar do guia de extrato e conciliação.
Provável causa: `currentGuide` usa `guides.find` e aceita o primeiro `guide.paths` que seja prefixo de `from`, sem priorizar a correspondência exata ou o caminho mais longo. Como o guia financeiro com `/financial` aparece antes do guia de conciliação com `/financial/statements` e `/financial/movements`, o prefixo amplo captura essas rotas específicas. Caminhos repetidos como `/loads` e `/vehicles` também ficam permanentemente associados ao primeiro guia da lista.

###############

Bug 1754

Sintoma: Em empresas com mais de 500 inconsistências, a Auditoria de consistência pode repetir alguns problemas e omitir outros entre os lotes, fazendo cartões, domínios e paginação refletirem um conjunto incompleto ou duplicado sem qualquer aviso.
Provável causa: `DataAudit` percorre `audit_data_consistency_v2` com chamadas independentes de `.range(offset, ...)`, mas a função concatena vários `RETURN QUERY` e nenhum deles, nem o resultado global, possui ordenação determinística. Cada faixa reexecuta o RPC em outro snapshot; mudanças concorrentes ou uma ordem de varredura diferente deslocam as posições usadas pelo offset, sem cursor, revisão ou deduplicação por identidade.

###############

Bug 1755

Sintoma: Em “Gastos conferidos”, depois de editar busca, datas, categoria ou origem sem pressionar “Filtrar”, clicar em um centro de custo deixa esses valores novos visíveis no formulário, mas a lista e os totais continuam usando os valores antigos; a tela aparenta aplicar uma combinação diferente da consulta real.
Provável causa: Os campos controlam o estado `draft`, enquanto os botões de centro de custo chamam `resetCursor({...filters, cost_center})`, baseado no último filtro aplicado, e em seguida fazem `setDraft({...draft, cost_center})`, preservando as edições ainda não submetidas apenas visualmente. Assim `draft` e `filters` divergem até o próximo envio explícito do formulário; o mesmo ocorre ao clicar em “Todos os centros”.

###############

Bug 1756

Sintoma: Depois de anexar com sucesso um comprovante adicional a um gasto, não é possível anexar um segundo arquivo sem fechar e reabrir todo o detalhe, embora o histórico e o backend aceitem múltiplos comprovantes por gasto.
Provável causa: `ExpenseArtifactPanel.attach` preenche `notice` após a primeira confirmação, e o formulário de arquivo é renderizado somente sob a condição `!notice`. Nenhum botão ou efeito limpa essa mensagem depois da atualização da lista; ela permanece durante toda a montagem do painel e substitui definitivamente o `fieldset` de novo upload até o componente ser desmontado.

###############

Bug 1757

Sintoma: Abrir o detalhe de um gasto com muitos comprovantes adicionais fica progressivamente lento e pode exceder memória ou tamanho de resposta, embora o usuário possa precisar apenas dos anexos mais recentes.
Provável causa: `secure_upload_private.expense_receipt_history` agrega em um único array JSON todas as linhas imutáveis de `expense_receipts` do gasto e chama `expense_receipt_source` para reconstruir a evidência de cada artefato, sem limite ou cursor. `readExpenseArtifacts` valida o pacote completo e `ExpenseArtifactPanel` renderiza todos os itens com `data.receipts.map`, também sem paginação, resumo ou carregamento incremental.

###############

Bug 1758

Sintoma: Em “Gastos conferidos”, os totais, contagens, categorias e centros de custo podem discordar das linhas exibidas quando um gasto é criado, cancelado ou retificado enquanto a tela carrega; uma atualização parcial também pode combinar a lista nova com um resumo anterior sem indicar que os dados pertencem a instantes diferentes.
Provável causa: `FinanceExpenses` consulta a página por `list_finance_expense_page_v2` e o resumo separadamente por `list_finance_expenses`, em duas queries independentes. Nenhum RPC devolve um instante de corte ou revisão compartilhada, e o cliente não valida correspondência entre as respostas; portanto uma mutação confirmada entre as duas transações produz uma composição inconsistente na mesma tela.

###############

Bug 1759

Sintoma: Um administrador consegue excluir diretamente pela Data API um pedido ainda sem vínculos bloqueantes e apagar junto todo o seu histórico de versões, sem deixar evento de exclusão; a trilha criada para reconstruir alterações desaparece justamente quando o registro original é removido.
Provável causa: A policy `Admins can manage orders` concede `ALL`, incluindo `DELETE`, sobre `orders`, enquanto `audit_order_version_v1` é um trigger somente `AFTER UPDATE`. A tabela `order_versions` ainda referencia `(tenant_id, order_id)` com `ON DELETE CASCADE`, e não existe trigger de exclusão que preserve o snapshot em `entity_audit_log` antes de a cascata eliminar as versões.

###############

Bug 1760

Sintoma: Um administrador ou integração pode alterar diretamente um pedido entregue ou cancelado de volta para `received`, ou saltar de recebido para entregue, deixando a situação incompatível com o fluxo operacional que a própria interface impõe.
Provável causa: `ORDER_TRANSITIONS` e `getNextStatuses` restringem a sequência apenas no frontend. O novo `orders_status_check` valida somente se o valor pertence ao enum aceito, e a policy `Admins can manage orders` continua permitindo `UPDATE` direto; não existe trigger nem comando de transição que compare `OLD.status` e `NEW.status` ou proteja estados terminais.

###############

Bug 1761

Sintoma: No próprio diálogo de edição, um pedido recebido pode ser levado até entregue em uma única gravação, bastando selecionar sucessivamente cada situação intermediária antes de clicar em “Salvar”; o histórico registra apenas o salto do estado original ao final, sem que as etapas intermediárias tenham sido confirmadas.
Provável causa: O `Select` de `OrderForm` calcula `getNextStatuses(form.status, 'order')` a partir do status mutável do rascunho. Cada seleção altera imediatamente `form.status` e libera o próximo passo, embora nenhum `UPDATE` tenha ocorrido; a restrição deveria permanecer ancorada em `order.status` até o salvamento.

###############

Bug 1762

Sintoma: Abrir a página de Pedidos fica progressivamente mais lento e pode consumir muita rede, memória e DOM conforme o histórico cresce; a tela precisa terminar de carregar todos os pedidos da empresa mesmo quando o usuário procura apenas um registro ou consulta o início da lista.
Provável causa: `useOrders` usa `fetchAllPostgrestPages` para buscar sequencialmente todas as linhas de `orders`, com todos os campos e o cliente associado. `Orders` aplica busca, situação, cliente e datas somente no navegador e renderiza `filtered.map` integralmente, sem paginação, limite, virtualização ou consulta filtrada no servidor.

###############

Bug 1763

Sintoma: Um administrador pode remover diretamente pela Data API a associação de um administrador, operador ou motorista com a empresa e revogar seu acesso sem deixar registro de quem executou a exclusão nem preservar os dados anteriores da associação.
Provável causa: A policy `Admins can manage memberships` concede `DELETE` sobre `tenant_memberships`, e `protect_tenant_owners` só acrescenta invariantes especiais para proprietários. O novo trigger `audit_tenant_membership_change_v1` é declarado exclusivamente `AFTER UPDATE`; não existe trigger `BEFORE/AFTER DELETE` nem comando público auditado que grave a revogação em `entity_audit_log` antes de a linha desaparecer.

###############

Bug 1764

Sintoma: Usuários de leitor de tela não conseguem distinguir as ações de editar, ativar/desativar e remover nas linhas de “Acessos do Portal”, nem saber qual concessão será afetada; os controles podem ser anunciados apenas como botões sem nome.
Provável causa: `PortalAccessTab` renderiza esses três `Button` somente com os ícones `Pencil`, `Ban`/`CheckCircle2` e `AlertTriangle`, sem texto, `aria-label`, `aria-labelledby` ou `title`. O UUID truncado e o cliente exibidos em outras células também não são associados programaticamente aos controles.

###############

Bug 1765

Sintoma: Se a criação manual de um protocolo de devolução for confirmada no banco mas a resposta se perder por timeout ou queda de rede, repetir “Salvar” cria outro protocolo e consome outro número para a mesma devolução, apesar da nova proteção idempotente do RPC.
Provável causa: `submitProtocol` gera `request_id: crypto.randomUUID()` dentro de cada chamada a `createMut.mutateAsync` e não preserva o comando em estado ou armazenamento. O bloqueio `submittingProtocolRef` dura apenas enquanto a promessa está pendente; depois de qualquer erro ele é liberado, e a repetição usa outro UUID, portanto `create_pallet_return_protocol` não encontra a criação anterior pelo índice idempotente.

###############

Bug 1766

Sintoma: Duas pessoas que editam simultaneamente o mesmo protocolo de devolução podem salvar com sucesso e a segunda apagar silenciosamente correções de fornecedor, datas, motorista, placa, observações ou itens feitas pela primeira; o histórico registra ambas como edições válidas, embora o estado final contenha apenas o último rascunho completo.
Provável causa: `submitEdit` envia um `patch` e a lista integral de `editItems`, mas `EditProtocolInput` não inclui a revisão lida. `edit_pallet_return_protocol_v1` adquire `FOR UPDATE` somente no momento da gravação, não compara `updated_at` esperado e depois exclui e reinsere todos os itens; a serialização evita execução simultânea, mas não detecta que o segundo rascunho ficou obsoleto.

###############

Bug 1767

Sintoma: Depois da consolidação de tipos de palete duplicados, relatórios e KPIs históricos ainda podem separar `PBR`, `pbr` e ` PBR ` em grupos distintos; uma variante com espaços pode inclusive ser contabilizada em “Outros”, embora o cadastro passe a exibir somente o tipo normalizado `PBR`.
Provável causa: `20260922018000_unique_normalized_pallet_type_codes.sql` troca apenas `pallet_return_items.pallet_type_id` pelo ID conservado, apaga os tipos duplicados e normaliza `pallet_types.code`, mas não atualiza o snapshot `pallet_return_items.pallet_type_code`. `buildMonthlyReport`, `buildPalletTypeRanking` e `totalsByPalletType` agrupam pelo texto bruto desse snapshot; `buildSupplierReport` aplica somente `toUpperCase()`, sem remover espaços.

###############

Bug 1768

Sintoma: Criar uma Rota Operacional ou salvar qualquer alteração em seus destinos falha no banco com erro de função `public.unaccent(text)` inexistente, bloqueando inclusive rotas sem cidades duplicadas.
Provável causa: `20260826002000_relocate_extensions.sql` moveu a extensão `unaccent` do schema `public` para `extensions`. O trigger novo `reject_duplicate_operational_route_destinations_v1`, entretanto, usa explicitamente `public.unaccent(...)` e ainda executa com `search_path=''`; nenhuma migração recria um wrapper nesse schema, portanto a chamada não pode ser resolvida durante `INSERT` ou `UPDATE OF destinations`.

###############

Bug 1769

Sintoma: Se o cadastro manual de uma Falta de Mercadoria for confirmado no banco, mas a resposta se perder por timeout ou queda de rede, repetir “Salvar em apuração” ou “Salvar e confirmar” cria outro caso e consome outro número para a mesma ocorrência, apesar da nova proteção idempotente do RPC.
Provável causa: `submitNew` gera `request_id: crypto.randomUUID()` dentro de cada chamada a `createCase.mutateAsync` e não preserva o comando entre tentativas. A trava `submittingCaseRef` é liberada no `finally` após qualquer erro; ao repetir, o frontend envia outro UUID, então `create_merchandise_shortage_case` não encontra o caso já gravado por `create_request_id` e executa uma nova criação.

###############

Bug 1770

Sintoma: No formulário de nova Falta de Mercadoria, usuários de leitor de tela podem percorrer os campos de data, empresa, fornecedor, motorista, placa, carga, NF, CT-e, cidade, cliente e observação sem ouvir qual informação cada controle solicita.
Provável causa: O componente local `Field` renderiza `Label` e `Input` como elementos irmãos, mas não atribui `htmlFor` ao rótulo nem `id` ao controle; o `Input` também não recebe `aria-label` ou `aria-labelledby`. Assim, o texto visível não compõe o nome acessível do campo.

###############

Bug 1771

Sintoma: Um administrador consegue excluir diretamente pela Data API uma Falta de Mercadoria e apagar junto todos os itens e o histórico do caso, sem deixar evidência da exclusão; se a criação original for reenviada com o mesmo identificador idempotente, ela ainda pode ser aceita novamente como um caso novo.
Provável causa: O baseline concede `DELETE` sobre as tabelas ao papel `authenticated`, e a policy `shortage_cases_delete` autoriza a operação para administradores. As FKs de `merchandise_shortage_items` e `merchandise_shortage_history` usam `ON DELETE CASCADE`, não existe trigger de auditoria para a exclusão, e `create_request_id` fica armazenado somente na própria linha removida; ao apagá-la, desaparecem tanto a trilha quanto a identidade de replay.

###############

Bug 1772

Sintoma: A Visão Geral de Centros de Custo pode continuar somando como “Total de despesas alocadas” contas a pagar canceladas, despesas de motorista rejeitadas e ordens de manutenção canceladas; esses lançamentos também permanecem no gráfico e na listagem como saídas válidas, superestimando o custo real.
Provável causa: `get_legacy_cost_center_report_v1` une `payables`, `driver_expenses` e `maintenance_orders` filtrando apenas tenant, centro de custo, instante e data inicial. O RPC não exclui `payables.status = 'cancelled'`, `driver_expenses.approval_status = 'rejected'` nem `maintenance_orders.status = 'cancelled'`; em seguida `by_center` e `total_outflow` somam incondicionalmente todo valor negativo desse conjunto.

###############

Bug 1773

Sintoma: Se o cancelamento de um DOC/COB for confirmado no banco, mas a resposta se perder por timeout ou queda de rede, a tela informa falha e continua exibindo o arquivo como cancelável; repetir a confirmação recebe `doccob_export_not_cancelable`, sem recuperar o sucesso anterior nem atualizar as faturas liberadas.
Provável causa: `useCancelEdiExport` chama `cancel_doccob_export` sem `request_id` e invalida as consultas somente em `onSuccess`. O RPC muda o estado para `cancelled`, mas não armazena resultado idempotente; uma nova chamada encontra esse estado fora da lista `generated`/`downloaded`/`error` e o rejeita, embora seja a repetição da mesma intenção após uma resposta incerta.

###############

Bug 1774

Sintoma: Usuários não conseguem consultar pela aplicação quem alterou um pedido, quais campos mudaram nem os estados anterior e posterior, embora essas versões sejam gravadas no banco; pedidos sem valor de frete sequer mostram qualquer ação de auditoria.
Provável causa: `audit_order_version_v1` insere cada alteração em `order_versions` e `entity_audit_log`, mas nenhum hook ou componente em `src` consulta `order_versions` ou o log de entidade para pedidos. O botão existente em `Orders` é condicionado a `o.total_freight` e abre `FreightAuditDrawer`, que lê somente `freight_calculation_log`; portanto ele não expõe o novo histórico de versões.

###############

Bug 1775

Sintoma: Ao trocar o usuário de um acesso do portal por um e-mail ainda não cadastrado, uma falha de rede ou conflito depois do envio do convite pode deixar simultaneamente o acesso antigo e o novo ativos para o mesmo cliente, embora a tela informe que a transferência falhou.
Provável causa: `PortalAccessDialog.save` primeiro chama `create-team-member`, que cria a conta e `client_portal_access` do convidado atomicamente no trigger de `auth.users`, e somente depois chama separadamente `replace_portal_access_after_invite_v1` para excluir a concessão antiga. As duas etapas não compartilham transação nem compensação; se o segundo RPC falhar por `portal_access_revision_conflict`, indisponibilidade ou resposta incerta, a nova concessão permanece criada e a anterior não é removida.

###############

Bug 1776

Sintoma: Ao trocar um acesso do portal para um convidado novo e, na mesma edição, selecionar outro cliente ou tipo de acesso, o convite é enviado e a nova concessão é criada, mas a tela sempre termina com falha; o acesso antigo continua existindo junto do novo.
Provável causa: `PortalAccessDialog` envia `clientId` e `accessType` editados a `create-team-member`, porém chama `replace_portal_access_after_invite_v1` somente com o ID da linha antiga e o novo usuário. O RPC procura a concessão criada usando `v_old.client_id` e `v_old.access_type`, isto é, os valores anteriores; quando qualquer um deles mudou, não encontra a linha nova, lança `invited_portal_access_not_found` e não exclui a antiga.

###############

Bug 1777

Sintoma: O autocomplete de Histórico do Produto pode sugerir um item que, ao ser selecionado, resulta em “Nenhum evento encontrado”, especialmente depois de realocações ou substituições que tornaram antigas associações de carga obsoletas.
Provável causa: A consulta de sugestões em `ProductHistory` lê diretamente `load_items`, incluindo versões e associações que deixaram de ser correntes. Já `read_product_history_v1` foi alterada por `20260917151900_use_current_product_history_and_require_check.sql` para usar `current_load_items`; um produto presente apenas nas linhas obsoletas entra no catálogo visual, mas é excluído da busca executada em seguida.

###############

Bug 1778

Sintoma: No Histórico do Produto, leitores de tela anunciam o campo de pesquisa apenas pelo placeholder, sem associá-lo ao rótulo visível “Produto”; quando o usuário começa a digitar e o placeholder desaparece, o controle pode ficar sem nome acessível.
Provável causa: O componente renderiza `<Label>Produto</Label>` sem `htmlFor` e o `<Input>` correspondente não possui `id` nem `aria-label`. O vínculo programático existente nos dois campos de período não foi aplicado ao seletor de produto.

###############

Bug 1779

Sintoma: No Histórico do Produto, as sugestões do autocomplete só podem ser escolhidas apontando e clicando; quem usa teclado não consegue percorrer as opções com as setas nem confirmar uma delas, e tecnologias assistivas não recebem os estados de expansão e seleção de um combobox.
Provável causa: O `<Input>` que conserva o foco fica fora do componente `<Command>` e não possui `role="combobox"`, `aria-expanded`, `aria-controls` ou tratamento de `ArrowDown`/`ArrowUp`. A lista contém apenas `CommandList`/`CommandItem`, sem `CommandInput` integrado, enquanto `onKeyDown` do campo trata exclusivamente Enter como envio direto da pesquisa.

###############

Bug 1780

Sintoma: No Painel Operacional, os cartões de pedidos, cargas, estoque, ocorrências, manutenção e documentos funcionam como atalhos somente com clique; usuários de teclado não conseguem focá-los nem acioná-los, e leitores de tela não os identificam como links ou botões.
Provável causa: `KPICard` aplica `onClick` diretamente ao componente visual `<Card>`, que é renderizado como elemento não interativo, acrescentando apenas classes de cursor e hover. O componente não usa link/botão, `tabIndex`, papel semântico nem manipulador de Enter/Espaço quando recebe `onClick`.

###############

Bug 1781

Sintoma: No Painel Operacional, as linhas de ocorrências abertas, manutenções e pedidos atrasados parecem atalhos ao reagirem ao ponteiro, mas não podem ser focadas ou abertas por teclado e não comunicam a leitores de tela que executam navegação.
Provável causa: As três listagens aplicam `onClick={() => navigate(...)}` diretamente a `<TableRow>` e acrescentam somente `cursor-pointer` e estilo de hover. As linhas `<tr>` não recebem link ou botão interno, `tabIndex`, papel interativo nem tratamento de Enter/Espaço.

###############

Bug 1782

Sintoma: No Painel Operacional, usuários de leitor de tela não conseguem consultar de forma coerente a distribuição de pedidos por status nem os paletes por cliente, pois esses valores detalhados são oferecidos exclusivamente em gráficos visuais sem alternativa textual ou tabular.
Provável causa: `OperationsDashboard` renderiza `PieChart` e `BarChart` do Recharts sem `accessibilityLayer`, título, descrição ou rótulo acessível e não apresenta os mesmos pares categoria/valor em uma tabela ou lista oculta. A configuração padrão da versão instalada não torna os gráficos focáveis nem fornece navegação acessível pelos pontos.

###############

Bug 1783

Sintoma: Se o Painel Operacional permanecer aberto durante a virada do dia civil da empresa, os pedidos atrasados, os dias de atraso e os documentos a vencer continuam calculados para o dia anterior até ocorrer recarregamento, remontagem ou refoco da janela.
Provável causa: `useOperationsDashboardSummary` usa uma chave formada apenas por `['operations_dashboard_summary', tenantId]` e não configura relógio civil, intervalo de atualização nem agendamento para a meia-noite. Embora o RPC devolva `today` e derive os indicadores de `statement_timestamp()` no timezone do tenant, essa mudança no servidor não altera a chave nem provoca uma nova execução enquanto a tela permanece ativa.

###############

Bug 1784

Sintoma: No Relatório de Produtividade, selecionar um veículo omite ocorrências e impacto financeiro registrados manualmente para cargas desse veículo; o filtro de motorista também pode omitir eventos da carga quando o operador não repetiu o motorista no cadastro da ocorrência.
Provável causa: `productivity_report_summary_v1` filtra `operational_events` somente por `e.vehicle_id` e `e.driver_id`, sem resolver esses vínculos por `load_id` ou `dispatch_trip_id`. O formulário manual permite escolher carga e motorista independentemente, não oferece campo de veículo, e `_operational_event_binding_snapshot` valida a carga mas não deriva dela `driver_id`/`vehicle_id`; assim eventos legitimamente ligados à carga permanecem com essas colunas nulas e desaparecem dos recortes.

###############

Bug 1785

Sintoma: No Relatório de Produtividade, viagens encerradas com entrega parcial, devolução, recusa, falha ou divergência desaparecem da Eficiência de Veículos; a quantidade de viagens e de paletes fica menor que a utilização real e a ocupação média pode parecer artificialmente melhor.
Provável causa: A CTE `filtered` de `vehicle_efficiency` em `productivity_report_summary_v1` aceita exclusivamente cargas com status `delivered`, `in_transit` ou `loaded`. Todos os demais desfechos que efetivamente transportaram carga são removidos antes de agrupar por viagem e somar `total_pallet_count`, embora os mesmos desfechos sejam reconhecidos pelo relatório ao calcular insucesso.

###############

Bug 1786

Sintoma: No Relatório de Produtividade com “Todos os motoristas”, o total de cargas e os KPIs podem incluir cargas sem motorista, mas essas cargas não aparecem em nenhuma linha ou barra do detalhamento por motorista; a soma apresentada na tabela deixa de reconciliar com o total do relatório sem qualquer explicação.
Provável causa: O cálculo de `v_loads`, entregas, divergências e sucesso consulta todas as cargas do recorte quando `_driver_id` é nulo. Já a CTE `load_totals` de `driver_metrics` contém `where driver_id is not null`, eliminando as cargas não atribuídas antes da agregação e sem devolver uma categoria “Sem motorista” ou uma contagem separada.

###############

Bug 1787

Sintoma: No Relatório de Produtividade, recarregar a página, abrir um link salvo ou retornar pelo histórico remove imediatamente os filtros de motorista e veículo, enquanto as datas permanecem; o relatório muda sozinho para “Todos” e o endereço deixa de reproduzir o recorte compartilhado.
Provável causa: `ProductivityReports` executa um `useEffect` na montagem que chama `setSearchParams` e apaga incondicionalmente `f_driver` e `f_vehicle`. O efeito também roda na primeira seleção do tenant, não apenas numa troca real de empresa, desfazendo justamente os parâmetros que `useListFilters` lê da URL para restaurar filtros entre recargas e navegação.

###############

Bug 1788

Sintoma: Em empresas com mais de 500 motoristas ou veículos, o Relatório de Produtividade não permite filtrar pelos cadastros posteriores ao primeiro corte alfabético; a tela apenas avisa que as opções foram limitadas, sem oferecer uma forma de localizar ou selecionar o restante.
Provável causa: `productivity_report_summary_v1` aplica `LIMIT 500` aos catálogos `driver_options` e `vehicle_options`. `ProductivityReports` entrega esses arrays truncados ao `ListFilterBar`, cujo `Select` renderiza somente opções locais e não possui busca remota, paginação ou carregamento incremental; os booleanos de truncamento alimentam apenas o texto informativo.

###############

Bug 1789

Sintoma: Informar no Relatório de Produtividade uma data inicial posterior à final — inclusive temporariamente ao editar um intervalo existente — substitui a tela inteira por “Não foi possível calcular o relatório”; os filtros somem, não há ação para limpar/corrigir o período e “Tentar novamente” repete indefinidamente a mesma falha.
Provável causa: Cada alteração de data entra imediatamente na chave de `useProductivityReportSummary`, mesmo quando `from > to`, e o RPC lança `invalid_productivity_period`. Embora `ListFilterBar` saiba detectar e avisar datas invertidas, `ProductivityReports` retorna antecipadamente o cartão de erro quando `reportQuery.isError`, antes de renderizar essa barra, deixando o estado inválido preso nos parâmetros da URL.

###############

Bug 1790

Sintoma: Mesmo filtrando o Relatório de Produtividade por um único dia, a consulta fica progressivamente mais cara conforme cresce todo o histórico de cargas e ocorrências da empresa; o recorte curto não evita repetidas varreduras sobre os registros antigos do tenant.
Provável causa: A migração cria índices B-tree em `(tenant_id, created_at)`, mas todos os predicados de período de `productivity_report_summary_v1` envolvem a coluna em `(created_at AT TIME ZONE v_timezone)::date`. Essa expressão não possui índice correspondente nem é convertida em limites UTC sobre `created_at`; cada uma das várias agregações pode usar o tenant como prefixo, porém precisa filtrar seu histórico inteiro para descobrir as linhas do intervalo civil.

###############

Bug 1791

Sintoma: A Central de Ajuda exibe como ativos os atalhos “Central CT-e” e “MDF-e” para empresas sem o módulo fiscal habilitado; ao seguir a orientação, o usuário cai na tela de integração indisponível em vez de conseguir executar os passos descritos.
Provável causa: `canOpenHelpPath` consulta somente `currentRole` e `findNavigationPage(path)?.item.roles`. A função ignora `item.capability` e não recebe `useTenantCapabilities`; por isso `/cte-hub` e `/mdfe` passam tanto nos cartões dos guias quanto no acesso rápido, embora as rotas reais estejam envolvidas por `CapabilityGate capability="fiscal"`.

###############

Bug 1792

Sintoma: Usuários internos sem autorização financeira veem na Central de Ajuda atalhos ativos para painel financeiro, contas a pagar/receber, extratos, conciliação, despesas e centros de custo; ao clicar, encontram apenas “Acesso financeiro não permitido”, embora a navegação lateral esconda essas áreas.
Provável causa: `HelpCenter` não consulta `useFinanceAccess` nem aplica `isFinancialPath` ao montar `quickPaths` e os links dos guias. `canOpenHelpPath` considera somente papéis declarados no catálogo, enquanto `AppLayout` remove rotas financeiras quando `financeAvailable` é falso e as páginas usam `FinanceAccessBoundary` ou verificações equivalentes.

###############

Bug 1793

Sintoma: Ainda é possível criar uma viagem planejada sem nome pelo RPC autenticado legado, apesar da nova migração afirmar que o nome é obrigatório; essas viagens ficam sem identificação legível nos acompanhamentos e processos posteriores.
Provável causa: O trigger `require_planned_dispatch_route_name_v1` só valida quando `new.status = 'planned' AND new.notes IS NOT NULL`, portanto aceita `notes = NULL`. `plan_dispatch_trip_v2`, executável por `authenticated`, grava `p_route_name` apenas em `metadata` e não preenche `dispatch_trips.notes`; ele também não valida o parâmetro, de modo que valores nulos ou em branco atravessam integralmente o suposto invariante.

###############

Bug 1794

Sintoma: Uma resolução manual de endereço pode registrar na auditoria coordenadas “anteriores” arbitrárias, fazendo o histórico afirmar que o ponto foi movido de um local que nunca foi sugerido nem esteve persistido; distância e origem do ajuste humano deixam de ser evidência confiável.
Provável causa: `resolve_address_queue_item_v2` valida latitude, longitude e provider finais, mas constrói `resolution_details.previous_lat` e `previous_lng` convertendo diretamente os valores enviados no payload. Para `selection_kind = 'manual_map'`, a função não compara esse par com `address_resolution_queue.candidates`, com a posição atual de `canonical_addresses` nem com qualquer snapshot bloqueado antes de gravar a auditoria.

###############

Bug 1795

Sintoma: Uma resolução manual pode marcar como “verificado” um endereço com precisão negativa ou confiança fora de 0–1, propagando métricas geográficas impossíveis para o endereço canônico, clientes, paradas e fila de resolução; consumidores posteriores podem tratar esses valores como evidência válida de qualidade.
Provável causa: `resolve_address_queue_item_v2` converte `accuracy_m` e `confidence` do payload, mas no ramo `manual_map` valida somente coordenadas, provider e tipo de seleção. A correspondência que implicitamente limita esses campos aos candidatos armazenados existe apenas para `assisted_candidate`; o servidor tampouco exige que ambos sejam nulos, como o `AddressResolutionPicker` atual envia para um ponto ajustado no mapa.

###############

Bug 1796

Sintoma: Na Validação de endereços, uma pessoa que navega apenas por teclado consegue escolher um candidato sugerido, mas não consegue ajustar o ponto até a portaria correta; essa parte essencial do fluxo exige mouse ou toque e não possui alternativa equivalente.
Provável causa: `AddressResolutionPicker` altera as coordenadas manuais somente pelo evento `click` do `MapContainer` ou pelo `dragend` do `Marker`. O marcador não oferece comandos de teclado para deslocamento, panoramizar o mapa não atualiza a seleção e não existem campos de latitude/longitude, botões direcionais ou outro controle focável que chame `adjust`.

###############

Bug 1797

Sintoma: Abrir uma página cheia de endereços ambíguos pode deixar a Validação de endereços muito lenta, consumir grande quantidade de memória e disparar centenas de requisições de tiles, mesmo que o administrador pretenda revisar apenas um item.
Provável causa: A fila usa `PAGE_SIZE = 100` e renderiza um `AddressResolutionPicker` para cada linha que possui candidatos. Cada picker monta imediatamente seu próprio `MapContainer`, `TileLayer` e marcador; não há expansão sob demanda, mapa compartilhado, virtualização ou carregamento apenas para o item ativo, permitindo até cem instâncias completas do Leaflet na mesma tela.

###############

Bug 1798

Sintoma: Na Validação de endereços, leitores de tela conseguem percorrer e acionar as opções encontradas, mas não são informados de qual candidato está selecionado e será confirmado; trocar a escolha altera apenas a aparência visual do botão.
Provável causa: `AddressResolutionPicker` representa cada candidato como um `<Button>` comum e usa exclusivamente `variant="secondary"` quando latitude e longitude coincidem com a seleção. O grupo não possui semântica de radiogroup e os botões não recebem `aria-pressed`, `aria-checked`, `aria-current` nem texto acessível que exponha o estado selecionado.

###############

Bug 1799

Sintoma: Na Validação de endereços, ajustar manualmente um ponto e depois pesquisar opções para outro item ou clicar em “Atualizar” descarta silenciosamente o ajuste ainda não confirmado e restaura o primeiro candidato; o administrador precisa refazer o posicionamento sem ter sido avisado de que havia alterações pendentes.
Provável causa: A seleção manual existe somente no estado local de cada `AddressResolutionPicker`. Tanto `searchMutation.onSuccess` quanto o botão “Atualizar” chamam `restartQueue`, que troca `generation`, reinicia o snapshot e remonta/refaz a lista; além disso, o efeito dependente de `candidates` redefine `selection` para `candidates[0]`. Não há estado sujo, persistência temporária nem confirmação antes de apagar os ajustes dos demais itens.

###############

Bug 1800

Sintoma: Usuários de leitor de tela não conseguem distinguir a qual cliente ou destino pertencem as ações repetidas de pesquisar e confirmar na Validação de endereços; em uma página com até cem registros, a lista de controles anuncia dezenas de botões chamados apenas “Buscar opções”, “Confirmar ponto ajustado” ou “Confirmar endereço selecionado”.
Provável causa: Os botões de cada card recebem somente esses textos genéricos como nome acessível. O nome da empresa e o endereço aparecem em elementos visuais separados, mas não há `aria-label`, `aria-labelledby` ou `aria-describedby` que associe cada ação ao respectivo item da fila.

###############

Bug 1801

Sintoma: Uma pesquisa de endereço pode responder com erro depois de deixar somente parte do estado gravado: o cliente pode ficar marcado como pendente ou ambíguo sem o item correspondente na fila, ou a fila pode receber os candidatos enquanto o cadastro mantém o estado anterior. A operação aparenta ter falhado, mas uma repetição passa a trabalhar sobre dados parcialmente alterados.
Provável causa: `recordEntityCandidates` na função `geocode-address` faz o `upsert` em `address_resolution_queue` e a atualização de `clients.address_geocode_status` por duas chamadas independentes da Data API. A segunda chamada é executada mesmo quando a primeira já retornou erro, e o código só verifica `queueResult.error || entityResult.error` depois das duas; não existe RPC transacional que confirme ou reverta o par atomicamente.

###############

Bug 1802

Sintoma: Se o endereço de um cliente for alterado enquanto uma tela antiga ainda está aberta, pesquisar as opções daquele item pode contaminar o cache do endereço antigo com coordenadas do endereço novo; uma pesquisa legítima posterior pelo endereço antigo passa a receber sugestões de outro local e pode vinculá-las a outro cliente.
Provável causa: `geocode-address` aceita separadamente `body.address` e o alvo `entity_id`. Para clientes, a consulta enviada ao provedor é montada com os campos estruturados atuais lidos de `clients`, mas `addressHash`, `normalized_address` e a chave de `address_geocoding_cache` continuam derivados do texto fornecido pelo chamador. A checagem posterior do hash impede apenas gravar a fila do alvo divergente; ela ocorre depois da geocodificação e não impede que os candidatos do endereço estruturado sejam persistidos sob o hash de outro endereço.

###############

Bug 1803

Sintoma: Depois que o geocodificador retorna zero resultados uma única vez, o endereço pode permanecer irrecuperável por até 30 dias: tanto as novas tentativas automáticas quanto o botão “Buscar opções” continuam respondendo “Nenhum endereço correspondente” sem consultar novamente o provedor, mesmo que a ausência tenha sido temporária ou os dados externos já tenham melhorado.
Provável causa: `geocode-address` grava também o array vazio em `address_geocoding_cache` com expiração fixa de 30 dias e considera qualquer `cached.candidates` que seja array — inclusive `[]` — um cache hit válido. Embora a fila programe `next_attempt_at` após `no_candidates`, cada repetição encontra esse cache negativo e devolve imediatamente o mesmo vazio; não há TTL reduzido, invalidação nem opção de forçar uma nova consulta.

###############

Bug 1804

Sintoma: Uma consulta reduzida pode ocultar alternativas de endereço para toda a empresa por até 30 dias: se a primeira chamada para um endereço pedir somente um resultado, as pesquisas administrativas posteriores também recebem apenas esse candidato e classificam a fila como simples, mesmo quando o provedor retornaria várias opções ambíguas com o limite normal.
Provável causa: `geocode-address` aceita `body.limit` entre 1 e 5 e permite que operadores consultem sem vincular uma entidade, mas `address_geocoding_cache` é único apenas por `(tenant_id, address_hash, provider)`. O limite não participa da chave nem do registro; a primeira resposta truncada é armazenada e qualquer chamada posterior retorna `cached.candidates` sem completar o conjunto solicitado.

###############

Bug 1805

Sintoma: Ao abrir a Saúde da Integração SSX em uma conexão lenta, o cartão “Pipeline Automático” afirma “Nenhum dado de pipeline ainda. Configure o cron para ativar” enquanto os dados existentes ainda estão sendo carregados; o administrador recebe um diagnóstico de configuração ausente que pode desaparecer segundos depois.
Provável causa: A consulta expõe `tenantHealthLoading`, mas a renderização do cartão testa apenas erro e presença de `tenant`. Enquanto `useQuery` ainda não retornou dados, `tenant` é nulo e o ramo final exibe imediatamente a mensagem de ausência, sem um estado de carregamento intermediário.

###############

Bug 1806

Sintoma: Ao carregar mais de 200 conflitos de mapeamento SSX, alguns conflitos podem desaparecer da revisão ou aparecer repetidos se outro administrador resolver/criar itens durante a leitura; registros com os mesmos horários também podem trocar de página entre chamadas, deixando a lista carregada incompleta mesmo sem aviso.
Provável causa: `IntegrationHealth` percorre `list_ssx_mapping_conflicts_v1` incrementando `_offset` de 200 em 200. O RPC aplica `LIMIT/OFFSET` diretamente ao conjunto mutável de conflitos abertos e ordena apenas por `due_at, first_observed_at`, sem um desempate único por `id`, snapshot ou cursor estável. Alterações entre páginas deslocam as posições, e empates permitem ordem não determinística.

###############

Bug 1807

Sintoma: Se a resolução de um conflito SSX for confirmada no banco, mas a resposta se perder por timeout ou queda de rede, a tela informa falha e mantém o item como aberto; repetir “Resolver vínculo” recebe `mapping_conflict_already_resolved`, sem recuperar o sucesso nem atualizar automaticamente a fila e as métricas.
Provável causa: `resolve_ssx_mapping_conflict_v1` não recebe `request_id` nem registra resultado idempotente. A primeira transação altera o vínculo e fecha o conflito, enquanto `SsxMappingConflictReview` invalida as consultas somente em `onSuccess`; após uma resposta incerta, o cache permanece antigo e qualquer nova chamada encontra `status <> 'open'` e é rejeitada como se fosse outra operação.
