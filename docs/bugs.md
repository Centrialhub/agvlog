Bug 01

Sintoma: Ao tentar entrar com credenciais inválidas, a interface em português exibe a mensagem em inglês "Invalid login credentials".
Provável causa: A tela de autenticação repassa diretamente `error.message` retornado pelo Supabase, sem mapear os erros de autenticação para mensagens em português.

###############

Bug 02

Sintoma: Datas sem horário podem aparecer como o dia anterior em telas como Portal de Documentos, Portal de Mercadorias, detalhe da mercadoria, Folha de Pagamento e Conciliação Bancária. Por exemplo, `2026-09-16` é exibido como `15/09/2026` no fuso de São Paulo.
Provável causa: As telas usam `new Date('AAAA-MM-DD')`; o JavaScript interpreta esse formato à meia-noite UTC e a conversão para `America/Sao_Paulo` retrocede a data.

###############

Bug 03

Sintoma: Depois das 21h no fuso de São Paulo, vários formulários podem preencher "hoje" com a data de amanhã. O problema afeta, entre outros, conciliação bancária, abastecimento, CT-e, tabelas de frete, devolução de paletes, faltas de mercadoria e relatórios do portal.
Provável causa: Os valores padrão são produzidos com `new Date().toISOString().slice(0, 10)`, que usa o calendário UTC em vez do calendário local.

###############

Bug 04

Sintoma: Campos `datetime-local` de nova coleta, novo abastecimento e emissão manual de ORT mostram um horário três horas à frente do horário local; ao editar uma coleta existente, o horário salvo também é apresentado deslocado.
Provável causa: O valor do campo é montado com `toISOString().slice(0, 16)`, convertendo a data para UTC antes de preencher um controle que espera data e hora locais.

###############

Bug 05

Sintoma: Ao abrir canhotos/PODs e alguns arquivos fiscais em uma nova aba, o conteúdo aberto pode manter acesso à aba do sistema e redirecioná-la para outra página.
Provável causa: Há chamadas `window.open(url, '_blank')` sem `noopener,noreferrer`, inclusive no Portal de Canhotos e nos visualizadores de CT-e.

###############

Bug 06

Sintoma: Ativar, desativar ou excluir geocercas falha quando o frontend atual é usado com o backend publicado.
Provável causa: O frontend já depende do RPC `mutate_fleet_geofence_v1`, mas a migração que cria esse RPC ainda não está aplicada no banco de produção.

###############

Bug 07

Sintoma: O sistema pode aceitar uma senha que já consta em bases conhecidas de credenciais vazadas.
Provável causa: A proteção contra senhas comprometidas está desativada na configuração de autenticação do projeto Supabase publicado.

###############

Bug 08

Sintoma: Leitores de tela encontram imagens sem nome na página de definição de senha e campos sem rótulo programático em diálogos como Nova Coleta e Novo Abastecimento.
Provável causa: Ícones decorativos não estão marcados com `aria-hidden` e vários componentes `Label` não possuem `htmlFor` associado ao `id` do campo correspondente.

###############

Bug 09

Sintoma: Alertas globais sem texto complementar, como o erro de credenciais inválidas, geram avisos de acessibilidade no navegador e não fornecem uma descrição associada ao diálogo para leitores de tela.
Provável causa: O componente global só renderiza `AlertDialogDescription` quando `description` possui conteúdo, mas mantém `AlertDialogContent` sem `aria-describedby={undefined}` nos alertas que têm apenas título.

###############

Bug 10

Sintoma: É possível registrar abastecimentos com litros, preço ou odômetro negativos, produzindo custo negativo e dados incoerentes de consumo da frota.
Provável causa: O formulário de abastecimento não define limites mínimos nem valida os números antes de salvar, e a tabela `vehicle_fueling` não possui restrições `CHECK` para impedir valores inválidos.


RESOLVIDO
###############

Bug 11

Sintoma: Um abastecimento pode aparecer como salvo com sucesso, mas a leitura de odômetro informada no mesmo formulário não ser registrada.
Provável causa: O abastecimento e a leitura do odômetro são inseridos em operações separadas; o segundo `insert` não verifica o erro retornado e não existe transação que reverta o primeiro registro em caso de falha.


RESOLVIDO
###############

Bug 12

Sintoma: Uma importação de ocorrências pode ser indicada como concluída e criar o lote de importação, mas nenhuma das ocorrências do arquivo ser gravada.
Provável causa: O lote e as ocorrências são inseridos separadamente; o resultado do `insert` em `delivery_occurrences` é ignorado e não há transação para impedir sucesso parcial.


RESOLVIDO
###############

Bug 13

Sintoma: Uma ingestão pode terminar normalmente sem que o relatório de auditoria correspondente apareça no histórico e sem avisar o usuário.
Provável causa: `persistIngestionReport` aguarda o `insert`, mas não verifica a propriedade `error`; erros do cliente Supabase são retornados como resultado e não acionam o bloco `catch` usado pela função.


RESOLVIDO
###############

Bug 14

Sintoma: Um rascunho de NFS-e ou um comprovante assinado de ocorrência pode ser salvo sem o respectivo evento/histórico de auditoria, embora a operação seja apresentada como concluída.
Provável causa: O registro principal e seu evento de auditoria são escritos em chamadas separadas; a resposta da segunda escrita é ignorada e não existe transação atômica entre elas.


RESOLVIDO
###############

Bug 15

Sintoma: Diálogos de edição de recebíveis, importação XML e gestão de contas a pagar, carregamento financeiro e cadastro de empresas geram repetidamente o aviso de acessibilidade "Missing Description or aria-describedby" durante os testes.
Provável causa: Esses fluxos renderizam `DialogContent` sem um `DialogDescription` associado e sem desativar explicitamente `aria-describedby` quando uma descrição não é necessária.


RESOLVIDO
###############

Bug 16

Sintoma: Duas coletas criadas quase ao mesmo tempo para a mesma empresa podem receber o mesmo número; uma delas falha por conflito de unicidade, tanto no fluxo interno quanto no pedido feito pelo portal do cliente.
Provável causa: `peek_next_pickup_number` calcula `MAX(pickup_number) + 1` antes do `insert`, sem bloquear ou reservar o número na mesma transação. Requisições concorrentes podem observar o mesmo valor.


RESOLVIDO
###############

Bug 17

Sintoma: O estoque aceita movimentações com quantidade ou custo negativo e permite uma saída maior que o saldo disponível, podendo aumentar o saldo em uma saída negativa ou deixar a quantidade atual abaixo de zero.
Provável causa: O formulário converte os campos com `Number` sem validar positividade ou disponibilidade, os controles numéricos não possuem limite mínimo e as tabelas de estoque não têm restrições `CHECK` equivalentes.


RESOLVIDO
###############

Bug 18

Sintoma: Uma movimentação de estoque pode ser registrada com sucesso sem atualizar o saldo do item; duas movimentações simultâneas também podem sobrescrever uma à outra e deixar um saldo incorreto.
Provável causa: O movimento é inserido primeiro e o saldo é calculado depois por leitura seguida de `update`, fora de uma transação. Os erros da leitura e da atualização do item são ignorados e não há bloqueio contra atualizações concorrentes.


RESOLVIDO
###############

Bug 19

Sintoma: Ao editar uma rota, uma falha durante a gravação pode apagar todos os pontos da rota ou criar pontos duplicados/desordenados mesmo que a tela informe erro.
Provável causa: A rota é atualizada, os pontos existentes são excluídos e os novos são inseridos em chamadas separadas, sem transação. O erro do `delete` de `route_waypoints` também não é verificado antes do novo `insert`.


RESOLVIDO
###############

Bug 20

Sintoma: Ao cadastrar um novo contrato ativo para um funcionário, uma falha na criação do contrato novo pode deixar o funcionário sem contrato ativo e encerrar indevidamente o contrato anterior.
Provável causa: O fluxo desativa e encerra o contrato atual antes de inserir o novo, usando duas operações independentes. A primeira alteração não é revertida quando o segundo `insert` falha.


RESOLVIDO
###############

Bug 21

Sintoma: Uma falha ao salvar a edição de um protocolo de devolução de paletes pode manter os dados principais alterados, mas remover todos os itens do protocolo ou deixar a alteração sem histórico de auditoria.
Provável causa: A atualização do protocolo, a exclusão dos itens antigos, a inserção dos novos itens e o histórico são quatro operações separadas, sem transação atômica; falhas intermediárias não restauram o estado anterior.


RESOLVIDO
###############

Bug 22

Sintoma: Ao registrar progresso ou previsão no monitoramento de motoristas, uma falha parcial seguida de nova tentativa pode duplicar entregas realizadas ou previsões e ainda deixar o resumo do monitor divergente do histórico.
Provável causa: O registro detalhado é inserido antes da atualização do monitor e do histórico, em operações não transacionais e sem uma chave idempotente. Se uma etapa posterior falha, a repetição da ação insere novamente a primeira etapa.


RESOLVIDO
###############

Bug 23

Sintoma: A importação de faltas de mercadoria pode informar que as linhas foram importadas mesmo quando o lote de importação não foi criado, deixando casos sem vínculo com o arquivo de origem; também pode encerrar sem registrar o resultado final do lote.
Provável causa: `commitImport` ignora o erro retornado ao criar e ao atualizar `merchandise_shortage_import_batches`, continua importando com `import_batch_id` nulo e sempre exibe o resumo de sucesso das linhas processadas.


RESOLVIDO
###############

Bug 24

Sintoma: A consulta antiga de centros de custo pode exibir totais e gráficos parciais como se estivessem completos quando uma das fontes falha; em empresas com muitos registros, os totais também podem considerar somente a primeira página devolvida pelo banco.
Provável causa: As cinco consultas paralelas ignoram suas propriedades `error` e usam apenas `data`; além disso, não há paginação para superar o limite máximo de linhas da API antes de calcular os totais no navegador.


RESOLVIDO
###############

Bug 25

Sintoma: Ao abrir no Excel certos CSVs exportados pelo sistema, valores controlados por usuários ou vindos de arquivos importados que começam com `=`, `+`, `-` ou `@` podem ser interpretados como fórmulas; campos com ponto e vírgula também podem quebrar colunas em alguns relatórios.
Provável causa: Exportações como centros de custo, cargas, monitoramento de motoristas e relatórios operacionais apenas concatenam ou colocam aspas nos valores, mas não neutralizam prefixos de fórmula; a exportação antiga de centros de custo sequer aplica escape CSV aos campos.


RESOLVIDO
###############

Bug 26

Sintoma: Registrar uma transferência de estoque reduz a quantidade total do item, mas não credita o material em nenhum destino, fazendo mercadoria desaparecer do saldo global.
Provável causa: `useCreateStockMovement` trata todo tipo diferente de `inbound` ou `return` como saída e subtrai a quantidade. O tipo `transfer` está disponível na interface, mas o fluxo não registra a filial de destino nem realiza a contrapartida.


RESOLVIDO
###############

Bug 27

Sintoma: A impressão individual de um romaneio pode abrir um documento vazio e informar "Romaneio aberto para impressão" quando a consulta dos itens da carga falha.
Provável causa: `printRomaneio` ignora a propriedade `error` das consultas de carga e de `load_items`; quando a segunda consulta falha, `(items || [])` é tratado como uma lista válida sem documentos.


RESOLVIDO
###############

Bug 28

Sintoma: Uma falha de leitura dos dados de saúde do pipeline SSX é apresentada como "Nenhum dado de pipeline ainda. Configure o cron para ativar", levando o administrador a diagnosticar configuração ausente quando o problema real é de acesso ou conexão.
Provável causa: As consultas de `PipelineHealthBanner` e da página de saúde da integração extraem apenas `data` do Supabase e ignoram `error`, convertendo qualquer falha em resultado nulo.


RESOLVIDO
###############

Bug 29

Sintoma: Ao cancelar um CT-e durante uma falha de leitura do banco, a tela informa incorretamente "CT-e ainda não transmitido", em vez de mostrar que não foi possível consultar o documento.
Provável causa: `useCancelCTe` ignora o `error` da consulta inicial e interpreta qualquer resposta sem `data` como ausência de `hub_document_id`.


RESOLVIDO
###############

Bug 30

Sintoma: Alterar o limite de velocidade de uma regra de alerta de excesso de velocidade não muda quando o alerta é disparado; o sistema continua usando o limite do veículo, da empresa ou o padrão de 80 km/h.
Provável causa: A tela salva `speed_limit_kmh` em `alert_rules.params`, mas o processamento de alertas calcula os excessos antes de percorrer as regras e nunca lê esse parâmetro da regra.


RESOLVIDO
###############

Bug 31

Sintoma: Uma regra de alerta de geofence criada pela tela de Alertas é salva normalmente, mas nunca gera alertas de entrada ou saída de cerca.
Provável causa: O formulário permite escolher o tipo `geofence`, porém salva a regra com `params` vazio e não oferece seleção de cerca; o avaliador no banco só associa a regra quando `params.geofence_id` corresponde à cerca processada.


RESOLVIDO
###############

Bug 32

Sintoma: É possível salvar limites negativos nas regras de veículo offline e parada longa, fazendo veículos recém-atualizados ou praticamente qualquer parada satisfazerem a condição e gerarem alertas indevidos em massa.
Provável causa: O campo numérico não possui mínimo nem validação no salvamento, e a tabela também não impõe restrição; no processador, o valor negativo é aceito diretamente nas comparações de duração.


RESOLVIDO
###############

Bug 33

Sintoma: Ordens de manutenção aceitam hodômetro e custos de peças ou mão de obra negativos, podendo exibir custo total negativo e distorcer indicadores financeiros e de manutenção.
Provável causa: O formulário não define limites mínimos nem valida esses campos antes de salvar, e as colunas numéricas de `maintenance_orders` não possuem restrições que impeçam valores negativos.


RESOLVIDO
###############

Bug 34

Sintoma: O resultado de uma execução do processador de alertas pode informar alertas abertos ou encerrados que não existem no banco, deixando as métricas de saúde do pipeline incorretas quando uma gravação falha.
Provável causa: As inserções e atualizações em `alert_instances` não verificam o `error` retornado pelo Supabase, e os contadores `alerts_opened` e `alerts_closed` são incrementados incondicionalmente logo após cada tentativa.


RESOLVIDO
###############

Bug 35

Sintoma: As abas do romaneio podem mostrar receita, despesas, lucro e margem incorretos — inclusive todos como zero — ou omitir paradas quando uma consulta falha, sem qualquer aviso de que os dados estão incompletos.
Provável causa: As consultas de CT-es, viagens, despesas e paradas em `LoadRomaneioTabs` extraem somente `data`, ignoram `error` e convertem respostas com falha em listas vazias usadas diretamente nos cálculos de rentabilidade.


RESOLVIDO
###############

Bug 36

Sintoma: É possível criar ou editar manualmente um título a receber com valor zero ou negativo, distorcendo a carteira, os totais financeiros e o saldo disponível para liquidação.
Provável causa: O formulário de recebíveis converte o campo vazio em zero e não valida que o valor seja positivo; o controle numérico não possui `min` e a tabela `receivables` também não possui restrição de valor positivo.


RESOLVIDO
###############

Bug 37

Sintoma: Ao selecionar um dia no histórico de um veículo no fuso de São Paulo, posições, viagens, paradas e excessos de velocidade das últimas três horas daquele dia ficam de fora, enquanto eventos das três horas finais do dia anterior podem aparecer no resultado.
Provável causa: A página monta o intervalo como `AAAA-MM-DDT00:00:00Z` até `AAAA-MM-DDT23:59:59Z`, tratando o dia selecionado como UTC em vez de converter os limites do dia local para UTC.


RESOLVIDO
###############

Bug 38

Sintoma: Ao gerar um CT-e interno quando não existe tabela de frete válida ou a consulta das tabelas falha, o sistema ainda cria o documento com status confirmado e sem valor de frete, permitindo que uma cobrança sem preço entre no fluxo operacional.
Provável causa: `useGenerateCTe` transforma qualquer resultado malsucedido do cálculo em `freightValue = 0`, grava o documento mesmo assim e trata a operação como sucesso com alerta, em vez de interromper o `insert`.


RESOLVIDO
###############

Bug 39

Sintoma: Duas gerações simultâneas de CT-e para a mesma carga podem criar documentos duplicados com o mesmo número, especialmente quando usuários ou abas diferentes executam a ação ao mesmo tempo.
Provável causa: O fluxo primeiro consulta se já existe um CT-e e depois faz o `insert` em uma chamada separada; não há transação nem índice único para a combinação de carga e documento de saída, então duas execuções podem passar pela verificação antes de qualquer uma gravar.


RESOLVIDO
###############

Bug 40

Sintoma: Uma execução da fila de telemetria pode apagar viagens, paradas e eventos válidos das últimas 24 horas e deixar apenas uma reconstrução parcial; mesmo assim, o item pode ser confirmado como processado e não voltar automaticamente para nova tentativa.
Provável causa: `agvlog-run-queue` exclui os dados anteriores e os recria em várias operações independentes, sem transação. Os erros dos `delete` e de diversas inserções são ignorados, e o ACK de sucesso depende apenas de a função chegar ao final.


RESOLVIDO
###############

Bug 41

Sintoma: O pipeline pode informar que calculou o estado de um veículo e emitiu eventos de transição mesmo quando `vehicles_state` ou `vehicle_events` não receberam nenhuma gravação.
Provável causa: `agvlog-compute-state` ignora os resultados do `upsert` de estado e do `insert` de eventos, incrementa `processed` e `events_emitted` incondicionalmente e devolve `success: true` ao orquestrador.


RESOLVIDO
###############

Bug 42

Sintoma: Uma falha temporária ao consultar viagens, paradas, alertas, posições ou combustível pode substituir métricas diárias corretas por zeros e ainda fazer a execução aparecer como agregação bem-sucedida.
Provável causa: `agvlog-aggregate-daily` ignora os erros de todas as consultas, transforma dados ausentes em listas vazias, não verifica o erro do `upsert` em `metrics_daily` e incrementa `aggregated` mesmo quando a escrita falha.


RESOLVIDO
###############

Bug 43

Sintoma: Em dias com mais de 5.000 posições de um veículo, as velocidades máxima e média do relatório diário são calculadas sobre apenas parte da telemetria e podem omitir o maior excesso de velocidade do dia.
Provável causa: A agregação consulta `positions_raw` com `limit(5000)`, sem paginação e sem ordenação, e calcula `max_speed_kmh` e `avg_speed_kmh` diretamente sobre esse subconjunto.


RESOLVIDO
###############

Bug 44

Sintoma: Uma alteração feita nas configurações da empresa enquanto o pipeline termina pode desaparecer; execuções simultâneas do próprio pipeline também podem perder contadores ou datas de saúde umas das outras.
Provável causa: `agvlog-pipeline-run` lê o objeto JSON completo de `tenants.settings`, modifica `pipeline_health` em memória e grava novamente o objeto inteiro, sem controle de versão, bloqueio ou atualização atômica somente da chave alterada.


RESOLVIDO
###############

Bug 45

Sintoma: Um CT-e ou uma NFS-e que possui referência válida no provedor pode acumular tentativas como se essa referência estivesse ausente e acabar enviado para dead letter durante uma falha de leitura do banco.
Provável causa: `cte-status-poll` e `nfse-status-poll` consultam `hub_fiscal_emissions` sem verificar `error`; qualquer falha é interpretada como emissão inexistente, incrementa `status_check_attempts` e pode acionar `terminalizeFiscalPoll` após o limite.


RESOLVIDO
###############

Bug 46

Sintoma: Ao sincronizar um CT-e rejeitado/cancelado ou uma NFS-e cancelada, as notas de origem podem voltar para a fila de faturamento enquanto o documento fiscal continua com o status antigo; o inverso também pode ocorrer, deixando um documento cancelado com origens ainda presas.
Provável causa: O poll libera os vínculos em `fiscal_documents` e atualiza o documento principal em chamadas separadas, sem transação, e ignora os erros de ambas as gravações antes de devolver o resultado ao chamador.


RESOLVIDO
###############

Bug 47

Sintoma: A consulta automática pode responder que um CT-e ou uma NFS-e foi autorizado, rejeitado ou cancelado sem que o status local, o histórico da emissão ou o evento de auditoria tenham sido gravados.
Provável causa: Nos caminhos antigos sem `dispatch_key`, os polls não verificam os resultados dos `update` em `hub_fiscal_emissions` e no documento fiscal nem do `insert` de eventos, mas sempre adicionam o desfecho recebido do provedor à resposta de sucesso.


RESOLVIDO
###############

Bug 48

Sintoma: O teste de login SSX pode exibir “Login SSX realizado!” mesmo quando o novo token não foi salvo; as sincronizações seguintes continuam sem token válido ou usando o estado anterior da conta.
Provável causa: Após receber um token válido do SSX, `ssx-login` ignora o resultado do `update` em `integration_accounts` e devolve `success: true` independentemente de a persistência de `token_cache`, expiração e status ter funcionado.


RESOLVIDO
###############

Bug 49

Sintoma: Se o SSX emitir um token com validade inferior a cinco minutos, o sistema o considera válido por 24 horas e continua tentando usá-lo muito depois de ele expirar no provedor.
Provável causa: O cálculo de expiração substitui qualquer TTL positivo menor que cinco minutos pelo `DEFAULT_TTL_MS` de 24 horas, tanto no login principal quanto no login auxiliar compartilhado.


RESOLVIDO
###############

Bug 50

Sintoma: A sincronização de rastreadores pode ser apresentada como concluída e marcar a conta como `ok` mesmo quando todos ou parte dos `provider_units`, veículos ou vínculos falharam ao gravar.
Provável causa: `ssx-sync-units` apenas incrementa contadores de itens ignorados e continua após falhas de `upsert`, criação de veículo ou vínculo; ao final, grava status saudável e devolve `success: true` sem transformar essas falhas em erro ou resultado parcial.


RESOLVIDO
###############

Bug 51

Sintoma: Quando a descoberta SSX retorna o lote máximo de 500 posições, rastreadores que não aparecem nesse primeiro lote permanecem desconhecidos, embora a tela informe sincronização bem-sucedida.
Provável causa: A descoberta oportunista faz uma única chamada a `PositionHistory/List`, não pagina respostas saturadas e apenas devolve `discovery_saturated: true`; a interface ignora esse sinal e mostra o mesmo toast de sucesso.


RESOLVIDO
###############

Bug 52

Sintoma: Em uma conta com mais unidades ativas do que o limite de linhas da API do banco, parte da frota nunca é consultada pelo polling SSX e permanece com posições antigas, sem indicação de que unidades foram omitidas.
Provável causa: `ssx-poll-positions` busca todos os `provider_units` ativos em uma consulta sem paginação e processa somente as linhas devolvidas pelo limite do PostgREST.


RESOLVIDO
###############

Bug 53

Sintoma: Pedidos aceitam quantidades, paletes, peso, volume, valor da nota, componentes do frete e alíquotas negativos, podendo gerar cargas e indicadores operacionais ou financeiros com valores impossíveis.
Provável causa: Os controles numéricos de `Orders` não possuem limites mínimos, `handleSubmit` apenas converte os textos para número e a tabela `orders` não impõe restrições de não negatividade para esses campos.


RESOLVIDO
###############

Bug 54

Sintoma: Informar explicitamente base de cálculo zero para ICMS, CBS ou IBS e clicar em recalcular aplica o imposto sobre o frete total em vez de manter a base zerada.
Provável causa: `calcTotals` escolhe a base com expressões como `n(icms_base) || total`; como zero é um valor falso em JavaScript, ele é substituído pelo total do frete.


RESOLVIDO
###############

Bug 55

Sintoma: Depois de calcular um pedido, alterar qualquer componente do frete, desconto ou alíquota e salvar sem clicar novamente em “Calcular Totais” grava subtotal, impostos e valor financeiro incompatíveis com os campos visíveis.
Provável causa: Os totais são atualizados somente pelo botão manual; as alterações posteriores não invalidam nem recalculam os valores derivados, e `handleSubmit` persiste todo o estado antigo sem conferir as fórmulas.


RESOLVIDO
###############

Bug 56

Sintoma: Ao criar uma carga, a tela pode informar erro e manter o formulário aberto mesmo que a carga e parte de seus vínculos já tenham sido gravados; ao tentar novamente, o usuário pode criar outra carga para a mesma operação.
Provável causa: `NewLoadDialog` cria a carga primeiro e depois atualiza notas, cria documento manual, atribui documentos e insere auditoria em chamadas independentes. Qualquer falha posterior cai no mesmo `catch`, sem transação, compensação ou reconhecimento do que já foi confirmado.


RESOLVIDO
###############

Bug 57

Sintoma: Uma tentativa malsucedida de criar carga a partir de um número de nota digitado manualmente pode deixar uma nota fiscal de entrada com status `confirmed`, mas sem vínculo com carga; novas tentativas podem gerar duplicidade ou conflito com esse registro órfão.
Provável causa: O documento fiscal manual é inserido antes da chamada a `assign_fiscal_documents_to_load_v2`. Se a atribuição falha, o fluxo apenas exibe o erro e não remove nem reconcilia o documento já criado.


RESOLVIDO
###############

Bug 58

Sintoma: Ao criar uma carga com uma única nota selecionada, uma falha na atribuição ou na auditoria pode alterar definitivamente número, cliente, destinatário e destino da nota original, embora a interface informe que a criação falhou.
Provável causa: `NewLoadDialog` atualiza diretamente a nota selecionada antes de executar a atribuição e a gravação de auditoria; essas operações não fazem parte da mesma transação e não existe rollback da edição quando uma etapa seguinte falha.


RESOLVIDO
###############

Bug 59

Sintoma: Empresas com mais de 1.000 notas fiscais de entrada não conseguem localizar nem selecionar notas antigas na criação de carga, mesmo usando os filtros por número, cliente ou bairro; a tela conclui incorretamente que nenhuma nota foi encontrada.
Provável causa: A consulta carrega somente as 1.000 notas mais recentes com `limit(1000)` e todos os filtros são aplicados depois, em memória, sem paginação nem busca no servidor.


RESOLVIDO
###############

Bug 60

Sintoma: A reimportação em lote pode apagar notas, cargas, itens, viagens, paradas e eventos do período e repor apenas parte das notas; um XML inválido, uma falha de rede ou um erro de inserção deixa os dados antigos removidos sem recuperação automática.
Provável causa: `BatchReimportDialog` executa `clear_reimport_batch_data` antes de analisar e validar todos os arquivos e depois insere cada XML em uma chamada independente. A limpeza e as importações não compartilham transação, staging nem rollback, e erros por arquivo são apenas acumulados enquanto o lote continua.


RESOLVIDO
###############

Bug 61

Sintoma: Em períodos com mais documentos do que o limite de linhas da API, o relatório da reimportação classifica notas que já existiam como “Novo” e deixa de identificar corretamente registros alterados ou inalterados.
Provável causa: O snapshot de `fiscal_documents` anterior à limpeza é carregado por uma única consulta sem paginação; documentos além do limite do PostgREST não entram nos mapas usados para comparar e classificar os XMLs reimportados.


RESOLVIDO
###############

Bug 62

Sintoma: Quando há mais notas confirmadas sem carga do que o limite de linhas da API, o agrupamento automático ignora parte delas e cria cargas apenas para o subconjunto retornado, sem avisar que existem notas pendentes omitidas.
Provável causa: `PendingDocsGrouping` consulta todos os `fiscal_documents` pendentes em uma única requisição, sem paginação, e monta grupos e totais somente sobre as linhas entregues pelo PostgREST.


RESOLVIDO
###############

Bug 63

Sintoma: No agrupamento de notas pendentes, desmarcar o último grupo faz todos os grupos serem selecionados novamente, impedindo o usuário de deixar a seleção vazia para revisar a lista.
Provável causa: O efeito de seleção automática é executado sempre que `selectedGroups.size` chega a zero, sem distinguir a carga inicial da decisão explícita do usuário de desmarcar todos os grupos.


RESOLVIDO
###############

Bug 64

Sintoma: O agrupamento automático permite criar uma carga cuja quantidade de paletes excede a capacidade do veículo escolhido manualmente; a tela mostra a ocupação acima de 100%, mas mantém o botão de criação habilitado e grava a composição.
Provável causa: A capacidade é usada apenas para sugerir veículo e colorir o indicador. `handleExecute` não bloqueia grupos acima do limite, e `assign_fiscal_documents_to_load_v2` não recebe nem valida a capacidade do veículo.


RESOLVIDO
###############

Bug 65

Sintoma: Os totais de fechamento de uma carga aceitam valores negativos para dinheiro ou PIX, permitindo salvar um valor total a receber abaixo de zero.
Provável causa: Os campos usam `min="0"`, mas o salvamento é disparado por um botão comum e converte diretamente os textos com `Number`, sem validar a faixa. As colunas `cash_to_receive` e `pix_to_receive` também não possuem restrição de não negatividade no banco.


RESOLVIDO
###############

Bug 66

Sintoma: Depois que os dados de uma carga são atualizados por outra tela ou usuário, salvar o cabeçalho do romaneio pode restaurar origem, destino, previsão, CIOT, observações e outros campos antigos sem acusar conflito.
Provável causa: O estado do formulário é inicializado apenas na montagem e, nas atualizações de `load`, o efeito sincroniza somente motorista e veículo. `handleSave` combina os valores antigos do formulário com a versão mais recente recebida por props, fazendo o controle otimista aceitar e gravar o conteúdo obsoleto.


RESOLVIDO
###############

Bug 67

Sintoma: Se os CT-es autorizados forem criados ou atualizados depois que o painel de MDF-e foi aberto, “Recarregar dados” atualiza a lista, mas não preenche novamente destinatário, município, responsável pelo CIOT e averbações; a emissão continua bloqueada até edição manual ou reabertura da carga.
Provável causa: A inicialização do formulário é protegida apenas por `initializedLoad.current === load.id`. Depois da primeira execução, mudanças nos CT-es, emitente, veículo ou carga do mesmo ID são ignoradas, embora estejam nas dependências do efeito.


RESOLVIDO
###############

Bug 68

Sintoma: Uma carga com mais CT-es vinculados do que o limite de linhas da API pode emitir MDF-e com apenas parte dos documentos e com peso, valor e produto predominante incompletos.
Provável causa: `useAuthorizedCteList` começa buscando os IDs de `cte_documents` da carga em uma única consulta sem paginação; somente os IDs retornados são usados para consultar documentos autorizados e montar o payload do MDF-e.


RESOLVIDO
###############

Bug 69

Sintoma: A conferência de um acerto aceita KM inicial, final e percorrido negativos, inclusive calculando distância negativa quando o hodômetro final é menor que o inicial; o acerto ainda pode ser aprovado normalmente com esses valores.
Provável causa: Os campos de KM não possuem limite mínimo nem validação de ordem, e `update_driver_settlement_km_review` grava os números recebidos sem exigir valores não negativos ou `km_end >= km_start`.


RESOLVIDO
###############

Bug 70

Sintoma: Um acerto pode ficar com a conferência de KM marcada como “Conferido” ou “Divergente” sem qualquer quilometragem auditada informada, produzindo um estado contraditório e exigindo exceção somente mais tarde, na aprovação.
Provável causa: O botão de salvar permite enviar `audited_km: null` para qualquer status, e `update_driver_settlement_km_review` valida apenas o texto do status, sem exigir KM quando ele deixa de ser `pending`.


RESOLVIDO
###############

Bug 71

Sintoma: É possível criar um acerto manual atribuído a um motorista usando romaneios pertencentes a outro motorista: basta selecionar os romaneios e depois trocar o motorista no seletor antes de criar.
Provável causa: A troca do motorista refaz a lista visível, mas preserva `selectedIds`; como os romaneios antigos deixam de aparecer, a checagem local de motoristas misturados passa a considerar uma lista vazia. `create_manual_driver_settlement` valida tenant e existência das cargas, mas não confere se o motorista delas corresponde ao motorista do acerto.


RESOLVIDO
###############

Bug 72

Sintoma: Acertos com histórico extenso podem exibir apenas parte dos itens, eventos ou pagamentos, embora os contadores das abas façam o subconjunto parecer completo.
Provável causa: `useDriverSettlement` consulta as três tabelas diretamente, sem paginação ou total separado; qualquer linha além do limite do PostgREST é omitida e o tamanho dos arrays truncados é usado na interface.


RESOLVIDO
###############

Bug 73

Sintoma: Um administrador consegue aprovar um acerto com pendências usando uma justificativa composta somente por espaços, deixando a exceção financeira sem motivo auditável.
Provável causa: O diálogo verifica apenas se a string é verdadeira e envia o texto sem `trim`; no banco, o ramo de aprovação com exceção compara `_reason` apenas com string vazia, também sem remover espaços.


RESOLVIDO
###############

Bug 74

Sintoma: Ao criar ou editar um acerto manual, a lista de romaneios disponíveis mostra no máximo 200 registros sem indicar que existem outros nem oferecer próxima página, dificultando selecionar cargas mais antigas sem conhecer um termo exato de busca.
Provável causa: `useAvailableLoadsForSettlement` chama `list_available_loads_for_settlement` com `_limit: 200`, e `LoadPicker` não recebe total, cursor ou controles de paginação.


RESOLVIDO
###############

Bug 75

Sintoma: É possível cadastrar ou editar um patrimônio com custo de aquisição negativo, reduzindo artificialmente o valor total exibido no painel e gravando um valor financeiramente impossível.
Provável causa: O campo de custo aceita qualquer número e o salvamento converte o texto diretamente com `Number`, sem validar valor mínimo; a coluna `assets.acquisition_cost` também não possui restrição que impeça números negativos.


RESOLVIDO
###############

Bug 76

Sintoma: Quando o cadastro de patrimônios ultrapassa o limite de linhas da API, ativos deixam de aparecer na busca e na tabela, enquanto os indicadores de quantidade e valor — apresentados como o cadastro completo — ficam menores que os valores reais.
Provável causa: `useAssets` busca todos os registros em uma única consulta sem paginação nem total separado, e a página calcula `assets.length` e a soma dos custos somente sobre as linhas devolvidas.


RESOLVIDO
###############

Bug 77

Sintoma: Selecionar “Transferência” ao criar uma movimentação de inventário sempre termina em erro, sem existir na tela uma forma de informar o destino necessário para completar a operação.
Provável causa: O tipo `transfer` continua disponível em `MOVEMENT_TYPES` e o formulário envia apenas um `location_id`, mas o gatilho `update_inventory_balance` rejeita incondicionalmente esse tipo com `inventory_transfer_requires_destination`.


RESOLVIDO
###############

Bug 78

Sintoma: Selecionar “Transferência” em uma movimentação de estoque sempre falha, mesmo com item, quantidade e demais campos preenchidos.
Provável causa: `create_stock_movement_v1` exige filiais de origem e destino distintas para o tipo `transfer`, porém o formulário não possui esses campos e `handleSaveMovement` nunca envia `from_branch` nem `to_branch`.


RESOLVIDO
###############

Bug 79

Sintoma: É possível salvar uma quantidade mínima negativa para um item de estoque; depois disso, o item deixa de ser contabilizado e destacado como estoque baixo mesmo quando está sem saldo.
Provável causa: O campo “Qtd Mínima” não possui limite ou validação, `handleSaveItem` aceita o número negativo e não há restrição correspondente em `stock_items`; a regra de alerta ignora explicitamente mínimos que não sejam maiores que zero.


RESOLVIDO
###############

Bug 80

Sintoma: Em inventários com mais saldos que o limite de linhas da API, itens desaparecem das três abas e os indicadores anunciados como referentes a todo o inventário mostram quantidades de itens, paletes e parados há mais de 30 dias incompletas.
Provável causa: `useInventoryBalances` faz uma única consulta sem paginação nem contagem total, e todos os filtros, abas e indicadores são calculados em memória apenas sobre o subconjunto retornado.


RESOLVIDO
###############

Bug 81

Sintoma: Quando a quantidade de itens de almoxarifado ultrapassa o limite de linhas da API, parte deles some da tabela, dos filtros e do seletor de novas movimentações, e os cartões de total e estoque baixo exibem contagens incompletas.
Provável causa: `useStockItems` consulta `stock_items` sem paginação nem total separado, e a página reutiliza diretamente o array truncado para listar, filtrar, movimentar e calcular os indicadores.


RESOLVIDO
###############

Bug 82

Sintoma: É possível criar um contrato ativo com salário-base negativo; ao gerar a folha, esse funcionário fica sem a verba de salário-base, embora o contrato continue ativo e exiba o valor negativo no histórico.
Provável causa: O formulário, `create_employee_contract_v1` e a tabela `employee_contracts` não exigem remuneração não negativa, enquanto `generate_payroll_period` só cria o item de salário quando `base_salary > 0`.


RESOLVIDO
###############

Bug 83

Sintoma: Um contrato com início futuro pode ser desativado imediatamente e ficar com a data de fim anterior à data de início, produzindo um período contratual impossível.
Provável causa: A ação “Desativar” sempre grava a data atual em `end_date`, sem compará-la com `start_date`, e a tabela não possui restrição que imponha `end_date >= start_date`.


RESOLVIDO
###############

Bug 84

Sintoma: Quando o cadastro de funcionários ultrapassa o limite de linhas da API, parte dos funcionários some da tabela e dos filtros, e os cartões por situação e de documentos próximos do vencimento exibem contagens incompletas.
Provável causa: `useEmployees` carrega todos os funcionários em uma única consulta sem paginação nem total separado, e a página calcula os filtros e indicadores apenas sobre o array devolvido.


RESOLVIDO
###############

Bug 85

Sintoma: O cartão “Docs Vencendo” inclui indefinidamente documentos que já venceram, mesmo que estejam expirados há meses ou anos, misturando atrasos antigos com os que realmente vencem nos próximos 30 dias.
Provável causa: `expiringDocs` verifica somente se `differenceInDays(validade, agora) < 30`; como não exige resultado maior ou igual a zero, qualquer data passada satisfaz a condição.


RESOLVIDO
###############

Bug 86

Sintoma: O cadastro de veículos aceita ano, odômetro, capacidades de carga e tanque, consumo médio e limite de velocidade negativos, permitindo salvar dados fisicamente impossíveis e distorcer alertas, roteirização e cálculos de ocupação.
Provável causa: Todos esses campos usam o mesmo input numérico sem limites; `handleSubmit` apenas aplica `Number` e as colunas correspondentes de `vehicles` não possuem restrições de não negatividade.


RESOLVIDO
###############

Bug 87

Sintoma: É possível registrar ou editar uma ocorrência com custo estimado negativo, reduzindo artificialmente o cartão de custo acumulado e gravando um prejuízo com sinal inválido.
Provável causa: O campo “Custo Estimado” não possui mínimo, o salvamento converte o texto diretamente com `Number` e `incidents.estimated_cost` não possui restrição contra valores negativos.


RESOLVIDO
###############

Bug 88

Sintoma: Ao reabrir uma ocorrência resolvida ou encerrada, ela volta ao status aberto ou em investigação mas continua com `resolved_at` e, se aplicável, `closed_at` preenchidos; uma ocorrência apenas resolvida depois de ter sido fechada também conserva a data de fechamento antiga.
Provável causa: `handleSave` só cria os timestamps quando o novo status é resolvido ou fechado, mas em qualquer transição inversa reutiliza `editing.resolved_at` e `editing.closed_at` em vez de limpar os campos incompatíveis.


RESOLVIDO
###############

Bug 89

Sintoma: Quando existem mais ocorrências que o limite de linhas da API, registros antigos desaparecem da busca e da tabela, e os indicadores de abertas, críticas ativas e custo acumulado ficam incompletos sem aviso.
Provável causa: `useIncidents` faz uma única consulta sem paginação nem totais agregados, e a página calcula filtros e indicadores somente sobre o subconjunto retornado.


RESOLVIDO
###############

Bug 90

Sintoma: Duas ocorrências criadas praticamente ao mesmo tempo podem receber o mesmo número `INC-*`, deixando a referência exibida na tabela ambígua.
Provável causa: `useCreateIncident` gera `incident_number` no cliente apenas a partir de `Date.now()` e a tabela não possui unicidade para esse campo; criações no mesmo milissegundo não são serializadas nem recebem sequência do banco.


RESOLVIDO
###############

Bug 91

Sintoma: Um único veículo dentro de duas ou mais cercas sobrepostas é contado duas ou mais vezes no cartão “Veículos dentro agora”, apesar de o rótulo indicar quantidade de veículos distintos.
Provável causa: A tela atribui `vehiclesInside = currentStates.length`; cada estado representa o par veículo–cerca, e não há deduplicação por `vehicle_id` antes da contagem.


RESOLVIDO
###############

Bug 92

Sintoma: Ao ultrapassar o limite de linhas da API, cercas deixam de aparecer no mapa, na lista e nos filtros, e os cartões de cercas cadastradas, ativas e veículos dentro passam a mostrar uma visão parcial como se fosse completa.
Provável causa: As consultas de `geofences` e `geofence_states` são executadas sem paginação nem contagens separadas, e todos os elementos da tela são montados diretamente a partir dos arrays potencialmente truncados.


RESOLVIDO
###############

Bug 93

Sintoma: Em tenants com muitos corredores, pontos ou execuções recentes, corredores e pontos deixam de aparecer na busca e os indicadores de execuções “OK” e com desvio nos últimos sete dias ficam menores que os valores reais.
Provável causa: A página de corredores consulta `route_templates`, todos os `route_waypoints` e os `route_runs` da janela de sete dias sem paginação; os resumos são calculados somente sobre as linhas retornadas pelo limite da API.


RESOLVIDO
###############

Bug 94

Sintoma: Configurar “Máx. fora” como zero minuto em um corredor salva cinco minutos, e ao reabrir uma rota que já tenha zero gravado a tela também mostra cinco.
Provável causa: Tanto a inicialização quanto o payload usam fallback por valor falsy (`allowed_outside_minutes || 5` e `parseInt(outsideMin) || 5`), transformando o zero válido permitido pelo input no padrão 5.


RESOLVIDO
###############

Bug 95

Sintoma: Um corredor aceita limite de velocidade negativo e seus pontos aceitam tempo estimado negativo, produzindo configurações de monitoramento e duração impossíveis.
Provável causa: Os respectivos inputs não definem mínimo nem fazem validação antes do envio, `save_route_template_v1` grava os valores recebidos e as tabelas não possuem restrições de não negatividade.


RESOLVIDO
###############

Bug 96

Sintoma: É possível manter uma rota operacional ativa sem nenhum destino; ela aparece normalmente como disponível, mas nunca corresponde a uma cidade e não participa de forma útil do agrupamento automático.
Provável causa: `handleSave` exige apenas o nome e envia `destinations: []`, enquanto a tabela e os leitores não exigem ao menos um destino para rotas ativas.


RESOLVIDO
###############

Bug 97

Sintoma: Cargas destinadas a municípios homônimos em estados diferentes podem ser agrupadas na rota errada, mesmo que a rota cadastrada se refira apenas a um dos estados.
Provável causa: O catálogo armazena cada destino somente como nome livre e `loadGrouping` compara apenas `recipient_city` normalizada; a UF do documento não faz parte da chave de correspondência.


RESOLVIDO
###############

Bug 98

Sintoma: Na ingestão, um município cujo nome contém outro município pode receber uma sugestão de rota incorreta; por exemplo, uma rota para “Bom Jesus” também pode corresponder a “Bom Jesus da Lapa”.
Provável causa: `findRouteForCity` considera equivalentes nomes quando todas as palavras da forma menor aparecem na maior, descartando preposições, sem exigir igualdade do conjunto completo nem confirmar UF.


RESOLVIDO
###############

Bug 99

Sintoma: O planejamento automático pode gerar uma rota com mais de 30 paradas apesar do limite interno de 30, especialmente quando uma única carga contém entregas para vários destinos.
Provável causa: `groupLoadsForRouting` documenta e recebe `maxStopsPerRoute`, mas divide os grupos usando `g.loads.length` e fatias de cargas; a quantidade real de paradas só é criada depois por `consolidateLoadsIntoStops`.


RESOLVIDO
###############

Bug 100

Sintoma: Ao gerar várias rotas automaticamente, o mesmo veículo ou motorista previamente atribuído às cargas pode ser selecionado simultaneamente em mais de uma rota, deixando os planos recém-criados bloqueados por conflito de recurso.
Provável causa: O planejador adiciona recursos herdados a `usedVehicleIds` e `usedDriverIds`, mas não verifica se eles já estavam nesses conjuntos antes de reutilizá-los em outro grupo; a duplicidade só é detectada na validação posterior.


RESOLVIDO
###############

Bug 101

Sintoma: Uma rota planejada acima da capacidade de paletes, peso ou volume do veículo continua podendo ser despachada individualmente, mesmo após a tela detectar a sobrecarga.
Provável causa: `validateRouteConsistency` adiciona excesso de capacidade apenas em `warnings`, não em `blockingErrors`; rotas no estado `review` mantêm `blocksDispatch: false` e o botão de despacho individual continua habilitado.


RESOLVIDO
###############

Bug 102

Sintoma: É possível criar duas rotas operacionais ativas com nomes visualmente iguais, diferenciados apenas por espaços no início ou no fim, causando opções ambíguas no catálogo e na roteirização.
Provável causa: A tela verifica `form.name.trim()` mas envia o texto original, e o índice único usa `op_route_norm(name)`, que remove acentos e caixa mas não aplica `btrim` nem normaliza espaços.


RESOLVIDO
###############

Bug 103

Sintoma: Quando existem mais de 1.000 protocolos de paletes, os mais antigos somem das tabelas, indicadores, relatórios e exportações, embora os resultados apresentados pareçam abranger todo o histórico filtrado.
Provável causa: `usePalletProtocols` aplica `.limit(1000)` sem paginação ou total separado, e todas as abas reutilizam diretamente esse mesmo subconjunto para somas, rankings e arquivos exportados.


RESOLVIDO
###############

Bug 104

Sintoma: Rascunhos, protocolos apenas programados e protocolos cancelados são contabilizados nos totais e no relatório “Paletes devolvidos por fornecedor” como se a devolução tivesse ocorrido.
Provável causa: `totalsByPalletType`, `buildSupplierReport`, `buildMonthlyReport` e `buildPalletTypeRanking` percorrem todos os protocolos sem filtrar status; o relatório mensal ainda usa `issue_date` quando `returned_at` não existe.


RESOLVIDO
###############

Bug 105

Sintoma: No relatório mensal de paletes, um único protocolo pode ser contado duas ou mais vezes na coluna “Protocolos” quando possui mais de um item do mesmo tipo.
Provável causa: `buildMonthlyReport` incrementa `row.protocols` para cada item percorrido, em vez de manter um conjunto de IDs distintos por mês, fornecedor e tipo.


RESOLVIDO
###############

Bug 106

Sintoma: O histórico de importações de paletes não preserva o nome real da planilha enviada; todos os lotes criados pela tela ficam identificados apenas como “importacao”.
Provável causa: `handleFile` não guarda o nome do arquivo e `commitImport` envia sempre o literal `fileName: 'importacao'` para `useImportPalletReturns`.


RESOLVIDO
###############

Bug 107

Sintoma: Em tenants com muitos clientes e fornecedores, uma importação de paletes pode deixar um fornecedor conhecido como não conciliado ou associá-lo por aproximação a outro cadastro.
Provável causa: A importação carrega clientes em uma única consulta com `.limit(2000)` e faz toda a correspondência apenas nesse subconjunto; não há paginação nem busca no servidor pelo nome de cada fornecedor.


RESOLVIDO
###############

Bug 108

Sintoma: Em protocolos ainda em rascunho ou programados, o botão de anexar comprovante permite escolher e enviar o arquivo, mas a operação termina em erro e deixa o arquivo enviado sem vínculo com protocolo algum.
Provável causa: A interface oferece o botão para qualquer status não confirmado/cancelado e `useAttachPalletProof` faz o upload antes de chamar `update_pallet_return_status`; o banco não permite a transição `draft/scheduled -> awaiting_signature`, e não há compensação para remover o arquivo após a falha.


RESOLVIDO
###############

Bug 109

Sintoma: Ao anexar um arquivo explicitamente chamado de “comprovante assinado” a um protocolo devolvido, o protocolo passa para “Aguardando assinatura”, exibindo um estado contraditório apesar de já possuir `signed_proof_url` e data de assinatura.
Provável causa: `useAttachPalletProof` grava os dados do comprovante e, na mesma chamada, força incondicionalmente o status `awaiting_signature`, cujo rótulo na tela é “Aguardando assinatura”.


RESOLVIDO
###############

Bug 110

Sintoma: Depois de anexar um comprovante, ao abrir o diálogo para outro protocolo o nome do recebedor e a data da assinatura anteriores permanecem preenchidos e podem ser gravados no protocolo errado.
Provável causa: `receiverName` e `signatureDate` são estados únicos da página, inicializados apenas na montagem; abrir, fechar ou concluir o diálogo não os reinicializa para o protocolo selecionado.


RESOLVIDO
###############

Bug 111

Sintoma: Uma falta de mercadoria pode ser registrada com quantidade zero ou com texto de quantidade impossível de interpretar, como “abc” ou “-2”; o item é salvo com quantidade nula/zero e valor total zero.
Provável causa: `validateCase` considera qualquer `quantity_text` não vazio suficiente e não exige quantidade numérica positiva nem `parsedSafely`; `create_merchandise_shortage_case` também grava quantidade nula e total informado sem validar o item.


RESOLVIDO
###############

Bug 112

Sintoma: Com mais de 1.000 casos ou itens no período, faltas somem da tabela e os indicadores e relatórios mensais exibem contagens e valores incompletos; alguns casos podem até aparecer no relatório como “sem itens” apesar de possuírem itens no banco.
Provável causa: `useShortageCases` limita a consulta a 1.000 casos sem paginação, e `useShortageReportRows` busca todos os itens desses casos em uma única consulta também sem paginação antes de montar o relatório em memória.


RESOLVIDO
###############

Bug 113

Sintoma: Ao mudar uma falta em apuração para `confirmed_shortage`, `supplier_fault`, `driver_fault`, `company_fault` ou `customer_fault`, ela desaparece da aba de apuração e não é contabilizada nem como pendente nem como finalizada, impedindo continuar o fluxo pela tela.
Provável causa: A tabela de ações renderiza somente o array `pending`, mas esses status não pertencem a `pending` nem a `finalized`; os controles de transição não existem na listagem geral.


RESOLVIDO
###############

Bug 114

Sintoma: Uma falta pode ser marcada diretamente como cobrada, ressarcida ou baixada sem registrar qualquer valor correspondente, ficando com status financeiro concluído e `amount_to_charge`, `amount_reimbursed` ou `amount_written_off` iguais a zero.
Provável causa: O seletor oferece todos os status a partir de qualquer caso pendente e envia apenas o novo status; `update_merchandise_shortage_status` não valida transições nem exige o respectivo valor positivo para `charged`, `reimbursed` ou `written_off`.


RESOLVIDO
###############

Bug 115

Sintoma: Depois de atribuir a responsabilidade de uma falta a “driver” ou “supplier”, não é possível encerrá-la pela interface, porque o fechamento sempre acusa que falta identificar o motorista ou fornecedor responsável.
Provável causa: A tela permite salvar apenas `responsible_party_type` e não oferece seletores para `responsible_driver_id` ou `responsible_supplier_id`; ao fechar, `validateFinalize` exige esses IDs, mas eles nunca podem ser preenchidos nesse fluxo.


RESOLVIDO
###############

Bug 116

Sintoma: Casos cancelados ou concluídos como “não era falta” continuam somando no cartão “Valor total” e nos relatórios e exportações mensais, superestimando a perda efetiva.
Provável causa: `totalMonth` e `useShortageReportRows` incluem todos os casos retornados pelo período, sem excluir os status `cancelled` e `not_shortage` antes das somas e da geração dos arquivos.


RESOLVIDO
###############

Bug 117

Sintoma: Ao apagar o mês ou o ano no seletor do painel de faltas, a tela pode carregar casos de todos os períodos e apresentar o relatório com título `undefined/0` ou outro período inválido.
Provável causa: Os handlers convertem campo vazio em zero; `useShortageCases` só aplica o filtro mensal quando mês e ano são truthy, enquanto `monthLabel` acessa diretamente `names[month - 1]` sem validar o intervalo.


RESOLVIDO
###############

Bug 118

Sintoma: Tabelas de frete aceitam percentuais, valor mínimo, tarifas por peso/palete e todos os componentes adicionais negativos, permitindo que o cálculo reduza artificialmente ou até produza um frete final negativo.
Provável causa: Os campos numéricos não possuem mínimo nem validação no salvamento, são convertidos diretamente com `parseFloat` e `freight_tables` não possui restrições de não negatividade.


RESOLVIDO
###############

Bug 119

Sintoma: É possível cadastrar uma tabela cuja data final de vigência é anterior à data inicial; ela permanece visível como não bloqueada, mas nunca pode ser selecionada pelo cálculo.
Provável causa: O formulário e o banco não exigem `valid_until >= valid_from`; o calculador filtra separadamente `valid_from <= hoje` e `valid_until >= hoje`, tornando um intervalo invertido inalcançável.


RESOLVIDO
###############

Bug 120

Sintoma: Uma tabela definida apenas por grupo pagador, pagador, região, rota, tipo de distribuição, carga, carroceria ou CTRC não pode ser salva ativa, apesar de todos esses critérios existirem no formulário e no calculador.
Provável causa: A validação `hasContext` considera somente cliente, UFs, municípios e tipo de veículo; os demais campos de contexto são ignorados e o salvamento acusa ausência de contexto.


RESOLVIDO
###############

Bug 121

Sintoma: Uma tabela de frete vinculada a um fornecedor específico pode ser aplicada a documentos de outro fornecedor, desde que os demais critérios coincidam.
Provável causa: `computeSpecificity` nunca compara `freight_tables.client_id` com `FreightInput.clientId`; o vínculo escolhido no campo “Fornecedor” não participa da pontuação nem da desqualificação.


RESOLVIDO
###############

Bug 122

Sintoma: Preencher o campo textual “Pagador” com o nome do cliente faz a tabela não corresponder ao próprio cliente durante o cálculo.
Provável causa: O cadastro grava texto livre em `freight_tables.payer`, mas `computeSpecificity` compara esse texto com `input.clientId`, que é um UUID, em vez de comparar nome/identificador do mesmo domínio.


RESOLVIDO
###############

Bug 123

Sintoma: Quando o cliente ou grupo pagador está ausente, o calculador pode escolher uma tabela específica de outro pagador e apresentá-la como “Match”, calculando o preço sem conhecer o contexto que restringia a tabela.
Provável causa: `checkSoft` não desqualifica critérios de pagador quando o input está vazio; depois, a presença desses critérios faz `winnerHasAnyCriteria` impedir a marcação de fallback, mesmo que eles tenham sido explicitamente ignorados.


RESOLVIDO
###############

Bug 124

Sintoma: Com mais tabelas vigentes que o limite de linhas da API, o cálculo pode ignorar a tabela mais específica e cobrar por outra tabela ou informar que não há tarifa aplicável.
Provável causa: `calculateFreight` consulta todas as linhas vigentes em uma única chamada sem paginação e pontua apenas o subconjunto devolvido pelo PostgREST.


RESOLVIDO
###############

Bug 125

Sintoma: Simular ou recalcular um documento fiscal antigo usa a tabela vigente hoje, e não a tabela que estava vigente na data de emissão ou da operação, podendo alterar retroativamente o frete histórico.
Provável causa: `FreightInput` não possui data de referência e `calculateFreight` sempre define a vigência com `localDateInputValue()`; nenhum chamador consegue informar a data do documento.


RESOLVIDO
###############

Bug 126

Sintoma: Ao carregar no simulador um novo documento sem `client_id` ou sem região reconhecida, o cliente ou a região do documento selecionado anteriormente permanece ativo e influencia o novo cálculo.
Provável causa: `loadFromDoc` e a busca rápida só chamam `setClientId` quando o documento tem cliente e só chamam `setRegionId` quando encontram correspondência; nos casos ausentes, não restauram esses estados para `NONE`.


RESOLVIDO
###############

Bug 127

Sintoma: Ao alterar rapidamente os campos com recálculo automático, o resultado final pode corresponder a valores anteriores e não aos que permanecem visíveis no formulário.
Provável causa: Cada alteração inicia uma chamada assíncrona independente de `handleSimulate`; não há cancelamento nem número de geração, portanto uma resposta antiga mais lenta pode executar `setResult` depois da resposta mais recente.


RESOLVIDO
###############

Bug 128

Sintoma: Buscar rapidamente por número de nota pode carregar um documento de outro fornecedor quando existem números repetidos, preenchendo valor, peso, cliente e destino incorretos no simulador.
Provável causa: A consulta aceita `invoice_number` sem combinar emitente ou chave, retorna até cinco linhas sem ordenação determinística e escolhe sempre `data[0]` sem pedir desambiguação.


RESOLVIDO
###############

Bug 129

Sintoma: O seletor de documentos do simulador mostra no máximo 500 documentos e pode omitir CT-es recentes quando muitas NF-es ocupam esse limite, mesmo com o filtro visual configurado para CT-e.
Provável causa: A consulta limita o conjunto misto a 500 antes de `filteredDocs` aplicar `docTypeFilter` no navegador; não há paginação nem filtro de tipo no servidor.


RESOLVIDO
###############

Bug 130

Sintoma: Ao ultrapassar o limite da API, tabelas de frete, fornecedores e regiões deixam de aparecer na tela de gestão e nos seletores, tornando filtros e cadastros incompletos sem qualquer aviso.
Provável causa: As três consultas da página `FreightTables` são feitas sem paginação, total ou busca remota, e os catálogos de opções são derivados somente dos arrays retornados.


RESOLVIDO
###############

Bug 131

Sintoma: Duas tabelas ativas do mesmo contexto podem ter vigências parcialmente sobrepostas; durante a sobreposição, uma delas vence silenciosamente por ordem de código, sem indicação de conflito ou regra de prioridade explícita.
Provável causa: O índice único impede apenas intervalos exatamente iguais, não sobreposições; quando a especificidade empata, o calculador preserva a ordem `table_code desc` da consulta e escolhe a primeira linha.


RESOLVIDO
###############

Bug 132

Sintoma: Cálculos automáticos de frete podem ignorar uma tabela restrita à região de destino cadastrada em “Regiões por Cliente” e escolher uma tabela genérica ou informar que não há correspondência, mesmo quando município, UF, cliente e grupo pagador identificam a região correta.
Provável causa: `calculateFreight` pontua e escolhe a tabela antes de consultar `client_regions`; o critério `destination_region` é comparado diretamente com `input.destination`, que nos fluxos automáticos contém o destinatário, o destino livre ou o município, e a região cadastrada só é procurada depois que a tabela já foi escolhida.


RESOLVIDO
###############

Bug 133

Sintoma: O resultado e o histórico de um cálculo podem exibir ou gravar a região de outro cliente, grupo pagador ou estado quando existem cadastros com municípios iguais ou nomes que contêm o mesmo trecho.
Provável causa: A resolução posterior da região filtra apenas o tenant e usa `municipality.ilike.%valor%`, sem comparar UF, `client_id` ou `payer_group`; em seguida aplica `limit(1)` sem ordenação determinística e aceita a primeira linha encontrada.


RESOLVIDO
###############

Bug 134

Sintoma: Ao importar regiões por planilha, um nome de cliente compartilhado por dois cadastros pode vincular todas as linhas a apenas um deles, sem apresentar ambiguidade ou pedir a escolha do cadastro correto.
Provável causa: A importação cria um `Map` de `company_name` normalizado para um único UUID; nomes repetidos sobrescrevem a entrada anterior, e não existe unicidade de nome na tabela `clients` nem desambiguação por documento ou código interno.


RESOLVIDO
###############

Bug 135

Sintoma: Em uma base grande de regiões, uma única linha já existente mas ausente da página carregada pode fazer até 99 regiões novas do mesmo lote deixarem de ser importadas, embora fossem válidas.
Provável causa: A consulta usada para montar `existing` não possui paginação; uma duplicata fora do subconjunto retornado segue para um `insert` de até 100 linhas, e a violação do índice único reverte o lote inteiro em vez de isolar somente a linha duplicada.


RESOLVIDO
###############

Bug 136

Sintoma: É possível cadastrar manualmente uma região com município ou nome da região composto somente por espaços e também criar chaves visualmente duplicadas acrescentando espaços no início ou no fim dos campos.
Provável causa: O botão verifica apenas se as strings são truthy e `upsertMutation` envia os valores sem `trim` ou normalização; o índice de deduplicação usa `upper`, mas não remove espaços das extremidades.


RESOLVIDO
###############

Bug 137

Sintoma: No “Histórico anterior” da conciliação, trocar a conta bancária não restringe os títulos, as divergências nem as obrigações de motoristas; registros vinculados a outra conta continuam aparecendo e entram nos indicadores da conta selecionada.
Provável causa: As consultas de `financial_obligations` em `legacy_reconciliation_summary` e `legacy_reconciliation_rows` filtram somente `tenant_id` e data, apesar de a tabela possuir `bank_account_id`; o parâmetro `_bank_account` é aplicado apenas às transações bancárias.


RESOLVIDO
###############

Bug 138

Sintoma: Uma obrigação sem data de vencimento aparece em todos os períodos consultados no histórico bancário e é recontada nos totais mesmo quando o intervalo selecionado não tem relação com ela.
Provável causa: O filtro de obrigações usa explicitamente `due_date IS NULL OR due_date BETWEEN início AND fim`, fazendo linhas sem data satisfazerem qualquer intervalo em vez de separá-las como pendências sem período.


RESOLVIDO
###############

Bug 139

Sintoma: O cartão “Pendentes” pode indicar zero mesmo existindo transações no status “Revisão manual” que ainda exigem ação do usuário.
Provável causa: `pending_count` conta somente os status `unmatched` e `suggested`; `manual_review` está disponível no modelo e nos filtros da tela, mas foi excluído do indicador de pendências.


RESOLVIDO
###############

Bug 140

Sintoma: Se o pedido de conciliação preservado no navegador ficar incompatível ou corrompido, a conciliação daquele extrato permanece bloqueada na sessão e a própria tela não oferece como descartar o conteúdo inválido e recomeçar.
Provável causa: Uma falha ao interpretar `sessionStorage` define `restored.error` de forma permanente; esse valor desabilita a seleção e o preparo, mas o componente não remove a chave problemática nem apresenta uma ação de recuperação.


RESOLVIDO
###############

Bug 141

Sintoma: Informar uma observação de importação de extrato com cinco ou mais espaços pode enviar e preservar o arquivo, falhar no registro das linhas e deixar o pedido preso indefinidamente em “Retomar importação”, sem permitir descartá-lo.
Provável causa: O contrato do frontend valida `reason` com `min(5)` sem `trim`, enquanto o banco exige ao menos cinco caracteres após `btrim`; no caminho `intake_finance_statement_artifact`, a rejeição é lançada como erro bruto, não como `FinanceRejectedError`, então o workflow mantém a fase `intake` como incerta e a interface oculta a opção de descarte.


RESOLVIDO
###############

Bug 142

Sintoma: O botão “Acessar arquivo original” recusa como “fora do contexto esperado” os extratos importados pelo fluxo atual de quarentena, impedindo consultar o arquivo a partir do histórico mesmo após importação e conferência bem-sucedidas.
Provável causa: O fluxo v2 grava em `finance_statement_imports.source_path` o derivado validado no padrão `<tenant>/<request>/validated.json`, dentro de `upload-validated`; `StatementHistoryDetail` ainda exige o padrão legado `<tenant>/imports/<hash>.*` e tenta gerar a URL no bucket `finance-statements`.


RESOLVIDO
###############

Bug 143

Sintoma: O valor informado como “Saldo inicial” ao cadastrar uma conta bancária é salvo, mas não participa da abertura, dos saldos, das conferências nem das projeções financeiras, dando a impressão de que a conta começou com aquele valor quando o razão continua sem abertura.
Provável causa: `NewBankAccountDialog` grava `bank_accounts.initial_balance`, porém nenhum leitor do frontend ou fluxo atual do razão consome essa coluna; as posições financeiras usam os registros auditáveis de `finance_account_openings`, e o cadastro da conta não cria nem vincula uma abertura.


RESOLVIDO
###############

Bug 144

Sintoma: Uma conta corrente ou poupança criada pela tela pode permanecer para sempre com a identificação OFX “incompleta”, impedindo a conciliação automática por referência mesmo quando agência, número e tipo da conta conferem.
Provável causa: A validação `native_statement_account` exige correspondência exata de `bank_code`, agência, conta e tipo, mas `NewBankAccountDialog` não possui campo para `bank_code`; o hook de atualização não é usado por nenhuma tela e não existe outra interface para preencher esse dado obrigatório.


RESOLVIDO
###############

Bug 145

Sintoma: Um OFX válido cujo tipo de conta é `MONEYMRKT` pode ser importado e ter suas linhas conferidas, mas nunca passa na identificação nativa da conta nem entra na conciliação automática.
Provável causa: O leitor OFX aceita `CHECKING`, `SAVINGS` e `MONEYMRKT`, enquanto o cadastro não oferece um tipo correspondente a mercado monetário e `native_statement_account` só converte `checking` e `savings`; o valor registrado fica nulo ou diferente de `MONEYMRKT`.


RESOLVIDO
###############

Bug 146

Sintoma: É possível importar um extrato bancário para uma conta do tipo “Caixa”; depois disso, a conferência de fechamento desse caixa passa a acusar permanentemente uma anomalia de evidência bancária e não permite encerrar o período.
Provável causa: O seletor da importação lista todas as contas ativas sem filtrar `account_type`, e `intake_statement` também valida apenas tenant e atividade da conta; já `cash_period_close_snapshot` adiciona o bloqueio `cash_has_bank_evidence_anomaly` quando encontra qualquer importação ou lançamento bancário associado a uma conta física.


RESOLVIDO
###############

Bug 147

Sintoma: Se um extrato for importado por engano na conta bancária errada, não há como transferi-lo ou anulá-lo e o mesmo arquivo é recusado ao tentar importá-lo novamente na conta correta, deixando conciliação, cobertura e fechamento vinculados ao cadastro incorreto.
Provável causa: `finance_statement_imports.bank_account_id` fica protegido pelo gatilho de imutabilidade e não existe comando de correção ou reversão da importação; além disso, `intake_statement` rejeita qualquer `file_hash` já existente no tenant sem considerar a conta escolhida.


RESOLVIDO
###############

Bug 148

Sintoma: Um OFX histórico de um período em que São Paulo estava no horário de verão pode ter conta, datas, linhas e saldos corretos, mas ainda ser recusado como “fuso incompatível”, impedindo registrar a abertura, aprovar a cobertura e fechar o período.
Provável causa: As validações de abertura, cobertura e proteção de período exigem literalmente `offset_minutes = -180`, e a interface também só considera elegíveis âncoras UTC−03:00; elas não calculam o deslocamento de `America/Sao_Paulo` na data do extrato, que em períodos históricos de horário de verão era UTC−02:00.


RESOLVIDO
###############

Bug 149

Sintoma: Um OFX com datas válidas informadas somente como `AAAAMMDD` pode ser aceito, importado e ter as linhas verificadas, mas nunca comprova a cobertura do período nem fornece uma âncora elegível para abertura e fechamento.
Provável causa: `ofxDate` aceita datas sem horário e sem offset e o leitor nativo não as rejeita; posteriormente, `statement_period_evidence` só cria intervalos e âncoras quando o texto original contém exatamente início `000000`, fim `235959` e fuso entre colchetes, descartando silenciosamente o formato que a importação declarou válido.


RESOLVIDO
###############

Bug 150

Sintoma: Quando o cadastro de contas ultrapassa o limite de linhas da API, contas ativas podem desaparecer dos seletores de importação de extrato, movimentação e transferência, e outras contas podem sumir do “Histórico anterior”, impedindo operar ou consultar esses registros pela interface.
Provável causa: Os dois hooks chamados `useBankAccounts` consultam `bank_accounts` sem paginação, contagem ou busca remota; todos esses seletores são montados apenas com o subconjunto retornado pela requisição.


RESOLVIDO
###############

Bug 151

Sintoma: Um PDF ou uma imagem de extrato pode ser apresentado como “preservado em quarentena”, mas desaparece da interface ao fechar o diálogo; não há tela para localizar, consultar ou retomar esse arquivo pela conta ou pelo identificador exibido.
Provável causa: `QuarantineFileUpload` cria um artefato avulso com `source_type = bank_account` e apenas mostra o UUID na montagem atual; o backend oferece somente leitura por `_artifact_id`, não uma listagem por conta, e nenhum registro de importação ou histórico público é criado para esses formatos. A recuperação local só é reencontrada ao selecionar novamente o mesmo arquivo no mesmo navegador.


RESOLVIDO
###############

Bug 152

Sintoma: Parcelas de um recebível renegociado aparecem na previsão de caixa sem cliente, descrição ou número do documento; ao revisar a data esperada, o usuário precisa distinguir as parcelas essencialmente pelo UUID, aumentando o risco de alterar a parcela errada.
Provável causa: A coleta de renegociações publica cada parcela com `source_table = receivables` e `source_id` igual ao ID da parcela, mas `cash_forecast_identified_sources` usa esse ID para procurar uma linha em `public.receivables`; como a parcela está no razão da renegociação e não nessa tabela, os campos descritivos ficam nulos.


RESOLVIDO
###############

Bug 153

Sintoma: Cadastrar uma conta como “Cartão empresa”, “Pix” ou “Outro” pode tornar toda a previsão de caixa indisponível, mesmo quando as contas correntes, poupanças e caixas possuem bases válidas e conferidas.
Provável causa: Esses três tipos são opções normais de `NewBankAccountDialog` e ficam ativos por padrão, mas `cash_forecast_collect` percorre todas as contas sem filtrar o escopo, classifica qualquer tipo diferente de `cash`, `checking` ou `savings` como `unsupported` e define `base_valid = false` para a projeção inteira.


RESOLVIDO
###############

Bug 154

Sintoma: Um recebível já integralmente recebido ou uma conta a pagar já totalmente paga pode continuar aparecendo para sempre entre as fontes da previsão; se esse registro histórico tiver alguma inconsistência de validação, ele também deixa a previsão atual incompleta apesar de não possuir saldo futuro.
Provável causa: `cash_forecast_collect` percorre todos os recebíveis e pagáveis cujo status seja diferente de `cancelled`, sem restringir a saldo aberto ou relevância para o horizonte; os registros liquidados só recebem `timing = already_covered` depois da validação, enquanto qualquer falha anterior já adicionou `forecast_*_unverified` aos bloqueios do cenário.


RESOLVIDO
###############

Bug 155

Sintoma: É possível criar ou editar uma conta a pagar já com o status “Paga” sem registrar pagamento, conta bancária, movimento financeiro ou valor efetivamente pago, fazendo a obrigação parecer liquidada sem existir saída de dinheiro auditável.
Provável causa: O seletor de status oferece `paid` e `handleSave` envia essa situação por `insert` ou `update` direto em `payables`; `useUpdatePayable` no máximo preenche `paid_at` com o horário atual, mas nenhum desses caminhos cria `payables_payments` nem exige o fluxo financeiro de pagamento e vínculo de movimento.


RESOLVIDO
###############

Bug 156

Sintoma: Depois de marcar uma conta a pagar como “Paga”, mudar o status de volta para pendente, vencida ou cancelada conserva `paid_at`, deixando o título com uma data de pagamento embora a situação indique que ele não está pago.
Provável causa: `useUpdatePayable` acrescenta `paid_at` quando o novo status é `paid`, mas não limpa essa coluna nas transições de saída; o formulário também não carrega nem envia `paid_at`, portanto o timestamp anterior permanece no registro.


RESOLVIDO
###############

Bug 157

Sintoma: Depois que uma conta a pagar é aprovada, ainda é possível alterar fornecedor, valor, vencimento, categoria, documento e observações mantendo o status “Aprovada”, de modo que a aprovação passa a aparentar validar dados que o responsável nunca revisou.
Provável causa: Ao editar sem trocar o status, `handleSave` omite `status` mas envia os demais campos diretamente; `guard_payable_revision_approval` só exige ticket na transição de outro estado para `approved` e retorna imediatamente quando `old.status = 'approved'`, sem invalidar ou retirar a aprovação diante de mudanças materiais.


RESOLVIDO
###############

Bug 158

Sintoma: Alterar uma conta aprovada para pendente, vencida, paga ou cancelada mantém `approved_at` e `approved_by`, deixando registros não aprovados — ou já encerrados — com metadados de aprovação ativa.
Provável causa: O formulário não carrega nem envia os campos de aprovação, `useUpdatePayable` só impede que o navegador os altere explicitamente e nenhuma transição para fora de `approved` os limpa; o gatilho de revisão também retorna sem intervenção quando o novo status não é `approved`.


RESOLVIDO
###############

Bug 159

Sintoma: Uma conta a pagar com baixa parcial ou total pode ser alterada diretamente para “Cancelada” sem estornar o pagamento nem o movimento bancário; o portfólio passa a excluir o título dos valores ativos, mas fica com uma pendência `cancelled_with_active_payment` que torna todos os totais filtrados indeterminados.
Provável causa: O formulário oferece `cancelled` para qualquer conta e grava a mudança por `update` direto em `payables`; não existe uma guarda global que exija a reversão dos registros em `payables_payments` e `finance_payable_movement_links` antes do cancelamento, embora `payable_portfolio_evidence` detecte a inconsistência somente depois de ela ter sido criada.


RESOLVIDO
###############

Bug 160

Sintoma: Uma conta já paga pode ter fornecedor, valor, vencimento, categoria ou documento alterados sem desfazer ou refazer a baixa; mudar o valor, por exemplo, produz um título “Pago” cujo total não corresponde mais aos pagamentos preservados e invalida a carteira inteira do filtro.
Provável causa: A tela abre títulos pagos para edição e envia todos os campos materiais por `useUpdatePayable`, enquanto as proteções existentes se concentram nas tabelas imutáveis de pagamento e nos tipos operacionais específicos; não há uma trava geral de revisão do título quando `old.status = 'paid'`.


RESOLVIDO
###############

Bug 161

Sintoma: O histórico informa que o XML original da conta foi preservado, exibe hash e dados extraídos, mas não oferece nenhuma forma de abrir ou baixar o arquivo; assim, o documento guardado não pode ser recuperado pelo usuário para auditoria ou conferência.
Provável causa: `PayableXmlHistory` recebe somente o DTO de metadados retornado por `get_finance_payable_xml_context`; o bucket `payable-xml-quarantine` bloqueia todo acesso do navegador e não existe RPC ou endpoint autenticado que gere uma leitura ou URL assinada do objeto original.


RESOLVIDO
###############

Bug 162

Sintoma: Selecionar um XML e abandonar a operação depois da preservação, ou perder o armazenamento local antes de confirmar a conta, deixa o arquivo privado ocupando espaço para sempre sem vínculo com qualquer conta e sem possibilidade de recuperação ou descarte.
Provável causa: O upload para `payable-xml-quarantine` ocorre antes de `record_finance_payable_xml`; artefatos recebidos sem linha em `payable_xml_private.links` não possuem rotina de expiração/limpeza, e o gatilho `payable_xml_original_immutable` impede inclusive a exclusão dos objetos abandonados.


RESOLVIDO
###############

Bug 163

Sintoma: A carteira permite selecionar contas vencidas para baixa em lote, mas a prévia sempre recusa o lote dizendo que existe título sem aprovação, mesmo quando todos os itens exibidos estavam habilitados para seleção.
Provável causa: `PayablePortfolioPanel` habilita o checkbox para status `approved`, `partial` e `overdue`, enquanto `payable_bulk_context` considera pagável somente `approved` ou `partial`; assim, `overdue` passa pela regra da interface e inevitavelmente recebe `finance_payable_not_payable` no servidor.


RESOLVIDO
###############

Bug 164

Sintoma: Criar, editar, pagar ou estornar manualmente uma conta a pagar pode concluir com sucesso e ainda deixar a carteira da própria tela exibindo linhas, saldos, situações e totais anteriores até que o usuário atualize ou remonte a página.
Provável causa: `useCreatePayable`, `useUpdatePayable` e a rotina `recorded` de `PayablePaymentDialog` invalidam chaves como `payables` e `payables_payments`, mas a lista visível é a consulta independente `finance-payable-portfolio`, que não é invalidada nesses caminhos; apenas fluxos como aprovação, XML e baixa em lote atualizam essa chave.


RESOLVIDO
###############

Bug 165

Sintoma: Se o pedido de baixa em lote salvo no navegador ficar corrompido, incompatível ou inacessível, todas as novas baixas em lote ficam permanentemente bloqueadas para a combinação empresa/usuário, sem botão para descartar o registro inválido e reiniciar.
Provável causa: Qualquer falha de `pendingPayableBulkSettlement` define `corrupt = true` e faz `hasPendingBulk` continuar verdadeiro; o diálogo apenas desabilita a revisão/envio e mostra a mensagem de inconsistência, mas nunca remove nem substitui a chave `agvlog:payable-bulk-settlement` defeituosa do `localStorage`.


RESOLVIDO
###############

Bug 166

Sintoma: É possível registrar a baixa de uma conta de um fornecedor usando uma saída cujo favorecido é outra pessoa ou empresa, fazendo o título parecer pago por um movimento que pertence a um destinatário diferente.
Provável causa: Tanto `payable_movement_options` quanto a lista da baixa em lote retornam todas as saídas disponíveis (salvo a restrição opcional de motorista), e `apply_payable_movement`/`payable_bulk_context` não comparam `finance_movements.beneficiary_name` com `payables.supplier_id` ou `supplier_name`; a validação do lote garante apenas que os títulos sejam do mesmo favorecido entre si.


RESOLVIDO
###############

Bug 167

Sintoma: Um recebível de determinado cliente pode ser baixado usando uma entrada registrada cuja contraparte é outro cliente, fazendo o título parecer liquidado com dinheiro que pertence a um pagador diferente.
Provável causa: `receipt_movement_options` filtra as entradas apenas por empresa, conta, data, direção, natureza e texto de busca; `project_receivable_command` repete somente as validações de conta/data/capacidade e nunca compara `finance_movements.beneficiary_name` com o cliente ou pagador do recebível.


RESOLVIDO
###############

Bug 168

Sintoma: Um registro incompatível ou corrompido de operação financeira no armazenamento local bloqueia novos recebimentos, estornos e conciliações para todas as contas a receber daquela empresa e usuário, sem oferecer uma forma de descartar o pedido inválido.
Provável causa: `pendingFinancialCommand` lança erro ao encontrar JSON inválido ou até uma chave antiga com o mesmo sufixo; `useReceivableFinancial` converte isso em `recoveryError`, que desabilita o formulário, enquanto `ReceivableFinancialRecoveryPanel` exibe somente a mensagem e não possui ação para remover ou substituir a chave `agvlog:receivable-financial` defeituosa.


RESOLVIDO
###############

Bug 169

Sintoma: Se a consulta das parcelas renegociadas falhar, a tela ainda permite preencher e confirmar um recebimento como se não existisse acordo; a operação termina recusada apenas no servidor e, se foi escolhido um comprovante, o arquivo pode já ter sido enviado sem ficar vinculado a recebimento algum.
Provável causa: `ReceivableFinancialDialog` transforma qualquer `agreementQuery.error` em `agreement = undefined`, não inclui esse erro em `blocked` nem o mostra ao usuário; com isso omite `installment_allocations` e `expected_agreement_revision`, apesar de `prepare_receivable_installment_distribution` exigir esses campos quando há acordo ativo, e o upload do comprovante ocorre antes da chamada rejeitada.


RESOLVIDO
###############

Bug 170

Sintoma: Criar, revisar ou revogar uma renegociação pode deixar a previsão de caixa aberta exibindo os vencimentos e valores das parcelas anteriores, mesmo depois de a nova versão do acordo ter sido confirmada.
Provável causa: `ReceivableAgreementDialog` invalida somente `receivable-agreement-position` e `receivable-agreement-history` apó confirmar ou recuperar o comando; não invalida `finance-cash-forecast-preview`, `finance-cash-forecast-agenda` nem as fontes correntes, embora `cash_forecast_collect` substitua o recebível pelas parcelas do acordo vigente.


RESOLVIDO
###############

Bug 171

Sintoma: Um recebível com mais de 30 versões de renegociação informa o total correto, mas o usuário só consegue ver as 30 versões mais recentes; todo o histórico anterior fica inacessível na interface.
Provável causa: O diálogo chama `readReceivableAgreementHistory` sempre com `offset = 0` e `limit = 30` e apenas renderiza essas linhas dentro de `<details>`; apesar de a resposta possuir `next_offset`, não existem estado de paginação nem botões para buscar as páginas seguintes.


RESOLVIDO
###############

Bug 172

Sintoma: Logo depois de criar ou revisar uma renegociação, tentar confirmar outra versão com as parcelas que continuam preenchidas na tela termina em conflito de chave; alterar apenas valor ou vencimento não resolve, obrigando o usuário a excluir e recriar manualmente cada linha.
Provável causa: Cada linha do formulário recebe um UUID em `newRow`, mas `confirmAgreement` não limpa nem regenera `rows` apó o sucesso; a versão seguinte reutiliza IDs já gravados, enquanto `receivable_agreement_installments` possui chave primária global por `(tenant_id, id)` e `record_receivable_agreement` tenta inseri-los novamente.


RESOLVIDO
###############

Bug 173

Sintoma: Durante uma aplicação de crédito ou baixa por desconto/perda, uma falha ao consultar as parcelas ainda deixa a confirmação habilitada como se o recebível não tivesse acordo; o usuário revisa e envia um comando que o servidor inevitavelmente recusa por falta da distribuição entre parcelas.
Provável causa: Em `ReceivableInstallmentAllocationFields`, tanto uma resposta realmente sem acordo quanto `position` indefinida por `query.error` executam `onChange({})`; `CustomerCreditConfirmation` e `ReceivableAdjustmentConfirmation` consideram qualquer distribuição diferente de `null` como pronta, apesar de o servidor exigir `installment_allocations` e `expected_agreement_revision` para um acordo ativo.


RESOLVIDO
###############

Bug 174

Sintoma: Em uma empresa com muitos créditos, recebíveis ou movimentos, abrir a primeira página do catálogo de créditos ou das saídas para devolução pode ficar progressivamente lento, consumir muita memória ou exceder o tempo da consulta, embora a tela solicite apenas 30 registros.
Provável causa: `customer_credit_options` e `customer_credit_refund_options` percorrem todos os candidatos, calculam posição/contexto individual e concatenam cada resultado em um grande array JSON; somente depois calculam `total` e aplicam `offset`/`limit` com `jsonb_array_elements`, portanto a paginação não limita o trabalho nem a memória no servidor.

###############

Bug 175

Sintoma: Se uma devolução de crédito for vinculada à saída errada ou ao valor errado, não existe forma de desfazer ou corrigir a operação; o saldo do crédito e a capacidade do movimento ficam reduzidos permanentemente pelo lançamento incorreto.
Provável causa: `customer_credit_refunds` é imutável, o histórico da interface é somente leitura e o backend expõe apenas prévia/registro de nova devolução; não há evento compensatório, comando de reversão ou liberação equivalente ao existente para aplicações de crédito.


RESOLVIDO
###############

Bug 176

Sintoma: Depois de revogar uma renegociação, a tela muda para “Novo acordo” e permite preencher parcelas e gerar conferência, mas nenhuma nova renegociação pode ser confirmada para aquele recebível.
Provável causa: O componente escolhe a ação `create` para qualquer posição diferente de `active`, inclusive `revoked`; porém `receivable_agreement_context` aceita `create` somente quando `status = 'none'` e adiciona `finance_agreement_already_exists` quando existe um evento revogado, tornando a revogação terminal apesar da interface oferecer um novo acordo.


RESOLVIDO
###############

Bug 177

Sintoma: A tela habilita “Conferir previsão atual” para períodos que o servidor sempre rejeita — por exemplo, saldo-base na data de hoje, horizonte inteiro no passado ou intervalo superior a dez anos — e responde apenas que a previsão está indisponível, sem indicar o campo inválido.
Provável causa: `CashForecastPanel` valida somente que as duas datas estejam preenchidas e `cutoff < end`; `cash_forecast_collect_before_agenda` exige adicionalmente `cutoff < hoje`, `period_end >= hoje` e no máximo 3.660 dias entre as datas, regras que não existem nos limites ou no estado desabilitado dos inputs da interface.


RESOLVIDO
###############

Bug 178

Sintoma: Quanto mais vezes datas esperadas são revisadas, mais pesadas ficam todas as consultas e preservações da previsão; um histórico longo em várias origens pode fazer a prévia crescer indefinidamente, ficar lenta ou exceder limites de resposta/armazenamento mesmo mostrando só 20 revisões por vez.
Provável causa: `cash_forecast_collect` agrega a lista completa de `cash_forecast_agenda_events` dentro de cada origem, e esse array integral participa da revisão, das páginas de fontes e do snapshot; `CashForecastAgendaHistory` apenas aplica `slice` no navegador, portanto sua paginação visual não reduz consulta, transferência nem tamanho da evidência preservada.


RESOLVIDO
###############

Bug 179

Sintoma: A tela permite revisar a data esperada para qualquer dia passado e avançar por toda a conferência, mas a confirmação é sempre recusada no fim com a mensagem para escolher hoje ou uma data futura.
Provável causa: O input de data em `CashForecastAgendaConfirmation` não define `min` nem valida a data antes de habilitar a revisão; o bloqueio `finance_forecast_agenda_date_past` existe apenas em `record_cash_forecast_agenda`, depois de o usuário preencher motivo, revisar e confirmar.


RESOLVIDO
###############

Bug 180

Sintoma: Ao registrar uma movimentação manual, é possível escolher uma data futura, preencher toda a operação e enviá-la, mas a confirmação sempre termina recusada com uma mensagem genérica e os dados precisam ser revistos.
Provável causa: O campo “Data da movimentação” de `MovementEntryDialog` não possui `max` nem validação contra a data local atual; `record_movement` aceita somente dinheiro já realizado e rejeita `occurred_on` posterior ao dia corrente com `finance_invalid_realized_movement`, erro que `financeError` não traduz especificamente.


RESOLVIDO
###############

Bug 181

Sintoma: Informar no filtro de movimentações uma data inicial posterior à data final faz a listagem inteira desaparecer e mostra uma mensagem genérica de falha, sem apontar que o intervalo precisa ser corrigido.
Provável causa: `FinanceMovements` envia `from` e `to` sem validar nem limitar a relação entre os campos; `list_movements` rejeita `date_from > date_to` como `finance_invalid_filters`, e a interface trata essa leitura com o mesmo tradutor genérico de operações financeiras.


RESOLVIDO
###############

Bug 182

Sintoma: Uma transferência registrada com conta, valor ou data errados não pode ser corrigida nem invalidada; uma saída em trânsito criada por engano também permanece indefinidamente entre as pendências, inclusive se a conta de destino for desativada antes da chegada.
Provável causa: A correção genérica adiciona `transfer_requires_specific_correction` para toda movimentação de natureza `transfer`, mas não existe comando ou interface de correção/cancelamento específico para `finance_internal_transfers` ou `finance_transfer_departures`; essas tabelas e seus movimentos são imutáveis e o único comando posterior disponível é registrar a chegada integral.

###############

Bug 183

Sintoma: Em empresas com muitos adiantamentos de viagem, abrir até a primeira página de devoluções pode ficar progressivamente lento, consumir muita memória ou exceder o tempo da consulta, embora a tela mostre somente 30 adiantamentos.
Provável causa: `driver_advance_positions` percorre todos os movimentos ativos de adiantamento, chama `driver_advance_position` para cada um e monta em memória todas as posições com seus históricos completos; só depois calcula o total e recorta as 30 linhas da página solicitada.


RESOLVIDO
###############

Bug 184

Sintoma: A tela informa quantas devoluções estão vinculadas a cada adiantamento e o total devolvido, mas não permite consultar quais entradas, valores, datas, autores ou motivos formam esse histórico, impedindo auditar ou localizar uma vinculação incorreta pela interface.
Provável causa: A API devolve em cada posição o array completo `history` com esses dados e o contrato o valida, porém `DriverAdvanceReturns` renderiza apenas `history_count`; não há detalhe, expansão ou outra tela que apresente os registros de `driver_advance_returns`.


RESOLVIDO
###############

Bug 185

Sintoma: Uma devolução de adiantamento ou de valor sob responsabilidade do motorista registrada pela própria tela de movimentações nunca aparece nos seletores de entrada compatível; na operação normal, esses catálogos ficam vazios e não é possível concluir o vínculo da devolução ao motorista.
Provável causa: `driver_advance_return_options` e os retornos de disposição `driver_custody` exigem uma entrada de natureza `refund`, `receipt` ou `other` cujo `driver_id` seja o mesmo do responsável, mas `MovementEntryDialog` só exibe motorista e inclui `driver_id` no comando quando a natureza é `driver_advance`, que força uma saída. Nenhum fluxo da interface cria a entrada com motorista que esses catálogos requerem.


RESOLVIDO
###############

Bug 186

Sintoma: Anexar um comprovante ao preparar uma despesa avulsa e depois voltar à edição, fechar o diálogo ou receber uma rejeição do servidor deixa o arquivo enviado ocupando o armazenamento sem vínculo recuperável; cada nova revisão pode enviar outra cópia órfã.
Provável causa: `ManualExpenseWorkspace.prepare` chama `uploadPaymentAttachment` antes da confirmação e guarda o caminho apenas no objeto de prévia em memória; os caminhos não são preservados no rascunho antes do envio e nenhum caminho de voltar, fechar ou rejeitar chama `removeSecureFiles`. O registro imutável de evidência só é criado depois que `record_manual_expense` aceita o comando.


RESOLVIDO
###############

Bug 187

Sintoma: Quando a empresa acumula mais adiantamentos de funcionários do que o limite de linhas da API, os mais antigos desaparecem da aba de folha e do histórico exibido no cadastro do funcionário, impedindo consultar, aprovar, cancelar ou vincular seus pagamentos pela interface.
Provável causa: `useEmployeeAdvances` consulta diretamente `employee_advances` com um único `select`, ordena o resultado e o usa como catálogo completo; não há paginação, contagem separada nem busca de páginas adicionais após o limite de resposta do PostgREST.


RESOLVIDO
###############

Bug 188

Sintoma: No cadastro de adiantamento de funcionário, valores com centavos digitados no campo numérico — por exemplo, `12.34` — são recusados como se o valor obrigatório estivesse ausente; apenas valores inteiros em reais funcionam de forma confiável nesse campo.
Provável causa: `RegisterAdvanceDialog` usa `<Input type="number" step="0.01">`, cujo `value` padronizado usa ponto como separador decimal, mas entrega esse texto a `parseFinanceAmount`; o parser aceita vírgula decimal e interpreta ponto somente como separador de milhar em grupos de três, rejeitando `12.34`.


RESOLVIDO
###############

Bug 189

Sintoma: Clientes com muitos documentos fiscais podem deixar de ver CT-es ou NFS-es antigos ainda faturáveis no assistente de nova fatura; o seletor afirma apenas que não há documentos elegíveis e não oferece busca ou página adicional.
Provável causa: `useEligibleCtes` e `useEligibleNfse` limitam a consulta aos 500 documentos mais recentes antes de excluir origens já cobradas e antes de chamar `filter_billable_fiscal_sources`. Não há paginação nem indicador de truncamento, portanto documentos elegíveis fora desse primeiro lote nunca chegam ao assistente.


RESOLVIDO
###############

Bug 190

Sintoma: É possível gerar uma fatura comercial com vencimento anterior à data de emissão, criando também um título a receber já vencido antes de existir a própria fatura.
Provável causa: `NewInvoiceWizard` aceita livremente as duas datas sem definir limite nem comparar sua ordem; `_client_invoice_draft_snapshot` e `create_client_invoice` verificam apenas se os textos são datas válidas, mas não exigem `due_date >= issue_date`.


RESOLVIDO
###############

Bug 191

Sintoma: Depois de muitas ações sobre a mesma fatura, eventos antigos de geração, envio, cancelamento ou reativação desaparecem do histórico exibido, sem aviso de que a auditoria está incompleta e sem meio de carregar registros anteriores.
Provável causa: `_invoice_lifecycle_snapshot` agrega somente os 20 comandos mais recentes de `client_invoice_commands`; o contrato e `ClientInvoiceLifecycleDialog` recebem apenas esse array, sem total, cursor ou paginação para consultar o restante.


RESOLVIDO
###############

Bug 192

Sintoma: Ao ultrapassar 500 faturas, a tela avisa que a consulta está limitada, mas não permite abrir, pesquisar, baixar ou executar ações nas faturas mais antigas; filtros por cliente, estado e número também retornam apenas resultados presentes no lote recente.
Provável causa: `list_client_invoice_financials` devolve no máximo as 500 linhas mais recentes e apenas um booleano `truncated`; `ClientInvoices` aplica todos os filtros no navegador e não possui cursor, número de página nem consulta individual por número para alcançar o restante.


RESOLVIDO
###############

Bug 193

Sintoma: Baixar novamente o PDF ou gerar o DOCCOB de uma fatura antiga pode exibir a razão social, documento, endereço, contatos ou logotipo atuais da transportadora e do cliente, diferentes dos dados existentes quando a cobrança foi gerada.
Provável causa: Embora `client_invoices` tenha `payer_snapshot` e `company_snapshot`, `NewInvoiceWizard` não os inclui no rascunho e o backend grava objetos vazios. `handleDownloadPdf` usa apenas `useCompanyProfile` e a relação `clients` atuais; `GenerateDialog` também prioriza `inv.clients` e só tenta o snapshot vazio como fallback parcial.


RESOLVIDO
###############

Bug 194

Sintoma: Um DOCCOB grande pode ser gerado e registrado como válido mesmo faltando notas de detalhe no TXT; as faturas ficam marcadas como exportadas e o histórico preserva contagens e hash do arquivo incompleto.
Provável causa: `fetchInvoicesBundle` lê todas as cobranças e detalhes selecionados em consultas PostgREST únicas, sem paginação, contagem esperada ou detecção do limite de resposta. Se parte dos detalhes for truncada e cada cobrança ainda conservar ao menos uma linha, a validação local não percebe; `register_doccob_export` confia integralmente no conteúdo, hash e contagens enviados pelo navegador, sem recompor ou comparar as linhas com o banco.


RESOLVIDO
###############

Bug 195

Sintoma: Após 200 arquivos de cobrança, exportações antigas desaparecem do histórico e não podem mais ser baixadas, conferidas, marcadas como enviadas ou canceladas pela interface, sem qualquer aviso de truncamento.
Provável causa: `useEdiExports` aplica `.limit(200)` à consulta ordenada por geração e `HistoryTab` renderiza esse resultado como histórico completo; não há total, cursor, paginação nem busca por arquivo.


RESOLVIDO
###############

Bug 196

Sintoma: Quando mais de 500 faturas correspondem aos filtros de DOCCOB, parte delas desaparece silenciosamente do seletor e o botão “Selecionar todas” inclui apenas o lote retornado, embora a tela não indique que existem outras faturas elegíveis.
Provável causa: `useEligibleInvoicesForEdi` encerra a consulta com `.limit(500)` e devolve somente um array; a página não recebe contagem total, sinal de truncamento ou cursor para carregar lotes adicionais.


RESOLVIDO
###############

Bug 197

Sintoma: Um perfil DOCCOB marcado como desativado continua sendo escolhido automaticamente e usado para gerar novos arquivos; pela própria tela também não é possível visualizar ou alterar o estado ativo/inativo do perfil.
Provável causa: `useEdiProfiles` busca perfis sem filtrar `enabled` e `clientProfile` escolhe o primeiro perfil do cliente ou global sem conferir esse campo. `ProfileDialog` inicializa `enabled`, mas não renderiza nenhum controle correspondente e lista perfis ativos e inativos da mesma forma.


RESOLVIDO
###############

Bug 198

Sintoma: Um único clique em “Marcar enviado” altera o arquivo e todas as faturas vinculadas para enviados mesmo sem informar destinatário, canal real, confirmação ou evidência de que o TXT saiu do sistema.
Provável causa: O botão do histórico chama diretamente `markSent.mutate({ exportId })`; `useMarkEdiSent` preenche o canal com `manual` e deixa `sent_to` vazio, enquanto `mark_doccob_sent` atualiza os estados sem exigir esses dados nem executar qualquer envio.


RESOLVIDO
###############

Bug 199

Sintoma: O usuário pode baixar um DOCCOB com sucesso e o histórico continuar indicando que ele nunca foi baixado; nenhuma mensagem informa que apenas o registro de auditoria falhou.
Provável causa: Tanto o download automático após gerar quanto “Baixar novamente” criam o arquivo antes de chamar `mark_doccob_downloaded`; se a RPC falha, o erro é capturado apenas com `console.warn`, sem aviso na interface nem tentativa de recuperação.


RESOLVIDO
###############

Bug 200

Sintoma: Depois de selecionar faturas e trocar filtros, o botão de gerar pode permanecer habilitado mesmo sem nenhuma das selecionadas estar visível; “Selecionar todas” também pode aparecer marcado para um conjunto diferente e o diálogo abre com zero faturas ou com uma seleção inesperada.
Provável causa: O estado `selected` não é limpo nem reconciliado quando cliente, estado ou datas mudam. O botão e o cabeçalho usam `selected.size`, enquanto `selectedInvoices` elimina IDs ausentes do novo resultado, e a igualdade de tamanhos é usada como se comprovasse que os mesmos IDs estão selecionados.


RESOLVIDO
###############

Bug 201

Sintoma: Um operador autenticado pode contornar os comandos de DOC/COB e alterar ou excluir diretamente arquivos, conteúdo, hash, totais, estado de envio e itens vinculados, apagando ou reescrevendo a trilha que a tela apresenta como histórico de exportações.
Provável causa: O baseline concede `INSERT`, `UPDATE` e `DELETE` em `billing_edi_exports` e `billing_edi_export_items` ao papel `authenticated`, e as políticas `edi_exports_write` e `edi_items_write` liberam todas essas operações para qualquer operador ou administrador do tenant. Não existe trigger de imutabilidade ou migração posterior revogando essas permissões; `tg_billing_edi_touch` apenas atualiza `updated_at`.


RESOLVIDO
###############

Bug 202

Sintoma: Empresas com muitos fechamentos deixam de ver os registros mais antigos e os cartões de quantidade, valor total, frete, peso e saldo em aberto passam a exibir totais parciais como se representassem toda a carteira filtrada.
Provável causa: `useClosingReportsList` executa um único `select` de `closing_reports`, sem paginação, limite controlado ou contagem total; `ClosingReportsScreen` soma diretamente as linhas devolvidas pelo limite da API e não sinaliza truncamento.


RESOLVIDO
###############

Bug 203

Sintoma: Um fechamento com muitos itens pode gerar PDF, Excel ou CSV incompleto, omitindo entregas ou linhas de resumo sem aviso, embora o arquivo seja baixado normalmente com o número e os totais do fechamento completo.
Provável causa: `fetchReportItems` e `useClosingReport` consultam `closing_report_items` e `closing_report_summary_lines` em chamadas únicas sem paginação nem comparação com `fiscal_document_count` ou outra contagem preservada. O código exporta diretamente qualquer subconjunto retornado pelo limite de linhas da API.


RESOLVIDO
###############

Bug 204

Sintoma: Reexportar um fechamento antigo pode trocar no PDF a identidade e o logotipo da transportadora e o nome do cliente pelos cadastros atuais, fazendo o mesmo fechamento histórico produzir documentos diferentes ao longo do tempo.
Provável causa: `closing_reports` possui `client_snapshot` e `company_snapshot`, mas `create_closing_report_draft` não os preenche e mantém os objetos padrão vazios. `ClosingReports.exportPdf` usa `useCompanyProfile`, `currentTenant.name` e a relação viva de `clients`, e os demais exportadores também recebem o nome atual em vez de snapshots preservados.


RESOLVIDO
###############

Bug 205

Sintoma: É possível criar um fechamento com vencimento previsto anterior ao início ou ao fim do próprio período, fazendo uma cobrança futura nascer já vencida ou com cronologia impossível.
Provável causa: `CreateClosingReportPanel` não define limite nem compara `expectedPay` com o período; `closingHeaderSchema` valida apenas o formato e `create_closing_report_draft` exige somente uma data finita, sem qualquer relação entre `expected_payment_date`, `period_start` e `period_end`.


RESOLVIDO
###############

Bug 206

Sintoma: Um fechamento pode ser marcado como enviado sem destinatário e sem canal, registrando uma entrega externa que não possui informação mínima para ser comprovada ou auditada.
Provável causa: `ClosingLifecycleDialog` envia `sent_to: null` e `channel: null` quando os campos estão vazios e não os inclui na condição de desabilitar o botão. O contrato aceita ambos como opcionais/nulos e o backend limita apenas o comprimento, sem exigir conteúdo para `mark_sent`.


RESOLVIDO
###############

Bug 207

Sintoma: Todo fechamento importado de planilha legada fica preso para sempre como rascunho ou em conferência: não pode ser fechado nem faturado, apesar de a tela afirmar que ele ficará bloqueado somente “até a conciliação”.
Provável causa: A importação grava `filters_snapshot.mode = 'spreadsheet'` e itens com `financial_review_required = true`; `_assert_closing_sources_current` rejeita incondicionalmente qualquer relatório cujo modo não seja `system` com `closing_import_review_required`. Não existe na interface nem no backend um comando de conciliação, aprovação ou substituição dessas evidências que remova esse bloqueio.


RESOLVIDO
###############

Bug 208

Sintoma: Células inválidas de valor, peso ou frete em uma planilha legada — texto digitado por engano, fórmula com erro ou formato não reconhecido — entram no fechamento como zero sem apontar qual linha está incorreta, alterando silenciosamente os totais importados.
Provável causa: `closingReportImporter.numeric` remove caracteres e retorna `0` sempre que o resultado não é finito; as linhas são aceitas normalmente e o contrato/backend apenas confirmam que os números resultantes são não negativos, sem preservar a célula original nem emitir erro de conversão.


RESOLVIDO
###############

Bug 209

Sintoma: Ao importar uma pasta de trabalho com fechamentos distribuídos em várias abas, somente a primeira planilha é considerada; as demais são ignoradas sem aviso e o resumo apresenta o arquivo como se todo o conteúdo tivesse sido lido.
Provável causa: `parseLegacyWorkbook` acessa exclusivamente `wb.Sheets[wb.SheetNames[0]]` e não verifica a quantidade de abas, não permite escolhê-las e não informa que há folhas adicionais descartadas.


RESOLVIDO
###############

Bug 210

Sintoma: É possível gerar duas folhas com períodos parcialmente sobrepostos, duplicando salário-base, descontos de ocorrências, acertos ou pagamentos nas duas competências e deixando uma delas bloqueada por origens já consumidas somente em etapas posteriores.
Provável causa: `GeneratePeriodDialog` confere apenas se fim é posterior ao início e `generate_payroll_period` procura somente um período com datas exatamente iguais. A tabela possui `CHECK (period_end >= period_start)`, mas não há restrição de exclusão nem validação contra qualquer outro período ativo que intercepte o intervalo.


RESOLVIDO
###############

Bug 211

Sintoma: Gerar novamente o mesmo intervalo escolhendo, por exemplo, “somente motoristas” mantém na folha os funcionários comuns incluídos na geração anterior; o nome e os grupos gravados no período também continuam os antigos, embora a tela informe sucesso na nova geração.
Provável causa: Para datas idênticas, `generate_payroll_period` reutiliza o rascunho existente e percorre apenas os grupos solicitados na chamada atual, mas não atualiza `period_name`, `include_drivers` ou `include_non_drivers` e não remove `payroll_entries` de funcionários que deixaram de pertencer ao novo escopo.


RESOLVIDO
###############

Bug 212

Sintoma: À medida que o histórico de folhas cresce, abrir a tela passa a disparar uma consulta cada vez mais pesada e repetida a cada 30 segundos, podendo deixar a página lenta mesmo quando o usuário consulta apenas o período recente.
Provável causa: `get_finance_payroll_periods` agrega todos os períodos sem paginação e, para cada um, chama lateralmente `payroll_payment_projection`, que recompõe entradas, títulos e pagamentos completos. `usePayrollPeriods` solicita todo esse JSON novamente com `refetchInterval: 30000`.


RESOLVIDO
###############

Bug 213

Sintoma: Uma entrada de folha com muitos lançamentos pode mostrar apenas parte dos créditos, débitos e valores já pagos no painel de detalhe, sem aviso de que itens adicionais ficaram fora da resposta.
Provável causa: `usePayrollEntryItems` faz um único `select('*')` em `payroll_entry_items`, sem paginação, total ou detecção do limite da API; a tabela do painel trata o array retornado como a composição completa.


RESOLVIDO
###############

Bug 214

Sintoma: Uma folha integralmente paga pode ser fechada sem registrar motivo, apesar de o diálogo pedir explicitamente a justificativa do fechamento; o histórico material fica apenas com estado e timestamps, sem explicar a decisão administrativa.
Provável causa: `PeriodEntries.handleClose` abre `promptAction` com `required: false` e aceita texto vazio. `close_payroll_period` exige motivo apenas quando ainda existe saldo em aberto e, para uma folha quitada, concatena nota somente se `_reason` não for nulo.


RESOLVIDO
###############

Bug 215

Sintoma: A folha pode ser aprovada faltando funcionários ou salário-base sem que a tela mostre a pendência; motoristas com acerto e sem funcionário vinculado são omitidos, e funcionários sem contrato aparecem sem salário, mas o usuário vê apenas uma folha aparentemente calculada.
Provável causa: `generate_payroll_period` grava avisos em `payroll_generation_issues` para `driver_without_employee` e `employee_without_contract`, porém nenhum hook ou componente consulta essa tabela. `approve_payroll_period` não verifica pendências não resolvidas e segue travando itens e criando contas a pagar mesmo com esses avisos ocultos.


RESOLVIDO
###############

Bug 216

Sintoma: Uma folha gerada com período ou grupo errado não pode ser cancelada nem descartada pela interface; depois de aprovada também não existe fluxo para cancelar ou reabrir a competência, embora “Cancelada” seja um estado previsto e exibido nos filtros.
Provável causa: Os contratos e tabelas aceitam `status = 'cancelled'`, mas os únicos comandos expostos são gerar/recalcular, aprovar e fechar. Não há hook, botão ou função pública auditada de cancelamento/reabertura de `payroll_periods`, e as proteções mais recentes revogam escrita direta nas tabelas.


RESOLVIDO
###############

Bug 217

Sintoma: Baixas em lote de contas a pagar desaparecem da Auditoria Financeira com o filtro padrão “Somente intervenções manuais”; ao remover o filtro, os eventos aparecem com o texto genérico “Ação financeira registrada” e também não podem ser selecionados no filtro por ação.
Provável causa: `apply_payable_bulk_movement` grava `payable_bulk_movement_applied` e `payable_bulk_movement_confirmed` com `after_data.manual_intervention = true`, mas `finance_private.audit_events` calcula e filtra intervenções por uma lista fixa de nomes que não inclui essas ações, enquanto `financeAuditActions` também não possui rótulos para elas.


RESOLVIDO
###############

Bug 218

Sintoma: Ao filtrar “Custos registrados” por período, o quadro “Manutenção e custos operacionais comprováveis” pode somar um custo financeiro de fora do intervalo ou omitir um custo ocorrido dentro dele, fazendo a cobertura não corresponder ao total e às linhas exibidas para as mesmas datas.
Provável causa: `recorded_costs` aplica `from`/`to` sobre a data canônica do custo (`occurred_on` ou competência), enquanto `recorded_cost_operational_coverage` filtra as fontes por `maintenance_orders.opened_at`, `stock_movements.moved_at` ou `driver_expenses.expense_at` e, depois, soma os `finance_expense_items` vinculados sem validar a data financeira desses custos.


RESOLVIDO
###############

Bug 219

Sintoma: A tela de Custos registrados mostra totais por categoria, mas não permite filtrar a listagem por nenhuma delas; mesmo havendo muitas categorias, o usuário precisa procurar visualmente página a página.
Provável causa: `RecordedCosts` mantém `category` em `RecordedCostFilters` e o RPC `recorded_costs` implementa o filtro correspondente, porém os totais de `data.categories` são renderizados como `<span>` sem controle de seleção e nenhum outro campo da tela altera `draft.category` ou `filters.category`.


RESOLVIDO
###############

Bug 220

Sintoma: Abrir a renegociação de um recebível que já possui parcelas pode causar uma exceção de renderização e fechar/quebrar o diálogo antes de o histórico terminar de carregar; o problema ocorre especialmente na primeira abertura, sem dados em cache, e também quando a consulta do histórico falha.
Provável causa: Dentro do bloco de “Parcelas vigentes”, `ReceivableAgreementDialog` renderiza imediatamente a faixa de versões usando `historyQuery.data!.rows.length`, `historyQuery.data!.total` e `historyQuery.data!.next_offset`; esse bloco depende apenas de `position.installments.length` e não verifica `historyQuery.data`, embora a consulta seja assíncrona e inicialmente retorne `undefined`.


RESOLVIDO
###############

Bug 221

Sintoma: Depois de uma resposta incerta ao criar/editar uma geofence, resolver um endereço ou revisar uma divergência de carga, a mensagem afirma que a solicitação foi preservada para reenvio, mas recarregar a página torna impossível recuperar o pedido exato; repetir a operação com qualquer diferença cria uma nova identidade e, no cadastro de uma cerca nova, pode duplicar uma criação que já tenha sido confirmada no servidor.
Provável causa: `prepareDurableOperatorCommand` grava no `localStorage` somente escopo, `requestId` e `payloadHash`, descartando o payload necessário para reconstruir o RPC. Não existe catálogo/fluxo de recuperação desses comandos; ao receber um payload diferente, o mesmo slot é simplesmente sobrescrito por outro `requestId`, embora o primeiro possa ter sido executado e apenas sua resposta tenha se perdido.


RESOLVIDO
###############

Bug 222

Sintoma: Quando a consulta das geofences falha, a página informa que não existe nenhuma cerca e oferece “Criar Primeira Cerca”; falhas ao consultar estados ou eventos também viram silenciosamente zero veículos dentro e nenhuma atividade, fazendo indisponibilidade parecer ausência real de dados.
Provável causa: `Geofences` usa `data = []` nas três consultas, mas só lê `isLoading` da lista de cercas e não renderiza `error`/tentativa novamente para geofences, `geofence_states` ou `geofence_events`. Ao terminar com erro, os arrays vazios alimentam diretamente o onboarding, os indicadores e as seções vazias.


RESOLVIDO
###############

Bug 223

Sintoma: Um administrador autenticado pode chamar o RPC de abastecimento com o `tenant_id` da própria empresa e IDs de veículo, motorista, funcionário ou viagem pertencentes a outra empresa, criando abastecimento e leitura de odômetro com referências cruzadas entre tenants.
Provável causa: `create_vehicle_fueling_with_odometer_v1` verifica apenas se o ator é administrador de `v_tenant_id`; depois insere diretamente todos os IDs recebidos sem consultar cada tabela pelo mesmo tenant. As relações de `vehicle_fueling` apontam somente para o `id` global das entidades, e não por chave composta `(tenant_id, id)`, portanto as FKs não garantem o isolamento omitido pelo RPC.


RESOLVIDO
###############

Bug 224

Sintoma: Se o servidor concluir uma criação mas a resposta se perder, repetir a ação pode registrar duas coletas, dois abastecimentos/odômetros, importar duas vezes as mesmas ocorrências, aplicar duas movimentações de estoque ou criar contratos/rotas duplicados.
Provável causa: RPCs atômicos recentes como `create_pickup_order_v1`, `create_vehicle_fueling_with_odometer_v1`, `import_occurrence_report_batch_v1`, `create_stock_movement_v1`, `create_employee_contract_v1` e a criação de `save_route_template_v1` não recebem `request_id` nem consultam um ledger idempotente; os hooks também não preservam uma identidade de tentativa, então todo reenvio é tratado como uma nova operação.


RESOLVIDO
###############

Bug 225

Sintoma: Editar uma rota que já possui pontos pode abrir o formulário mostrando “Nenhum ponto adicionado”; se o usuário salvar qualquer alteração, todos os pontos existentes são apagados, mesmo sem ter escolhido removê-los.
Provável causa: O efeito de inicialização de `RouteDialog` executa enquanto `existingWaypoints` ainda é o array vazio padrão da consulta e entra no bloco por causa de `existingWaypoints.length > 0 || editRoute`, condição sempre verdadeira na edição. Ele grava `waypoints = []` e `initialized = true`; quando a consulta assíncrona retorna os pontos, o efeito não os carrega mais, e `save_route_template_v1` apaga e recria a coleção com o array vazio.


RESOLVIDO
###############

Bug 226

Sintoma: Depois de adicionar, remover ou reordenar pontos e salvar uma rota, a tabela principal continua mostrando a quantidade/tipos de pontos antigos e a busca por nomes de pontos usa dados desatualizados até recarregar a página.
Provável causa: `RouteDialog` invalida as chaves `route_templates` e `route_waypoints`, mas a página `Routes` monta o resumo e a busca a partir da consulta `route_waypoints_all`; essa chave não é invalidada após o salvamento.


RESOLVIDO
###############

Bug 227

Sintoma: Em uma empresa com mais geofences ou pontos de interesse ativos que o limite da API, parte desses locais não aparece nos seletores de corredor e de pontos da rota, embora continue cadastrada e utilizável em outras telas.
Provável causa: A página `Routes` passou a paginar `route_templates`, `route_waypoints` e `route_runs`, mas as consultas auxiliares de `geofences` e `pois` ainda fazem um único `select` sem paginação; `RouteDialog` e `WaypointEditor` tratam os arrays truncados como catálogos completos.


RESOLVIDO
###############

Bug 228

Sintoma: Uma falha ao carregar corredores faz a página afirmar “Nenhum corredor encontrado”; falhas nos pontos, execuções recentes, geofences ou POIs viram silenciosamente resumo vazio e seletores incompletos, sem aviso nem opção de tentar novamente.
Provável causa: `Routes` atribui `data = []` a todas as consultas e usa apenas `isLoading` da lista principal, sem ler ou renderizar o estado de erro de nenhuma delas. Os arrays vazios resultantes alimentam diretamente o estado vazio, as estatísticas e o formulário.


RESOLVIDO
###############

Bug 229

Sintoma: Depois de aplicar a migração que torna a auditoria dependente do dado do evento, conciliações bancárias manuais, cancelamentos de despesas, anulações de movimento, fechamentos/reaberturas de período e revisões de agenda de caixa deixam de aparecer no filtro padrão “Somente intervenções manuais”, embora antes fossem exibidos.
Provável causa: `20260917030000_fix_reported_billing_closing_integrity.sql` substitui integralmente a classificação por nomes de ação por `after_data.manual_intervention`, mas não atualiza nem retroalimenta os eventos que não carregam essa chave. Emissores como `bank_reconciled_manually`, `expense_cancelled`, `manual_expense_cancelled`, `movement_voided`, `account_period_reopened` e `cash_forecast_agenda_set` gravam apenas seus resultados atuais (alguns usam `manual: true`) e passam a ser classificados como não manuais.


RESOLVIDO
###############

Bug 230

Sintoma: Reabrir uma folha cancelada pode reativar como “Pendente” uma conta a pagar da folha que já estava cancelada antes do cancelamento da competência por outro motivo, ressuscitando uma obrigação que o usuário não pediu para restaurar.
Provável causa: `change_payroll_period_state` não preserva quais contas foram efetivamente alteradas na ação `cancel`; na ação `reopen`, executa `status = 'pending'` em todo título ligado às entradas da folha cujo estado atual seja `cancelled`, inclusive os que já estavam assim antes do comando.


RESOLVIDO
###############

Bug 231

Sintoma: Ao abrir uma folha calculada, o botão “Aprovar” pode ficar habilitado enquanto as pendências de geração ainda estão carregando ou mesmo quando essa consulta falhou; o usuário confirma a aprovação e só então recebe uma rejeição do servidor sem ter visto quais funcionários ou contratos precisam de correção.
Provável causa: `PeriodEntriesContent` só usa `issues.data?.length` para mostrar pendências e desabilitar a aprovação. `issues.isPending`, `issues.isFetching` e `issues.isError` não entram no estado de carregamento, na mensagem de erro nem na condição do botão, embora `approve_payroll_period` agora bloqueie qualquer `payroll_generation_issues` não resolvida.


RESOLVIDO
###############

Bug 232

Sintoma: Depois que os períodos da folha foram paginados, buscar por nome ou filtrar por situação/pagamento só examina os 30 períodos da página atual; um período existente em outra página aparece como inexistente, e os contadores de resultados também descrevem apenas a página.
Provável causa: `get_finance_payroll_period_page` não recebe filtros e devolve primeiro a página; em `Payroll`, `filteredPeriods = periods.filter(...)` aplica todos os critérios somente no array paginado já retornado pelo servidor, sem reiniciar ou consultar as demais páginas.


RESOLVIDO
###############

Bug 233

Sintoma: Uma chamada autenticada pode registrar uma movimentação de estoque com um tipo inexistente e, mesmo assim, reduzir o saldo do item como se fosse uma saída válida.
Provável causa: `create_stock_movement_v1` não valida `movement_type` contra os valores suportados; seu cálculo considera apenas `inbound` e `return` como entradas e `transfer` como neutra, tratando qualquer outro texto pelo ramo padrão `-v_qty`. A tabela `stock_movements` também não possui uma restrição que rejeite esses valores desconhecidos.


RESOLVIDO
###############

Bug 234

Sintoma: Um administrador pode registrar uma movimentação no estoque da própria empresa associada a funcionário, responsável, ativo, ordem de manutenção ou incidente de outra empresa; o campo de veículo aceita até um UUID sem vínculo existente, contaminando rastreabilidade e relatórios de consumo.
Provável causa: `create_stock_movement_v1` valida somente que o item pertence ao `tenant_id` informado e repassa os demais IDs do payload diretamente para `stock_movements`. As chaves estrangeiras dessas referências, quando existem, são apenas pelo `id`, sem composição com `tenant_id`, e `vehicle_id` não possui chave estrangeira nessa tabela.


RESOLVIDO
###############

Bug 235

Sintoma: Uma rota de uma empresa pode ser salva apontando para corredor, POIs ou geofences de outra empresa, expondo nomes e referências cruzadas nas telas de roteirização e deixando o template ligado a objetos que seus próprios usuários não conseguem consultar.
Provável causa: `save_route_template_v1` verifica apenas que o autor é administrador do tenant da rota; `corridor_geofence_id`, `poi_id` e `geofence_id` são inseridos sem confirmar o tenant das entidades referenciadas, e as respectivas chaves estrangeiras validam somente o `id` global.


RESOLVIDO
###############

Bug 236

Sintoma: Um administrador pode criar no tenant atual um contrato para um funcionário pertencente a outra empresa, fazendo o vínculo aparecer em cálculos e consultas da empresa errada e podendo interferir no estado ativo dos contratos desse ID.
Provável causa: `create_employee_contract_v1` confirma a administração de `v_tenant`, mas nunca verifica se `v_employee` pertence a esse tenant; a chave estrangeira `employee_contracts_employee_id_fkey` referencia apenas `employees(id)`, enquanto a política RLS confere somente o `tenant_id` da nova linha.


RESOLVIDO
###############

Bug 237

Sintoma: É possível criar ou renomear um template de rota para um nome vazio digitando apenas espaços, produzindo uma opção sem identificação nas listas e seletores de rota.
Provável causa: `RouteDialog` testa `!name` antes de remover espaços, de modo que uma sequência de espaços passa também pela validação HTML `required` e depois é enviada como `name.trim()`, isto é, string vazia. `save_route_template_v1` e a tabela `route_templates` não impõem nome não vazio.


RESOLVIDO
###############

Bug 238

Sintoma: Cancelamentos e reaberturas de folha aparecem na auditoria financeira apenas como “Ação financeira registrada” e não podem ser selecionados no filtro por ação, dificultando localizar e distinguir operações críticas da competência.
Provável causa: `change_payroll_period_state` grava os eventos `payroll_period_cancelled` e `payroll_period_reopened`, mas `financeAuditActions` não contém esses dois nomes; a tela usa esse mapa tanto para montar o seletor quanto para rotular cada linha.


RESOLVIDO
###############

Bug 239

Sintoma: Se falhar a leitura de faturas elegíveis, perfis ou histórico DOCCOB, a tela mostra “Nenhuma fatura elegível”, “Nenhum perfil” ou “Nenhuma exportação” como se as consultas tivessem retornado com sucesso, podendo levar o usuário a concluir que não há dados.
Provável causa: `BillingEdi` substitui os resultados indefinidos por arrays vazios e considera apenas `isLoading`; os estados `isError` e os erros de `useEligibleInvoicesForEdi`, `useEdiProfiles`, `useEdiExports` e `useClients` não são renderizados nem oferecem nova tentativa contextual.


RESOLVIDO
###############

Bug 240

Sintoma: Quando falha o carregamento das faturas, cobranças ou detalhes ao gerar um DOCCOB, o clique termina sem mensagem no diálogo e sem preencher a lista de erros; durante essa leitura demorada o botão também permanece habilitado para novos cliques.
Provável causa: `GenerateDialog.handleGenerate` executa `await fetchInvoicesBundle(...)` antes do bloco `try/catch`, e o estado usado para desabilitar “Gerar TXT” é apenas `register.isPending`, que só começa depois que todo o pacote já foi carregado e o arquivo montado.


RESOLVIDO
###############

Bug 241

Sintoma: Um operador autenticado pode gerar uma fatura com nome, documento, endereço ou dados da transportadora arbitrários no snapshot imutável, fazendo PDF e DOCCOB exibirem informações que nunca pertenceram ao cliente ou à empresa faturadora.
Provável causa: `apply_client_invoice_command` aceita `payer_snapshot` e `company_snapshot` dentro do `draft`, e `_client_invoice_draft_snapshot` os preserva sem comparar com `clients` e `tenants`. O trigger `tg_preserve_billing_snapshots_and_dates` só busca os dados autoritativos quando o objeto recebido é exatamente `{}`, portanto qualquer JSON não vazio fornecido pelo chamador é aceito como verdade histórica.


RESOLVIDO
###############

Bug 242

Sintoma: Depois de 500 movimentações de inventário, as mais antigas deixam de poder ser consultadas ou encontradas pelos filtros de tipo e data; a tela informa que filtra apenas as 500 recentes, mas não oferece página, busca remota ou outro acesso ao histórico restante.
Provável causa: `useInventoryMovements` encerra a consulta com `.limit(500)` e devolve somente o array desse lote; `Inventory` aplica todos os filtros localmente e não recebe total nem cursor para carregar registros anteriores.


RESOLVIDO
###############

Bug 243

Sintoma: Se falhar a leitura de saldos ou movimentos do inventário, a página exibe contadores zerados e mensagens de “Nenhum saldo encontrado” ou “Nenhum movimento registrado”; falhas nos locais e clientes ainda deixam os seletores vazios como se não houvesse cadastros.
Provável causa: `Inventory` substitui `data` indefinido por `[]` e observa apenas `isLoading` de saldos e movimentos. Os estados `isError` de `useInventoryBalances`, `useInventoryMovements`, `useInventoryLocations` e `useClients` não são renderizados nem impedem os estados vazios e indicadores derivados.


RESOLVIDO
###############

Bug 244

Sintoma: Registrar “Ajuste” no inventário sempre diminui o saldo e não existe opção para realizar uma correção para cima; uma chamada direta com qualquer tipo textual desconhecido também é interpretada como saída.
Provável causa: O trigger atual `update_inventory_balance` define sinal positivo apenas para `inbound` e `return`, zero para `transfer` rejeitada e `-1` para todo o restante. A interface oferece `adjustment` somente com quantidade positiva, e `inventory_movements` não restringe `movement_type` aos valores conhecidos.


RESOLVIDO
###############

Bug 245

Sintoma: Movimentações de um item sem local ou sem cliente podem criar vários saldos separados para a mesma combinação; uma saída posterior pode gerar outra linha negativa em vez de reduzir a entrada existente, deixando a listagem e os totais contraditórios.
Provável causa: A chave única de `inventory_balances` é `(tenant_id, location_id, client_id, item_description)`, mas `location_id` e `client_id` aceitam `NULL` e a restrição não usa `NULLS NOT DISTINCT`. Por isso o `ON CONFLICT` de `update_inventory_balance` não encontra conflito quando qualquer campo opcional é nulo, embora a verificação de disponibilidade use `IS NOT DISTINCT FROM` e trate essas linhas como a mesma chave lógica.


RESOLVIDO
###############

Bug 246

Sintoma: Um item que ficou com saldo zero e foi reposto hoje pode aparecer imediatamente como parado há mais de 30 dias, herdando a idade de um lote antigo já consumido.
Provável causa: No `ON CONFLICT`, `update_inventory_balance` sempre mantém `first_inbound_at = coalesce(inventory_balances.first_inbound_at, excluded.first_inbound_at)`; ele não reinicia a primeira entrada quando o saldo anterior era zero antes de uma nova entrada, e a aba Aging usa esse timestamp histórico como idade do estoque atual.


RESOLVIDO
###############

Bug 247

Sintoma: Um administrador pode registrar no inventário da própria empresa um movimento ligado a local, cliente ou documento fiscal de outra empresa, criando saldos e rastreabilidade com referências cruzadas que os usuários do tenant não conseguem resolver corretamente.
Provável causa: A política de `inventory_movements` valida apenas o `tenant_id` da nova linha; `location_id`, `client_id` e `fiscal_document_id` são aceitos diretamente e suas chaves estrangeiras referenciam somente o `id`, sem exigir que a entidade relacionada pertença ao mesmo tenant.


RESOLVIDO
###############

Bug 248

Sintoma: Uma saída de inventário pode deixar paletes, peso ou volume negativos mesmo quando a quantidade de unidades continua válida; por exemplo, retirar uma unidade informando dez paletes passa se houver uma unidade disponível.
Provável causa: `update_inventory_balance` bloqueia saldo insuficiente consultando apenas `inventory_balances.quantity`. `pallet_count`, `weight_kg` e `volume_m3` são subtraídos no `ON CONFLICT` sem conferir a disponibilidade de cada medida e não há restrição na tabela de saldos que impeça resultados abaixo de zero.


RESOLVIDO
###############

Bug 249

Sintoma: Ao cadastrar um item de almoxarifado sem alterar a categoria, ele é salvo como `general`, aparece com esse texto técnico na tabela e não pode ser selecionado por nenhum filtro de categoria específico.
Provável causa: O estado inicial e o padrão da tabela usam `category = 'general'`, mas `STOCK_CATEGORIES` e `STOCK_CATEGORY_LABELS` contêm apenas `tire`, `oil`, `filter`, `mechanical_part`, `operational`, `ppe` e `other`; o seletor não possui uma opção correspondente ao valor inicial que será enviado.


RESOLVIDO
###############

Bug 250

Sintoma: Após 500 movimentações de almoxarifado, registros antigos deixam de aparecer e não podem ser encontrados por item, responsável, tipo ou período; a paginação visível apenas divide localmente esse lote recente.
Provável causa: `useStockMovements` limita a consulta a 500 linhas antes de qualquer filtro, e `Stock` executa a busca e `usePagination` somente sobre o array truncado, sem total do servidor ou cursor para alcançar o restante.


RESOLVIDO
###############

Bug 251

Sintoma: Uma falha ao carregar itens ou movimentações do almoxarifado faz a tela mostrar totais zerados e “Nenhum item/movimento encontrado”; se funcionários falharem, o seletor de responsável simplesmente fica vazio.
Provável causa: `Stock` usa `data = []` e somente `isLoading` para `useStockItems` e `useStockMovements`, e nem mesmo captura o estado da consulta de `useEmployees`; erros das três leituras não são exibidos nem distinguidos de resultados vazios legítimos.


RESOLVIDO
###############

Bug 252

Sintoma: A opção “Ajuste” do almoxarifado só consegue reduzir o saldo; não há forma de corrigir uma contagem para cima, embora o usuário informe uma justificativa e uma quantidade positiva.
Provável causa: O formulário restringe a quantidade a valor positivo, enquanto `create_stock_movement_v1` soma apenas os tipos `inbound` e `return` e trata `adjustment`, junto de todo tipo restante, como `-v_qty`; não existe campo que indique a direção do ajuste.


RESOLVIDO
###############

Bug 253

Sintoma: Se não houver posição recente de veículo e a primeira geofence da lista estiver sem coordenadas, o mapa abre com zoom local no centro padrão do Brasil e as cercas válidas seguintes ficam fora da área visível, parecendo não ter sido desenhadas.
Provável causa: A condição para renderizar o mapa aceita que qualquer geofence tenha coordenadas, mas o `center` usa exclusivamente `geofences[0]`; quando essa primeira linha é inválida, cai em `[-14.235, -51.9253]` com zoom 14 em vez de localizar a primeira cerca válida ou ajustar os limites às geometrias exibidas.


RESOLVIDO
###############

Bug 254

Sintoma: Desativar uma cerca pode continuar contabilizando e exibindo veículos como “dentro” dela; após excluir uma cerca, o mesmo estado ainda pode permanecer na tela até uma recarga ou refetch posterior.
Provável causa: `statesQuery` busca todo `geofence_states.is_inside = true` sem exigir que a geofence esteja habilitada, e `mutate_fleet_geofence_v1` não limpa estados ao desativar. Além disso, os sucessos de ativação, desativação e exclusão invalidam apenas a chave `geofences`, não `geofence_states`; mesmo o cascade da exclusão fica oculto pelo cache antigo.


RESOLVIDO
###############

Bug 255

Sintoma: Uma competência pode calcular salário usando um contrato que só começa depois do período da folha; da mesma forma, um contrato com data de fim anterior pode continuar sendo usado enquanto o campo `active` permanecer verdadeiro.
Provável causa: `generate_payroll_period` associa `employee_contracts` apenas por funcionário, tenant e `c.active = true`; não compara `start_date` ou `end_date` com `_period_start` e `_period_end`. O cadastro permite escolher livremente a data de início, e criar um contrato futuro já o torna o único contrato ativo imediatamente.


RESOLVIDO
###############

Bug 256

Sintoma: Ao trocar o contrato de um funcionário e recalcular uma folha ainda em rascunho, o salário pode ser recriado com o contrato novo enquanto a entrada da folha continua apontando para o contrato antigo, deixando duas referências contratuais contraditórias no mesmo cálculo.
Provável causa: `generate_payroll_period` faz `INSERT ... ON CONFLICT (payroll_period_id, employee_id) DO NOTHING`; ao reutilizar a entrada existente, não atualiza `payroll_entries.contract_id`. Em seguida apaga e recria os itens automáticos usando `_emp.contract_id` e `_emp.base_salary` atuais, inclusive gravando o contrato novo em `payroll_entry_items.source_id`.


RESOLVIDO
###############

Bug 257

Sintoma: Um funcionário incluído numa folha e depois marcado como inativo ou desligado continua na competência ao recalculá-la, com seus lançamentos anteriores preservados, mesmo não pertencendo mais ao conjunto atual de funcionários elegíveis.
Provável causa: A geração percorre apenas funcionários cujo estado atual é ativo ou afastado, mas não remove entradas existentes de quem deixou de satisfazer esse filtro. A limpeza adicionada ao período reutilizado exclui somente grupos desmarcados de motoristas/não motoristas, não funcionários inativos, desligados ou removidos do escopo por outras mudanças cadastrais.


RESOLVIDO
###############

Bug 258

Sintoma: Qualquer usuário autenticado pode testar se um UUID existe em tabelas que não tem permissão para consultar — inclusive tabelas privadas — e distinguir existência de ausência pela resposta ou exceção da função.
Provável causa: A migração `20260917043000_fix_live_queue_integrity.sql` cria `finance_private.assert_tenant_reference(regclass, uuid, uuid, text)` como `SECURITY DEFINER`, aceita o nome de qualquer relação fornecido pelo chamador, executa uma consulta dinâmica por `tenant_id` e `id`, não valida acesso ao tenant e concede `EXECUTE` diretamente ao papel `authenticated`.


RESOLVIDO
###############

Bug 259

Sintoma: Se o cancelamento ou a reabertura de uma folha for confirmado pelo banco, mas a resposta se perder, a interface informa falha e não consegue recuperar nem confirmar a tentativa original; reenviar o mesmo comando retorna que o estado já não permite a ação.
Provável causa: `change_payroll_period_state` não recebe `request_id`, não possui ledger idempotente e retorna apenas `void`; `useChangePayrollPeriodState` também dispara a RPC diretamente, sem outbox ou identidade persistida. Depois do commit, o guard de estado transforma qualquer retry em `finance_payroll_cannot_cancel` ou `finance_payroll_cannot_reopen`.


RESOLVIDO
###############

Bug 260

Sintoma: Falhas ao carregar contratos, ocorrências, folhas, adiantamentos, dados de motorista ou acertos no detalhe de um funcionário são exibidas como “Sem contratos”, “Sem ocorrências”, “Sem entradas de folha”, “Sem adiantamentos”, campos com traços ou “Sem acertos”, fazendo indisponibilidade parecer ausência de histórico.
Provável causa: `EmployeeDetail` substitui os dados de todas essas consultas por arrays vazios ou valores indefinidos e não lê `isError`/`error` de nenhum hook ou `useQuery`; cada aba decide o estado vazio apenas pelo comprimento do resultado padrão.


RESOLVIDO
###############

Bug 261

Sintoma: No cadastro do funcionário, somente as 20 entradas de folha e os 10 acertos de motorista mais recentes ficam visíveis; históricos anteriores desaparecem sem contagem, aviso ou controle para consultar outras páginas.
Provável causa: As consultas locais `employee_payroll_entries` e `employee_driver_settlements` terminam respectivamente em `.limit(20)` e `.limit(10)`, e as tabelas da ficha renderizam esses arrays como o histórico completo, sem total nem cursor.


RESOLVIDO
###############

Bug 262

Sintoma: Cancelar ou reabrir uma folha ao mesmo tempo em que outra sessão a aprova, fecha ou recalcula pode provocar deadlock no banco e abortar uma das ações, mesmo que cada comando isolado seja válido.
Provável causa: `change_payroll_period_state` executa `SELECT ... FROM payroll_periods ... FOR UPDATE` antes de adquirir o advisory lock `tenant:finance`. Os demais escritores protegidos por `finance_private.lock_payroll_lifecycle` adquirem primeiro esse advisory lock e só depois travam `payroll_periods`, criando a ordem circular linha→advisory versus advisory→linha.


RESOLVIDO
###############

Bug 263

Sintoma: Um operador pode importar ocorrências no tenant atual vinculando cada linha a cliente, fornecedor, carga, motorista, documento fiscal ou CT-e pertencente a outra empresa, contaminando o histórico operacional com referências cruzadas.
Provável causa: O wrapper idempotente de `import_occurrence_report_batch_v1` valida apenas o tenant do lote e repassa `_occurrences` à implementação anterior sem usar `assert_tenant_reference`. Essa implementação insere todos os IDs recebidos diretamente em `delivery_occurrences`; as políticas RLS verificam só o `tenant_id` da linha e as chaves estrangeiras relacionadas usam apenas o `id` global.


RESOLVIDO
###############

Bug 264

Sintoma: Um abastecimento pode registrar uma leitura de odômetro menor que a leitura anterior do veículo, produzindo regressão de quilometragem e cálculos de consumo ou manutenção com distância negativa ou incoerente.
Provável causa: `FuelingTab` e `create_vehicle_fueling_with_odometer_v1` verificam somente que `odometer_km` não seja negativo; antes de inserir em `vehicle_odometer`, nenhum deles consulta a última leitura cronológica nem compara o valor com o odômetro atual do veículo.


RESOLVIDO
###############

Bug 265

Sintoma: Informar a quilometragem atual ao registrar um abastecimento cria uma linha no histórico de odômetro, mas o cadastro do veículo continua exibindo o valor antigo, deixando telas que leem `vehicles.odometer_km` desatualizadas.
Provável causa: A implementação atômica de `create_vehicle_fueling_with_odometer_v1` insere em `vehicle_fueling` e `vehicle_odometer`, porém não atualiza `vehicles.odometer_km`; também não existe trigger posterior que sincronize a leitura nova com a coluna do veículo.


RESOLVIDO
###############

Bug 266

Sintoma: A aba de odômetro permite salvar manualmente uma quilometragem negativa ou menor que a última leitura, fazendo o gráfico retroceder e podendo tornar a quilometragem acumulada inválida.
Provável causa: `OdometerTab.handleSave` converte e envia `Number(km)` sem validar finitude, mínimo ou monotonicidade; o input não possui `min`, `useCreateOdometerReading` insere diretamente em `vehicle_odometer` e a tabela não impõe restrição nem comparação com a leitura anterior.


RESOLVIDO
###############

Bug 267

Sintoma: Veículos com histórico extenso perdem abastecimentos e leituras antigas nas abas; a quantidade de leituras e os quilômetros registrados passam a representar apenas o lote retornado, e o histórico de consumo deixa de calcular períodos mais antigos sem avisar sobre o corte.
Provável causa: `useVehicleFuelingList` e `useVehicleOdometerList` fazem um único `select` ordenado, sem paginação, total ou detecção do limite do PostgREST. `FuelingTab`, `OdometerTab` e `useConsumptionHistory` tratam os arrays recebidos como históricos completos.


RESOLVIDO
###############

Bug 268

Sintoma: Quando a consulta de abastecimentos falha, a aba mostra indicadores zerados e nenhum registro como se o veículo nunca tivesse abastecido; se a leitura do odômetro falha, ela exibe traços e “Nenhuma leitura registrada”.
Provável causa: `useConsumptionHistory` descarta os estados de carregamento e erro de `useVehicleFuelingList` e devolve apenas arrays/cálculos com o padrão vazio. `OdometerTab` captura `isLoading`, mas ignora `isError` e `error`, substituindo `data` ausente por `[]`.


RESOLVIDO
###############

Bug 269

Sintoma: A migração `20260917050000_fix_inventory_and_payroll_followups.sql` pode falhar inteira ao ser aplicada justamente em uma base que já recebeu movimentos de inventário sem local ou cliente, impedindo a instalação das correções seguintes.
Provável causa: Antes da migração, a chave única comum permitia duplicatas quando `location_id` ou `client_id` era `NULL`. O script remove essa chave e adiciona imediatamente `UNIQUE NULLS NOT DISTINCT` sobre as mesmas colunas, mas não consolida nem rejeita previamente as duplicatas históricas; a construção do novo índice único falha ao encontrá-las.


RESOLVIDO
###############

Bug 270

Sintoma: Um ajuste de almoxarifado configurado para aumentar o saldo falha com “estoque insuficiente” sempre que a quantidade acrescentada é maior que o saldo atual — inclusive ao tentar corrigir um item zerado para qualquer valor positivo.
Provável causa: O novo `create_stock_movement_v1` chama primeiro `create_stock_movement_unsafe_20260917`, cuja lógica antiga trata todo `adjustment` como saída, calcula `v_current - qty` e rejeita saldo negativo. Somente depois dessa chamada o wrapper tenta compensar a subtração somando `qty * 2`, etapa que nunca é alcançada quando o aumento supera o saldo existente.


RESOLVIDO
###############

Bug 271

Sintoma: Um funcionário admitido ou desligado no meio da competência recebe o salário-base mensal inteiro na folha, mesmo que o contrato tenha vigorado apenas alguns dias do período.
Provável causa: O gerador atualizado escolhe qualquer contrato cuja faixa de datas apenas intercepte a competência (`start_date <= period_end` e `end_date >= period_start`), mas o item `base_salary` continua sendo criado com `_emp.base_salary` integral; não há cálculo proporcional pelos dias de vigência nem indicação de que o valor exige ajuste manual.


RESOLVIDO
###############

Bug 272

Sintoma: Um administrador pode inserir no tenant atual uma leitura manual de odômetro associada a um veículo de outra empresa, fazendo o histórico cruzar fronteiras de tenant e apontar para um veículo que os usuários locais não conseguem consultar.
Provável causa: `useCreateOdometerReading` grava diretamente em `vehicle_odometer` usando o `vehicle_id` recebido e o tenant atual. A política RLS confere apenas o `tenant_id` da nova linha e `vehicle_odometer_vehicle_id_fkey` referencia somente `vehicles(id)`, sem uma chave composta ou trigger que confirme o tenant do veículo.


RESOLVIDO
###############

Bug 273

Sintoma: Um administrador pode criar uma manutenção no tenant atual vinculada a veículo, patrimônio, funcionário ou incidente de outra empresa, deixando o planejamento e o histórico de custos com referências cruzadas e parcialmente invisíveis.
Provável causa: `useCreateMaintenance` insere diretamente em `vehicle_maintenance` e a RLS valida somente o `tenant_id` da linha. As chaves de `vehicle_id`, `asset_id`, `employee_id` e `incident_id` apontam apenas para o `id` das tabelas relacionadas, sem composição ou trigger que confirme a mesma empresa.


RESOLVIDO
###############

Bug 274

Sintoma: Em veículos com muitas manutenções, registros antigos desaparecem da aba e dos indicadores de atrasadas/próximas; se a consulta falhar, a tela mostra “Nenhuma manutenção registrada” como se o histórico estivesse vazio.
Provável causa: `useVehicleMaintenanceList` executa um único `select` sem paginação, total ou sinal de truncamento. `MaintenanceTab` substitui dados ausentes por `[]`, observa apenas `isLoading` e ignora `isError`, usando esse mesmo array para histórico e indicadores.


RESOLVIDO
###############

Bug 275

Sintoma: O cartão “manutenções próximas — nos próximos 7 dias” deixa de contar serviços agendados para amanhã ou para os próximos seis dias e, ao contrário, contabiliza agendamentos com mais de uma semana de antecedência.
Provável causa: `MaintenanceTab` inclui uma manutenção em `upcoming` quando `!isPast(addDays(scheduled_date, -7))`; essa condição só é verdadeira quando a data agendada ainda está a pelo menos sete dias no futuro. Para a janela correta, a comparação precisaria limitar a data até sete dias a partir de agora, não subtrair sete dias da agenda e exigir que esse instante ainda seja futuro.


RESOLVIDO
###############

Bug 276

Sintoma: Preencher “Próxima em (data)” não gera aviso de manutenção próxima nem atrasada quando essa data chega; o valor fica apenas armazenado no registro.
Provável causa: Os cálculos `overdue` e `upcoming` de `MaintenanceTab` consultam `scheduled_date` e, parcialmente, `next_odometer`, mas nunca leem `next_date`, apesar de o formulário gravar esse campo para representar a próxima revisão.


RESOLVIDO
###############

Bug 277

Sintoma: É possível registrar um abastecimento com data e hora futuras, fazendo litros e custo entrarem antecipadamente nos totais e posicionando uma leitura de odômetro futura como a mais recente do histórico.
Provável causa: O campo `datetime-local` de `FuelingTab` não possui limite máximo e `handleSave` não compara `fueled_at` com o instante atual. `create_vehicle_fueling_with_odometer_v1` aceita qualquer timestamp válido e o replica também em `vehicle_odometer.recorded_at`.


RESOLVIDO
###############

Bug 278

Sintoma: Empresas com muitas coletas deixam de ver parte do histórico e os cartões de total, pendentes, vinculadas e finalizadas passam a exibir números menores que os reais, sem qualquer aviso ou opção de carregar mais registros.
Provável causa: `usePickupOrders` faz um único `select('*')` sem paginação, contagem total ou detecção de truncamento. `PickupOrders` usa apenas o array devolvido para montar a tabela e calcular todos os indicadores locais, ficando sujeito ao limite máximo de linhas da API.


RESOLVIDO
###############

Bug 279

Sintoma: Quando a consulta de coletas falha, a tela informa “Nenhuma coleta encontrada” e mostra todos os indicadores zerados, fazendo um erro de rede, permissão ou servidor parecer uma base legitimamente vazia.
Provável causa: `usePickupOrders` propaga o erro pelo React Query, mas `PickupOrders` extrai somente `data` e `isLoading`, aplica `data = []` e nunca trata `isError` ou `error`.


RESOLVIDO
###############

Bug 280

Sintoma: Uma coleta com muitos documentos fiscais pode exibir uma quantidade de XMLs menor que a real; o cartão “XMLs vinculados” também fica subestimado quando o conjunto consultado ultrapassa o limite de linhas da API.
Provável causa: `usePickupOrderCounts` busca todas as linhas de `fiscal_documents` com um único `select('pickup_order_id')` e soma o resultado no cliente, sem paginação nem agregação no banco. Qualquer truncamento silencioso da resposta vira uma contagem aparentemente válida.


RESOLVIDO
###############

Bug 281

Sintoma: Uma requisição autenticada manipulada consegue editar uma coleta do próprio tenant para apontar o remetente, o motorista ou o veículo para um registro pertencente a outra empresa, deixando referências cruzadas e snapshots incoerentes no banco.
Provável causa: `useUpdatePickupOrder` atualiza `pickup_orders` diretamente e a policy de `UPDATE` valida somente o `tenant_id` da própria coleta. As FKs de `remitter_client_id`, `driver_id` e `vehicle_id` referenciam apenas o `id` das tabelas relacionadas, sem chave composta por tenant; ao contrário da RPC de criação, a atualização não chama `assert_tenant_reference`.


RESOLVIDO
###############

Bug 282

Sintoma: O “Histórico do Produto” pode omitir eventos antigos ou até informar que não há eventos em um período que possui movimentações, sobretudo para produtos recorrentes com mais de 2.000 itens registrados.
Provável causa: `ProductHistory` limita a consulta inicial de `load_items` a 2.000 linhas, sem paginação nem ordenação, e só depois aplica os filtros de data no cliente. Assim, o banco pode devolver um subconjunto arbitrário que não inclui as linhas do intervalo solicitado; a paginação visual apenas divide esse resultado já truncado.


RESOLVIDO
###############

Bug 283

Sintoma: Se qualquer consulta usada para montar o histórico do produto falhar, a tela termina exibindo “Nenhum evento encontrado para este produto” e indicadores zerados, sem distinguir indisponibilidade de ausência real de movimentações.
Provável causa: A query propaga erros das buscas de itens, coletas, paradas e eventos, mas `ProductHistory` consome somente `data`, `isFetching` e `refetch`, define `timeline = []` e não renderiza `isError` ou `error`.


RESOLVIDO
###############

Bug 284

Sintoma: Abrir ou filtrar a tela de canhotos pode gerar dezenas ou centenas de requisições sequenciais, consumir memória proporcional a todo o acervo e ficar cada vez mais lento conforme a empresa acumula comprovantes, embora a interface exiba apenas 25 registros por página.
Provável causa: Além da query paginada, `DeliveryReceipts` habilita incondicionalmente `allFiltered`, que executa `listAllDeliveryReceipts` em lotes de 100 até materializar todos os resultados para uma eventual seleção em massa. `getDeliveryReceiptFilterCatalog` percorre novamente todo o acervo em outra query, e cada alteração dos filtros, inclusive cada caractere da busca, reinicia o carregamento completo filtrado.


RESOLVIDO
###############

Bug 285

Sintoma: Ao carregar a tela de faltas de mercadoria, os indicadores podem piscar como zero e a tabela mostrar “Nenhum registro encontrado”; se a consulta falhar, esse estado vazio permanece indefinidamente sem informar o erro.
Provável causa: `MerchandiseShortages` converte `cases.data` ausente em `[]` e calcula tabela, totais e indicadores imediatamente, sem renderizar `cases.isLoading`, `cases.isError` ou `cases.error`.


RESOLVIDO
###############

Bug 286

Sintoma: Quando a busca dos itens das faltas falha, relatórios e exportações PDF, XLSX e CSV podem sair sem produtos, quantidades e custos detalhados, apresentando cada caso como “(sem itens)” sem avisar que os dados estão incompletos.
Provável causa: `useShortageReportRows` trata `items.data` ausente como lista vazia e devolve somente `rows`, `isLoading` e `cases`; ele não propaga `items.isError` nem `items.error`. A página habilita as exportações e os resumos mesmo nesse estado.


RESOLVIDO
###############

Bug 287

Sintoma: Se uma importação de faltas for interrompida no meio, parte dos casos fica gravada e o lote pode permanecer em processamento; reenviar a mesma planilha cria outro lote e duplica os casos que já tinham sido importados.
Provável causa: `commitImport` cria o lote e depois chama `create_merchandise_shortage_case` uma vez por caso em um laço no navegador, concluindo o lote em uma atualização separada. Não existe transação de lote, fingerprint do arquivo, chave idempotente por linha nem restrição que impeça reprocessar o mesmo caso.


RESOLVIDO
###############

Bug 288

Sintoma: Um operador autenticado consegue criar ou atualizar uma falta do próprio tenant apontando ocorrência, documentos, carga, motorista, veículo, clientes ou responsáveis pertencentes a outra empresa, contaminando a apuração e os relatórios com relacionamentos cruzados.
Provável causa: `create_merchandise_shortage_case` autoriza somente `_tenant_id` e grava diretamente todos os UUIDs recebidos no payload; `update_merchandise_shortage_status` faz o mesmo com os IDs de responsáveis. As respectivas FKs referenciam apenas o `id`, sem compor `tenant_id`, e nenhuma das funções confirma que cada registro relacionado pertence ao tenant autorizado.


RESOLVIDO
###############

Bug 289

Sintoma: Editar ou excluir diretamente uma leitura de odômetro já existente pode quebrar a ordem cronológica das quilometragens, trocar o veículo por um de outro tenant ou deixar `vehicles.odometer_km` apontando para um valor removido/antigo.
Provável causa: A migração `20260917053000_fix_fleet_and_atomic_followups.sql` instala `validate_vehicle_odometer` e `sync_vehicle_odometer` somente para `INSERT`. A policy permite `ALL` aos administradores, mas `UPDATE` não repete as validações de tenant, futuro e monotonicidade nem resincroniza o veículo, enquanto `DELETE` também não recalcula a leitura atual.


RESOLVIDO
###############

Bug 290

Sintoma: Empresas com muitos pedidos deixam de ver registros na listagem e todos os filtros e a contagem do cabeçalho passam a operar sobre um subconjunto truncado, sem paginação ou aviso.
Provável causa: `useOrders` executa um único `select` de `orders` sem `range`, paginação ou contagem total. `Orders` filtra no cliente e usa `orders.length` como total, ficando limitado ao máximo de linhas devolvido pela API.


RESOLVIDO
###############

Bug 291

Sintoma: Se a consulta de pedidos falhar, a tela mostra “Nenhum pedido encontrado” e o cabeçalho informa zero pedidos, sem expor o erro ao usuário.
Provável causa: `useOrders` propaga a falha, mas `Orders` extrai apenas `data` e `isLoading`, aplica `data = []` e nunca trata `isError` ou `error`.


RESOLVIDO
###############

Bug 292

Sintoma: Quando dois administradores editam o mesmo pedido, quem salva por último pode sobrescrever silenciosamente todas as alterações do primeiro, mesmo tendo aberto o formulário antes delas existirem.
Provável causa: O formulário envia novamente o snapshot completo do pedido e `useUpdateOrder` condiciona o `UPDATE` apenas por `id` e `tenant_id`. Não há comparação com o `updated_at` originalmente lido, versão otimista ou RPC que rejeite uma gravação concorrente obsoleta.


RESOLVIDO
###############

Bug 293

Sintoma: Se apenas a consulta de contagens de clientes/fornecedores falhar, a listagem continua carregando normalmente, mas o cabeçalho e todas as abas passam a indicar zero cadastros, contradizendo os registros visíveis sem mostrar qualquer erro.
Provável causa: `useClientCounts` executa quatro contagens em `Promise.all` e rejeita a query se uma delas falhar. `Clients` extrai somente `data`, substitui a ausência pelo objeto `{ clients: 0, suppliers: 0, both: 0, total: 0 }` e ignora `isError` e `error` dessa query.


RESOLVIDO
###############

Bug 294

Sintoma: Duas pessoas editando simultaneamente o mesmo cliente ou fornecedor podem salvar com sucesso, mas a segunda gravação sobrescreve silenciosamente os campos alterados pela primeira com os valores antigos que ainda estavam no formulário.
Provável causa: `useUpdateClient` envia o cadastro completo e filtra o `UPDATE` apenas por `id` e `tenant_id`; embora a linha tenha `updated_at`, o valor originalmente lido não é usado como precondição de concorrência.


RESOLVIDO
###############

Bug 295

Sintoma: Ao trocar de página, busca ou tipo em Clientes e Fornecedores, a interface pode exibir temporariamente os registros da consulta anterior sob o novo número de página/filtro, sem qualquer indicador de que aqueles resultados ainda estão desatualizados.
Provável causa: `useClientsPage` usa `placeholderData: previous => previous`, mas `Clients` observa apenas `isLoading`, que não volta a ser verdadeiro nas refetches com placeholder. O componente não usa `isFetching` para sinalizar ou bloquear a tabela enquanto a nova chave de consulta está sendo carregada.


RESOLVIDO
###############

Bug 296

Sintoma: Páginas e diálogos que precisam apenas oferecer um seletor de cliente, motorista, veículo, carga ou rota ficam progressivamente mais lentos e consomem memória proporcional a todo o cadastro da empresa antes de liberar a interface.
Provável causa: `useClients`, `useDrivers`, `useVehicles`, `useLoads` e `useOperationalRoutes` chamam `readOperatorReferenceCatalog`, que percorre sequencialmente todas as páginas de 500 itens e materializa o catálogo inteiro no navegador. Não há busca remota incremental, virtualização nem limite ligado ao seletor que realmente será exibido.

###############

Bug 297

Sintoma: Enquanto uma pessoa navega pelas páginas de Clientes e Fornecedores, renomear um cadastro em outra sessão pode fazer esse cliente aparecer duas vezes ou desaparecer da navegação até que a consulta seja reiniciada.
Provável causa: `list_operator_clients_page_v1` usa `(company_name, id)` como cursor, embora `company_name` seja mutável. O `snapshot_at` congela apenas a inclusão por `created_at`; ele não preserva o nome/ordenação que existia no início da paginação, portanto uma edição pode mover uma linha para antes ou depois do cursor já consumido.

###############

Bug 298

Sintoma: Ao existir mais de 500 faturas, todas as faturas mais antigas são apresentadas como se tivessem “vínculos financeiros divergentes” e os quatro totais gerais ficam indisponíveis, mesmo quando os vínculos dessas faturas estão corretos.
Provável causa: `useClientInvoices` cruza o histórico completo com as no máximo 500 linhas retornadas por `list_client_invoice_financials`; para todo ID ausente desse lote, ele fabrica `received_amount: null`, `open_amount: null` e `requires_reconciliation: true`. Em seguida retorna `truncated: false`, impedindo a tela de distinguir limitação do leitor protegido de uma divergência real.

###############

Bug 299

Sintoma: O assistente de nova fatura pode falhar ao carregar documentos elegíveis para clientes com muitos CT-es ou NFS-es, mesmo que a paginação inicial consiga buscar todos os documentos.
Provável causa: `useEligibleCtes` e `useEligibleNfse` acumulam todos os IDs, mas depois enviam o array inteiro em uma única consulta PostgREST `.in('source_id', ids)` e em uma única chamada a `filter_billable_fiscal_sources`. A etapa não é particionada e pode exceder o tamanho de URL, payload, array ou tempo de execução quando o cliente possui milhares de documentos.

###############

Bug 300

Sintoma: Abrir “Faturas por Cliente” fica progressivamente mais lento e consome cada vez mais memória e rede conforme o histórico cresce, embora a tela não ofereça paginação e o usuário normalmente precise apenas das faturas recentes.
Provável causa: `useClientInvoices` chama `fetchAllPostgrestPages` e materializa todas as linhas de `client_invoices` e seus clientes no navegador antes de aplicar busca e filtros localmente. O antigo limite de 500 foi removido sem ser substituído por paginação de interface ou filtros no servidor.

###############

Bug 301

Sintoma: Buscar um cliente rural por nome, bairro ou fornecedor pode retornar “Nenhum perfil rural encontrado” mesmo quando ele existe; as pendências e os relatórios CSV/PDF também podem omitir cadastros fora do lote recente.
Provável causa: `useRuralProfiles` limita a consulta a 1.000 linhas ordenadas por `updated_at` e somente depois aplica `filters.search` no navegador. A aba de pendências e as exportações reutilizam exatamente esse array truncado, sem paginação nem busca textual no servidor.

###############

Bug 302

Sintoma: Os indicadores de clientes rurais, com/sem instrução, contato, estrada de terra e telefone ficam menores que os valores reais em empresas com mais de 2.000 clientes rurais, sem aviso de truncamento.
Provável causa: `useRuralClientsSummary` seleciona no máximo 2.000 linhas de `clients` e calcula todos os KPIs contando esse array no navegador, sem contagem agregada, paginação ou sinal de que o limite foi atingido.

###############

Bug 303

Sintoma: Falhas ao carregar perfis rurais, indicadores ou histórico de importações aparecem respectivamente como lista vazia, KPIs zerados ou “Nenhuma importação ainda”, fazendo indisponibilidade parecer ausência de dados.
Provável causa: `RuralClients` observa apenas `isLoading` da query de perfis e define valores padrão vazios para `profiles` e `batches`; a query de resumo também é consumida sem `isError`/`error`. Nenhum dos três erros é renderizado.

###############

Bug 304

Sintoma: Ao importar uma planilha rural em uma empresa com mais de 5.000 clientes ou perfis, destinatários existentes podem ser classificados como “Cliente não encontrado” e perfis já cadastrados podem ser propostos como novos, causando omissões ou duplicidades.
Provável causa: `buildRuralImportPreview` carrega clientes e perfis existentes em duas consultas independentes com `.limit(5000)` e constrói toda a correspondência apenas nesses subconjuntos. Não há paginação, busca individual no servidor nem indicador de catálogo truncado.

###############

Bug 305

Sintoma: Uma importação rural interrompida pode deixar parte dos perfis gravada e o lote incompleto; repetir a mesma planilha pode duplicar os perfis que já foram criados ou reaplicar atualizações sem recuperar a tentativa anterior.
Provável causa: `useCommitRuralImport` cria o lote e executa, no navegador, um `insert`/`update` de perfil e outro `update` de cliente para cada linha, finalizando o lote em uma requisição separada. Não há transação de lote, request ID persistente, fingerprint do arquivo/linha nem unicidade para a chave usada por `ruralProfileDedupeKey`.

###############

Bug 306

Sintoma: A tela “Regiões por Cliente” fica progressivamente lenta, consome muita memória e demora para liberar filtros e importação conforme aumentam os cadastros de clientes e de regiões.
Provável causa: `ClientRegions` usa `fetchAllPostgrestPages` para materializar todos os clientes ativos e todas as regiões no navegador antes de renderizar; busca, filtros e detecção de duplicidade são feitos sobre esses arrays completos, sem paginação de interface ou consulta incremental.

###############

Bug 307

Sintoma: Se a consulta de regiões falhar, a tela informa que nenhuma região foi cadastrada; se a consulta de clientes falhar, o seletor fica vazio e uma importação pode classificar todos os nomes informados como clientes inexistentes, sem revelar a falha original.
Provável causa: As duas queries de `ClientRegions` substituem dados ausentes por `[]`; o componente observa apenas `isLoading` da lista de regiões e ignora `isError`/`error` de ambas. A rotina de importação reutiliza esses arrays vazios como se fossem resultados válidos.

###############

Bug 308

Sintoma: Uma falha ao criar o rascunho de NFS-e depois de reservar a numeração deixa um RPS permanentemente saltado; se a resposta do `insert` se perder e o usuário repetir a criação, um segundo rascunho recebe outro RPS embora o primeiro possa já existir.
Provável causa: `useCreateNFSe` chama `next_nfse_number_by_emitter`/`next_nfse_number` e só depois, em outra requisição e transação, insere `nfse_documents`. A reserva e a criação não formam um comando atômico/idempotente e não compartilham um `request_id` recuperável.

###############

Bug 309

Sintoma: Um rascunho de NFS-e pode ser criado sem o emitente padrão, com filial/regime incorretos ou sem os dados de seguro das notas vinculadas durante uma falha de leitura, embora a criação seja apresentada como bem-sucedida.
Provável causa: `useCreateNFSe` descarta os erros das consultas a `tenant_emitters` tanto no caminho padrão quanto no explícito e também ignora o erro da busca de `fiscal_documents` usada para propagar o seguro. Ausência causada por falha é tratada como ausência real e o fluxo continua com `MATRIZ`, regime nulo, emitente nulo ou seguro vazio.

###############

Bug 310

Sintoma: A tela de NFS-e demora e consome cada vez mais rede e memória conforme cresce o histórico, apesar de mostrar somente 50 linhas por página; buscas e filtros também aguardam o carregamento de todo o acervo.
Provável causa: `useNFSeList` percorre todas as páginas PostgREST e materializa todos os documentos no navegador. `NFSe` aplica filtros e `slice` apenas depois disso, de modo que `FiscalListPagination` é paginação exclusivamente visual, não paginação da fonte de dados.

###############

Bug 311

Sintoma: A Consulta de CT-e fica progressivamente lenta e pode congelar o navegador em empresas com grande histórico, mesmo quando o usuário aplica um filtro específico; a tabela chega a renderizar todas as linhas encontradas de uma vez.
Provável causa: `useCteSearch` percorre integralmente, em blocos de 500, `cte_documents`, todos os `fiscal_documents` de saída e todas as emissões CT-e de `hub_fiscal_emissions`, faz o merge/filtro final no cliente e devolve o array completo. `CteSearch` não pagina nem virtualiza `rows.map`, e as consultas de saída/emissão nem sequer recebem a maioria dos filtros informados.

###############

Bug 312

Sintoma: Manter a Consulta de CT-e aberta com muitos documentos em processamento ou cancelamento pode disparar uma rajada de requisições ao provedor a cada cinco segundos e iniciar uma nova rodada antes de a anterior terminar, provocando rate limit e carga excessiva.
Provável causa: O efeito de polling de `CteSearch` cria um `setInterval` que percorre todos os `transientRows` e chama `pollStatus.mutate` individualmente para cada um. Não há lote, limite de concorrência, backoff, jitter nem bloqueio enquanto chamadas da rodada anterior ainda estão pendentes.

###############

Bug 313

Sintoma: O Monitor de CT-e fica progressivamente lento e consome muita rede/memória conforme cresce o histórico, embora a interface mostre somente 50 linhas por página.
Provável causa: `useCteMonitor` percorre todas as páginas de `cte_documents` e todos os `fiscal_documents` de saída, faz o merge e o filtro final no navegador e entrega o array completo. `FiscalListPagination` apenas aplica `slice` depois que todo o acervo já foi transferido e processado.

###############

Bug 314

Sintoma: O histórico SEFAZ de um CT-e pode omitir eventos antigos e, se a consulta falhar, o detalhe informa “Nenhum evento registrado ainda” em vez de exibir o erro.
Provável causa: `useCteSefazEvents` faz um único `select('*')` sem paginação ou total; `CteDetail` substitui `data` ausente por `[]` e não observa `isLoading`, `isError` ou `error` da query.


RESOLVIDO
###############

Bug 315

Sintoma: Um CT-e processado proveniente apenas da tabela legada `cte_documents` exibe o botão “Cancelar CT-e”, mas a ação falha dizendo que o documento ainda não foi transmitido, mesmo quando existem emissão e status SEFAZ registrados para ele.
Provável causa: Linhas `source: 'draft'` preservam o ID de `cte_documents`, mas `CteDetail` o envia como `fiscalDocumentId` para `useCancelCTe`. Esse hook procura exclusivamente em `fiscal_documents` e não consulta emissões cujo vínculo é `cte_document_id`.


RESOLVIDO
###############

Bug 316

Sintoma: Depois que um registro de `cte_documents` é associado a um CT-e real de saída, o detalhe pode deixar de mostrar o histórico SEFAZ que pertence ao rascunho original.
Provável causa: No merge de `useCteMonitor`, uma linha encontrada pela chave de acesso recebe `id: match.id`, isto é, o ID de `fiscal_documents`. `CteDetail` usa esse mesmo ID em `useCteSefazEvents`, mas `cte_sefaz_events.cte_document_id` é uma FK para `cte_documents`, não para `fiscal_documents`.


RESOLVIDO
###############

Bug 317

Sintoma: O Resumo de Notas Importadas omite notas mais antigas, apresenta totais menores que os reais e pode dizer que não há notas com determinado status operacional mesmo quando elas existem fora das 2.000 importações mais recentes.
Provável causa: `useImportedNotes` limita a consulta base de `fiscal_documents` a 2.000 linhas e não oferece paginação ou indicador de truncamento. Status derivados como processada, em trânsito, entregue e não entregue só são calculados e filtrados no navegador depois desse corte; KPIs e exportações usam o mesmo subconjunto.

###############

Bug 318

Sintoma: Consultar o resumo com um lote grande de notas pode falhar completamente durante a associação com CT-e/NFS-e, embora a consulta inicial das notas tenha sido bem-sucedida.
Provável causa: `useImportedNotes` envia até 2.000 UUIDs de uma vez em filtros `.overlaps('fiscal_document_ids', ids)` e `.in('id', outboundIds/missingNfseIds)`. Essas listas não são particionadas e podem ultrapassar limites de URL/query do PostgREST; as consultas relacionadas ainda aplicam outro limite fixo de 2.000 linhas.

###############

Bug 319

Sintoma: Selecionar muitas notas e executar auditoria ou exclusão em massa pode falhar por tamanho da requisição, saturar o navegador/servidor ou concluir apenas parte das exclusões.
Provável causa: A auditoria envia todos os IDs em um único `.in(...)`, sem particionamento. A exclusão cria uma promessa RPC `soft_delete_fiscal_document` para cada ID e dispara todas simultaneamente com `Promise.all`, sem lote, limite de concorrência, comando transacional ou identidade idempotente de operação em massa.

###############

Bug 320

Sintoma: O filtro de fornecedor em Canhotos pode exibir o mesmo fornecedor várias vezes, com nomes ligeiramente diferentes, gerando chaves/valores duplicados no seletor.
Provável causa: Em `get_delivery_receipt_filter_catalog_v1`, `supplier_options` aplica `DISTINCT` sobre o par `(supplier_id, issuer_name)`. Como documentos do mesmo fornecedor podem conter variações históricas do nome, o mesmo `supplier_id` produz várias opções; a interface usa apenas `option.value` como chave e valor e não deduplica a resposta do novo RPC.


RESOLVIDO
###############

Bug 321

Sintoma: A tela de Coletas passa a ficar progressivamente lenta e a consumir muita memória/rede conforme o histórico cresce, podendo renderizar milhares de linhas de uma vez.
Provável causa: Para evitar o antigo truncamento, `usePickupOrders` agora percorre todas as páginas com `fetchAllPostgrestPages`, mas `PickupOrders` continua sem paginação ou virtualização e calcula filtros/indicadores no navegador sobre o array completo.

###############

Bug 322

Sintoma: Em uma empresa com muitas coletas, a consulta das quantidades de XML pode falhar mesmo depois de carregar corretamente o histórico, deixando os contadores indisponíveis ou zerados.
Provável causa: `usePickupOrderCounts` envia todos os IDs de coleta de uma vez em `.in('pickup_order_id', pickupIds)`; embora pagine as linhas retornadas, não particiona a lista do filtro, que pode exceder o limite de URL/query do PostgREST e é repetida em cada página buscada.


RESOLVIDO
###############

Bug 323

Sintoma: O Histórico de MDF-e demora e consome cada vez mais rede e memória conforme os manifestos se acumulam, embora a tela exiba somente 50 registros por página.
Provável causa: `useMdfeHistory` percorre todas as páginas de `load_manifests`, incluindo relações de carga, motorista, veículo e emitente, antes de devolver o array completo. `Mdfe` aplica busca, filtros e `slice` apenas no navegador; `FiscalListPagination` não reduz a consulta ao banco.

###############

Bug 324

Sintoma: Ao atingir 1.000 NFs sem carga extraída, a Auditoria de Extração orienta “refine com filtros”, mas buscar uma chave/NF ou escolher um cliente pode continuar retornando vazio mesmo quando o documento existe fora do lote recente; o CSV também sai incompleto.
Provável causa: A query de `fiscal_documents` aplica `.limit(1000)` sem receber os filtros da tela. Busca e cliente só são avaliados em `docs.filter` depois do corte, e a exportação usa esse mesmo array parcial.

###############

Bug 325

Sintoma: Clientes ativos podem desaparecer do seletor e notas vinculadas a eles aparecem com o nome “—” na Auditoria de Extração quando a empresa possui mais clientes do que o limite padrão da API.
Provável causa: A consulta de `clients` faz um único `select` sem paginação ou limite explícito e usa apenas as linhas devolvidas para montar tanto o seletor quanto `clientNameById`.

###############

Bug 326

Sintoma: Se falhar a consulta das notas da auditoria, a tela informa “Nenhuma NF encontrada” e mostra zero pendências; se falhar a consulta de clientes, o seletor fica vazio e os nomes somem, sem mensagem de erro ou opção de tentar novamente.
Provável causa: `LoadExtractionAudit` substitui os dois resultados ausentes por `[]`, observa apenas `isLoading` da query de documentos e ignora `isError`/`error` de ambas as consultas.

###############

Bug 327

Sintoma: Um administrador autenticado consegue criar ou editar um patrimônio da empresa apontando o responsável para um funcionário de outro tenant; também consegue registrar uma movimentação do tenant atual envolvendo patrimônio e funcionários de outras empresas.
Provável causa: `assets.responsible_employee_id` e os campos `asset_id`, `from_employee_id` e `to_employee_id` de `asset_movements` possuem FKs apenas por `id`. `useCreateAsset`, `useUpdateAsset` e `useCreateAssetMovement` gravam diretamente nas tabelas, enquanto as policies validam somente o `tenant_id` da linha e não a pertença das referências.


RESOLVIDO
###############

Bug 328

Sintoma: A página de Patrimônios fica progressivamente lenta e consome muita rede/memória conforme o cadastro cresce, apesar de não oferecer paginação ou virtualização da tabela.
Provável causa: A correção do antigo truncamento fez `useAssets` percorrer todas as páginas com `fetchAllPostgrestPages`; `Assets` ainda filtra, soma indicadores e renderiza o array inteiro no navegador.

###############

Bug 329

Sintoma: Quando a consulta de patrimônios falha, a tela mostra indicadores zerados e uma tabela vazia como se não existissem ativos cadastrados.
Provável causa: `Assets` extrai somente `data` e `isLoading` de `useAssets`, substitui o resultado ausente por `[]` e não trata `isError` ou `error`.


RESOLVIDO
###############

Bug 330

Sintoma: Empresas com muitas ordens de manutenção deixam de ver registros antigos, e os filtros, a contagem e os indicadores da tela passam a representar apenas o lote retornado pela API.
Provável causa: `useMaintenanceOrders` executa um único `select` sem paginação, total separado ou detecção de truncamento; `MaintenanceOrders` filtra e calcula tudo no navegador sobre esse array.

###############

Bug 331

Sintoma: Se a consulta de ordens de manutenção falhar, a tela mostra uma lista vazia e indicadores zerados como se não existissem ordens cadastradas.
Provável causa: `MaintenanceOrders` extrai somente `data` e `isLoading`, define `orders = []` e não renderiza `isError` ou `error` de `useMaintenanceOrders`.


RESOLVIDO
###############

Bug 332

Sintoma: Duas ordens de manutenção criadas no mesmo milissegundo podem receber exatamente o mesmo número, tornando listagens, pesquisas e referências financeiras ambíguas.
Provável causa: `useCreateMaintenanceOrder` gera `order_number` no navegador como `OS-${Date.now().toString(36)}`. Não existe sequência transacional nem restrição `UNIQUE` por tenant para impedir colisões concorrentes.


RESOLVIDO
###############

Bug 333

Sintoma: Um administrador pode criar uma ordem de manutenção no tenant atual ligada a veículo, patrimônio, funcionário, incidente ou agenda de outra empresa; uma peça da ordem também pode apontar para ordem, item de estoque ou movimento de outro tenant.
Provável causa: Os hooks gravam `maintenance_orders` e `maintenance_parts` diretamente. Suas FKs relacionadas usam apenas o `id`, as policies validam o tenant da linha e não há trigger/RPC que compare o `tenant_id` de cada referência.


RESOLVIDO
###############

Bug 334

Sintoma: Um administrador pode cadastrar ou editar uma tabela de frete do tenant atual vinculando `client_id` a um cliente de outra empresa, fazendo a tabela desaparecer parcialmente dos joins e contaminando a seleção de regras.
Provável causa: `freight_tables_client_id_fkey` referencia somente `clients(id)`, e `FreightTables` grava diretamente na tabela. A policy valida o `tenant_id` da tabela de frete, mas não compara o tenant do cliente relacionado.


RESOLVIDO
###############

Bug 335

Sintoma: Duas tabelas de frete ativas que diferem legitimamente por grupo/pagador, região, rota, tipo de distribuição, tipo de carga, carroceria ou CTRC podem colidir como duplicadas e impedir o segundo cadastro.
Provável causa: O índice único `uq_freight_tables_context` considera apenas tenant, cliente, UFs, municípios, tipo de veículo e vigência. Vários campos que o formulário e `calculateFreight` tratam como dimensões de contexto não participam da chave de unicidade.


RESOLVIDO
###############

Bug 336

Sintoma: Falhas ao carregar tabelas de frete, clientes ou regiões aparecem como tabela e seletores vazios, sem mensagem de erro; o usuário pode iniciar um cadastro acreditando que não existem regras ou opções anteriores.
Provável causa: `FreightTables` define `rows`, `clientsList` e `regionsCatalog` como `[]` quando as queries não entregam dados e observa apenas `isLoading` da primeira, ignorando `isError`/`error` das três consultas.


RESOLVIDO
###############

Bug 337

Sintoma: Abrir Tabelas de Frete fica progressivamente lento e consome muita memória/rede em empresas com muitos clientes, regiões e regras, antes mesmo de o usuário aplicar qualquer filtro.
Provável causa: A página percorre integralmente, em paralelo, todas as páginas de `freight_tables`, clientes ativos e `client_regions` com `fetchAllPostgrestPages`, mantendo os três catálogos completos no navegador e sem paginação de interface.

###############

Bug 338

Sintoma: A tela de Ocorrências fica progressivamente lenta, transfere todo o histórico a cada abertura e renderiza milhares de linhas de uma vez; busca, filtros e indicadores também passam a consumir memória e CPU proporcionais ao volume total.
Provável causa: `useIncidents` percorre todas as páginas de `incidents` com `fetchAllPostgrestPages`, incluindo joins de funcionário e cliente, e `Incidents` mantém, filtra, agrega e renderiza o conjunto completo no navegador, sem paginação de interface nem agregações no servidor.

###############

Bug 339

Sintoma: Quando a consulta de ocorrências falha, a tela informa “0 registradas”, zera todos os indicadores e exibe “Nenhuma ocorrência”, fazendo uma indisponibilidade parecer ausência real de dados.
Provável causa: `Incidents` converte `data` ausente em `[]` e observa somente `isLoading` de `useIncidents`; `isError` e `error` são ignorados, portanto o estado de falha cai no mesmo fluxo visual de uma resposta vazia bem-sucedida.


RESOLVIDO
###############

Bug 340

Sintoma: O histórico de ações de RH de uma ocorrência pode aparecer vazio quando a consulta falha e pode perder ações antigas silenciosamente ao ultrapassar o limite de linhas da API.
Provável causa: `useIncidentActions` executa uma única consulta sem paginação, enquanto `HrActionsSection` substitui dados ausentes por `[]` e não observa `isLoading`, `isError` nem `error`; falha e truncamento são apresentados como uma lista normal incompleta ou vazia.


RESOLVIDO
###############

Bug 341

Sintoma: Duas pessoas podem editar a mesma ocorrência simultaneamente e ambas receber sucesso, mas a última a salvar sobrescreve silenciosamente título, vínculos, custos, status, plano de ação e conclusão alterados pela primeira.
Provável causa: O formulário envia novamente o snapshot completo da ocorrência e `useUpdateIncident` condiciona o `UPDATE` apenas por `id` e `tenant_id`. O `updated_at` originalmente lido não é usado como precondição, versão otimista ou rejeição de gravação obsoleta.


RESOLVIDO
###############

Bug 342

Sintoma: Abrir Ocorrências Operacionais pode transferir duas vezes grandes partes do histórico e só então liberar a tabela; trocar filtros refaz uma varredura integral do resultado, enquanto a paginação exibida não reduz o trabalho de rede nem do navegador.
Provável causa: A página mantém simultaneamente `useOperationalEvents`, que percorre todas as páginas de todos os eventos para os KPIs, e `useOperationalEventsFiltered`, que percorre todas as páginas do filtro. Depois de ambas as cargas completas, `OperationalEvents` pagina apenas com `sorted.slice(...)` no cliente.

###############

Bug 343

Sintoma: O XLSX de ocorrências pode subestimar entregas, notas e valor por motorista em períodos com mais de 5.000 cargas; se a consulta de cargas falhar, o arquivo ainda é gerado com esses totais zerados, sem avisar o usuário.
Provável causa: `exportReport` consulta `loads` com `.limit(5000)`, não pagina nem solicita contagem, e desestrutura somente `data` de `await lq`, descartando `error`. O resumo é calculado sobre `loadsRows || []` e exportado como se estivesse completo.

###############

Bug 344

Sintoma: A busca por placa/identificação e o filtro por tipo de alerta podem informar que não há resultados mesmo quando existem alertas correspondentes mais antigos; também não há como navegar além dos 100 mais recentes da situação escolhida.
Provável causa: `AlertInstancesSection` aplica `.limit(100)` no servidor apenas depois do filtro de status, mas executa busca textual e filtro de tipo no navegador sobre esse subconjunto, sem paginação, cursor ou indicação de que correspondências posteriores foram excluídas.

###############

Bug 345

Sintoma: A aba “Notas paradas” mostra no máximo 200 documentos vencidos e pode ocultar silenciosamente outras notas com mais de sete dias sem romaneio/saída, impedindo que o operador veja e corrija toda a fila.
Provável causa: `StaleFiscalDocsSection` encerra a consulta com `.limit(200)` e renderiza o resultado inteiro, sem paginação, contagem total ou aviso de truncamento.

###############

Bug 346

Sintoma: Falhas ao consultar alertas ativos, notas paradas, regras ou geofences aparecem respectivamente como “Nenhum alerta”, “Nenhuma nota”, “Nenhuma regra” ou seletor vazio, confundindo indisponibilidade com ausência de pendências/configuração.
Provável causa: As quatro queries de `Alerts` substituem `data` ausente por `[]` e suas seções observam somente `isLoading` ou nem isso; `isError` e `error` não são renderizados.


RESOLVIDO
###############

Bug 347

Sintoma: Depois de “Rodar processamento”, a página confirma que o pipeline terminou, mas novos alertas gerados nessa execução não aparecem na aba aberta até uma recarga ou outra revalidação posterior.
Provável causa: `ProcessButton` invoca `agvlog-pipeline-run` e exibe o toast de sucesso, porém não invalida nem refaz a query `alert_instances`; essa consulta também não possui polling ou assinatura em tempo real.


RESOLVIDO
###############

Bug 348

Sintoma: Falhas ao reconhecer ou fechar um alerta e ao ativar, desativar ou excluir uma regra não exibem nenhuma mensagem; o clique pode simplesmente não produzir o efeito esperado e o operador não sabe se deve repetir a ação.
Provável causa: As mutations de ACK, fechamento, toggle e exclusão definem apenas `onSuccess`, sem `onError` nem tratamento no evento da interface. Os erros lançados pela chamada ao Supabase ficam apenas no estado interno da mutation, que não é apresentado pela página.


RESOLVIDO
###############

Bug 349

Sintoma: Em empresas com muitos usuários, membros desaparecem da tabela e os cartões de total, ativos e papéis ficam menores que os valores reais; nomes também podem faltar ou a listagem inteira pode falhar quando a relação de IDs cresce.
Provável causa: `TeamManagement` faz uma única consulta sem paginação em `tenant_memberships` e envia todos os `user_id` retornados em um único `.in('id', userIds)` para `profiles`. Não há cursor, contagem total nem particionamento do filtro.


RESOLVIDO
###############

Bug 350

Sintoma: Uma falha ao carregar os membros da empresa aparece como equipe vazia, com todos os indicadores zerados e “Nenhum membro encontrado”, sem distinguir indisponibilidade de uma empresa realmente sem usuários.
Provável causa: A página substitui `data` ausente por `[]` e observa somente `isLoading` da query `tenant_members`; os estados `isError` e `error` não são apresentados.


RESOLVIDO
###############

Bug 351

Sintoma: Membros legítimos podem aparecer apenas como um prefixo de UUID e deixar de ser localizáveis por e-mail, especialmente em instalações com mais de 4.000 contas, sem qualquer aviso de que o enriquecimento ficou incompleto.
Provável causa: `list-tenant-members` varre no máximo 20 páginas de 200 usuários do Auth para localizar os IDs do tenant. Além desse teto — ou ao ocorrer erro em uma página — devolve silenciosamente a lista parcial; `TeamManagement` ainda captura e ignora por completo qualquer falha da função.


RESOLVIDO
###############

Bug 352

Sintoma: A busca por e-mail pode declarar que uma conta existente “ainda não foi encontrada” e tentar convidá-la novamente quando ela estiver depois dos primeiros 1.000 usuários do projeto.
Provável causa: `search-users-by-email` implementa a busca exata percorrendo no máximo dez páginas de cem contas de `auth.users`, sem API de procura indexada nem sinal de resultado truncado. A interface interpreta qualquer lista vazia como inexistência da conta.


RESOLVIDO
###############

Bug 353

Sintoma: Um administrador consegue, por chamada direta à API, rebaixar ou desativar o proprietário da empresa, apesar de a interface ocultar esses controles; isso permite remover a autoridade do owner e assumir o controle administrativo do tenant.
Provável causa: A policy `Admins can manage memberships` concede `ALL` em `tenant_memberships` a qualquer owner/admin do tenant e não protege linhas com papel `owner`, não exige que o ator seja o próprio owner nem impõe invariantes de último proprietário. A restrição existe somente na renderização de `TeamManagement`.


RESOLVIDO
###############

Bug 354

Sintoma: A aba “Acessos do Portal” pode omitir concessões antigas quando há muitos acessos e mostra “Nenhum acesso de portal cadastrado” quando a consulta falha, sem paginação nem mensagem de erro.
Provável causa: `PortalAccessTab` executa uma única consulta não paginada em `client_portal_access`, substitui `data` ausente por `[]` e observa apenas `isLoading`; limite da API e falha são tratados como uma lista normal parcial ou vazia.


RESOLVIDO
###############

Bug 355

Sintoma: O botão “Copiar link do portal” pode informar “Link do portal copiado” mesmo quando o navegador recusou o acesso à área de transferência e nenhum link foi copiado.
Provável causa: O handler chama `navigator.clipboard.writeText(url)` sem aguardar a Promise nem capturar sua rejeição e exibe o toast de sucesso incondicionalmente logo em seguida.


RESOLVIDO
###############

Bug 356

Sintoma: Uma falha ao consultar conflitos de mapeamento SSX oculta completamente a fila e pode marcar a etapa “Conflitos de mapeamento visíveis e controlados” como atendida, permitindo que a tela declare a integração pronta com conflitos desconhecidos.
Provável causa: A query `ssx_mapping_conflicts` substitui dados ausentes por `[]`, mas a página não observa seu `isError`/`error`. `SsxMappingConflictReview` não renderiza arrays vazios e `evaluateSsxReadiness` interpreta `mappingConflicts.length === 0` como sucesso, inclusive quando esse vazio veio de erro.


RESOLVIDO
###############

Bug 357

Sintoma: A fila de conflitos SSX mostra no máximo 200 pendências e não informa nem permite acessar conflitos posteriores, embora o título apresente o tamanho do array como se fosse o total da fila.
Provável causa: `IntegrationHealth` chama `list_ssx_mapping_conflicts_v1` sempre com `_limit: 200` e `_offset: 0`; apesar de o RPC aceitar paginação, não há contagem total, cursor ou controles para avançar.


RESOLVIDO
###############

Bug 358

Sintoma: O painel de frescor pode contabilizar no máximo 5.000 veículos ativos e superestimar a cobertura de posições frescas quando a empresa possui mais veículos, especialmente se os excedentes ainda não têm telemetria.
Provável causa: `activeVehiclesQuery` encerra a consulta com `.limit(5_000)` sem sondar excedente nem paginar. `summarizeTelemetryFreshness` usa somente esses IDs como denominador, enquanto a consulta de posições aplica um limite independente.


RESOLVIDO
###############

Bug 359

Sintoma: Se a consulta das contas SSX falhar, a página classifica a integração como `not_configured`, exibe a área de contas vazia e reprova a autenticação sem informar que ocorreu uma indisponibilidade de leitura.
Provável causa: `IntegrationHealth` extrai apenas `data` e `isLoading` de `useWorkspaceSsxAccounts`, substitui dados ausentes por `[]` e ignora `error`/`isError`; o mesmo array vazio alimenta `operationalStatus` e os gates de prontidão.


RESOLVIDO
###############

Bug 360

Sintoma: Veículos podem desaparecer silenciosamente do Mapa da Frota — inclusive dos totais, busca e marcadores — quando o workspace ultrapassa o limite de linhas de uma resposta PostgREST.
Provável causa: `useWorkspaceFleetSnapshot` chama uma única vez o RPC set-returning `list_workspace_fleet_snapshot_v1`, que não aceita limite/cursor, e trata o array retornado como snapshot completo. Não há paginação, contagem nem sondagem de truncamento pelo limite da API.


RESOLVIDO
###############

Bug 361

Sintoma: O “Diagnóstico SSX (manual)” pode terminar visualmente como se tivesse funcionado mesmo quando uma ou todas as execuções do pipeline falharam, deixando o mapa sem atualização e sem explicar a falha.
Provável causa: O loop de `pollMutation` aguarda `supabase.functions.invoke('agvlog-pipeline-run')`, mas não inspeciona o campo `error` nem uma falha declarada em `data`. Assim, respostas HTTP tratadas pelo cliente como resultado com erro não lançam exceção e disparam `onSuccess` normalmente; também não existe feedback de sucesso ou erro na página.


RESOLVIDO
###############

Bug 362

Sintoma: Se a consulta das contas SSX falhar no Mapa da Frota, o botão de diagnóstico manual simplesmente desaparece, exatamente como se nenhuma conta pronta existisse, sem mensagem ou opção de tentar carregar as contas novamente.
Provável causa: `FleetMap` desestrutura apenas `data` de `useWorkspaceSsxAccounts`, usa `[]` como fallback e ignora `isLoading`, `isError` e `error`; a renderização do botão depende exclusivamente de `accounts.length > 0`.


RESOLVIDO
###############

Bug 363

Sintoma: A Rastreabilidade pode omitir documentos antigos, retornar vazio para filtros que possuem correspondência e exportar CSVs e indicadores incompletos sem informar que o universo foi cortado.
Provável causa: A consulta inicial limita `fiscal_documents` aos 1.000 mais recentes e todos os filtros — NF, carga, cliente, fornecedor, datas, status, POD, canhoto e lote — são aplicados somente depois no navegador. Tabela, métricas, analisador e exportações usam esse mesmo subconjunto.


RESOLVIDO
###############

Bug 364

Sintoma: Carregar a Rastreabilidade pode falhar com muitos vínculos ou apresentar eventos, viagens e paradas incompletos, fazendo documentos parecerem sem histórico operacional.
Provável causa: Até 1.000 `load_id` são enviados de uma vez em consultas `.in(...)` de eventos e viagens, e todos os `trip_id` resultantes seguem em outro `.in(...)` de paradas. As listas não são particionadas e nenhuma das três consultas pagina as linhas retornadas, expondo tanto limite de URL quanto truncamento de resposta.


RESOLVIDO
###############

Bug 365

Sintoma: Se qualquer consulta da Rastreabilidade falhar, a tela encerra o carregamento mostrando “Nenhum registro encontrado”, contadores zerados e exportações desabilitadas, sem revelar que os dados estão indisponíveis.
Provável causa: O `useQuery` lança os erros das quatro etapas, mas a página desestrutura apenas `data` e `isLoading`; `isError`/`error` não são renderizados e `rows` converte `data` ausente em arrays vazios.


RESOLVIDO
###############

Bug 366

Sintoma: Os filtros “POD = Sim” e “Canhoto = Sim” incluem toda nota marcada como entregue mesmo que ela não possua comprovante, enquanto ambos os filtros “Não” excluem entregas sem evidência; os dois controles sempre produzem exatamente o mesmo resultado.
Provável causa: A página não consulta `proof_of_delivery` nem arquivos/assinaturas de canhoto. Tanto `filters.pod` quanto `filters.canhoto` são comparados somente com `row.siatStatus === 'delivered'`, confundindo status operacional com existência real de cada evidência.


RESOLVIDO
###############

Bug 367

Sintoma: Quando uma carga possui mais de uma viagem, a Rastreabilidade pode exibir horários e paradas de uma viagem antiga ou arbitrária, mesmo que `loads.trip_id` aponte para a viagem atual.
Provável causa: Para cada documento, a página usa `trips.find(t => t.load_id === doc.load_id || t.id === doc.loads?.trip_id)`. A condição ampla por `load_id` vem antes da preferência pelo `trip_id`, e a consulta de viagens não possui ordenação; portanto a primeira linha retornada vence sem garantir que seja a viagem vinculada atualmente.


RESOLVIDO
###############

Bug 368

Sintoma: O filtro “Lote de importação” pode juntar dois uploads distintos feitos pelo mesmo usuário no mesmo minuto ou dividir um único upload que atravessou a virada do minuto, produzindo contagens, análises e exportações atribuídas ao lote errado.
Provável causa: Como `fiscal_documents` não persiste um identificador de lote, `Traceability` inventa a chave `${created_by}|${Math.floor(created_at / 60000)}`. O agrupamento por janela fixa de 60 segundos não representa a transação ou o arquivo de origem.


RESOLVIDO
###############

Bug 369

Sintoma: Falhas ao carregar cargas, ocorrências, clientes, veículos ou motoristas no Relatório de Produtividade são apresentadas como zeros, “Sem dados”, nomes “Desconhecido” ou até “Nenhuma divergência 🎉”, podendo transformar uma indisponibilidade em um resultado aparentemente positivo.
Provável causa: `ProductivityReports` substitui os dados dos cinco hooks por `[]` e observa somente `isLoading` de cargas e eventos. Nenhum `isError`/`error` é renderizado, e todos os indicadores são calculados diretamente sobre os arrays vazios ou incompletos.


RESOLVIDO
###############

Bug 370

Sintoma: Um período sem nenhuma entrega concluída nem divergente exibe “Taxa de Sucesso 100%”; motoristas sem desfecho no recorte também recebem 100%, embora não exista amostra que sustente essa taxa.
Provável causa: Tanto `overallSuccess` quanto `driverMetrics.successRate` usam `100` como fallback quando `delivered + divergent === 0`, em vez de apresentar valor indisponível ou ausência de base estatística.


RESOLVIDO
###############

Bug 371

Sintoma: A tabela de eficiência de veículos pode contar várias “viagens” para uma única viagem real e calcular ocupação média incorreta quando o mesmo despacho transporta mais de uma carga.
Provável causa: `vehicleEfficiency` define `trips = vehicleLoads.length` e soma a capacidade do veículo uma vez por carga, sem agrupar as cargas por `trip_id`/`dispatch_trip` antes de calcular `totalPallets / (trips * maxPallets)`.


RESOLVIDO
###############

Bug 372

Sintoma: Relatórios de ingestão anteriores aos 500 primeiros resultados de um filtro não podem ser abertos, auditados, exportados nem reprocessados pela interface; os cartões também somam apenas esse recorte.
Provável causa: `IngestionReports` aplica filtros no servidor, mas encerra sempre a consulta com `.limit(500)` e não oferece paginação, cursor, contagem total ou acesso ao restante do histórico.


RESOLVIDO
###############

Bug 373

Sintoma: Ao alternar entre empresas, a página de Folha de Devolução pode continuar exibindo uma ocorrência da empresa anterior e até tentar gerar uma nova folha nela enquanto cabeçalhos e demais dados já pertencem ao tenant atual.
Provável causa: A query `delivery-occurrence-detail` usa como chave apenas `occurrenceId`, não inclui `currentTenant.id` e consulta `delivery_occurrences` somente por `id`. Como a RLS permite ler tenants dos quais o usuário é membro, a seleção ativa da empresa não restringe nem invalida esse detalhe.


RESOLVIDO
###############

Bug 374

Sintoma: Uma falha ao consultar a ocorrência é mostrada como “Ocorrência não encontrada”; falhas ao buscar folhas ou histórico podem ocultar versões existentes, liberar indevidamente a opção de gerar outra folha ou simplesmente remover a auditoria da tela.
Provável causa: `OccurrenceReturnSheetPage` observa somente o carregamento da ocorrência e não renderiza `isError`/`error` de nenhuma das três queries. Dados ausentes são tratados como `null` ou `[]`, fazendo estados de erro seguirem os fluxos normais de inexistência.


RESOLVIDO
###############

Bug 375

Sintoma: Quando todas as versões de uma folha estão canceladas ou substituídas, a tela escolhe uma delas como folha ativa e permite marcá-la como impressa ou anexar uma assinatura, ressuscitando um documento terminal como `printed` ou `signed`.
Provável causa: `activeSheet` usa `list[0]` como fallback quando não encontra status ativo. Os botões bloqueiam apenas `printed`/`signed`, e `useMarkReturnSheetPrinted`/`useUploadSignedProof` fazem `UPDATE` direto por `id`, sem precondição de status; o banco possui apenas um `CHECK` dos valores permitidos, não uma máquina de transição.


RESOLVIDO
###############

Bug 376

Sintoma: Se o arquivo da folha assinada for enviado com sucesso mas a atualização do registro falhar, o usuário recebe erro e pode repetir o envio, deixando um ou mais comprovantes órfãos no storage.
Provável causa: `useUploadSignedProof` executa primeiro `uploadSecureFile` e depois um `UPDATE` separado em `occurrence_return_sheets`. Não há operação atômica, identidade idempotente nem compensação para excluir o objeto recém-enviado quando a gravação do caminho/status falha.


RESOLVIDO
###############

Bug 377

Sintoma: No app do motorista, falhas ao identificar o motorista, localizar a viagem ativa ou carregar suas paradas podem aparecer como “Nenhuma ocorrência registrada” e seletor de parada vazio; ao tentar registrar, o usuário recebe apenas “Sem viagem ativa”, sem saber que houve uma falha de consulta.
Provável causa: `DriverIssues` não observa `isError`/`error` de `useCurrentDriver`, `useActiveTrip` nem `stopsQuery`. Dados ausentes desabilitam silenciosamente o histórico ou caem no snapshot local, e somente o erro da consulta de ocorrências possui estado visual próprio.


RESOLVIDO
###############

Bug 378

Sintoma: Na página inicial do motorista, falhas ao identificar o motorista, consultar a jornada física ou carregar as paradas podem ser apresentadas como conta não vinculada, ausência de carga/viagem ou rota sem próximo destino, em vez de erro de leitura.
Provável causa: `DriverHome` não extrai `isError`/`error` de `useCurrentDriver` nem de `useDriverPhysicalJourney`, e `homeStopsQuery.isError` apenas ativa silenciosamente um snapshot local quando disponível. `hasDataError` considera somente viagem automática, lista de viagens e cargas.


RESOLVIDO
###############

Bug 379

Sintoma: Um motorista com mais de 20 cargas não finalizadas pode deixar de ver cargas ativas antigas na seção “Cargas atribuídas”, sem contagem total, aviso ou botão para carregar o restante.
Provável causa: A query `driver_my_loads` filtra estados não terminais, ordena por criação e aplica `.limit(20)`. `standaloneLoads` e toda a renderização são derivados somente desse lote, sem paginação ou cursor.


RESOLVIDO
###############

Bug 380

Sintoma: Na tela de Motoristas, falhas ao carregar veículos, usuários com papel de motorista ou contas SSX deixam os respectivos seletores vazios e fazem nomes/botões de sincronização desaparecerem, embora a lista principal continue parecendo saudável.
Provável causa: Somente a query principal de motoristas expõe `isError`. As queries `vehicles_for_assign`, `driver_users_for_link` e `useWorkspaceSsxAccounts` usam `[]` como fallback e seus estados de erro não são renderizados; a função de enriquecimento de usuários ainda captura e ignora falhas explicitamente.


RESOLVIDO
###############

Bug 381

Sintoma: Dois administradores podem editar simultaneamente o mesmo motorista e ambos receber sucesso, mas o último salvamento sobrescreve silenciosamente os campos alterados pelo primeiro com o snapshot antigo do formulário.
Provável causa: `DriverDialog` copia praticamente toda a linha para `form` e a envia novamente no `UPDATE`, condicionado apenas por `id` e `tenant_id`. Embora exista `updated_at`, o valor originalmente lido não é usado como precondição ou versão otimista.


RESOLVIDO
###############

Bug 382

Sintoma: Ao alternar entre empresas, o detalhe de um veículo pode continuar mostrando placa e cadastro do tenant anterior junto de métricas, históricos e ações já consultados no tenant atual.
Provável causa: A query principal usa a chave `['vehicle', vehicleId]`, sem `currentTenant.id`, e busca `vehicles` somente por `id`. Usuários membros de mais de uma empresa podem ler a linha fora do contexto ativo, e a troca de tenant não invalida esse cache.


RESOLVIDO
###############

Bug 383

Sintoma: No detalhe do veículo, falhas ao carregar capacidades, métricas diárias, viagens, paradas/POIs, alertas, eventos de geofence, excessos de velocidade, combustível ou catálogo de POIs aparecem como recurso ausente, contador zero ou tabela/gráfico vazio, sem mensagem de erro.
Provável causa: A página trata erro somente nas queries de telemetria. As demais desestruturam apenas `data`, frequentemente com fallback `[]`; capacidades e métricas chegam a descartar explicitamente o campo `error` retornado pelo Supabase dentro do `queryFn`.


RESOLVIDO
###############

Bug 384

Sintoma: As abas de alertas e geofences do veículo mostram no máximo 20 registros e rotulam esse tamanho como a quantidade da aba, sem permitir consultar eventos anteriores nem avisar que o histórico foi cortado.
Provável causa: `vehicle_alerts` e `vehicle_geo_events` terminam com `.limit(20)`, enquanto os títulos usam `alerts.length` e `geoEvents.length` e as tabelas não possuem paginação, total ou ação “carregar mais”.


RESOLVIDO
###############

Bug 385

Sintoma: Em um dia com muitos registros, o detalhe do veículo pode omitir viagens, paradas, excessos de velocidade ou leituras de combustível e calcular totais, velocidade máxima, consumo e gráficos sobre uma amostra truncada sem aviso.
Provável causa: As quatro consultas diárias fazem um único `select` sem paginação nem contagem. Seus arrays são tratados como completos para consolidar viagens, somar distância/tempo, contar excesso e calcular a variação de combustível.


RESOLVIDO
###############

Bug 386

Sintoma: Uma parada detectada pode ser vinculada a um POI inexistente ou pertencente a outra empresa, deixando o histórico com referência invisível ou nome incorreto no tenant do veículo.
Provável causa: `linkPOIMutation` atualiza `trip_stops.poi_id` filtrando somente pelo `id` da parada, e a coluna `trip_stops.poi_id` não possui chave estrangeira — simples nem composta por tenant — para `pois`. A RLS protege a parada, mas não valida o UUID relacionado.


RESOLVIDO
###############

Bug 387

Sintoma: Na lista de Veículos, uma falha ao carregar motoristas deixa todos os seletores de vínculo vazios enquanto a tabela de veículos permanece normal, induzindo o administrador a acreditar que não há motorista disponível.
Provável causa: A página trata `isError` apenas da query principal de veículos; `drivers_for_assign` usa `[]` como fallback e seu erro não é observado nem exibido.


RESOLVIDO
###############

Bug 388

Sintoma: Dois administradores podem editar simultaneamente o mesmo veículo e ambos receber sucesso, mas o último salvamento sobrescreve silenciosamente os dados alterados pelo primeiro com valores antigos do formulário.
Provável causa: `VehicleDialog` envia novamente quase todos os campos da linha e condiciona o `UPDATE` apenas por `id` e `tenant_id`; `updated_at` não é usado como versão esperada ou proteção contra escrita concorrente obsoleta.


RESOLVIDO
###############

Bug 389

Sintoma: Um usuário que esqueceu a senha não consegue recuperar a própria conta pela aplicação; a tela de login oferece somente o campo de senha, e o administrador também não dispõe de uma ação segura para enviar redefinição ou novo link a uma conta existente.
Provável causa: Não existe chamada a `resetPasswordForEmail`, rota de recuperação nem controle “Esqueci minha senha” no frontend. O backend administrativo rejeita definição de senha de terceiros e o fluxo de convite foi implementado apenas para criar um novo usuário, deixando contas já existentes sem caminho de recuperação.


RESOLVIDO
###############

Bug 390

Sintoma: Se a requisição de login ou de definição da senha falhar por exceção de rede, o botão pode permanecer indefinidamente em “Entrando...” ou “Salvando...”, sem mensagem nem possibilidade de tentar novamente pela mesma tela.
Provável causa: `handleLogin` e `handleSubmit` aguardam diretamente `signInWithPassword`/`updateUser` sem `try/catch/finally`; uma Promise rejeitada interrompe o handler antes de restaurar `loading` ou `saving` e antes de exibir o erro.


RESOLVIDO
###############

Bug 391

Sintoma: Um destinatário pode receber por e-mail um convite para definir senha que já nasce inválido; isso ocorre quando a criação da conta no Auth funciona, mas o vínculo com a empresa ou o acesso ao portal falha logo depois.
Provável causa: `create-team-member` envia o e-mail por `inviteUserByEmail` antes de inserir `tenant_memberships`/`client_portal_access`. Se essa inserção posterior falha, a função apaga o usuário do Auth, mas não consegue recolher a mensagem já enviada nem substituir o link por um convite válido.


RESOLVIDO
###############

Bug 392

Sintoma: Ao editar um membro, a tela pode informar “Conta atualizada com sucesso” embora o nome exibido continue antigo e a alteração do perfil não tenha sido gravada.
Provável causa: `update-team-member` aguarda o `update` em `profiles`, mas ignora por completo o `error` retornado e responde `success: true` mesmo quando essa gravação falha.


RESOLVIDO
###############

Bug 393

Sintoma: Um administrador de uma empresa pode trocar o e-mail de login global de um usuário compartilhado com outras empresas, alterando ou bloqueando o acesso desse usuário em todos os tenants sem autorização dos demais proprietários.
Provável causa: `update-team-member` usa a chave de serviço para chamar `auth.admin.updateUserById` e exige apenas que o ator seja owner/admin de um tenant ao qual o alvo pertença. A identidade do Auth é global, mas não há verificação de outros vínculos, consentimento do próprio usuário nem restrição da alteração ao escopo daquela empresa.


RESOLVIDO
###############

Bug 394

Sintoma: Os controles “Cards compactos” e “Notificações por e-mail” do portal parecem salvar preferências, mas não alteram a aparência dos cards nem o envio de mensagens; recarregar o portal apenas restaura a posição dos interruptores.
Provável causa: `PortalSettings` é o único consumidor de `agvlog:portal:prefs:v1`, `compactCards` e `emailNotifications`. Os valores são gravados exclusivamente em `localStorage`, sem qualquer componente de cards, serviço de notificação ou backend que os leia e aplique.


RESOLVIDO
###############

Bug 395

Sintoma: Se falhar a consulta de emitentes ou de credenciais do Hub Fiscal, a configuração informa “Nenhum emitente cadastrado” ou “Nenhuma credencial. Usará o token padrão do sistema”, induzindo o administrador a cadastrar dados duplicados ou acreditar que haverá fallback.
Provável causa: `EmittersSettings`, `EmitterFormDialog` e `CredentialsDialog` extraem `data` com fallback `[]` e observam apenas o carregamento; os estados `error`/`isError` de `useEmitters` e `useHubCredentials` nunca são renderizados nem bloqueiam as ações.

RESOLVIDO

###############

Bug 396

Sintoma: Uma falha ao carregar os dados da empresa ou da seguradora padrão abre formulários vazios como se ainda não houvesse cadastro; um administrador pode preencher apenas alguns campos e apagar silenciosamente os demais valores existentes ao salvar.
Provável causa: `CompanySettings` e `InsuranceSettings` ignoram `error`/`isError` das queries e inicializam o estado local com `{}` quando `data` está ausente. As mutações seguintes mesclam esse formulário vazio no objeto persistido, convertendo os campos não recuperados em strings vazias.

RESOLVIDO

###############

Bug 397

Sintoma: Salvar os dados da empresa pode exibir “Dados da empresa salvos” mesmo que nenhuma linha tenha sido atualizada — por exemplo, quando a permissão administrativa foi revogada enquanto o formulário estava aberto.
Provável causa: `useUpdateCompanyProfile` executa o `UPDATE` em `tenants` sem solicitar a linha modificada nem conferir a contagem/resultado. Um bloqueio por RLS que produz zero linhas e nenhum erro é tratado como sucesso e dispara o toast positivo.

RESOLVIDO

###############

Bug 398

Sintoma: Selecionar uma chave canônica para uma telemetria ainda não mapeada sempre falha, impedindo criar novos mapeamentos pela tela de Configurações.
Provável causa: `TelemetryMappingSection` insere apenas `tenant_id`, `telemetry_id` e `canonical_key` em `telemetry_mapping`, mas a coluna `provider` é obrigatória, não possui valor padrão e também faz parte da chave única.

RESOLVIDO

###############

Bug 399

Sintoma: Quando dois provedores possuem o mesmo `telemetry_id`, a tela mostra o mapeamento de um deles também no outro e editar qualquer uma das linhas pode alterar sempre o mesmo registro, deixando o segundo provedor impossível de configurar corretamente.
Provável causa: O catálogo é global e distingue sinais por `(provider, telemetry_id)`, assim como a tabela de mapeamentos, porém `mappingByTelId` e todas as ações da interface usam somente `telemetry_id` como chave e nem exibem o provedor ao operador.

RESOLVIDO

###############

Bug 400

Sintoma: “Auto-sugerir” informa imediatamente que vários mapeamentos foram aplicados mesmo quando todas ou parte das gravações falham; o usuário recebe um toast de sucesso antes de os resultados reais serem conhecidos.
Provável causa: `handleAutoSuggest` dispara uma mutação assíncrona independente com `mutate` para cada item, incrementa o contador apenas por ter encontrado uma sugestão e mostra sucesso ao terminar o laço, sem aguardar, agregar ou validar nenhuma resposta.

RESOLVIDO

###############

Bug 401

Sintoma: Um administrador que participa de mais de uma empresa pode criar um rastreador no tenant atual apontando para uma conta SSX de outra empresa, ou vincular veículo e rastreador de tenants diferentes, contaminando posições e vínculos da frota entre empresas.
Provável causa: `provider_units` e `vehicle_tracker_links` possuem somente chaves estrangeiras simples para conta, veículo e unidade; não há restrição composta nem trigger que confira igualdade de `tenant_id`. As mutações do frontend enviam IDs livres, e a RLS valida apenas o tenant gravado na linha nova.

RESOLVIDO

###############

Bug 402

Sintoma: Falhas ao carregar contas SSX, rastreadores, veículos ou vínculos ativos deixam os seletores e tabelas da aba Rastreadores vazios e exibem “Nenhum rastreador cadastrado”/“Nenhuma vinculação ativa”, sem informar indisponibilidade.
Provável causa: `UnitsSection` extrai somente `data` e estados de carregamento das quatro queries, substitui dados ausentes por `[]` e nunca observa ou renderiza `error`/`isError`.

RESOLVIDO

###############

Bug 403

Sintoma: Remover um rastreador ou desvinculá-lo de um veículo pode falhar sem qualquer mensagem; o clique termina e o registro continua na tabela, sem explicar por que a ação não ocorreu.
Provável causa: `removeUnit.mutate` e `removeLink.mutate` são chamados sem `onError`, e as respectivas mutations de `useProviderUnitMutations`/`useTrackerLinkMutations` também não possuem tratamento global de erro.

RESOLVIDO

###############

Bug 404

Sintoma: Falhas ao carregar o catálogo de telemetria, os mapeamentos ou os logs de integração aparecem como catálogo não sincronizado, ausência de mapeamentos ou “Nenhum log registrado”, ocultando uma indisponibilidade do banco.
Provável causa: `TelemetryCatalogSection`, `TelemetryMappingSection` e `IntegrationLogsSection` usam fallback `[]` e observam somente `isLoading`; nenhuma dessas telas renderiza os estados de erro das queries.

RESOLVIDO

###############

Bug 405

Sintoma: Empresas com muitos rastreadores ou vínculos deixam de ver registros antigos, e os números dos títulos e as opções de vinculação passam a representar apenas um subconjunto truncado sem aviso.
Provável causa: `useProviderUnits` e `useTrackerLinks` fazem uma única consulta PostgREST sem paginação, contagem ou detecção do limite máximo de linhas, enquanto `UnitsSection` usa diretamente `units.length`, `links.length` e esses arrays nos seletores.

RESOLVIDO

###############

Bug 406

Sintoma: Um operador, motorista ou cliente autenticado no tenant pode executar diretamente o comando de manutenção que apaga viagens, paradas, eventos e vínculos e devolve todas as cargas de XML ao planejamento, embora a interface afirme que a ação é exclusiva de administradores.
Provável causa: O RPC `revert_xml_loads_to_available` é `SECURITY DEFINER`, está concedido a `authenticated` e autoriza a execução com apenas `is_tenant_member(_tenant_id)`; a verificação `useIsAdmin` existe somente no componente visual.

RESOLVIDO

###############

Bug 407

Sintoma: A área de manutenção afirma que a reversão em massa de XMLs “é registrada em auditoria do tenant”, mas a operação pode eliminar todo o histórico operacional sem produzir o evento prometido.
Provável causa: `revert_xml_loads_to_available` apaga e atualiza as tabelas e retorna contadores, porém não insere nenhuma linha em `entity_audit_log` nem em outro registro de auditoria antes de concluir.

RESOLVIDO

###############

Bug 408

Sintoma: Reverter os XMLs pode apagar também uma viagem mista e desvincular cargas que não vieram de XML, embora o comando e a confirmação indiquem que o alcance está limitado às cargas importadas.
Provável causa: Basta `dispatch_trips.load_id` apontar para uma das cargas de XML para o RPC incluir e excluir a viagem inteira; ao remover todos os `dispatch_trip_loads` desse `dispatch_trip_id`, ele não restringe os vínculos às cargas contidas em `_load_ids`.

RESOLVIDO

###############

Bug 409

Sintoma: Cargas de XML vinculadas a uma viagem somente pela tabela de múltiplas cargas podem voltar ao status `planned` enquanto a viagem e o vínculo continuam ativos, deixando planejamento e execução contraditórios.
Provável causa: `revert_xml_loads_to_available` descobre `_trip_ids` exclusivamente por `dispatch_trips.load_id = ANY(_load_ids)` e ignora `dispatch_trip_loads.load_id`; depois redefine todas as cargas de XML, mas remove vínculos apenas das viagens encontradas pelo campo legado singular.

RESOLVIDO

###############

Bug 410

Sintoma: Um usuário do portal com permissão de coleta ou ocorrência em um cliente continua vendo as ações ao selecionar outro cliente sem essa permissão; o formulário chega a pré-selecionar o cliente proibido e a tentativa só é rejeitada depois do envio. O cancelamento de coleta sofre a mesma inconsistência.
Provável causa: `PortalPickups` e `PortalOccurrences` calculam `canRequest`/`canOpen` com `hasAnyPermission` sobre todos os acessos, em vez do cliente selecionado. A pré-seleção usa `selectedClientId` antes de confirmar que ele pertence a `requestableClients`/`openableClients`, e o botão de cancelamento também usa a permissão global agregada.

RESOLVIDO

###############

Bug 411

Sintoma: No portal, coletas, canhotos e ocorrências antigas desaparecem quando o resultado filtrado ultrapassa 200 registros; não há paginação ou forma de acessar o restante do histórico.
Provável causa: `usePortalPickups`, `usePortalPods` e `usePortalOccurrences` chamam seus RPCs sempre com `_limit: 200` e `_offset: 0`. As páginas filtram/renderizam somente esse lote e não recebem total nem disponibilizam controles para avançar.

RESOLVIDO

###############

Bug 412

Sintoma: Abrir a conversa de uma ocorrência muito longa pode ficar progressivamente lento, transferir todo o histórico a cada atualização de dez segundos e consumir memória sem limite.
Provável causa: `list_client_occurrence_messages` devolve todas as mensagens em ordem crescente, sem limite ou cursor, e `usePortalOccurrenceMessages` repete a consulta integral por polling enquanto o diálogo permanece aberto.

RESOLVIDO

###############

Bug 413

Sintoma: Na página de Documentos do portal, quando a última página válida possui exatamente 50 itens, o botão “Próxima” continua habilitado e leva o usuário a uma página vazia que parece não ter documentos.
Provável causa: `list_client_documents_v2` devolve apenas as linhas, sem total ou indicador `has_more`; a interface presume que qualquer lote com `docs.length >= 50` possui uma página seguinte, sem buscar um item adicional para confirmar.

RESOLVIDO

###############

Bug 414

Sintoma: Uma resposta incompleta ou incompatível do servidor de tracking é apresentada como “Nenhuma carga em trânsito”, ocultando a quebra do contrato da API e removendo temporariamente todos os veículos do mapa.
Provável causa: `usePortalTracking` retorna `[]` quando o payload não é objeto ou quando `data.items` não é array, em vez de lançar erro; `PortalTracking` interpreta esse array vazio como um resultado legítimo.


RESOLVIDO
###############

Bug 415

Sintoma: O portal aceita um relatório cuja data inicial é posterior à final e exibe todos os indicadores zerados e seções “Sem dados”, sem informar que o intervalo é inválido.
Provável causa: `PortalReports` não relaciona os campos com `min`/`max` nem valida `start <= end`; `get_client_portal_reports_summary_v2` também não rejeita o intervalo e apenas executa filtros `BETWEEN` que naturalmente não encontram linhas.


RESOLVIDO
###############

Bug 416

Sintoma: O relatório do portal pode informar várias “Entregas no período” para uma única entrega física quando a carga possui mais de uma nota, inflando também a distribuição por status e o ranking de cidades.
Provável causa: `get_client_portal_reports_summary_v2` define a base `fd` com uma linha por `fiscal_documents` e usa `count(*)` como `deliveries_total` e nas demais agregações, embora os rótulos da interface descrevam entregas e não documentos fiscais.

RESOLVIDO

###############

Bug 417

Sintoma: Um usuário pode baixar um canhoto pelo portal sem que o acesso bem-sucedido seja registrado, deixando a trilha de auditoria incompleta justamente para documentos já expostos por URL assinada.
Provável causa: `get-client-pod-signed-url` cria e devolve a URL antes de exigir confirmação de `log_pod_access_v2`; tanto o log de sucesso quanto o de falha usam `.catch(() => undefined)` e qualquer erro de auditoria é ignorado.

RESOLVIDO

###############

Bug 418

Sintoma: Operadores veem os botões “Novo Template” e “Executar” na página de checklists, preenchem os diálogos e só descobrem ao salvar que não possuem permissão para nenhuma dessas ações.
Provável causa: A rota aceita todo papel interno e `Checklists` não consulta `useIsAdmin` para ocultar ou desabilitar mutações, enquanto as policies de `operational_checklists` e `checklist_executions` permitem inserção somente a owner/admin.

RESOLVIDO

###############

Bug 419

Sintoma: Falhas ao carregar templates, execuções, veículos ou funcionários aparecem como listas, indicadores e seletores vazios, permitindo iniciar um checklist sem perceber que os dados necessários estão indisponíveis.
Provável causa: `Checklists` extrai apenas `data` e `isLoading` das quatro queries, usa `[]` como fallback e nunca observa nem renderiza seus estados `error`/`isError`.

RESOLVIDO

###############

Bug 420

Sintoma: Depois de 200 execuções, checklists antigos desaparecem da tabela e os indicadores “Executados”, “Reprovados” e “Bloqueios” passam a contar apenas os registros recentes, embora sejam apresentados como totais gerais.
Provável causa: `useChecklistExecutions` encerra a consulta com `.limit(200)` e a página não possui total, paginação ou aviso de truncamento; todos os KPIs são calculados diretamente sobre esse array.

RESOLVIDO

###############

Bug 421

Sintoma: Um checklist recém-aberto pode ser aprovado sem que o operador confirme item algum, fazendo a execução parecer integralmente inspecionada mesmo que o diálogo tenha sido apenas aberto e salvo.
Provável causa: `startExecution` inicializa todos os itens automaticamente com `status: 'ok'`, e `handleExecute` permite gravar imediatamente esse estado sem exigir interação, confirmação individual ou evidência de que cada verificação ocorreu.

RESOLVIDO

###############

Bug 422

Sintoma: Itens marcados como obrigatórios podem ser alterados para “N/A” e ainda produzir um checklist aprovado e sem bloqueio, mesmo quando todos os itens obrigatórios foram ignorados.
Provável causa: Ao iniciar a execução, a tela descarta a propriedade `required` do template. O cálculo considera somente `nok` como falha; `na` não entra em `failed`, e qualquer execução com zero itens `nok` recebe status `passed`.

RESOLVIDO

###############

Bug 423

Sintoma: Qualquer item reprovado bloqueia a operação mesmo em um template configurado para não permitir bloqueio; por outro lado, a opção persistida no cadastro não exerce controle algum sobre a execução.
Provável causa: `handleExecute` define `blocked_operation: failed > 0` incondicionalmente e nunca consulta `selectedChecklist.can_block_operation`. A coluna possui padrão `false`, mas esse valor é ignorado pelo frontend.

RESOLVIDO

###############

Bug 424

Sintoma: Templates configurados para gerar incidente ou manutenção após reprovação nunca criam esses registros, deixando as colunas de vínculo vazias apesar das capacidades habilitadas.
Provável causa: `can_generate_incident` e `can_generate_maintenance` são armazenados em `operational_checklists`, mas não são lidos em nenhuma parte da aplicação; `useCreateChecklistExecution` apenas insere a execução e não aciona qualquer criação associada.

RESOLVIDO

###############

Bug 425

Sintoma: Um administrador que participa de mais de uma empresa pode gravar uma execução no tenant atual usando template ou funcionário de outro tenant; `vehicle_id` e `dispatch_trip_id` aceitam até UUIDs inexistentes, comprometendo a rastreabilidade do checklist.
Provável causa: `checklist_executions` possui FKs simples apenas para `checklist_id` e `employee_id`, sem composição por tenant, e não possui FK para veículo nem viagem. A policy valida somente `tenant_id`, e a inserção direta do hook não compara o escopo das referências.

RESOLVIDO

###############

Bug 426

Sintoma: Um template de checklist marcado como inativo continua aparecendo normalmente e pode receber novas execuções como se estivesse vigente.
Provável causa: `useOperationalChecklists` não filtra `active`, `Checklists` não diferencia visualmente esse campo e `startExecution` não verifica o status antes de abrir e salvar a execução.

RESOLVIDO

###############

Bug 427

Sintoma: Se a auditoria de consistência falhar, a página exibe contadores zerados e a mensagem verde “Nenhuma inconsistência detectada”, transformando uma indisponibilidade da verificação em aparente aprovação dos dados.
Provável causa: `DataAudit` substitui `data` ausente por `[]`, observa apenas `isLoading`/`isFetching` e nunca renderiza `error` ou `isError` da query.


RESOLVIDO
###############

Bug 428

Sintoma: Cada clique em “Reexecutar” pode disparar duas auditorias completas simultâneas, duplicando carga no banco e fazendo o indicador de atualização acompanhar apenas parte do trabalho iniciado.
Provável causa: O handler incrementa `stamp`, o que já cria uma nova chave e nova consulta, e chama `refetch()` no mesmo clique, reexecutando também a query da chave antiga antes da atualização de estado.


RESOLVIDO
###############

Bug 429

Sintoma: Auditar uma nota que já está em trânsito, entregue ou não entregue pode fazê-la voltar a aparecer como “Processado”; depois disso, mudanças reais no estado da carga deixam de atualizar a situação exibida no resumo.
Provável causa: As ações individual e em massa gravam incondicionalmente `imported_note_status = 'processed'`. `resolveNoteStatus` dá prioridade absoluta a esse campo persistido antes de consultar `delivery_meta`, o status da nota ou o status atual da carga, e a tela permite auditar qualquer linha sem considerar sua situação corrente.

RESOLVIDO

###############

Bug 430

Sintoma: Uma nota pode aparecer com número de CT-e e situação “Processado” mesmo quando o CT-e associado mais recente foi cancelado.
Provável causa: A associação em `useImportedNotes` consulta `cte_documents` incluindo `status` e `cancelled_at`, mas não exclui registros cancelados e escolhe o primeiro CT-e por data de emissão. O enriquecimento atribui seu ID à nota e `resolveNoteStatus` considera a mera presença de `cte_id` suficiente para classificá-la como processada.

RESOLVIDO

###############

Bug 431

Sintoma: Uma NFS-e cancelada pode continuar sendo exibida como documento emitido e entrar na aba “Emitidas” da planilha quando o vínculo existe apenas pelo ID direto salvo na nota.
Provável causa: A busca principal por `fiscal_document_ids` ignora NFS-e com `status = 'cancelled'`, mas o fallback por `nfse_emitted_document_id` adiciona todos os resultados a `nfseById` sem repetir essa validação. `docTypeOf` interpreta qualquer `nfse_number` encontrado como emissão válida.

RESOLVIDO

###############

Bug 432

Sintoma: Alterar o filtro “Agrupado” entre “Sim” e “Não” não modifica a tabela, os totais nem as exportações, embora a consulta seja recarregada e a interface indique que a opção foi aplicada.
Provável causa: `grouped` integra o estado e a chave de cache de `useImportedNotes`, porém não é usado pela query nem pela renderização. O agrupamento do PDF é decidido separadamente por `reportType`, e CSV/XLSX sempre recebem a mesma lista plana.

RESOLVIDO

###############

Bug 433

Sintoma: Depois de selecionar notas e trocar ou limpar os filtros, o contador e as ações em massa podem continuar apontando para notas que já não estão visíveis; confirmar a operação audita ou exclui esses registros ocultos.
Provável causa: `selectedIds` não é limpo nem reconciliado quando `applied` ou `rowsData` mudam. O contador e as mutações usam todo o `Set` persistente, enquanto o checkbox “selecionar todas” ainda compara apenas `selectedIds.size === rows.length`, podendo inclusive aparecer marcado para conjuntos de IDs completamente diferentes.

RESOLVIDO

###############

Bug 434

Sintoma: Uma auditoria individual ou em massa pode informar que todas as notas foram auditadas mesmo quando nenhuma linha foi alterada, por exemplo se os registros tiverem sido excluídos ou deixado de estar acessíveis desde a consulta.
Provável causa: Os `update` de `fiscal_documents` verificam somente o erro HTTP e não solicitam as linhas alteradas nem conferem a quantidade afetada. No PostgREST, um update filtrado que encontra zero linhas pode concluir sem `error`, e a mensagem de sucesso usa a seleção original como se comprovasse a atualização.

RESOLVIDO

###############

Bug 435

Sintoma: A operação chamada “Auditar” não permite descobrir depois quem auditou a nota, quando isso ocorreu ou qual era o estado anterior, comprometendo a trilha de uma ação operacional individual ou em massa.
Provável causa: Os handlers fazem um `update` direto apenas em `fiscal_documents.imported_note_status`; não gravam ator/data nem inserem evento em `entity_audit_log`, `entity_state_audit_log` ou `load_note_audit_events`, e não existe trigger de auditoria para essa coluna.

RESOLVIDO

###############

Bug 436

Sintoma: Ao gerar um PDF, o arquivo pode ser baixado corretamente e mesmo assim a interface informar “Falha ao gerar PDF”, manter o diálogo aberto e incentivar o usuário a gerar cópias repetidas.
Provável causa: `handlePrint` chama `downloadImportedNotesSummaryPdf` antes de aguardar `createSummaryReportSnapshot`. Se a inserção do snapshot falhar, o download já é irreversível, mas o mesmo `catch` atribui o erro à geração inteira e o sucesso/fechamento do diálogo não é executado.

RESOLVIDO

###############

Bug 437

Sintoma: Todo CSV do Resumo de Notas Importadas contém as colunas “Empresa” e “Filial” vazias em todas as linhas, mesmo quando a empresa e a filial estão identificadas no sistema.
Provável causa: `exportImportedNotesCsv` declara esses dois campos no cabeçalho, mas acrescenta literalmente `'', ''` no início de cada registro e não recebe os dados do tenant, perfil da empresa ou filial para preenchê-los.

RESOLVIDO

###############

Bug 438

Sintoma: O usuário pode pesquisar um período de emissão cuja data inicial é posterior à final; a tela apenas retorna “Nenhuma nota encontrada”, fazendo um filtro inválido parecer um resultado legítimo vazio.
Provável causa: Diferentemente do intervalo de importação, `issueFrom` e `issueTo` são aplicados diretamente com `.gte` e `.lte` sem validação de ordem no formulário ou em `normalizeImportedNoteFilters`.

RESOLVIDO

###############

Bug 439

Sintoma: Se o catálogo de clientes falhar, os seletores de cliente e fornecedor ficam vazios como se não houvesse cadastros, enquanto a consulta das notas pode continuar funcionando e nenhuma mensagem permite distinguir ou repetir a carga do catálogo.
Provável causa: `ImportedNotesSummary` extrai somente `data` de `useClients` com fallback para `[]` e ignora `isError`, `error` e `refetch` dessa query; ambos os seletores são montados exclusivamente a partir desse array silenciosamente vazio.

RESOLVIDO

###############

Bug 440

Sintoma: A Rastreabilidade de Produto omite itens além dos 1.000 mais recentes e calcula quantidade, peso, paletes, valor de NFs, páginas e CSV sobre esse subconjunto, produzindo indicadores e exportações incompletos em históricos maiores.
Provável causa: A consulta de `load_items` termina em `.limit(1000)` e não possui paginação no servidor nem total exato. `usePagination` apenas divide localmente as linhas já cortadas, e todos os totais e a exportação reutilizam o mesmo array parcial.

RESOLVIDO

###############

Bug 441

Sintoma: Se falhar a consulta de motoristas na Rastreabilidade de Produto, o filtro mostra somente “Todos os motoristas”, como se nenhum motorista estivesse cadastrado, mesmo que os itens continuem carregando normalmente.
Provável causa: A página extrai apenas `data` de `useDrivers` com fallback para `[]` e não observa erro, estado de carga ou ação de repetição dessa query auxiliar.

RESOLVIDO

###############

Bug 442

Sintoma: O Histórico do Produto pode repetir a mesma entrada de NF e a mesma atribuição de carga várias vezes, inflando o total de eventos e o indicador “Cargas / NFs” quando o produto aparece em mais de um item da mesma nota ou carga.
Provável causa: O loop percorre cada linha de `load_items` e adiciona eventos `inbound`/`outbound` e `load` sem deduplicar por documento fiscal e carga. Os conjuntos usados para coletas e viagens não são aplicados a esses eventos iniciais.

RESOLVIDO

###############

Bug 443

Sintoma: A linha do tempo apresenta horários aparentemente precisos e pode ordenar entrada e saída de modo incorreto, embora a fonte possua apenas a data fiscal e não registre o horário desses eventos.
Provável causa: Para notas de entrada o código fabrica `T08:00:00`, e para documentos de saída fabrica `T18:00:00`, concatenando esses horários à `issue_date`. Esses valores artificiais são exibidos e usados na ordenação junto a timestamps operacionais reais.

RESOLVIDO

###############

Bug 444

Sintoma: Restringir o Histórico do Produto a um único dia continua lendo todo o histórico desse produto e todas as coletas, paradas e ocorrências das viagens relacionadas, ficando progressivamente lento e caro conforme os anos de dados crescem.
Provável causa: `from` e `to` não são enviados a nenhuma consulta. A página percorre todas as páginas de `load_items`, resolve todos os IDs relacionados e só aplica o intervalo com `events.filter` no navegador depois de materializar a linha do tempo completa.

RESOLVIDO

###############

Bug 445

Sintoma: A trajetória de um produto pode listar paradas e eventos operacionais destinados exclusivamente a outras entregas da mesma viagem, inclusive ocorrências posteriores à descarga desse produto, sugerindo uma movimentação que ele não realizou.
Provável causa: Basta uma carga com o produto possuir `trip_id` para a página adicionar todas as linhas de `dispatch_stops` e `dispatch_events` daquela viagem. Não há cruzamento da parada/evento com o documento, item, carga específica ou momento de entrega do produto.

RESOLVIDO

###############

Bug 446

Sintoma: Digitar parte do nome de um produto pode retornar histórico vazio, enquanto nomes contendo `_` ou `%` podem misturar produtos diferentes na mesma linha do tempo.
Provável causa: A sugestão pesquisa por trecho, mas a consulta final usa `.ilike('item_description', product)` sem adicionar curingas para uma busca parcial nem escapar curingas presentes no nome escolhido. Assim, texto comum é tratado como correspondência integral e caracteres especiais são interpretados como padrão SQL LIKE.

RESOLVIDO

###############

Bug 447

Sintoma: Alterar datas ou pesquisar outro produto pode disparar consultas completas redundantes — inclusive uma nova leitura do produto anterior — aumentando muito a carga justamente porque cada consulta percorre todo o histórico.
Provável causa: Depois da primeira pesquisa, `from` e `to` fazem parte diretamente da chave habilitada e cada edição já inicia uma query, embora exista o botão “Buscar histórico”. O handler também muda a chave por `setProduct` e agenda `refetch()` capturado da renderização anterior, reexecutando a chave antiga ao mesmo tempo que a nova consulta automática começa.

RESOLVIDO

###############

Bug 448

Sintoma: Informar no Histórico do Produto uma data inicial posterior à final não gera aviso; a tela faz a consulta completa e termina em “Nenhum evento encontrado”, fazendo um período inválido parecer ausência real de movimentação.
Provável causa: Os campos não possuem limites cruzados nem validação de ordem. O filtro local exige simultaneamente `t >= from` e `t <= to`, combinação impossível para o intervalo invertido, depois de já carregar todos os dados.

RESOLVIDO

###############

Bug 449

Sintoma: Uma falha na Auditoria de ICMS é apresentada em verde como “100% Consistente”, “Nenhuma violação detectada” e “Risco Zero”; isso ocorre sistematicamente para operadores, apesar de eles terem acesso à página.
Provável causa: A rota interna admite owner, admin e operator, mas `monitor_simples_nacional_icms_violations` autoriza apenas administradores. `CteConsistencyReport` não consome `isError` nem `error`, converte a ausência de `data` em `[]` e trata esse fallback como auditoria bem-sucedida sem violações.

RESOLVIDO

###############

Bug 450

Sintoma: Enquanto a Auditoria de ICMS ainda está carregando, o cartão de status já afirma “100% Consistente” e “Nenhuma violação detectada”, podendo transmitir aprovação antes de qualquer resultado existir.
Provável causa: O cartão decide entre alerta e sucesso somente por `violations.length`; não possui ramo para `isLoading`. Apenas a mensagem inferior e a tabela consideram parcialmente o carregamento.

RESOLVIDO

###############

Bug 451

Sintoma: Clicar em “Corrigir” numa inconsistência de ICMS não abre o CT-e indicado nem preserva sua identidade; o usuário é levado à tela geral e precisa localizar manualmente o documento irregular.
Provável causa: Todas as linhas executam exatamente `navigate('/cte-monitor')`, sem enviar `fiscal_document_id`, número, chave ou parâmetro de busca, apesar de cada violação possuir esses dados.

RESOLVIDO

###############

Bug 452

Sintoma: ORTs antigas desaparecem da consulta, dos filtros e dos indicadores quando o histórico ultrapassa 1.000 registros, sem paginação ou aviso de que os totais representam apenas o recorte mais recente.
Provável causa: `OrtConsultaTab` limita `ort_extraction_audits` a 1.000 linhas e aplica todos os filtros e cálculos com `useMemo` somente depois desse corte no navegador.

RESOLVIDO

###############

Bug 453

Sintoma: Se a consulta do histórico de ORTs falhar, a tela mostra indicadores zerados e “Nenhuma ORT encontrada”, fazendo uma indisponibilidade parecer um histórico vazio.
Provável causa: `OrtConsultaTab` observa apenas `isLoading`, usa `data = []` como fallback e ignora `isError`/`error`; o ramo vazio da tabela e os quatro cartões são calculados normalmente sobre esse array.

RESOLVIDO

###############

Bug 454

Sintoma: ORTs marcadas como “Requer revisão” podem ser localizadas, mas não há como abrir os dados extraídos, comparar a origem, aprovar, rejeitar ou concluir a revisão pela tela.
Provável causa: A consulta seleciona `extracted_payload`, `reviewed_at`, `fiscal_document_id` e estados de revisão, porém a tabela não possui detalhe nem ações e sequer torna a linha navegável. O payload e a data de revisão nunca são renderizados.

RESOLVIDO

###############

Bug 455

Sintoma: Na geração automática de ORT, alterar lote dinâmico, lote de controle, OS, ordem de coleta, referência, CNPJ, romaneios, situação da carga, placa, datas de carregamento, operação ou tipo de romaneio não muda as NFs candidatas.
Provável causa: Embora todos esses controles atualizem estado e parte deles integre a chave da query, o `queryFn` aplica somente número da nota, cliente, fornecedor e intervalo de emissão. Os estados `operacao`, `romaneio` e `todosRomaneio` nem sequer entram na chave ou na consulta.

RESOLVIDO

###############

Bug 456

Sintoma: A geração de ORT não permite acessar NFs candidatas além das 500 mais recentes; buscas amplas podem ocultar documentos válidos e a contagem apresentada parece representar toda a fila.
Provável causa: A consulta ordena por emissão e aplica `.limit(500)` sem paginação, total, cursor ou indicador de truncamento; a tabela renderiza diretamente esse lote único.

RESOLVIDO

###############

Bug 457

Sintoma: Uma falha ao vincular as NFs depois de gerar uma ORT deixa uma coleta vazia gravada no sistema, embora a tela informe somente que a geração falhou; repetir a ação cria outra coleta.
Provável causa: `handleGenerate` primeiro confirma `create_pickup_order_v1` e só depois executa um `update` independente em `fiscal_documents`. As etapas não compartilham transação, chave idempotente da operação completa ou compensação que cancele/remova a coleta já criada quando o vínculo falha.

RESOLVIDO

###############

Bug 458

Sintoma: Duas sessões podem gerar ORTs para as mesmas notas; a última atualização transfere silenciosamente as NFs para sua coleta, enquanto a primeira ORT fica vazia ou incompleta e ambas as sessões podem anunciar sucesso.
Provável causa: As candidatas são lidas com `pickup_order_id IS NULL`, mas o update posterior filtra apenas IDs e tenant, sem repetir `pickup_order_id IS NULL`, bloquear as linhas ou conferir a quantidade alterada. A separação entre criação e vínculo abre uma janela de corrida e permite sobrescrever uma associação feita depois da busca.

RESOLVIDO

###############

Bug 459

Sintoma: Notas arquivadas por exclusão lógica podem reaparecer como candidatas e ser vinculadas a uma nova ORT.
Provável causa: A consulta de geração exige apenas documento de entrada, ausência de coleta e `status != 'cancelled'`; ela não filtra `deleted_at IS NULL` nem exclui o status `deleted` usado por `soft_delete_fiscal_document`.

RESOLVIDO

###############

Bug 460

Sintoma: Se falhar a busca das NFs candidatas ou do catálogo de clientes, a geração de ORT mostra respectivamente “Nenhuma NF candidata encontrada” ou um seletor vazio, sem revelar a falha nem oferecer repetição contextual.
Provável causa: `OrtGeracaoTab` não consome `isError`/`error` da query desabilitada de candidatas e desestrutura `useClients` apenas como `data = []`; ambos os resultados ausentes são tratados como listas vazias válidas.

RESOLVIDO

###############

Bug 461

Sintoma: É possível pesquisar candidatas a ORT com emissão inicial posterior à final; a tela responde que nenhuma NF foi encontrada, sem informar que o intervalo é inválido.
Provável causa: Os campos `nfFrom`/`nfTo` não possuem `min`/`max` cruzados nem validação antes de aplicar simultaneamente `.gte('issue_date', nfFrom)` e `.lte('issue_date', nfTo)`.

RESOLVIDO

###############

Bug 462

Sintoma: Falhas ao carregar monitoramentos, previsões ou atualizações diárias aparecem como tabelas vazias, KPIs zerados e relatórios exportáveis sem dados, sem mensagem de indisponibilidade.
Provável causa: `DriverMonitoring` desestrutura apenas `data` e `isLoading` de `useDriverMonitorsList` e somente `data` das outras duas queries, sempre com fallback `[]`; `isError`, `error` e repetição contextual não são renderizados.

RESOLVIDO

###############

Bug 463

Sintoma: Depois que monitoramentos, previsões ou atualizações de uma rota ultrapassam o limite de linhas da API, registros antigos somem das tabelas, indicadores e relatórios sem paginação nem aviso de truncamento.
Provável causa: `useDriverMonitorsList`, `useMonitorForecasts` e `useMonitorUpdates` fazem um único `select` sem `range`, cursor, total ou paginação. A interface calcula e exporta diretamente o subconjunto devolvido pelo PostgREST.

RESOLVIDO

###############

Bug 464

Sintoma: Rotas não mudam automaticamente para “No prazo”, “Atrasado”, “Sem atualização” ou “Retornando”; os KPIs, filtros e relatório de atrasos podem permanecer zerados mesmo com prazos vencidos, mais de 24 horas sem contato ou todas as entregas concluídas.
Provável causa: `calculateDriverStatus` e `detectDelayedRoute` existem, mas não são chamados fora dos testes. Criação/importação grava `active`; `add_driver_progress_v1` e `add_driver_forecast_v1` atualizam totais e localização sem recalcular `status`, e o formulário de edição também não oferece estado operacional.

RESOLVIDO

###############

Bug 465

Sintoma: A aba “Rotas Ativas” e o relatório “Motoristas em Rota” incluem registros que já chegaram, foram concluídos ou cancelados, misturando histórico encerrado com operação corrente.
Provável causa: A consulta inicial não restringe estados ativos e as duas saídas reutilizam `rows` integralmente. Apenas o KPI “Em rota” aplica localmente uma lista de estados, sem compartilhar essa regra com a tabela ou exportação.

RESOLVIDO

###############

Bug 466

Sintoma: É possível registrar mais entregas do que o total previsto; a tela então mostra, por exemplo, 15 realizadas de um total de 10, mas limita artificialmente o progresso a 100% e as faltantes a zero.
Provável causa: O diálogo não limita a quantidade ao saldo e `add_driver_progress_v1` soma incondicionalmente todas as atualizações. O backend usa `greatest(total - completed, 0)` e o frontend usa `min(100, ...)`, mascarando o excesso em vez de rejeitá-lo.

RESOLVIDO

###############

Bug 467

Sintoma: Um clique duplo em “Salvar” pode criar duas atualizações de progresso ou duas previsões; se a requisição falhar, o diálogo não mostra o erro e o navegador pode registrar uma rejeição de promessa não tratada.
Provável causa: Os handlers inline aguardam `mutateAsync` sem `try/catch`, e os botões não são desabilitados por `progMut.isPending`/`forecastMut.isPending`. Cada chamada cria um `request_id` novo, portanto a idempotência do RPC não deduplica os dois cliques.

RESOLVIDO

###############

Bug 468

Sintoma: Depois de confirmar que um motorista chegou, a ação “Chegou” continua disponível e pode sobrescrever `actual_returned_at` com um horário posterior, perdendo a data efetiva da primeira chegada.
Provável causa: O botão é ocultado apenas para `completed` e `cancelled`, não para `arrived`. Cada clique envia novamente status `arrived` e `new Date().toISOString()`; o comando aceita manter o mesmo estado terminal e atualizar o timestamp.

RESOLVIDO

###############

Bug 469

Sintoma: Ao registrar progresso com o detalhe da rota aberto, as novas linhas podem aparecer enquanto os totais “Realizadas”, “Faltantes” e “Progresso” do mesmo diálogo continuam antigos até fechar e reabrir.
Provável causa: A mutação invalida as queries, mas `openRow` guarda uma cópia do objeto selecionado e não é reconciliado com a nova linha retornada em `rows`; o detalhe mistura esse snapshot obsoleto com `openUpdates` atualizado.

RESOLVIDO

###############

Bug 470

Sintoma: O PDF “Chegada de Veículos” pode declarar filtros de placa, cidade ou status no cabeçalho e ainda incluir previsões de todos os motoristas, produzindo um relatório cuja legenda não corresponde às linhas.
Provável causa: `filterSummary` é derivado dos filtros aplicados a `useDriverMonitorsList`, mas `useMonitorForecasts()` é consultado sem esses filtros. Mesmo assim, `arrivalForecastsPdf(forecasts, filterSummary, ...)` imprime o resumo filtrado sobre a lista global.

RESOLVIDO

###############

Bug 471

Sintoma: Durante a importação legada, uma falha ou truncamento na leitura de motoristas faz cadastros existentes serem tratados como “não encontrados” e cria monitoramentos sem `driver_id`, vinculados apenas pelo nome digitado na planilha.
Provável causa: A importação faz um único `select` não paginado em `drivers`, ignora a propriedade `error` e executa `.find` apenas sobre `driversData || []`; a ausência decorrente de falha ou limite é convertida em aviso e não impede os inserts.

RESOLVIDO

###############

Bug 472

Sintoma: Uma importação de monitoramento interrompida deixa parte dos monitores, atualizações e previsões gravada; reenviar o mesmo arquivo cria novos registros duplicados e outro lote, sem retomar a tentativa original.
Provável causa: O fluxo cria o lote e depois executa inserts/updates sequenciais diretamente no navegador, sem transação, fingerprint do arquivo, chave idempotente por linha ou rollback. A finalização do lote é outra requisição separada e pode falhar após os dados operacionais já terem sido persistidos.

RESOLVIDO

###############

Bug 473

Sintoma: Uma planilha pode importar um monitor com entregas “realizadas” no resumo, mas sem nenhuma atualização diária que comprove essas entregas no histórico.
Provável causa: Se o insert em `driver_route_progress_updates` falha, o código apenas acumula um aviso e continua. Em seguida, soma o array que tentou inserir e atualiza `completed_deliveries`, `remaining_deliveries`, cidade e data do monitor como se todas as linhas tivessem sido gravadas.

RESOLVIDO

###############

Bug 474

Sintoma: Monitores importados com todas as entregas concluídas continuam “Ativo”, e mesmo quando a planilha informa prazo de retorno eles ficam sem data esperada, não entrando corretamente em retornos ou atrasos.
Provável causa: A importação grava sempre `status: 'active'`, define `return_deadline_days`, mas não calcula `expected_return_date`; após consolidar o progresso, também não aplica `calculateDriverStatus` nem qualquer transição baseada no total concluído.

RESOLVIDO

###############

Bug 475

Sintoma: Se a planilha possui mais de um bloco para o mesmo motorista, todas as previsões desse nome são vinculadas somente ao último monitor criado, mesmo que pertençam a rotas diferentes.
Provável causa: `monitorByName` é um `Map<string, string>` e cada novo bloco sobrescreve o ID anterior para a mesma chave normalizada; as previsões não possuem outro identificador de rota, carga ou período para desambiguar o destino.

RESOLVIDO

###############

Bug 476

Sintoma: O relatório de Produtividade pode atribuir 100% “No prazo” a motoristas cujas rotas estão ativas, canceladas, sem atualização ou com ocorrência, sem que tenham concluído no prazo.
Provável causa: `productivityPdf` calcula a taxa como `(rotas - status delayed) / rotas`; todo estado diferente de `delayed` é contado implicitamente como sucesso, inclusive registros ainda sem desfecho e estados negativos que não representam pontualidade.

RESOLVIDO

###############

Bug 477

Sintoma: Descargas além das 1.000 mais recentes desaparecem da aba correspondente, sem paginação, total ou forma de consultar o restante do histórico.
Provável causa: `useUnloadingCharges` aplica `.limit(1000)` e `UnloadingTab` renderiza todo o array retornado em uma única tabela, sem cursor ou indicador de truncamento.

RESOLVIDO

###############

Bug 478

Sintoma: Se a consulta de descargas falhar, a aba informa “Nenhuma descarga registrada”, fazendo indisponibilidade do banco parecer ausência legítima de cobranças.
Provável causa: `UnloadingTab` usa somente `data = []` e `isLoading` de `useUnloadingCharges`; não consome `isError`, `error` ou `refetch`, portanto a falha cai no mesmo ramo visual de uma lista vazia.

RESOLVIDO

###############

Bug 479

Sintoma: No detalhe de uma carga, uma falha ao buscar documentos ou descargas mostra contagens zero e seções vazias, podendo levar o usuário a concluir que não há documentos/custos vinculados.
Provável causa: `LoadDetailPanel` desestrutura apenas `data` com fallback `[]` de `useLoadDocuments` e `useUnloadingCharges`, ignorando os estados de carregamento e erro de ambas as queries.

RESOLVIDO

###############

Bug 480

Sintoma: Uma carga com mais documentos do que o limite de resposta da API exibe uma lista e contagem de documentos incompletas no detalhe, sem avisar que parte deles foi omitida.
Provável causa: `useLoadDocuments` executa um único `select('*')` sem paginação, range, contagem esperada ou comparação com `invoice_count`/`cte_count`; o painel usa diretamente `docs.length` como total.

RESOLVIDO

###############

Bug 481

Sintoma: Mesmo após carregar todas as cargas, a aba Pendências mostra no máximo 200 problemas e oculta silenciosamente os demais, embora a mensagem de completude sugira que toda a base foi avaliada e está acessível.
Provável causa: `PendingPanel` filtra o conjunto completo e aplica `.slice(0, 200)` sem paginação, total de pendências ou indicação de que a lista foi cortada.

RESOLVIDO

###############

Bug 482

Sintoma: Cargas já pagas ou canceladas podem continuar aparecendo como pendência “Sem previsão” ou “Sem NF”; uma carga cancelada com vencimento passado também pode ser rotulada como “Vencida”.
Provável causa: O filtro de pendências exclui `paid` somente no ramo de data vencida, mas os ramos `!expected_payment_date` e `invoice_count === 0` incluem qualquer status. `cancelled` também não é excluído de nenhuma condição.

RESOLVIDO

###############

Bug 483

Sintoma: Os PDFs “Cargas em Aberto” e “Cargas Pagas” incluem cargas de todos os estados financeiros; apenas os títulos e as colunas mudam, fazendo relatórios específicos apresentarem linhas indevidas e totais globais.
Provável causa: `runReport` envia sempre `rows` integralmente e `downloadLoadControlPdf` executa `opts.rows.map(...)` e reduz o mesmo array para qualquer `kind`. Os casos `open` e `paid` de `buildRow` formatam colunas, mas nunca filtram por `payment_status` ou saldo.

RESOLVIDO

###############

Bug 484

Sintoma: O Controle de Cargas aceita data inicial posterior à final tanto para carregamento quanto para previsão de pagamento e retorna uma lista vazia, sem informar que o intervalo é inválido.
Provável causa: Os quatro campos não possuem limites cruzados e `doSearch` copia os filtros sem validação; `normalizeLoadControlFilters` apenas remove espaços e repassa os pares contraditórios ao RPC.

RESOLVIDO

###############

Bug 485

Sintoma: Uma importação com mais de cinco erros informa o total, mas revela somente os cinco primeiros e não oferece expansão ou arquivo de diagnóstico; o usuário não consegue localizar e corrigir todas as linhas rejeitadas pela tela.
Provável causa: O painel renderiza deliberadamente `preview.errors.slice(0, 5)` e não disponibiliza detalhe do lote, paginação, download ou outro acesso ao restante de `preview.errors`.

RESOLVIDO

###############

Bug 486

Sintoma: Ao aplicar novos filtros na Consulta CT-e, os filtros já aparecem ativos enquanto a tabela ainda contém o resultado anterior; nesse intervalo é possível exportar, baixar, cancelar, reenviar ou excluir documentos do filtro antigo acreditando agir sobre o novo.
Provável causa: `useCteSearch` usa `placeholderData: prev => prev`, mas a página não observa `isPlaceholderData` nem desabilita ações durante `isFetching`. A chave/filtros mudam imediatamente e os dados anteriores permanecem totalmente interativos até a consulta terminar.

RESOLVIDO

###############

Bug 487

Sintoma: Se a nova consulta de CT-e falhar, a página pode continuar exibindo KPIs e linhas da consulta anterior ao lado do aviso de erro, permitindo exportar ou operar sobre dados obsoletos como se fossem a resposta parcial do filtro atual.
Provável causa: O mesmo `placeholderData` preserva o array anterior, e `searchError` apenas adiciona um cartão de erro; tabela, totais e botões continuam derivados de `rowsData` sem invalidar ou identificar visualmente o conteúdo antigo.

RESOLVIDO

###############

Bug 488

Sintoma: A Consulta CT-e aceita emissão inicial posterior à final e retorna nenhum documento, sem indicar que o intervalo é inválido.
Provável causa: Os inputs aplicam cada data imediatamente e não possuem `min`/`max` cruzados nem validação; o backend e `matchesDateRange` apenas combinam os dois limites contraditórios.

RESOLVIDO

###############

Bug 489

Sintoma: Depois de selecionar uma cidade no filtro da Consulta CT-e, as demais cidades desaparecem do seletor; para trocar diretamente para outra, o usuário precisa voltar a “Todas”, aguardar nova consulta e só então escolher a próxima.
Provável causa: As opções e contagens de `cities` são recalculadas a partir de `rows`, que já está filtrado por `recipientCity`, em vez de um catálogo independente ou do resultado sem esse filtro.

RESOLVIDO

###############

Bug 490

Sintoma: CT-es rejeitados exibem a ação “Cancelar CT-e” e permitem iniciar um pedido de cancelamento para um documento que nunca foi autorizado, terminando apenas em erro do provedor ou do backend.
Provável causa: A condição do botão inclui explicitamente `r.sefaz_status === 'rejected'` sempre que há `hub_document_id`, sem limitar cancelamento aos estados fiscalmente autorizados.

RESOLVIDO

###############

Bug 491

Sintoma: Ao excluir um rascunho de CT-e com erro, uma falha após a liberação das NFs pode manter o rascunho existente enquanto as notas ficam disponíveis para outra emissão, abrindo caminho para duplicidade e estado contraditório.
Provável causa: No fallback de `useDeleteFailedCTe`, o frontend primeiro atualiza separadamente todas as `fiscal_documents` para limpar os vínculos e só depois executa o `delete` em `cte_documents`. Não há RPC transacional nem compensação se a segunda chamada falhar.

RESOLVIDO

###############

Bug 492

Sintoma: Abrir o CSV da Consulta CT-e em uma planilha pode executar fórmulas originadas de nomes, referências ou outros campos importados que comecem com `=`, `+`, `-` ou `@`.
Provável causa: O exportador local `toCsv` apenas envolve os valores em aspas e duplica aspas internas; ao contrário de exportadores corrigidos que usam `csvSafeCell`, não neutraliza prefixos interpretados como fórmula pelo Excel/Calc.

RESOLVIDO

###############

Bug 493

Sintoma: Após uma atualização automática mudar quais CT-es possuem arquivo, “Selecionar todos” pode aparecer marcado para um conjunto diferente do selecionado e o botão “Limpar seleção” pode ser mostrado mesmo com documentos atuais desmarcados.
Provável causa: O estado `checked` sobrevive aos refetches/polling e a seleção global é inferida apenas por `checked.size === downloadableRows.length`, sem conferir se os IDs dos dois conjuntos são os mesmos nem reconciliar IDs removidos.

RESOLVIDO

###############

Bug 494

Sintoma: A Central de CT-e pode abrir completamente vazia quando recebe um parâmetro `?tab=` desconhecido ou digitado incorretamente, sem redirecionar para uma aba válida.
Provável causa: `CteHubPage` aceita qualquer texto da URL como `activeTab`; o componente controlado não valida o valor contra `faturamento`, `monitor` e `consulta`, portanto nenhum `TabsContent` corresponde.

RESOLVIDO

###############

Bug 495

Sintoma: Trocar de aba na Central de CT-e não atualiza a URL; recarregar, compartilhar o link ou usar o histórico do navegador pode voltar para a aba indicada anteriormente na query string, e não para a aba que o usuário escolheu.
Provável causa: `onValueChange` altera somente o estado local com `setActiveTab`. Há um efeito URL → estado, mas nenhum fluxo estado → `searchParams`/navegação para manter o endereço sincronizado.

RESOLVIDO

###############

Bug 496

Sintoma: Clicar em “Limpar filtros” na Consulta de NFS-e não volta a mostrar todos os documentos; rascunhos, rejeições, processamentos e cancelamentos continuam ocultos sem que o usuário tenha escolhido esse recorte novamente.
Provável causa: O manipulador do botão redefine `statusFilter` para `issued`, e não para `all`, embora limpe os demais campos e o próprio rótulo prometa remover os filtros.

RESOLVIDO

###############

Bug 497

Sintoma: A Consulta de NFS-e aceita uma data inicial posterior à final e apresenta a lista vazia, sem avisar que o intervalo de emissão é inválido.
Provável causa: Os inputs não têm limites cruzados nem validação de ordem; o filtro local exige ao mesmo tempo `issue_date >= dateFrom` e `issue_date <= dateTo`, combinação impossível quando o período está invertido.

RESOLVIDO

###############

Bug 498

Sintoma: Depois de selecionar NFS-e, alterar a busca textual e clicar no checkbox geral pode limpar a seleção em vez de selecionar todas as notas do resultado atual, mesmo quando nenhuma delas estava marcada.
Provável causa: A busca não limpa `checked`, e o toggle do cabeçalho decide entre marcar e desmarcar comparando apenas `prev.size` com `downloadable.length`. IDs selecionados mas escondidos pela nova busca contam nessa comparação, sem conferir a interseção entre os conjuntos.

RESOLVIDO

###############

Bug 499

Sintoma: NFS-e rejeitadas, com erro ou ainda em estados não autorizados exibem a ação “Cancelar”; a operação pode tentar cancelar no provedor um documento fiscal que nunca foi autorizado ou falhar somente depois de o usuário informar a justificativa.
Provável causa: A tabela mostra o botão para qualquer status diferente de `cancelled`. `useCancelNFSe` também chama `cancelNFSe` sempre que encontra uma emissão com `hub_document_id`, sem restringir a ação a estados efetivamente canceláveis.

RESOLVIDO

###############

Bug 500

Sintoma: Usar “Recuperar” em uma NFS-e definitivamente rejeitada retransmite o mesmo RPS e o mesmo snapshot fiscal que o provedor já recusou, em vez de exigir um novo rascunho corrigido.
Provável causa: A ação é oferecida explicitamente para `status === 'rejected'`, e `useResendNFSe` reaproveita o `request_payload` da última emissão sem chamar `assertNFSeBatchRetryable`. Essa proteção existe no fluxo em lote e documenta que uma rejeição definitiva deve gerar novo RPS, mas não é aplicada ao reenvio individual.

RESOLVIDO

###############

Bug 501

Sintoma: Rascunhos de NFS-e que nunca foram transmitidos podem acumular tentativas de consulta automática e acabar enviados para dead letter como se tivessem perdido a referência do provedor.
Provável causa: `nfse-status-poll` inclui `draft` no array `PENDING`. Para cada rascunho, procura uma linha em `hub_fiscal_emissions`; como ela legitimamente não existe antes da emissão, registra `MISSING_PROVIDER_REFERENCE`, incrementa `status_check_attempts` e eventualmente chama `terminalizeFiscalPoll`.

RESOLVIDO

###############

Bug 502

Sintoma: “Consultar status” pode verificar somente parte das NFS-e pendentes e ainda apresentar a quantidade consultada como se representasse toda a fila; em uma fila grande, as demais notas permanecem sem resposta nesta execução sem qualquer aviso na tela.
Provável causa: `nfse-status-poll` aplica `MAX_DOCS = 50` tanto à chamada manual do tenant quanto ao cron global. A resposta não informa o total restante ou truncamento por limite, e a interface exibe apenas `checked` como “nota(s) ainda em processamento”.

RESOLVIDO

###############

Bug 503

Sintoma: Uma consulta manual interrompida por rate limit ou indisponibilidade do provedor pode ser anunciada como sucesso, por exemplo “1 NFS-e com status atualizado”, embora nenhuma nota tenha recebido um desfecho fiscal e o restante do lote nem tenha sido consultado.
Provável causa: O poll encerra o loop no primeiro HTTP 429/5xx e devolve `partial`/`stopped_reason`, mas a página ignora esses campos. Além disso, `useSyncNFSeStatus` conta como resolvido todo `outcome` diferente de `pending`, incluindo `rate_limited`, `provider_unavailable`, `disabled`, `no_hub_document` e `reconciliation_required`.

RESOLVIDO

###############

Bug 504

Sintoma: Ao abrir o formulário de NFS-e a partir de uma carga, uma falha ao consultar as NF-es da carga aparece como “Nenhuma NF encontrada”, impedindo distinguir indisponibilidade do banco de uma carga realmente vazia.
Provável causa: A query `nfse_load_docs` descarta o campo `error` retornado pelo Supabase e devolve `data || []`; o componente também consome apenas `data`, sem estado de erro ou ação de nova tentativa.

RESOLVIDO

###############

Bug 505

Sintoma: O painel de NFS-e de uma carga informa “Nenhuma NFS-e gerada para esta carga” quando a consulta falha, ocultando documentos existentes e oferecendo a criação de outra nota como se a carga estivesse vazia.
Provável causa: `NFSePanel` substitui imediatamente o resultado de `useNFSeList({ loadId })` por `[]` e não consome `isLoading`, `isError` ou `error`; falha e ausência real recebem exatamente a mesma interface.

RESOLVIDO

###############

Bug 506

Sintoma: No formulário “Nova NFS-e” aberto dentro de uma carga, trocar o ambiente fiscal pode apagar todos os campos e itens já preenchidos e restaurar os valores iniciais; um refetch ou outra atualização do painel pai pode provocar a mesma perda silenciosa.
Provável causa: `NFSePanel` cria um novo objeto literal para a prop `initial` em toda renderização. `NFSeFormDialog` inclui esse objeto nas dependências do efeito que reinicializa formulário, itens e seleção; `onEnvironmentChange` atualiza estado no painel pai, produz nova referência e dispara a reinicialização enquanto o diálogo está aberto.

RESOLVIDO

###############

Bug 507

Sintoma: Uma NFS-e definitivamente rejeitada pode ser emitida novamente com o mesmo RPS pelo painel da carga, embora o assistente em lote exija descartar a tentativa e criar um novo RPS após uma rejeição fiscal.
Provável causa: `NFSePanel` mostra o botão “Emitir” tanto para `draft` quanto para `rejected` e chama diretamente `useIssueNFSe`. Esse caminho não executa `assertNFSeBatchRetryable`, reconstrói o payload do mesmo documento rejeitado e o envia novamente com a mesma identidade fiscal.

RESOLVIDO

###############

Bug 508

Sintoma: Uma falha ao carregar as cargas pendentes no Planejamento de Rotas aparece como “Nenhuma carga pendente para roteirização”, levando o operador a acreditar que a fila está vazia e a procurar ou importar dados desnecessariamente.
Provável causa: A página consome apenas `data` e `isLoading` da query `pending_loads_for_routing`, substitui dados ausentes por `[]` e não renderiza `isError`, `error` nem uma tentativa de recarga.

RESOLVIDO

###############

Bug 509

Sintoma: O Planejamento de Rotas pode omitir cargas, itens ou endereços, ou falhar completamente, quando existem muitas cargas planejadas; mesmo antes de renderizar, uma única consulta pode exceder limites de URL e resposta do PostgREST.
Provável causa: A query local busca todas as cargas sem paginação, envia todos os IDs de carga em um único `.in('load_id', loadIds)` e depois todos os IDs de cliente em outro `.in('id', clientIds)`. Não há particionamento, total, indicador de truncamento nem paginação da interface.

RESOLVIDO

###############

Bug 510

Sintoma: Clientes que já possuem endereço geocodificado e verificado continuam gerando paradas sem latitude/longitude no Planejamento de Rotas, obrigando o operador a selecionar novamente o ponto no mapa ou justificar uma exceção antes do despacho.
Provável causa: A página reimplementa a query de cargas e lê de `clients` somente campos textuais de endereço. Ela não usa `usePendingLoadsForRouting`, que chama `get_routing_client_locations_v1` e anexa `client_location`; por isso `consolidateLoadsIntoStops` recebe sempre `client_location` ausente e cria coordenadas nulas.

RESOLVIDO

###############

Bug 511

Sintoma: Rotas não despachadas salvas anteriormente podem deixar de ser restauradas de forma intermitente ao abrir o Planejamento de Rotas, especialmente quando as cargas terminam de carregar antes dos rascunhos.
Provável causa: A página trata `persistedDrafts = []` como resultado definitivo sem observar o carregamento/erro dessa query. Assim que `pendingLoads` fica disponível, o efeito vê o array de rascunhos ainda vazio, define `draftsHydratedRef.current = true` e nunca reexecuta a hidratação quando os rascunhos chegam.

RESOLVIDO

###############

Bug 512

Sintoma: Alterações em uma rota planejada podem não ser salvas e desaparecer ao sair da página sem qualquer aviso, apesar de a tela aparentar ter salvamento automático.
Provável causa: `useRoutePlanAutosave` agenda a gravação somente após 1,5 segundo e cancela o timer no unmount, sem flush em navegação/fechamento. Além disso, o `onError` só reage a `DraftConflictError`; falhas de rede, permissão ou banco na gravação automática são silenciosamente ignoradas.

RESOLVIDO

###############

Bug 513

Sintoma: Um clique duplo em “Despachar rotas prontas” pode iniciar duas execuções concorrentes do lote, produzindo salvamentos conflitantes, contagens/resumos divergentes e mensagens de falha mesmo quando uma das execuções despachou a rota.
Provável causa: `dispatchAllValid` não possui estado `batchBusy`, e o botão é desabilitado apenas por `dispatchRouteMutation.isPending`, mutation que não é usada no fluxo em lote. As duas execuções chamam `savePlanSnapshot.mutateAsync` para as mesmas rotas antes de chegar à proteção idempotente do outbox.

RESOLVIDO

###############

Bug 514

Sintoma: Depois de um despacho individual confirmado, a aplicação pode pedir ao usuário que exclua o rascunho recém-despachado e até mostrar erro de conflito/exclusão após já anunciar “Rota despachada”.
Provável causa: O `onSuccess` de `dispatchRouteMutation` chama `removeRoute(route.id)`. Essa função não é uma simples remoção local: abre uma confirmação e tenta executar `delete_route_planning_draft_v1`, embora o RPC de despacho já tenha convertido/removido o rascunho; a chamada ainda não é aguardada antes do toast e da navegação.

RESOLVIDO

###############

Bug 515

Sintoma: O planejamento pode aplicar ao cliente uma janela de entrega pertencente a outro dia da semana, alterando horários previstos e sinalizações de risco de forma não determinística.
Provável causa: `useCustomerDeliveryWindowsForRouting` busca todas as janelas ativas, ignora `weekday` e guarda somente a primeira linha encontrada por cliente em um `Map`. A consulta não ordena as linhas nem compara o dia da rota com o dia configurado.

RESOLVIDO

###############

Bug 516

Sintoma: Após selecionar cargas e trocar o filtro de destino, o checkbox “Selecionar todas as cargas visíveis” pode aparecer marcado para cargas diferentes das selecionadas e, ao clicar, limpar toda a seleção em vez de marcar o resultado atual.
Provável causa: O estado mantém IDs fora do filtro e tanto o indicador quanto `selectAll` comparam apenas `selectedLoads.size === filteredLoads.length`. A lógica não verifica se os IDs selecionados são exatamente os IDs visíveis.

RESOLVIDO

###############

Bug 517

Sintoma: Falhas de leitura na Realocação de Cargas parecem ausência de dados: os seletores podem ficar vazios, uma carga pode aparecer com “Nenhum item” e os agrupamentos podem cair em “Sem cliente identificado/Sem cidade”, sem revelar a indisponibilidade nem oferecer nova tentativa.
Provável causa: A página substitui por `[]` os resultados de `useLoads`, `useVehicles`, `useLoadItems` e `reallocation_load_meta`, mas consome somente os estados de carregamento dos itens. `isError`/`error` dessas consultas nunca são exibidos.

RESOLVIDO

###############

Bug 518

Sintoma: Com muitas cargas ativas, os seletores de realocação podem agrupar várias cargas sob cliente/cidade incorretos ou genéricos e omitir metadados de itens mais antigos, sem indicar resultado parcial.
Provável causa: `reallocation_load_meta` envia todos os IDs de carga em um único `.in('load_id', activeLoadIds)` e faz apenas um `select`, sem paginação ou particionamento. O limite de resposta do PostgREST pode truncar `load_items`, e um array grande também pode exceder o limite da URL.

RESOLVIDO

###############

Bug 519

Sintoma: É possível mover itens para uma carga cujo veículo ficará acima do limite de paletes ou peso; a tela só mostra a barra vermelha depois da sobrecarga e ainda confirma a realocação como bem-sucedida.
Provável causa: `LoadColumn` calcula `isOverPallet` e `isOverWeight` exclusivamente para apresentação. `handleMoveItems`, `useMoveLoadItems` e `move_load_items_between_loads` não comparam a composição resultante com `vehicles.max_pallets` ou `max_weight_kg` antes de confirmar a mudança.

RESOLVIDO

###############

Bug 520

Sintoma: Ao mover todos os itens de uma carga planejada ainda sem viagem, a carga de origem vazia permanece ativa e reaparece nos seletores, em vez de ser removida como ocorre no fluxo equivalente já vinculado a uma viagem.
Provável causa: `move_load_items_between_loads` chama `delete_load_if_empty` somente dentro de `if v_source_trip is not null`. Para a realocação comum entre cargas ainda não despachadas, o RPC atualiza todos os itens, pula a limpeza, devolve `source_removed = false` e preserva a carga vazia.

RESOLVIDO

###############

Bug 521

Sintoma: Ao trocar página ou filtros no Controle Fiscal, a interface pode continuar mostrando os documentos da consulta anterior sob os novos filtros; nesse intervalo ainda é possível expandir uma linha e alterar o status do documento antigo acreditando operar no novo resultado.
Provável causa: `useFiscalDocumentsPage` usa `placeholderData: previous => previous`, mas a página não observa `isPlaceholderData`/`isFetching`, não identifica as linhas como obsoletas e não desabilita suas ações enquanto a nova consulta está em andamento.

RESOLVIDO

###############

Bug 522

Sintoma: Buscar documentos pelo nome de um cliente pode omitir resultados quando mais de 100 clientes correspondem ao texto, embora a paginação indique uma contagem exata apenas do subconjunto encontrado.
Provável causa: Antes da consulta fiscal, `useFiscalDocumentsPage` procura IDs de clientes com `.limit(100)` e coloca somente esses IDs no filtro `client_id.in(...)`. Clientes correspondentes fora dos primeiros 100 não são considerados, a menos que o mesmo texto também apareça em número, remetente, destinatário ou chave.

RESOLVIDO

###############

Bug 523

Sintoma: Um operador pode mudar livremente um documento fiscal de confirmado para cancelado, de cancelado de volta para confirmado ou para qualquer outro estado exposto, mesmo quando ele já está vinculado a carga, viagem ou emissão; filas e relatórios passam a divergir do histórico operacional/fiscal.
Provável causa: Cada linha oferece todos os valores de `DOC_STATUSES` exceto o atual, e `useUpdateFiscalDocument` executa um `update` direto em `fiscal_documents.status`. Não há máquina de transição, validação de vínculos, motivo, evento de auditoria nem efeitos atômicos equivalentes aos comandos operacionais de cancelamento/reabertura.

RESOLVIDO

###############

Bug 524

Sintoma: O Controle Fiscal permite criar um documento praticamente vazio — sem número, chave, cliente, remetente, destinatário ou data — que passa a contar nos indicadores e pode entrar em fluxos operacionais sem identidade fiscal suficiente.
Provável causa: Embora o formulário marque apenas o tipo como obrigatório, o botão “Salvar” não valida nenhum campo antes de chamar `useCreateFiscalDocument`; o hook repassa o objeto diretamente ao `insert` e não exige chave de acesso nem identidade composta mínima.

RESOLVIDO

###############

Bug 525

Sintoma: Clicar repetidamente em “Salvar” enquanto um novo documento fiscal está sendo criado pode enviar várias inserções; documentos sem identidade única ou de tipos não protegidos podem ser duplicados e toasts de respostas concorrentes podem se contradizer.
Provável causa: `DocForm` não recebe `createDoc.isPending`, o botão permanece habilitado durante `mutateAsync` e não existe trava local ou chave idempotente para o comando de criação.

RESOLVIDO

###############

Bug 526

Sintoma: Se os catálogos de clientes ou pedidos falharem ao carregar, o formulário de novo documento mostra os dois seletores vazios como se não existissem cadastros e ainda permite salvar o documento sem esses vínculos.
Provável causa: A página desestrutura somente `data` de `useClients` e `useOrders`, aplica `[]` como fallback e não repassa estados de carregamento/erro ao formulário nem bloqueia a gravação até distinguir catálogo vazio de consulta indisponível.

RESOLVIDO

###############

Bug 527

Sintoma: A página “Endereços para validar” pode afirmar que todos os endereços estão resolvidos e esconder pendências reais quando existe um histórico grande de resoluções; os três indicadores também representam no máximo uma fração da fila.
Provável causa: A página chama `get_address_resolution_queue_v1` com `_status: null` e `_limit: 200`. O RPC inclui também itens `resolved` e `ignored` no corte ordenado, enquanto `parseQueue` descarta esses estados somente depois do retorno; registros históricos podem ocupar as 200 posições e expulsar pendências, ambiguidades e erros ainda ativos.

RESOLVIDO

###############

Bug 528

Sintoma: Quando a consulta da fila de endereços falha, a tela exibe simultaneamente “Não foi possível carregar a fila” e o cartão verde “Todos os endereços estão resolvidos”, transmitindo duas conclusões incompatíveis.
Provável causa: Após o erro, `items` recebe `queue.data || []`; o estado vazio de sucesso verifica apenas `!queue.isLoading && items.length === 0` e não exclui `queue.isError`/`queue.error`.

RESOLVIDO

###############

Bug 529

Sintoma: Uma resposta parcialmente incompatível da fila pode fazer itens desaparecerem silenciosamente e reduzir os indicadores, chegando a mostrar “Todos os endereços estão resolvidos” mesmo quando o servidor retornou registros que a interface não conseguiu interpretar.
Provável causa: `parseQueue` usa `flatMap` e simplesmente devolve `[]` para qualquer linha com ID, entidade, endereço ou status inesperado; não há validação do envelope, contagem de linhas descartadas nem erro quando toda ou parte da resposta é rejeitada pelo parser.

RESOLVIDO

###############

Bug 530

Sintoma: A Central de Operações classifica como “atrasada (&gt;24h)” qualquer carga ativa sem atualização recente, mesmo que esteja planejada legitimamente para uma data futura; ao mesmo tempo, uma carga realmente atrasada deixa de contar se qualquer edição incidental atualizar o registro.
Provável causa: O indicador aplica apenas `status` não entregue/cancelado e `loads.updated_at < agora - 24h`. Não compara horário programado, previsão de chegada, prazo operacional nem eventos de progresso; `updated_at` mede alteração do registro, não atraso da operação.

RESOLVIDO

###############

Bug 531

Sintoma: Documentos fiscais excluídos logicamente continuam entrando nos KPIs de NF-e/CT-e, valores, receita de frete e gráfico diário da Central de Operações.
Provável causa: A query `ops_fiscal` consulta `fiscal_documents` sem `.is('deleted_at', null)`. O Controle Fiscal e outros leitores excluem essas linhas, mas o dashboard agrega diretamente o recorte que ainda contém soft-deleted.

RESOLVIDO

###############

Bug 532

Sintoma: O gráfico “Distribuição por Destino” da Central de Operações inclui cargas canceladas, embora os cartões de cargas ativas e atrasadas as excluam; os painéis da mesma tela passam a representar universos diferentes sem deixar isso claro.
Provável causa: `destChart` filtra somente `status !== 'delivered'`, enquanto `activeLoadSample` e as contagens exatas removem simultaneamente `delivered` e `cancelled`.

RESOLVIDO

###############

Bug 533

Sintoma: Mantendo a Central de Operações aberta, cargas e alertas se atualizam a cada 30 segundos, mas documentos fiscais, incidentes, viagens, despesas e manutenção podem permanecer indefinidamente com os valores da abertura da página, produzindo um painel temporalmente inconsistente.
Provável causa: Apenas `ops_loads` e `ops_alerts` definem `refetchInterval`. As demais queries próprias da central não possuem polling, assinatura realtime ou invalidação periódica, apesar de seus números serem exibidos lado a lado como visão operacional corrente.

RESOLVIDO

###############

Bug 534

Sintoma: Assim que existe ao menos uma viagem ativa, a Torre de Controle pode ficar inteiramente indisponível, ocultar todas as viagens e mostrar erro de consulta mesmo que o RPC tenha respondido com linhas.
Provável causa: A redefinição mais recente de `get_active_trips_live` deixou de retornar campos obrigatórios pelo contrato do frontend, entre eles `tenant_id`, `trip_status` e `tracking_enabled`. `readTowerTrips` valida cada linha com Zod e rejeita o array completo quando qualquer um desses campos está ausente.

RESOLVIDO

###############

Bug 535

Sintoma: Alertas automáticos abertos de desvio de rota, falta de sinal, atraso ou veículo parado deixam de aparecer na Torre de Controle, embora continuem registrados como abertos no banco.
Provável causa: `get_open_trip_alerts` filtra esses tipos exigindo `(t->>'tracking_enabled')::boolean` e `t->>'trip_status'` nas linhas produzidas por `get_active_trips_live`; a versão atual desse RPC não inclui nenhum dos dois campos, de modo que a condição nunca é verdadeira.

RESOLVIDO

###############

Bug 536

Sintoma: Viagens efetivamente em trânsito podem desaparecer da Torre de Controle enquanto viagens ainda apenas planejadas ou em carregamento continuam sendo listadas.
Provável causa: A versão mais recente de `get_active_trips_live` filtra `dispatch_trips.status` por `planned`, `loading`, `dispatched` e `in_progress`, mas omite o estado canônico `in_transit` que a versão anterior e os filtros de alertas tratam como ativo.

RESOLVIDO

###############

Bug 537

Sintoma: A Torre de Controle pode posicionar um veículo no mapa usando uma coordenada antiga e rotulá-lo como “Em rota”, mesmo com o rastreamento SSX desativado ou sem sinal recente válido.
Provável causa: A redefinição atual de `get_active_trips_live` removeu a leitura das políticas `ssx_enabled`/`ssx_kill_switch` e a janela de frescor de 15 minutos; ela expõe diretamente `positions_last.lat/lng` e usa `coalesce(tls.state, 'normal')` sem validar idade, revisão ou contexto da posição.

RESOLVIDO

###############

Bug 538

Sintoma: As paradas pendentes não são desenhadas no mapa da Torre de Controle, ainda que tenham coordenadas válidas cadastradas.
Provável causa: `ControlTowerMap` só cria o marcador quando `pending_stops` contém `latitude` e `longitude`, mas a versão atual de `get_active_trips_live` deixou de selecionar esses campos nas subconsultas de paradas.

RESOLVIDO

###############

Bug 539

Sintoma: Uma falha ao consultar o catálogo de Rotas Operacionais é apresentada como “Nenhuma rota encontrada”, podendo levar o operador a cadastrar novamente rotas que já existem.
Provável causa: `OperationalRoutesPage` extrai apenas `data` e `isLoading` de `useOperationalRoutes`; quando a query entra em erro, o valor padrão `routes = []` aciona o mesmo estado vazio usado para uma consulta bem-sucedida, sem renderizar `isError` ou a mensagem da falha.

RESOLVIDO

###############

Bug 540

Sintoma: Editar apenas o nome, a descrição ou o status de uma Rota Operacional pode apagar silenciosamente a periodicidade e os dias da semana configurados individualmente para cada destino.
Provável causa: O banco permite objetos de destino com `periodicity` e `weekdays`, porém `openEdit` reduz cada objeto ao texto `name` e `handleSave` reconstrói todo o array somente como `{ name }`, descartando os demais metadados.

RESOLVIDO

###############

Bug 541

Sintoma: Um registro inativo de rota com `destinations` legado ou malformado pode derrubar toda a página de Rotas Operacionais em vez de isolar a linha inválida e avisar sobre o dado incompatível.
Provável causa: O leitor genérico valida apenas identificadores, tenant e data de criação, depois força o resultado para `OperationalRoute[]`; a página chama diretamente `row.destinations.map`, `forEach` e `slice` sem validar que o JSON recebido é um array. A proteção do banco exige array apenas para rotas ativas.

RESOLVIDO

###############

Bug 542

Sintoma: Em uma operação com muitas viagens, “Calcular todas” pode provocar uma rajada de requisições ao serviço de rotas, causar bloqueios/conflitos e transformar parte do lote em falhas por indisponibilidade ou limite do provedor.
Provável causa: `handleCalculateAll` cria uma promessa para cada viagem e entrega todas de uma vez a `Promise.allSettled`, sem tamanho de lote, limite de concorrência, espera entre chamadas, backoff ou coordenação com a capacidade do OSRM e da Edge Function.

RESOLVIDO

###############

Bug 543

Sintoma: Não é possível criar o primeiro acerto manual de um motorista que ainda não possui nenhum acerto; ele não aparece no seletor do diálogo “Novo acerto manual”.
Provável causa: O diálogo reutiliza `useDriverSettlementFilterOptions`, e o RPC `list_driver_settlement_filter_options` só inclui motoristas para os quais já existe uma linha em `driver_settlements`. Um cadastro novo fica fora do catálogo justamente até receber seu primeiro acerto.

RESOLVIDO

###############

Bug 544

Sintoma: Informar no Acerto de Motoristas uma data inicial posterior à final produz apenas uma lista vazia e “Nenhum acerto encontrado”, sem avisar que o intervalo é inválido.
Provável causa: A página envia `dateFrom` e `dateTo` sem comparar os campos, e `list_driver_settlements` aplica simultaneamente `trip_completed_at >= _date_from` e `< _date_to + 1 day`; o RPC também não rejeita a inversão, portanto o intervalo impossível é indistinguível de uma busca válida sem resultados.

RESOLVIDO

###############

Bug 545

Sintoma: “Gerar / Recalcular pendentes” pode informar apenas quantos acertos foram criados, recalculados e ignorados mesmo quando algumas viagens falharam, induzindo o operador a acreditar que o processamento terminou sem pendências técnicas.
Provável causa: `useGeneratePendingDriverSettlements` extrai o array `errors` retornado pelo RPC, mas o callback de sucesso não o exibe, não muda o toast para erro parcial e não oferece acesso aos itens que falharam.

RESOLVIDO

###############

Bug 546

Sintoma: Ao navegar pelas páginas de acertos, linhas podem se repetir ou ser puladas quando dois registros têm os mesmos horários ou quando novos acertos são gerados durante a navegação.
Provável causa: `list_driver_settlements` usa paginação por `OFFSET` e ordena somente por `trip_completed_at` e `created_at`, sem um ID como desempate estável e sem snapshot; empates e inserções entre requisições alteram as fronteiras das páginas.

RESOLVIDO

###############

Bug 547

Sintoma: A tela de Custódia de cargas e viagens deixa de abrir para a empresa inteira quando o histórico ultrapassa 5.000 dossiês, em vez de continuar mostrando páginas do histórico.
Provável causa: `list_trip_cargo_controls_v1` agrega todas as custódias em um único JSON sem paginação nem limite, enquanto o parser do cliente rejeita `items` com mais de 5.000 elementos; um registro adicional invalida a resposta completa.

RESOLVIDO

###############

Bug 548

Sintoma: Um único dossiê grande pode ficar impossível de abrir quando acumula mais de 100 cargas, 2.000 documentos, 100 lacres, 200 evidências ou 500 divergências, embora os dados continuem válidos no banco.
Provável causa: `trip_cargo_snapshot` agrega integralmente todas as coleções sem paginação, mas `availableSchema` impõe máximos fixos a cada array. Ultrapassar qualquer teto faz `getTripCargoControl` rejeitar todo o snapshot como resposta inválida.

RESOLVIDO

###############

Bug 549

Sintoma: Uma divergência já aprovada, resolvida ou rejeitada pode ser revisada novamente para qualquer outro estado, inclusive depois de a custódia ter sido encerrada, deixando um dossiê fechado novamente com divergência pendente/rejeitada.
Provável causa: A página oferece “Revisar” para todas as divergências independentemente do estado do controle, e `private.review_trip_cargo_divergence` atualiza qualquer linha para `approved`, `rejected` ou `resolved` sem validar o estado anterior nem impedir alterações quando a custódia está `departed`, `returned` ou `closed`.

RESOLVIDO

###############

Bug 550

Sintoma: É possível encerrar uma custódia com lacre instalado ainda sem baixa ou com lacre rompido/ausente sem motivo, conferência e evidência final, contrariando a mensagem exibida na própria tela.
Provável causa: O botão só bloqueia localmente quando encontra `status === 'installed'` e não verifica `resolved_at`, `resolution_reason` ou `resolution_evidence_id`; o RPC `close_trip_cargo_v1` não valida nenhum estado ou evidência de lacre, portanto a regra também pode ser contornada por chamada direta.

RESOLVIDO

###############

Bug 551

Sintoma: Após abrir um dossiê e trocar o filtro de situação, a tela pode continuar exibindo abaixo da lista um dossiê que não pertence ao filtro atual, fazendo parecer que o resultado filtrado contém aquela custódia.
Provável causa: A mudança de `status` atualiza apenas a query da lista; `tripId` e a query de detalhe permanecem ativos e não são limpos quando o item selecionado deixa de existir em `list.data.items`.

RESOLVIDO

###############

Bug 552

Sintoma: Depois de abrir uma nova tentativa de reentrega ainda sem chegada, o Histórico do POD pode alertar “Chegada sem resultado canônico” como se a tentativa atual já tivesse chegado, usando na verdade a chegada de uma tentativa antiga.
Provável causa: `get_operator_pod_history_v1` calcula `arrival_without_outcome` procurando qualquer alocação histórica da NF com `actual_arrival_at`, sem restringir `delivery_attempt_id` à tentativa atual; o texto da página, porém, atribui a situação à tentativa atual.

RESOLVIDO

###############

Bug 553

Sintoma: Em documentos do fluxo legado, o quadro “Alocação atual” pode mostrar uma parada antiga ou arbitrária quando a mesma NF passou por mais de uma viagem/parada.
Provável causa: O RPC marca como atual toda alocação cujo `delivery_attempt_id` seja `NULL` quando `current_delivery_attempt_id` também é `NULL`; a página usa o primeiro elemento encontrado com `is_current`, embora várias linhas possam satisfazer essa condição.

RESOLVIDO

###############

Bug 554

Sintoma: O Histórico do POD de uma NF pode listar como “Ocorrência vinculada” um problema que pertence a outro documento transportado na mesma parada, confundindo a auditoria individual do comprovante.
Provável causa: A consulta inclui toda `operational_events` cujo `dispatch_stop_id` esteja entre as paradas da NF, mesmo que o evento não tenha `fiscal_document_id` nem `proof_of_delivery_id` apontando para ela; uma ocorrência genérica da parada é replicada no histórico de todos os documentos alocados ali.

RESOLVIDO

###############

Bug 555

Sintoma: O Histórico do POD fica progressivamente pesado e pode exceder limites de resposta/memória em uma NF com muitas tentativas, correções, comprovantes, realocações ou ocorrências, sem permitir consultar o histórico em partes.
Provável causa: `get_operator_pod_history_v1` agrega integralmente cinco coleções (`attempts`, `outcomes`, `proofs`, `allocations` e `occurrences`) em um único JSON, e a página renderiza toda a linha do tempo e todos os resultados sem paginação, limite ou carregamento incremental.

###############

Bug 556

Sintoma: Depois de registrar um lote de gastos ou durante qualquer atualização da consulta, os KPIs, centros de custo, tabela e paginação de “Gastos conferidos” desaparecem sem exibir um estado de carregamento, deixando apenas os filtros na tela até a resposta chegar.
Provável causa: `ExpenseWorkspace` força `page` para `undefined` sempre que `query.isFetching`, mas o aviso “Carregando gastos…” depende apenas de `query.isPending`; em um refetch com dados anteriores, `isFetching` é verdadeiro e `isPending` é falso, ocultando simultaneamente conteúdo e feedback.

RESOLVIDO

###############

Bug 557

Sintoma: Em “Extratos importados”, é possível deixar a data inicial posterior à final alterando “De” depois de preencher “Até”; ao filtrar, a tela mostra somente uma falha genérica de consulta e não informa qual campo precisa ser corrigido.
Provável causa: O atributo `min` existe apenas no campo “Até” e não revalida nem limpa esse valor quando “De” avança. O servidor rejeita `start_date > end_date` como `finance_invalid_statement_filters`, mas a página substitui qualquer erro por “Não foi possível consultar os extratos”.

RESOLVIDO

###############

Bug 558

Sintoma: Quando o catálogo de contas falha dentro do detalhe de um extrato, “Corrigir conta deste extrato” abre com um seletor vazio e sem mensagem ou opção de tentar novamente, parecendo que não existem outras contas ativas.
Provável causa: A query `finance-statement-reassign-accounts` trata e lança erros de paginação, mas `StatementHistoryDetail` usa apenas `accounts.data` para montar as opções e nunca renderiza `accounts.isError`, `accounts.error` ou um botão de `refetch`.

RESOLVIDO

###############

Bug 559

Sintoma: No “Frete Automático”, usar Voltar/Avançar do navegador depois de trocar de aba altera o parâmetro `?tab=` da URL, mas a tela pode continuar mostrando a aba anterior, deixando endereço e conteúdo em desacordo.
Provável causa: `FreightHub` usa o parâmetro somente para inicializar `useState`; ao contrário da central de CT-e, não existe efeito que sincronize mudanças posteriores de `useSearchParams` de volta para o estado `tab`.

RESOLVIDO

###############

Bug 560

Sintoma: No fluxo operacional do motorista, viagens elegíveis mais antigas que as 50 primeiras nunca aparecem no seletor “Viagem do gasto”, impossibilitando registrar um gasto nelas por essa tela.
Provável causa: `DriverOperationalExpenses` chama `useOperationalDriverExpenseSources(0, open)` com offset fixo zero e não renderiza controles de paginação, embora o RPC e o schema retornem páginas de no máximo 50 viagens e informem o total.

RESOLVIDO

###############

Bug 561

Sintoma: O “Histórico enviado” do fluxo operacional do motorista omite permanentemente despesas anteriores às 50 primeiras, sem contagem, aviso de recorte ou botão para consultar as próximas páginas.
Provável causa: A página chama `useDriverExpenseHistory(0)` com offset fixo e renderiza somente `history.data.rows`; o hook aceita offset e o servidor retorna no máximo 50 linhas, mas essa variante da tela não expõe paginação.

RESOLVIDO

###############

Bug 562

Sintoma: Quando o motorista ainda não enviou despesas, a tela informa “Nenhum gasto enviado nesta viagem” mesmo sem haver uma viagem selecionada e embora a seção represente o histórico geral do motorista, induzindo a procurar um filtro inexistente.
Provável causa: O estado vazio de `DriverOperationalExpenses` usa uma mensagem herdada de uma visão por viagem, enquanto `useDriverExpenseHistory(0)` consulta todas as despesas do motorista e não recebe o `source` selecionado no diálogo.

RESOLVIDO

###############

Bug 563

Sintoma: Ao desmarcar o compartilhamento de diagnóstico do aplicativo do motorista, a tela pode indicar imediatamente que ele está desativado mesmo se o servidor não confirmar a revogação, deixando o registro remoto da instalação ativo sem qualquer aviso.
Provável causa: O estado local é desligado antes da chamada `disable_driver_app_observability_v1`; erros e exceções dessa chamada são descartados por um `catch` vazio, não restauram o checkbox e não acionam `heartbeatError` nem mensagem de falha.

RESOLVIDO

###############

Bug 564

Sintoma: Na Auditoria financeira, é possível deixar “De” posterior a “Até” alterando a data inicial depois da final; ao filtrar, a tela exibe apenas “Não foi possível consultar a auditoria” e não orienta a corrigir o intervalo.
Provável causa: O `min` do campo final só restringe sua escolha no momento da edição e a página não valida a relação entre os dois valores no submit. O leitor rejeita filtros financeiros inválidos, mas todos os erros são apresentados pela mesma mensagem genérica.

RESOLVIDO

###############

Bug 565

Sintoma: A central de ORT pode abrir completamente vazia quando recebe um parâmetro `?tab=` desconhecido, sem selecionar “Consulta”, mostrar erro ou corrigir a URL.
Provável causa: `OrtManagement` usa qualquer texto da query string como valor inicial de `activeTab`; como o componente controlado só possui conteúdos para `consulta` e `geracao`, nenhum `TabsContent` corresponde ao valor inválido.

RESOLVIDO

###############

Bug 566

Sintoma: Trocar entre “Consulta” e “Geração” na central de ORT não atualiza a URL; recarregar ou compartilhar a página volta para a aba indicada originalmente em `?tab=` ou para “Consulta”, e o histórico do navegador não representa a navegação feita.
Provável causa: `onValueChange` chama apenas `setActiveTab`. A página lê `window.location.search` na montagem, mas nunca grava a aba escolhida com `useSearchParams` ou navegação equivalente.

RESOLVIDO

###############

Bug 567

Sintoma: Um usuário com papel `operator` vê “Auditoria de dados” no menu e consegue abrir a rota, mas a execução sempre termina com `not_authorized`, tornando a funcionalidade anunciada inutilizável para esse papel.
Provável causa: A navegação e `ProtectedRoute` liberam todas as funções internas para `owner`, `admin` e `operator`, enquanto `audit_data_consistency_v2` exige exclusivamente `is_tenant_admin(_tenant_id)`; a página não possui guarda de papel nem oculta o item para operadores.

RESOLVIDO

###############

Bug 568

Sintoma: Enquanto o histórico de MDF-e está carregando ou quando a consulta falha, os quatro cartões no topo exibem zero manifestos, zero em viagem, zero encerrados e zero requerendo atenção, embora esses valores não tenham sido confirmados.
Provável causa: `useMdfeHistory` é desestruturado com `data: manifests = []` e os totais são sempre calculados/renderizados sobre esse fallback; somente a área da tabela distingue `isLoading` e `error`.

RESOLVIDO

###############

Bug 569

Sintoma: Quando uma busca ou filtro de situação não encontra MDF-e, a tela afirma “Abra uma carga pronta para emitir o primeiro manifesto” e oferece “Ir para cargas”, mesmo que já existam diversos manifestos apenas fora do filtro atual.
Provável causa: O mesmo ramo `filtered.length === 0` atende tanto ao histórico realmente vazio quanto ao resultado vazio de filtros, sem verificar `manifests.length`, exibir quais filtros eliminaram os resultados ou oferecer limpá-los.

RESOLVIDO

###############

Bug 570

Sintoma: Ocorrências de “Cliente fechado ou recusa” e “Devolução” podem aparecer na aba “Informativos”, com ícone de alerta, em vez de serem tratadas como eventos finalizadores da entrega.
Provável causa: `FINAL_EVENT_TYPES` reconhece `refused` e `returned`, mas o próprio mapa de rótulos também admite os tipos efetivamente usados `client_refused` e `return`; esses aliases não estão no conjunto e caem automaticamente em `informativo`.

RESOLVIDO

###############

Bug 571

Sintoma: Buscar por cliente, NF ou evento pode informar “Nenhum evento encontrado” mesmo quando há correspondência em uma página mais antiga; as contagens “Todos”, “Finalizadores” e “Informativos” também aumentam conforme o usuário carrega páginas, sem avisar que são parciais.
Provável causa: `useDriverOperationalEventHistory` busca 50 itens por cursor, mas `DriverEvents` aplica busca, filtros e contagens somente sobre `eventHistory.items`, isto é, as páginas já carregadas no navegador; os critérios não são enviados ao RPC e não existe total por tipo.

###############

Bug 572

Sintoma: O detalhe de um evento pode indicar “Foto anexada” e “Assinado”, mas o motorista não consegue abrir, ampliar ou baixar nenhum dos comprovantes sinalizados.
Provável causa: `DriverEventDetail` consulta apenas metadados de `operational_events`; a seção “Comprovantes” renderiza blocos estáticos com base em `report_details.has_photo`/`has_signature` e não busca localizadores seguros, URLs assinadas nem fornece qualquer ação para visualizar os arquivos.

###############

Bug 573

Sintoma: Ao abrir ou atualizar o checklist online logo após uma mudança de turno, marcações do turno anterior podem reaparecer por alguns instantes e ficar interativas; uma ação rápida pode tentar salvar usando a revisão e o limite antigos, produzindo conflito ou levando marcações obsoletas para a fila offline.
Provável causa: `DriverChecklist` considera qualquer lista online vazia como ausência de dados e recorre ao `scopedSnapshot` (`status.preItems.length || !scopedSnapshot` e equivalente para o pós), além de reutilizar IDs e `boundaryId` do cache por `??`. A substituição do snapshot pela resposta vazia válida ocorre somente em um `useEffect` assíncrono após essa renderização, sem desabilitar os controles durante a reconciliação.

###############

Bug 574

Sintoma: Um checklist pré ou pós-viagem completo de um turno anterior pode liberar visualmente o início ou o encerramento de uma nova jornada; ao executar, o comando online é rejeitado apenas pelo servidor e o comando offline pode ficar posteriormente em “requer atenção”.
Provável causa: `DriverJourney` calcula `preCompleted` e `postCompleted` com um `OR` incondicional sobre a quantidade de itens do `operationalSnapshot`. O componente não compara `snapshot.checklist.*.boundaryId` com `checklist.preBoundaryId`/`postBoundaryId`, portanto um cache completo continua valendo mesmo quando a consulta online já identificou outro limite de turno e nenhum checklist válido depois dele.

###############

Bug 575

Sintoma: A página “Minhas Cargas” pode falhar por completo ao alcançar uma carga que tenha sido vinculada a mais de 100 viagens, impedindo inclusive a visualização das demais cargas válidas da mesma página.
Provável causa: `list_driver_loads_page_v1` agrega todos os registros de `dispatch_trip_loads` de cada carga sem limite ou paginação, enquanto `driverLoadHistory.loadSchema` impõe `.max(100)` ao array; `parseDriverLoadHistoryPage` rejeita a resposta inteira quando uma única carga ultrapassa esse teto.

###############

Bug 576

Sintoma: Abrir “Documentos fiscais” deixa de funcionar para uma carga com mais de 1.000 documentos associados, exibindo erro genérico apesar de todos os documentos continuarem válidos e acessíveis no banco.
Provável causa: `private.driver_read_load_fiscal` agrega integralmente NF-e, CT-e e NFS-e em `v_documents`, sem limite, cursor ou total; `parseDriverFiscalCatalog` rejeita qualquer catálogo cujo array exceda 1.000 itens, e a interface não oferece paginação para consultar o excedente.

###############

Bug 577

Sintoma: Viagens com muitas paradas podem exibir somente uma parte da rota em “Paradas” e “Entregas e Coletas”, calcular pendências/conclusões sobre essa amostra e ainda substituir o snapshot offline completo por uma lista truncada sem qualquer aviso.
Provável causa: As duas páginas consultam `dispatch_stops` com um único `.select(...).order(...)`, sem paginação, contagem ou detecção do limite de linhas da API. O array retornado é tratado como completo e é usado diretamente para regravar `DriverOperationalSnapshot` e, em `DriverStops`, também o snapshot legado da rota.

###############

Bug 578

Sintoma: Abrir “Entregas e Coletas” em uma viagem com muitas paradas pode gerar uma rajada de centenas ou milhares de requisições simultâneas, sofrer rate limit/timeout e deixar o cache de itens ou documentos fiscais indisponível para uso offline.
Provável causa: `deliveryItemsSnapshotQuery` executa um `Promise.all` com um `get_driver_delivery_items` para cada parada, enquanto `deliveryFiscalSnapshotQuery` inicia simultaneamente outro `Promise.all` com um snapshot fiscal por parada. Não há lote no backend, fila, limite de concorrência nem carregamento incremental.

###############

Bug 579

Sintoma: “CLIENTE RECUSOU” e “CLIENTE ESTAVA FORA” aparecem no grupo “Informativo”, embora ao enviar encerrem a tentativa como `refused` ou `failed`; o motorista recebe uma classificação que não corresponde à mudança definitiva produzida no status da entrega.
Provável causa: `DRIVER_DELIVERY_EVENTS` declara `cliente_recusou` e `cliente_estava_fora` com `category: 'informativo'`, mas `deliveryOutcome` mapeia as mesmas chaves para resultados terminais e `createDeliverySubmission` chama `driver_record_delivery_outcome` em vez do gravador de comunicações informativas.

RESOLVIDO

###############

Bug 580

Sintoma: Um evento meramente informativo, como “Outros”, “Solicitar desconto” ou “Atualizar boleto”, pode habilitar “Lançar evento” e só depois do clique falhar com “O snapshot fiscal desta parada não está disponível”, mesmo que esse tipo de comunicação não altere a entrega.
Provável causa: `canSubmit` exige itens e snapshot fiscal apenas quando `def.category === 'finalizador'`, mas `submitEvent` procura e exige incondicionalmente `deliveryFiscalSnapshotQuery`/cache para todo evento diferente de chegada. O backend `driver_record_delivery_note` não possui essa precondição fiscal, deixando validação visual, mutação e contrato remoto divergentes.

RESOLVIDO

###############

Bug 581

Sintoma: Em eventos que não exigem assinatura, o botão “Assinatura” informa que ela é opcional e orienta usar o quadro abaixo, mas nenhum quadro de assinatura é exibido e não há como anexá-la.
Provável causa: O botão de ação é renderizado para todos os eventos e rola até `sig-anchor`, enquanto `SignaturePad` só é montado quando `def.requiresSignature` é verdadeiro; a mensagem de assinatura opcional promete um controle que não existe nesse ramo.

RESOLVIDO

###############

Bug 582

Sintoma: Na tela de entregas, ao trocar para “Concluídas” o contador exibido na aba “Em Rota” passa a refletir a lista concluída; além disso, uma busca feita em “Em Rota” filtra as paradas abertas, mas continua exibindo abaixo todas as concluídas que não correspondem ao termo.
Provável causa: Existe um único `filteredStops`, cujo conteúdo muda conforme `tab`, e `DriverDeliveryStopList` o usa sempre como contagem de “Em Rota”. A seção adicional de concluídas usa `completedStops` sem aplicar `search`, embora seja renderizada dentro do mesmo resultado pesquisado.

RESOLVIDO

###############

Bug 583

Sintoma: Um motorista que perdeu o vínculo ou foi desativado em uma das empresas ainda pode receber viagens, paradas, clientes, veículo e carga dessa empresa por meio de uma jornada física compartilhada, desde que conserve um vínculo ativo em qualquer outro tenant da mesma pessoa.
Provável causa: O RPC `get_current_driver_journey_v1` é `SECURITY DEFINER` e autoriza a jornada com um único `exists` sobre qualquer `workspace_person_tenant_links` cujo motorista pertença ao usuário. Depois agrega todas as linhas de `physical_journey_trips` e `physical_journey_stops` sem exigir motorista ativo, membership ativo ou autorização do ator para cada `source_tenant_id` devolvido.

###############

Bug 584

Sintoma: Em uma jornada compartilhada entre empresas, o cartão de próximo destino e o mapa mostram somente as paradas da primeira viagem; se essa primeira viagem já terminou, a página pode ficar sem próximo destino embora uma viagem posterior da mesma jornada física ainda esteja ativa.
Provável causa: `DriverHome` define `primaryTrip = activeTrips[0]` antes de filtrar estados e, no ramo `multiTenantJourney`, reduz `physicalJourney.stops` a `stop.dispatch_trip_id === primaryTrip.id`. A ordenação global `journey_order` e as paradas das demais viagens nunca entram em `destinationStops`, `getNextDriverStop` nem no mapa.

###############

Bug 585

Sintoma: Na jornada compartilhada, expandir “Documentos fiscais” de uma carga pertencente a outra empresa falha ou consulta o escopo errado até que o motorista abra a viagem e troque manualmente o tenant ativo.
Provável causa: Os cartões de todas as viagens físicas renderizam `DriverLoadNotes` apenas com `loadId`; o componente obtém `_tenant_id` exclusivamente de `currentTenant`, ignorando `trip.tenant_id`. Diferentemente de `accessTrip`, a expansão do catálogo não chama `activateTenantId` nem recebe o tenant de origem da viagem.

###############

Bug 586

Sintoma: Mesmo estando online e sem viagem ativa, o motorista pode abrir “Nova Ocorrência” e registrar o fato contra a última viagem armazenada no aparelho, inclusive uma viagem já concluída, sem qualquer indicação de que está usando contexto antigo.
Provável causa: `DriverIssues` considera o snapshot compatível sempre que `trip?.id` está ausente (`!trip?.id || snapshot.tripId === trip.id`) e define `effectiveTripId` pelo `readLatest`. Um retorno bem-sucedido e nulo de `useActiveTrip` não invalida esse fallback de até sete dias, e o botão “Nova” só é desabilitado por erro de consulta, não pela ausência de uma viagem online atual.

###############

Bug 587

Sintoma: Ao tentar registrar uma despesa com um erro corrigível no formulário — por exemplo valor zero, comprovante ausente, motivo curto ou hodômetro inválido — o motorista não consegue apenas ajustar o campo e reenviar; precisa primeiro clicar em “Atualizar contexto da despesa”.
Provável causa: `ExpenseCreationForm.submit` envolve validações locais, montagem do contrato e envio remoto no mesmo `try/catch`, e qualquer exceção executa `setInvalidated(true)`. Como o botão final fica desabilitado quando `invalidated`, até erros produzidos pela regex ou pelo Zod local são tratados como se a viagem/acerto tivesse sofrido uma alteração concorrente.

RESOLVIDO

###############

Bug 588

Sintoma: Uma ação offline marcada como “Requer conferência” por conflito definitivo de jornada, checklist, ocorrência, despesa, autorização ou evidência pode permanecer para sempre na fila; o motorista não consegue corrigir, descartar ou concluir a revisão e novas sincronizações apenas repetem ou ignoram o mesmo impasse.
Provável causa: `DriverSyncPending` oferece ação de resolução somente para entregas com `delivery_fiscal_snapshot_changed`. Para todos os demais `needs_attention` renderiza apenas o erro; ao mesmo tempo chama `operationalQueue.recover(true)` e o replay de despesas percorre inclusive itens definitivos, enquanto o replay de entregas ignora conflitos não autorizativos. Não existe comando geral de revisão/remoção nem fluxo específico para esses estados.

###############

Bug 589

Sintoma: Trocar o parâmetro `?trip=` sem desmontar a página de custódia pode exibir temporariamente o dossiê da viagem anterior e levar fotos, divergência, resoluções de lacre ou uma chave idempotente pendente para a nova viagem, causando rejeições por evidência fora do escopo ou conflito de pedido.
Provável causa: O efeito de leitura não limpa `cachedCargo` antes de buscar o novo `tripId`; a hidratação do novo controle redefine apenas parte do formulário e preserva `evidence`, `sealInstallationEvidence`, divergência e outros drafts. `requestIds` também usa somente `action + payload` como identidade, sem incluir a viagem, e nunca é reinicializado na mudança de rota.

RESOLVIDO

###############

Bug 590

Sintoma: Depois de selecionar uma foto para uma avaria/falta/sobra e voltar a opção para “Sem divergência adicional”, confirmar a carga ainda envia essa foto ao dossiê como evidência genérica `other`, embora a divergência tenha sido removida da tela.
Provável causa: Ao mudar `divergenceKind`, o handler altera o `kind` e zera apenas `path`, mas preserva `evidence[2].file`. `confirmCargo` percorre sempre os três itens de `evidence` e inclui qualquer item com arquivo/caminho, independentemente de `divergenceKind` estar vazio.

RESOLVIDO

###############

Bug 591

Sintoma: Apagar um valor de volumes, pallets ou peso e confirmar converte o campo vazio em zero, podendo criar uma divergência falsa; valores fracionários de pallet e outras violações de `min`/`step` só são descobertos após a chamada ao servidor.
Provável causa: Os controles numéricos não são submetidos por um `<form>` e o botão usa `onClick`, portanto a validação nativa de `min`/`step` não é executada. `confirmCargo` transforma todos os textos diretamente com `Number`, para o qual `Number('') === 0`, sem checar preenchimento, finitude ou integralidade de `pallet_count`.

RESOLVIDO

###############

Bug 592

Sintoma: Uma conferência incompleta pode enviar fotos ao storage e só depois avisar que faltou confirmar documento, justificar ausência de lacre ou cumprir outra regra, deixando arquivos órfãos se o motorista fechar a tela ou abandonar a tentativa.
Provável causa: `confirmCargo` executa `uploadSecureFile` para evidências de carga, amarração e lacres antes das validações finais de documentos e antes da validação completa feita pelo RPC. Em caso de erro posterior não há rollback nem remoção dos caminhos já enviados.

RESOLVIDO

###############

Bug 593

Sintoma: Cada alteração na fila offline pode disparar duas recuperações simultâneas/seguidas das entregas, multiplicando leituras, uploads e chamadas idempotentes e favorecendo cancelamentos ou rajadas de rede durante a sincronização.
Provável causa: `DriverDeliverySyncBanner` contém dois `useEffect` literalmente idênticos que registram `replayAfterPredecessor` no mesmo evento `DRIVER_OFFLINE_OUTBOX_CHANGED`; ambos agendam `refetch()` com `setTimeout(0)` para toda mudança da fila.

RESOLVIDO

###############

Bug 594

Sintoma: Se uma nova despesa ficar pendente enquanto o aparelho continua reportando estado online — por exemplo após uma falha transitória de upload — ela pode não receber nova tentativa automática e permanecer na fila até ação manual ou até a conexão mudar para offline e voltar.
Provável causa: `DriverExpenseSyncAgent` usa um booleano `attempted` que vira `true` na primeira reprodução e só é reiniciado quando `online` fica falso. O flag não volta a `false` quando a fila zera nem distingue novos IDs, portanto o surgimento posterior de `pendingCount > 0` na mesma sessão online não aciona `queue.replay`.

RESOLVIDO

###############

Bug 595

Sintoma: Quando existem mais de 200 endereços aguardando validação, os excedentes desaparecem da tela e os cartões “Pendentes”, “Ambíguos” e “Com erro” parecem totais gerais, sem aviso de recorte nem opção para consultar o restante.
Provável causa: `AddressResolution` chama `get_address_resolution_queue_v1` uma única vez com `_limit: 200`; o RPC só aceita limite, ordena e corta a coleção, sem cursor, offset ou total. A página conta apenas `queue.data` e não implementa carregamento adicional.

###############

Bug 596

Sintoma: O botão “Auditoria do frete” aparece em pedidos que possuem valor de frete, mas ao abri-lo o painel informa “Nenhum cálculo registrado”, impedindo auditar como aquele total foi obtido.
Provável causa: `Orders` abre `FreightAuditDrawer` com `entityType="order"` e o ID do pedido, porém nenhum fluxo de pedidos chama `logFreightCalculation`; todas as gravações localizadas usam tipos de documentos fiscais (`fiscal_document`, `nfe` ou `cte`). Além disso, o drawer ignora a propriedade `entityType` e consulta apenas `entity_id`.

###############

Bug 597

Sintoma: Uma falha de permissão, rede ou banco ao carregar a auditoria do frete é apresentada como “Nenhum cálculo registrado”, levando o usuário a concluir que não existe histórico em vez de perceber que a consulta falhou.
Provável causa: `FreightAuditDrawer` ignora o campo `error` retornado pelo Supabase, executa `setLogs(data || [])` e não possui estado de erro nem tentativa novamente; qualquer resposta sem `data` se transforma no mesmo array vazio usado para ausência legítima de cálculo.

RESOLVIDO

###############

Bug 598

Sintoma: Ao fechar a auditoria de um registro e abrir rapidamente a de outro, o painel pode exibir temporariamente — ou, se uma resposta antiga chegar por último, manter — valores, tabela e critérios pertencentes ao registro anterior.
Provável causa: O efeito de `FreightAuditDrawer` não limpa `logs` quando `entityId` muda ou o painel fecha e não cancela nem identifica a requisição assíncrona em andamento. Como `bd` continua derivando de `logs[0]` durante o novo carregamento, respostas concorrentes podem sobrescrever o estado fora de ordem.

RESOLVIDO

###############

Bug 599

Sintoma: Recalcular o frete de um mesmo documento elimina a versão anterior da auditoria, impossibilitando reconstruir a evolução do cálculo; o bloco “Histórico” do painel praticamente nunca contém mais de uma versão real da mesma entidade.
Provável causa: `freight_calculation_log` possui índice único por `(tenant_id, entity_type, entity_id)` e `logFreightCalculation` usa `upsert` nessa chave, substituindo o registro corrente. O drawer tenta listar até dez linhas e renderizar histórico, mas o modelo de persistência conserva somente uma linha por entidade e tipo.

###############

Bug 600

Sintoma: Ao reconstruir uma auditoria de frete gravada, o painel pode ocultar o valor mínimo que elevou a cobrança e sempre exibe código e score como zero, deixando uma diferença sem explicação entre “Base Calculada” e “Valor Final”.
Provável causa: `logFreightCalculation` não persiste `minValue`, `tableCode` nem `specificityScore` em `freight_calculation_log`, e `logsToBreakdown` preenche os três campos com `0`. Como linhas não obrigatórias de valor zero são omitidas, o mínimo efetivamente aplicado desaparece da auditoria.

###############

Bug 601

Sintoma: Uma alteração manual de frete pode ser efetivada no CT-e e ainda assim informar falha e ficar sem o respectivo registro de auditoria; uma nova tentativa pode então registrar um “valor anterior” incorreto ou duplicar a operação lógica.
Provável causa: `useOverrideFreightValue` primeiro atualiza `fiscal_documents` e só depois faz um `insert` independente em `freight_override_log`. As duas escritas não estão em uma transação/RPC atômica; se a segunda falhar, a primeira não é revertida e a invalidação das consultas também não ocorre porque a mutação termina em erro.

###############

Bug 602

Sintoma: “Confirmar valor atual” pode mostrar “Valor confirmado” e fechar o diálogo mesmo sem confirmar documento algum, por exemplo se o CT-e foi removido/transferido ou deixou de estar atualizável entre a abertura e o clique.
Provável causa: `useConfirmFreightValue` executa um `update` filtrado por ID e tenant, mas não solicita a linha alterada nem verifica contagem. O PostgREST não trata atualização de zero linhas como erro, e o hook retorna `{ ok: true }` para esse caso.

###############

Bug 603

Sintoma: Depois de calcular o frete de um conjunto de NF-es, alterar a seleção e gerar o CT-e pode aplicar ao novo conjunto o valor calculado para as notas anteriores.
Provável causa: `CTeWorkbench` mantém apenas o número em `calculatedFreight` e não o invalida em `toggleDoc`, `selectAll`, mudanças de filtro/documentos ou de carga. O preview continua habilitado e `generateCTe` combina esse valor antigo com `selectedDocs` e totais atuais.

RESOLVIDO

###############

Bug 604

Sintoma: Quando o cálculo de frete falha por falta, ambiguidade ou erro de tabela, ainda é possível abrir o preview e criar um CT-e confirmado com frete igual a zero.
Provável causa: No ramo de erro, `handleCalcFreight` executa `setCalculatedFreight(0)`. O botão de preview só exige que o estado seja diferente de `null`, e `generateCTe` rejeita apenas `null`, sem validar finitude ou valor positivo antes do `insert`.

RESOLVIDO

###############

Bug 605

Sintoma: CT-es criados pelo workbench podem registrar no campo principal `value` a soma das mercadorias das NF-es, enquanto `freight_value` contém o preço do transporte, produzindo divergência com os demais fluxos fiscais e com recálculos posteriores.
Provável causa: O payload direto de `CTeWorkbench.generateCTe` usa `value: totals.value`; já `useGenerateCTE`, o recálculo e o fluxo fiscal canônico tratam `value` do documento outbound como o valor do frete. Não há reconciliação após a inserção.

###############

Bug 606

Sintoma: Um CT-e gerado com override manual não aparece como alterado, perde a justificativa digitada e não preserva corretamente valor original versus valor ajustado, apesar de a interface exigir o motivo antes de gerar.
Provável causa: `CTeWorkbench` nunca usa `overrideReason` no payload nem no log e não grava `freight_overridden`, `freight_override_reason`, `freight_value_original` ou os metadados de autor/data. O log sintético também é salvo por `logFreightCalculation` sem `is_override` nem `override_reason`.

###############

Bug 607

Sintoma: CT-es gerados pelo workbench com o valor calculado normalmente não exibem o breakdown da regra, a tabela escolhida nem uma trilha de cálculo ao serem revisados.
Provável causa: `handleCalcFreight` descarta `result.breakdown` e conserva somente `result.value`. No caminho sem override, `generateCTe` não grava `freight_value_original`, `freight_table_id` ou `freight_breakdown` e não chama `logFreightCalculation`; o único log criado nesse componente é o override sintético.

###############

Bug 608

Sintoma: As NF-es selecionadas para gerar um CT-e no workbench continuam disponíveis para novas gerações e, depois da criação, não é possível determinar de forma confiável quais notas compõem aquele conhecimento, permitindo duplicidade de faturamento das mesmas origens.
Provável causa: `selectedDocs` é usado somente para totais e para montar `product_summary`. O `insert` grava um `fiscal_documents` outbound ligado à carga, mas não persiste os IDs selecionados, não preenche `cte_emitted_outbound_id` nas origens e não usa `fiscal_source_reservations`, ao contrário do fluxo fiscal canônico.

###############

Bug 609

Sintoma: Um CT-e criado na aba “Documentos” do romaneio aparece na lista de emitidos do workbench, mas pode continuar fora da receita, lucro, margem e “Valor CT-e Bruto” da mesma carga.
Provável causa: O workbench insere somente em `fiscal_documents`. Os indicadores de `LoadRomaneioTabs` somam exclusivamente `cte_documents` encontrados por `load_ids`, e o espelhamento para esse catálogo exige uma emissão do hub e reservas de origem que o workbench não cria.

###############

Bug 610

Sintoma: Os atalhos “CON (Monitor)”, “Consultar CT-e” e “Chave Acesso” do romaneio abrem a aba correta, porém não filtram pela carga ou chave desejada; o usuário chega a uma consulta geral sem o contexto prometido pelo botão.
Provável causa: `LoadRomaneioTabs` navega com `?load=<número>` ou `?key=<load.id>`, mas `CteHubPage` consome apenas `tab` e `CteMonitor`/`CteSearch` não inicializam filtros a partir desses parâmetros. No terceiro atalho, o suposto valor de chave ainda é o UUID da carga, não uma chave fiscal de 44 dígitos.

###############

Bug 611

Sintoma: Desmarcar a última NF — ou usar “Desmarcar Todas” — no formulário de NFS-e mantém os itens, o valor e os vínculos anteriores; salvar em seguida ainda cria a nota referenciando as NF-es que a interface mostra como desmarcadas.
Provável causa: O efeito que sincroniza `selectedIds` com `form` e `items` só executa seu corpo quando `selectedIds.size > 0`. Ao chegar a zero ele não limpa nada, e `handleSave` reconstrói `fiscal_document_ids` a partir dos itens antigos, não da seleção visível.

RESOLVIDO

###############

Bug 612

Sintoma: É possível selecionar NF-es de clientes/tomadores diferentes e criar uma única NFS-e que referencia todas elas, mas identifica como tomador somente o cliente da primeira nota selecionada.
Provável causa: `NFSeFormDialog` não valida homogeneidade de `client_id`, CNPJ ou tomador entre `selected`. O efeito escolhe `selected[0]` para preencher todos os dados cadastrais e, ao mesmo tempo, cria itens e `fiscal_document_ids` para a coleção inteira.

RESOLVIDO

###############

Bug 613

Sintoma: Abrir para edição um rascunho de NFS-e que possui NF-es vinculadas pode derrubar o formulário com erro de execução, sobretudo na tela geral ou antes de a consulta dos documentos da carga terminar.
Provável causa: A inicialização preenche `selectedIds` a partir de `initial.fiscal_document_ids`; o efeito seguinte entra porque o conjunto não está vazio, mas `loadDocuments` ainda pode ser `[]`. Ele usa `selected[0]` sem verificar existência e acessa `first.client_id` e demais campos de um valor indefinido.

RESOLVIDO

###############

Bug 614

Sintoma: Quando um rascunho de NFS-e vinculado é reaberto com os documentos da carga já disponíveis, descrições, quantidades, valores e dados do tomador salvos manualmente podem ser substituídos pelos valores atuais das NF-es sem confirmação.
Provável causa: O efeito de abertura restaura corretamente `initial.items` e os campos do rascunho, mas também restaura `selectedIds`. O efeito da seleção reage logo depois e recria `items`, `description`, `valor_servicos` e todos os dados do cliente a partir de `loadDocuments`, sem distinguir inicialização de uma alteração feita pelo usuário.

RESOLVIDO

###############

Bug 615

Sintoma: O formulário de NFS-e da carga permite selecionar notas excluídas, já emitidas ou reservadas por outra emissão, cria e numera o RPS normalmente e só revela o conflito quando o usuário tenta transmiti-lo.
Provável causa: `nfse_load_docs` filtra apenas `load_id` e `document_type = 'inbound'`; não considera `deleted_at`, `cte_emitted_at`, `nfse_emitted_document_id` nem `fiscal_source_reservations`. As validações `fiscal_source_already_issued`/`fiscal_sources_reserved` existem apenas no início da emissão, depois que o rascunho e o número já foram consumidos.

RESOLVIDO

###############

Bug 616

Sintoma: Remover da tabela de itens uma NF que continua marcada na lista superior deixa o checkbox afirmando que ela integra a NFS-e, mas o rascunho é salvo sem o vínculo dessa nota.
Provável causa: `removeItem` altera somente `items` e não atualiza `selectedIds`. No salvamento, `fiscal_document_ids` é derivado dos itens restantes, enquanto os checkboxes continuam derivados do conjunto de seleção independente.

RESOLVIDO

###############

Bug 617

Sintoma: Depois de ajustar manualmente descrição, quantidade ou valor de itens de uma NFS-e, marcar ou desmarcar qualquer outra NF restaura todos os itens selecionados aos valores das notas e perde as edições sem aviso.
Provável causa: Toda mudança em `selectedIds` executa um efeito que substitui `items` por um novo `selected.map(...)`; ele não mescla itens já editados por `fiscal_document_id` nem confirma o descarte das alterações existentes.

RESOLVIDO

###############

Bug 618

Sintoma: Enquanto o assistente “Emitir NFS-e a partir de NFs” está aberto, uma atualização da lista de emitentes pode devolver o usuário ao primeiro passo e apagar seleção, valores, descrição, observações e dados editados antes da emissão.
Provável causa: O efeito de inicialização depende de `[open, emitters, batchStorageKey]` e redefine todo o estado de trabalho sempre que a referência de `emitters` muda, inclusive em refetch por foco ou invalidação, sem distinguir abertura real do diálogo.

RESOLVIDO

###############

Bug 619

Sintoma: Selecionar uma NF com seguro e depois trocar a seleção por notas de outra carga/seguradora pode emitir as novas NFS-e com seguradora, apólice, averbação e valores herdados da seleção anterior.
Provável causa: O efeito de pré-preenchimento do seguro usa setters no formato `v => v || valorDaNota`, portanto apenas preenche campos vazios e nunca os limpa ou substitui quando `selectedDocs` muda. A seleção e o formulário não mantêm qualquer vínculo que identifique a origem desses dados.

###############

Bug 620

Sintoma: Se a criação individual de um lote falhar depois de preparar apenas parte dos RPS, “Tentar novamente com segurança” transmite somente os rascunhos já criados e abandona silenciosamente as demais NF-es, embora o resumo continue indicando a quantidade original.
Provável causa: `rememberDraft` grava progressivamente apenas os sucessos em `batchAttempt.drafts`. Quando `batchAttempt` já existe, `handleEmit` pula toda a etapa de criação e chama `issueBatch` exclusivamente com `Object.values(batchAttempt.drafts)`, sem comparar `sourceCount`, recuperar os IDs de origem ou criar os rascunhos ausentes.

###############

Bug 621

Sintoma: No modo individual, uma NFS-e pode ser preparada com valor de serviço zero ou negativo desde que outras notas selecionadas mantenham o total geral positivo, consumindo RPS e chegando à emissão com valor fiscal inválido.
Provável causa: Cada input de serviço aceita qualquer número, sem `min` ou validação por documento. A passagem ao terceiro passo verifica apenas `totalServicos > 0`; `handleEmit` não exige `valorPorDoc(d) > 0` antes de criar cada rascunho.

###############

Bug 622

Sintoma: Mesmo com mensagens vermelhas indicando seguradora, CNPJ, apólice ou averbação inválidos, o botão “Emitir NFS-e” continua habilitado e cria os rascunhos antes de a montagem do payload fiscal rejeitar o seguro.
Provável causa: `insuranceCheck` é usado somente para renderizar textos de erro. Nem `handleEmit` nem a condição `disabled` consultam `insuranceCheck.ok`; a validação impeditiva só ocorre posteriormente em `buildNFSeEmitPayload`, durante a transmissão dos RPS já criados.

###############

Bug 623

Sintoma: Dados de seguradora incompletos ou inválidos podem ser salvos como padrão do tenant e reaplicados a emissões futuras, fazendo novos CT-es/NFS-es falharem até que o perfil seja corrigido manualmente.
Provável causa: “Salvar como padrão” exige apenas `insurerName`; ele ignora `insuranceCheck.ok`. `useUpdateInsuranceProfile` também grava nome, CNPJ e apólice diretamente em `tenants.settings` sem chamar `validateInsurance`.

###############

Bug 624

Sintoma: No modo de emissão individual, editar a “Discriminação dos Serviços” não altera o texto das NFS-e geradas; todas recebem a descrição automática, apesar de o campo editável permanecer visível no resumo.
Provável causa: O caminho unificado usa `descricao?.trim()`, mas o loop individual ignora completamente esse estado e sempre define `description = buildIndividualNFSeDescription(...)` para cada nota.

###############

Bug 625

Sintoma: A criação de qualquer rascunho/RPS de NFS-e pelo navegador pode falhar imediatamente com erro de permissão ao reservar a numeração, tanto com emitente cadastrado quanto no fallback por filial.
Provável causa: `useCreateNFSe` chama diretamente `next_nfse_number_by_emitter` ou `next_nfse_number` usando a sessão autenticada, porém a baseline revoga execução de `PUBLIC`, `anon` e `authenticated` e concede ambos os RPCs somente a `service_role`; nenhuma migração posterior restaura a permissão exigida pelo frontend.

###############

Bug 626

Sintoma: Selecionar mais de 100 NF-es no modo individual cria e numera um RPS para cada nota e só então a transmissão do lote inteiro falha, deixando mais de cem rascunhos pendentes sem que a interface tivesse avisado ou limitado a seleção.
Provável causa: `NFSeFromInvoicesDialog` não impõe tamanho máximo e cria todos os rascunhos sequencialmente antes de chamar `issueBatch`. O `hub-fiscal-proxy`, porém, rejeita `emit-nfse-batch` quando `entries.length > 100`; o hook não particiona a operação em comandos menores.

###############

Bug 627

Sintoma: O recálculo em lote pode contabilizar uma NF como “atualizada” mesmo que nenhuma linha tenha sido alterada — por exemplo, se ela for excluída entre a leitura e a escrita — e documentos selecionados que não retornam na leitura nem entram no total de falhas.
Provável causa: `useRecalculateInboundFreight` não compara `docIds` com os IDs efetivamente carregados. Em cada `update`, também não solicita a linha/contagem afetada; atualização de zero linhas não gera erro no PostgREST, o log falho é engolido e `updated++` é executado mesmo assim.

###############

Bug 628

Sintoma: Recalcular frete de um lote grande e diversificado pode falhar por tamanho de URL justamente ao carregar os grupos pagadores, apesar de a leitura inicial das NF-es ter sido dividida em blocos para evitar esse problema.
Provável causa: O hook particiona `docIds` em grupos de 200, mas depois reúne todos os `client_id` distintos e os envia de uma só vez em `.in('id', clientIds)` para `clients`, sem chunking ou paginação.

###############

Bug 629

Sintoma: O botão de recálculo fica progressivamente lento e pode gerar centenas de varreduras repetidas no banco para um único lote, tornando lotes grandes sujeitos a timeout ou processamento parcial demorado.
Provável causa: O hook processa cada NF sequencialmente e chama `calculateFreight` de novo para cada uma. Cada chamada pagina novamente todo o catálogo vigente de `freight_tables` e pode paginar `client_regions`, em vez de compartilhar os mesmos catálogos carregados dentro do lote.

###############

Bug 630

Sintoma: Ao emitir em homologação ou sandbox, o assistente pode oferecer NF-es já reservadas nesse mesmo ambiente — que falharão ao transmitir — e esconder NF-es reservadas apenas em produção, embora as reservas fiscais sejam independentes por ambiente.
Provável causa: `useBillingDocuments` não recebe o ambiente escolhido no diálogo e consulta `fiscal_source_reservations` e `hub_fiscal_emissions` sempre com `.eq('environment', 'production')`. A chave primária das reservas inclui `environment`, mas a elegibilidade da tela ignora essa dimensão.

###############

Bug 631

Sintoma: Uma NF pode aparecer no assistente de NFS-e ou CT-e com base no município de uma filial e depois ser emitida por outra, produzindo classificação fiscal errada ou falha tardia quando o usuário escolhe um emitente não padrão.
Provável causa: `useBillingDocuments(..., 'nfse'/'cte')` decide `sameCity` exclusivamente com `useDefaultEmitter`. O emitente efetivamente selecionável no passo fiscal não é passado ao hook nem provoca nova classificação das notas candidatas.

###############

Bug 632

Sintoma: A lista de notas não faturadas e seus filtros ficam progressivamente lentos e caros conforme cresce o histórico fiscal, mesmo quando o usuário busca uma única NF recente.
Provável causa: Para cada execução, `useBillingDocuments` pagina não só as NF-es candidatas, mas todo o catálogo ativo de `cte_documents`, todo o de `nfse_documents`, todas as reservas de produção e todas as emissões de produção. O cruzamento é integral no navegador e se repete em refetch por montagem, foco e alteração dos filtros.

###############

Bug 633

Sintoma: Selecionar mais de 500 NF-es no modo unificado cria e numera o RPS consolidado, mas a transmissão falha depois com limite de origens fiscais, sem que a interface tivesse impedido a seleção excedente.
Provável causa: O assistente não limita a quantidade de fontes no modo `unified` e o proxy recebe somente uma entrada, portanto seu teto de 100 não ajuda. Ao reivindicar a emissão, `claim_hub_fiscal_emission` rejeita `cardinality(source_ids) > 500` com `fiscal_too_many_sources`, já após `useCreateNFSe` ter persistido o rascunho.

###############

Bug 634

Sintoma: Correções manuais feitas no formulário de MDF-e — como tara, RNTRC, CIOT, responsável, averbações ou municípios — podem ser apagadas e restauradas aos valores automáticos ao recarregar CT-es ou após qualquer atualização da carga, emitente ou veículo.
Provável causa: O efeito de inicialização usa uma assinatura que inclui `load.updated_at` e arrays derivados de CT-es, emitentes e veículos. Toda mudança dessa assinatura executa `setForm` para o objeto completo, sem preservar campos já editados nem verificar se o usuário iniciou alterações.

###############

Bug 635

Sintoma: Falhas ao consultar o manifesto existente, CT-es autorizados, motorista, veículo, emitentes, credenciais ou seguro aparecem como dados ausentes e formulário bloqueado — ou até como inexistência de MDF-e — sem mensagem de erro nem tentativa específica de recarga.
Provável causa: `ManifestPanel` consome apenas `data` e `isLoading` dessas queries. Os estados `isError`/`error` são ignorados e os fallbacks `null`/`[]` alimentam as mesmas mensagens de campos pendentes usadas para ausência legítima de cadastro.

###############

Bug 636

Sintoma: Uma carga com mais de 500 CT-es autorizados pode ser totalmente exibida e chegar ao comando de emissão, mas o MDF-e sempre falha sem alternativa para dividir os documentos em manifestos suportados.
Provável causa: O painel não limita nem particiona `cteIds`; `prepare_mdfe_issue` rejeita atomicamente qualquer coleção com `cardinality(ids) > 500` por `mdfe_too_many_ctes`, e a interface modela rigidamente “um documento fiscal por carga”.

###############

Bug 637

Sintoma: Mesmo abaixo do teto fiscal de 500 CT-es, a preparação do MDF-e pode falhar por URL grande ou perder dados auxiliares quando uma carga possui muitos documentos e origens vinculadas.
Provável causa: Depois de paginar os IDs iniciais, `useAuthorizedCteList` envia todos eles de uma vez em várias consultas `.in('id'/'fiscal_document_id'/'outbound_id', documentIds)`; também envia todos os `sourceIds` e `driverIds` sem particionamento e não pagina os resultados dessas consultas dependentes.

###############

Bug 638

Sintoma: CT-es cujo remetente ou destinatário está em um cliente fora do primeiro lote da API podem perder IE e endereço de fallback, fazendo o MDF-e acusar contratante ou município incompleto apesar de o cadastro existir.
Provável causa: `useAuthorizedCteList` consulta todos os `clients` do tenant em uma única chamada sem paginação e constrói `clientMap` somente com o subconjunto devolvido pelo PostgREST.

###############

Bug 639

Sintoma: Um CT-e autorizado que contém o código IBGE do destinatário em seu payload pode continuar aparecendo no MDF-e com “Município de descarga” ausente quando não existe cliente local correspondente ao CNPJ.
Provável causa: Ao montar `recipient_city_ibge`, `useAuthorizedCteList` usa exclusivamente `recipientClient?.address_city_ibge_code`. `readCteMdfeDetails` não extrai o endereço do destinatário e `readAuthorizedCteHubDetails` lê somente o remetente, portanto o código imutável já transmitido no CT-e é descartado.

###############

Bug 640

Sintoma: Se a preparação do MDF-e for gravada mas o envio ao proxy falhar antes de confirmar um documento do provedor, o painel fica permanentemente em “Pronto para transmitir” sem botão para transmitir ou refazer a tentativa.
Provável causa: `prepare_mdfe_issue` persiste `load_manifests.status = 'draft'` antes de `hubFiscal.emit`. No painel, `canRetry` só aceita ausência, rejeição ou cancelamento; um manifesto `draft` entra no ramo de documento existente, mas não possui `hub_document_id` para sincronizar e não recebe ação de emissão, embora o RPC suporte recuperar o mesmo draft.

###############

Bug 641

Sintoma: Um MDF-e marcado “Aguardando conciliação” pode instruir “Sincronize este documento” e, ao mesmo tempo, não mostrar o botão Sincronizar, deixando a carga sem caminho de recuperação pela interface.
Provável causa: Estados `provider_unknown` podem existir sem `hub_document_id` quando o resultado falha antes de devolver a identidade remota. O texto de conciliação é incondicional, mas a ação de sincronizar só é renderizada quando `manifest.hub_document_id` existe; `canRetry` também recusa esse estado.

###############

Bug 642

Sintoma: Ao navegar diretamente de um romaneio para outro sem remontar o painel, os campos de Dinheiro e PIX podem continuar exibindo os valores da carga anterior e permitir salvá-los na nova carga.
Provável causa: `cashToReceive` e `pixToReceive` são inicializados por `useState` a partir de `load` apenas na primeira montagem. Não existe efeito que os ressincronize quando `load.id`, `cash_to_receive` ou `pix_to_receive` muda.

###############

Bug 643

Sintoma: Salvar os totais de fechamento pode sobrescrever silenciosamente uma alteração concorrente e ainda informar sucesso quando nenhuma carga foi atualizada.
Provável causa: `saveTotals` faz `update` somente por `load.id`, sem `tenant_id`, `expectedVersion` ou outro controle otimista usado no restante do romaneio. Também não solicita retorno/contagem; zero linhas afetadas não gera erro no PostgREST e o toast de sucesso é exibido do mesmo modo.

###############

Bug 644

Sintoma: O relatório “Imprimir / PDF” pode divergir da tabela visível, omitindo canhotos, formas de pagamento e ocorrências que o usuário acabou de preparar mas ainda não salvou.
Provável causa: A tabela combina `delivery_meta` com `drafts.rows` no objeto `meta`, porém a impressão recebe `inboundDocs.map(...)` e converte somente o `delivery_meta` persistido de cada documento; os rascunhos locais não são incluídos nem há bloqueio/aviso enquanto `dirty.size > 0`.

###############

Bug 645

Sintoma: Ao navegar entre cargas sem remontar a página, abrir “Despachar” pode manter o motorista, veículo e observações escolhidos na carga anterior e criar a nova viagem com esses responsáveis incorretos.
Provável causa: `dispatchForm` é criado uma única vez com strings vazias e depois preserva qualquer seleção manual. Não há efeito de reset por `load.id`; os fallbacks `dispatchForm.driver_id || load.driver_id` e equivalente para veículo deixam de usar a nova carga assim que o estado antigo se torna não vazio.

###############

Bug 646

Sintoma: Uma carga pode ficar definitivamente no estado “Carregada” sem o CT-e automático esperado quando o cálculo, a consulta fiscal ou a criação do documento falha após a transição.
Provável causa: `handleStatusChange('loaded')` primeiro confirma `transitionLoadStatus` e só depois, em outra mutação/transação, chama `generateCTE`. A exceção da segunda etapa gera apenas um toast; não reverte o status nem cria uma pendência recuperável que vincule as duas operações.

###############

Bug 647

Sintoma: A prévia de CT-e pode mostrar um frete calculado com valor total zero, cliente/grupo pagador ausente ou tabela genérica quando, na realidade, falhou a leitura das NF-es ou do cliente da carga.
Provável causa: `openCTePreview` ignora `error` nas consultas de `fiscal_documents` e `clients`. Respostas sem `data` viram arrays/valores vazios e são enviados normalmente a `calculateFreight`, que pode selecionar um fallback válido em vez de sinalizar indisponibilidade dos dados de contexto.

###############

Bug 648

Sintoma: Ao abrir “Adicionar Item” em uma carga existente, uma falha de rede, permissão ou banco na consulta das NF-es aparece como “Nenhuma NF disponível para esses filtros”, fazendo indisponibilidade parecer ausência real de documentos.
Provável causa: A query `load_item_pull_fiscal_docs` lança o erro, mas `LoadItemsPanel` desestrutura apenas `data` e `isFetching`, com fallback `fiscalDocs = []`; nenhum estado `error` é renderizado e a lista vazia é usada para a mensagem de ausência.

###############

Bug 649

Sintoma: Em empresas com mais de 1.000 NF-es de entrada, notas antigas não podem ser localizadas nem vinculadas a uma carga já existente pelo diálogo “Puxar NF”, mesmo pesquisando por número, cliente, bairro ou cidade.
Provável causa: `load_item_pull_fiscal_docs` busca somente as 1.000 notas mais recentes com `.limit(1000)`, enquanto todos os filtros e a paginação visual são aplicados depois desse corte, em memória, sem busca ou cursor no servidor.

###############

Bug 650

Sintoma: É possível adicionar manualmente um item ou puxar NF-es para uma carga e ultrapassar o peso máximo do veículo, embora o mesmo painel conheça essa capacidade e passe a exibir a ocupação em vermelho depois da inclusão.
Provável causa: `handleAdd` bloqueia apenas quando `newPallets` excede `vehicleMaxPallets`; não calcula nem compara o peso resultante com `vehicleMaxWeight`. As RPCs de preparação de item e alteração documental também não validam a composição contra `vehicles.max_weight_kg`.

###############

Bug 651

Sintoma: Ao pesquisar ou marcar um endereço no mapa e depois editar o texto, é possível confirmar uma nova parada, replanejamento ou local de entrega com o endereço novo associado às coordenadas do endereço anterior.
Provável causa: `LocationPicker` chama somente `onAddressChange` ao editar o campo e não invalida `value` nem a lista de candidatos já pesquisada. Vários consumidores (`DocumentChangeDialog`, `LoadReplanningPanel` e `StopDraftTable`) apenas atualizam a string, mantêm o `ResolvedLocation` anterior e deixam o botão de confirmação habilitado.

###############

Bug 652

Sintoma: Ao liberar um saldo parcial para reentrega, o operador pode informar paletes, peso ou cubagem maiores que os do item original; a nova tentativa passa a carregar medidas físicas impossíveis e pode distorcer capacidade do veículo, roteirização e acerto.
Provável causa: O formulário e `isRedeliveryPayload` exigem somente números não negativos. `request_document_redelivery` confirma que todos os itens do saldo foram enviados e reaproveita do contexto apenas `remaining_quantity`; os campos `pallet_count`, `weight_kg` e `volume_m3` vindos do cliente não são comparados com as medidas do item de origem nem com uma proporção máxima do saldo.

###############

Bug 653

Sintoma: Em uma carga com mais de 500 notas editadas, “Salvar Notas” abre a revisão completa, mas “Salvar conferência” fica desabilitado sem mensagem de limite; o usuário não consegue salvar nem fracionar o trabalho preparado e precisa descartar rascunhos manualmente.
Provável causa: `LoadNotesPanel` permite acumular `dirty` sem teto — inclusive ao aplicar “Detectar formas de pagamento” em massa — e envia todos os rascunhos a um único `DocumentMetadataDialog`. `isMetadataPayload` e `update_load_document_metadata` aceitam no máximo 500 itens, porém não há seleção por lote, particionamento nem aviso quando esse tamanho é excedido.

###############

Bug 654

Sintoma: Se falhar a consulta das NF-es ou das cargas vinculadas ao abrir “Nova Carga”, a tela mostra “Nenhuma nota encontrada”/“Nenhuma nota recente disponível” e perde a identificação da carga atual, sem informar indisponibilidade nem oferecer repetição explícita.
Provável causa: As queries `new_load_available_fiscal_docs` e `new_load_linked_load_lookup` lançam erros, mas o componente desestrutura somente `data` e `isFetching`, aplicando fallback `[]`; os estados `error` não são renderizados e são tratados como catálogos legitimamente vazios.

###############

Bug 655

Sintoma: “Nova Carga” permite selecionar uma NF que já pertence a outra carga e promete que ela “será reatribuída”, mas a criação falha no servidor; a opção de abrir a carga vinculada nunca aparece no ramo previsto para esse caso.
Provável causa: `selectableFilteredDocs` é exatamente o mesmo array de `filteredDocs`, portanto inclui notas vinculadas e torna impossível a condição `selectableFilteredDocs.length === 0 && linkedFilteredDocs.length > 0`. Ao salvar, `create_load_with_documents_v1` chama `assign_fiscal_documents_to_load_v2`, cuja implementação canônica rejeita itens/documentos ligados a outra carga com `document_already_linked` em vez de realocá-los.

###############

Bug 656

Sintoma: Se a criação de carga for confirmada no servidor mas a resposta se perder, editar a seleção e tentar novamente pode deixar a carga com a união das notas da primeira e da segunda tentativa, embora a tela mostre apenas o conjunto revisado no momento do reenvio.
Provável causa: `NewLoadDialog` preserva o mesmo `request_id` após erro, mas `create_load_with_documents_v1` repassa ao ledger idempotente de `apply_load_aggregate_command` somente `changes`; seleção, patch de NF, documento manual e auditorias ficam fora do hash/resultado. No replay, a carga existente é reutilizada e os novos IDs são anexados, sem conferir o payload original nem remover documentos que deixaram de estar selecionados.

###############

Bug 657

Sintoma: Um XML sem data de emissão pode ser aceito na reimportação de qualquer período e gerar uma NF com `issue_date` nulo; esse registro não pertence a nenhum intervalo e, em reimportações futuras, não é removido pela limpeza periódica, podendo acumular duplicatas permanentes.
Provável causa: `validateNFe` trata data ausente apenas como aviso e `isWithinSelectedPeriod` retorna `true` quando `issueDate` está vazio ou inválido. `replace_reimport_batch_v1` também aceita `issue_date` nulo, enquanto `clear_reimport_batch_data` e o snapshot anterior trabalham por intervalo de `issue_date`.

###############

Bug 658

Sintoma: Ao trocar o período da reimportação, uma falha ao calcular a prévia pode deixar na tela as contagens de exclusão do período anterior, sem aviso; o administrador pode confirmar “LIMPAR” acreditando que aqueles números correspondem ao novo intervalo.
Provável causa: `fetchErasePreview` não possui `catch`, não limpa `erasePreview` antes da chamada e é disparado pelo efeito sem tratamento da Promise. Em caso de erro, somente `previewLoading` volta a `false`; o valor anterior continua renderizado e a execução do lote permanece habilitada.

###############

Bug 659

Sintoma: O relatório final da reimportação pode classificar uma NF nova como “Atualizada” ou “Sem alteração” quando já existia no período apenas outra nota com o mesmo número, mas de fornecedor, modelo ou série diferente.
Provável causa: Para documentos sem chave de acesso, `existingByInvoiceNumber` indexa o snapshot exclusivamente por `invoice_number`, sobrescrevendo colisões e ignorando emitente, modelo e série. Essa busca simplificada alimenta `state`/`reason`, embora o próprio fluxo use uma identidade composta mais forte para detectar duplicatas entre arquivos.

###############

Bug 660

Sintoma: Se a consulta das NF-es pendentes falhar, o agrupador informa “Nenhuma NF-e pendente (sem carga vinculada)”, fazendo indisponibilidade do banco ou falta de permissão parecer ausência real de trabalho.
Provável causa: A query `pending_fiscal_docs` lança o erro, mas `PendingDocsGrouping` desestrutura apenas `data` e `isLoading`, com fallback `pendingDocs = []`; não existe ramo para `error` nem ação de tentar novamente.

###############

Bug 661

Sintoma: O agrupamento automático pode criar uma carga cujo peso total excede a capacidade do veículo selecionado, sem alerta ou bloqueio, embora a tela mostre o peso do grupo e o cadastro do veículo possua limite em quilogramas.
Provável causa: A sugestão, a barra de ocupação e `handleExecute` consideram somente `max_pallets`. `create_grouped_load_v1` repete no servidor apenas a soma/validação de paletes e nunca compara `SUM(weight_kg)` com `vehicles.max_weight_kg`.

###############

Bug 662

Sintoma: Se o servidor criar uma carga agrupada mas a resposta se perder, a tela contabiliza o grupo como erro e não oferece recuperação; uma nova tentativa pode gerar estado confuso ou outra operação enquanto a primeira carga já existe.
Provável causa: `handleExecute` gera um `request_id` efêmero dentro do laço, não o persiste em outbox nem tenta reconciliar respostas incertas. Qualquer exceção incrementa `errors` indistintamente, mesmo após possível commit, e o identificador original se perde ao encerrar a chamada.

###############

Bug 663

Sintoma: Os filtros avançados de Remetente, Cliente, Município e Fornecedor podem retornar cargas sem relação com o valor pesquisado e omitir as corretas, apesar de os chips apresentarem esses filtros como exatos.
Provável causa: `list_loads_page_v1` não consulta as NF-es/itens da carga: compara Remetente com `loads.origin`, Cliente e Município com o mesmo campo `loads.destination`, e Fornecedor com `loads.supplier_manifest`. Esses campos representam cabeçalho de rota ou número de manifesto, não as entidades exibidas nos rótulos.

###############

Bug 664

Sintoma: Filtrar cargas por “Data Emissão” usa a data em que a carga foi criada, podendo incluir NF-es emitidas fora do intervalo e excluir cargas novas que contêm notas antigas dentro do período fiscal desejado.
Provável causa: As condições `emissionFrom`/`emissionTo` de `list_loads_page_v1` comparam `loads.created_at::date`; não existe join ou subconsulta sobre `fiscal_documents.issue_date`, embora esse seja o significado apresentado pelo formulário.

###############

Bug 665

Sintoma: Marcar tipos como “Normal”, “Devolução”, “Transferência”, “Entrega” ou “Subcontratação” nos filtros de Romexp/Romaneio frequentemente zera a lista, mesmo havendo cargas desses tipos; alguns poucos rótulos funcionam apenas por coincidência textual.
Provável causa: Tanto `romexpTypes` quanto `romaneioTypes` são aplicados por `ILIKE` ao mesmo enum `loads.operation_type`, cujos valores são códigos sem acento como `devolucao`, `transferencia`, `viagem_direta` e `redespacho`. A interface envia rótulos livres em português e não os converte para os valores canônicos nem consulta campos distintos de Romexp/Romaneio.

###############

Bug 666

Sintoma: Depois de aplicar período, busca ou filtros avançados, os botões de status continuam mostrando contagens gerais da empresa, divergindo do total e das linhas filtradas na mesma tela.
Provável causa: A CTE `tenant_status_counts` de `list_loads_page_v1` consulta diretamente `public.loads` somente por `tenant_id`, em vez de agrupar o conjunto `filtered_loads` (eventualmente removendo apenas o filtro de status para facetas). Assim, nenhum filtro ativo participa dos números retornados em `status_counts`.

###############

Bug 667

Sintoma: Ao mudar para o modo Kanban, a tela mostra somente a página atualmente carregada e remove todos os controles de paginação; se a troca ocorreu na página 2 ou posterior, não há como avançar, voltar ou retornar à primeira página dentro dessa visualização, e os contadores das colunas representam apenas o recorte preso.
Provável causa: `useLoadsPage` continua buscando uma página de `pageSize` linhas, mas o bloco de paginação está renderizado exclusivamente no ramo da tabela. `LoadsKanban` recebe apenas `filtered = loadPage.rows` e calcula suas colunas localmente, sem total ou callbacks de página.

###############

Bug 668

Sintoma: Selecionar cargas em uma página e navegar para outra mantém o contador e habilita “Excluir”, mas a confirmação falha como “Seleção desatualizada”; também não há indicação clara de quais IDs invisíveis continuam selecionados.
Provável causa: O `Set selected` não é limpo nem reconciliado ao mudar página ou filtros. `handleBulkDelete` tenta resolver todos os IDs somente em `loads`, que contém a página corrente, e recusa o lote se qualquer seleção veio de outro recorte.

###############

Bug 669

Sintoma: “Reimprimir página” pode gerar romaneios incompletos e ainda informar sucesso quando o conjunto de cargas possui mais itens do que o limite de resposta da API; itens excedentes somem silenciosamente do documento impresso.
Provável causa: `printAllRomaneios` envia todos os IDs da página em um único `.in('load_id', loadIds)` e faz uma única consulta não paginada em `load_items`. O agrupamento e a impressão usam diretamente esse array potencialmente truncado, sem contagem esperada, cursor ou detecção de corte.

###############

Bug 670

Sintoma: O Planejamento de Rotas pode exibir o valor total de uma parada multiplicado quando a mesma nota fiscal está associada a mais de um item da carga, apesar de listar a NF apenas uma vez.
Provável causa: `consolidateLoadsIntoStops` deduplica `fiscal_document_ids` e `invoice_numbers`, mas executa `stop.total_value += fiscal_document.value` para cada `load_item`. Como o modelo permite múltiplos itens com o mesmo `fiscal_document_id`, o valor integral do documento é somado repetidamente.

###############

Bug 671

Sintoma: Quando a rota chega ao cliente antes do início da janela de recebimento, o planejamento considera que o atendimento começa imediatamente e antecipa artificialmente a saída e todas as paradas seguintes, em vez de contabilizar o tempo de espera.
Provável causa: `simulateStopTimeline` usa somente `delivery_window_end` para classificar atraso. `delivery_window_start` não ajusta o horário de chegada/serviço nem o cursor da simulação, embora seja usado para ordenar as paradas.

###############

Bug 672

Sintoma: Uma janela de entrega que atravessa a meia-noite, por exemplo 22:00–02:00, pode marcar como crítica uma chegada válida às 23:00 e produzir alertas e ordenação incorretos.
Provável causa: A simulação aplica `delivery_window_end` diretamente à mesma data da chegada com `setHours`, sem detectar que o horário final é menor que o inicial e pertence ao dia seguinte. A tabela `customer_delivery_windows` também não restringe esse formato.

###############

Bug 673

Sintoma: Quando uma cidade está cadastrada em duas rotas operacionais, o planejamento automático agrupa suas cargas como uma rota comum por cidade e não avisa que há duas rotas candidatas, apesar de existir uma mensagem específica para essa ambiguidade no código.
Provável causa: `matchOperationalRoute` retorna uma rota somente quando há exatamente uma correspondência e devolve `null` quando há várias. A verificação `opMatchCount > 1` fica dentro do ramo `if (opRoute)`, que é inalcançável justamente no caso ambíguo; o fluxo cai silenciosamente no agrupamento `city:*`.

###############

Bug 674

Sintoma: O cartão e o romaneio PDF de uma rota podem contar e imprimir a mesma NF-e várias vezes, repetindo também seu valor integral, quando o documento possui mais de um item de carga associado.
Provável causa: `routeTotals` define a quantidade de NF-es como `allItems.length` e soma `fiscal_documents.value` por item. `buildRouteRomaneio` também gera uma linha por `load_item`, sem deduplicar por `fiscal_document_id`, embora cada linha represente o documento fiscal e não detalhe o item.

###############

Bug 675

Sintoma: Falhas ao carregar veículos, motoristas, rotas operacionais ou janelas de clientes no Planejamento de Rotas aparecem como seletores vazios, ausência de correspondência ou cliente sem janela; o planejamento automático pode gerar rotas para revisão com uma justificativa operacional falsa.
Provável causa: A página consome somente `data` de `useVehicles`, `useDrivers`, `useOperationalRoutes` e `useCustomerDeliveryWindowsForRouting`, substituindo dados indisponíveis por `[]`. Nenhum `isError`/`error` desses catálogos é exibido ou impede o planejamento baseado nos fallbacks.

###############

Bug 676

Sintoma: Após selecionar cargas e mudar o filtro de destino, usar “Adicionar ... a rota” inclui silenciosamente também as cargas que ficaram ocultas pelo filtro atual, sem a confirmação mostrada nos fluxos de criar rota e planejamento automático.
Provável causa: `addToRoute` resolve a seleção contra todo `availableLoads` e é ligado diretamente ao seletor de rota. O wrapper `confirmIfHidden`, criado para detectar `hiddenSelectedLoads`, envolve apenas `createRouteFromSelected` e `generateAutoPlan`.

###############

Bug 677

Sintoma: A interface oferece uma justificativa de exceção para uma parada sem coordenadas, mas mesmo preenchendo o mínimo exigido o botão de despacho permanece bloqueado por “informe latitude e longitude”; a exceção nunca consegue cumprir sua função nesse cenário.
Provável causa: `useDispatchRoutePlan` aceita uma parada sem localização verificada quando `location_exception_reason` possui ao menos 20 caracteres, porém `validateRouteConsistency`, executado antes e usado para habilitar o botão, adiciona erro bloqueante para qualquer coordenada ausente ou inválida sem considerar a exceção.

###############

Bug 678

Sintoma: Uma coordenada legada e ainda não verificada pode ser promovida a “Ponto selecionado no mapa” apenas abrindo “Revisar endereço/mapa” e clicando em “Usar este local”, sem selecionar ou confirmar efetivamente um ponto novo.
Provável causa: `openLocation` transforma toda origem diferente de `address_geocoded` em `map_selected` ao inicializar `editingLocation`. Como o botão já fica habilitado com esse valor herdado, `applyLocation` grava a origem promovida e limpa a justificativa de exceção mesmo sem interação com o mapa.

###############

Bug 679

Sintoma: Um operador autenticado pode despachar por chamada direta ao RPC uma rota cujo peso, volume ou quantidade de paletes excede a capacidade do veículo, contornando o bloqueio existente na tela.
Provável causa: `dispatch_planned_route_v3` delega a criação a `dispatch_planned_route`, que confirma apenas que veículo e cargas pertencem ao tenant e estão ativos/elegíveis. O comando transacional nunca soma a composição da carga nem compara `max_weight_kg`, `max_volume_m3` ou `max_pallets`; a regra existe somente em `validateRouteConsistency` no cliente.

###############

Bug 680

Sintoma: Uma chamada direta ao comando de despacho consegue criar uma viagem com mais de 30 paradas, embora o Planejamento de Rotas trate esse limite como erro bloqueante.
Provável causa: O limite `stops.length > 30` é verificado somente por `validateRouteConsistency` no navegador. `dispatch_planned_route` exige apenas que o array de paradas exista e não esteja vazio, percorrendo e inserindo qualquer quantidade recebida.

###############

Bug 681

Sintoma: Uma carga que ainda referencia uma NF-e cancelada, rejeitada ou em outro estado fiscal impróprio pode ser despachada e gerar uma parada/documento de entrega normal.
Provável causa: O RPC canônico `dispatch_planned_route` valida tenant, tipo `inbound`, unicidade e vínculo dos documentos, mas não consulta nem restringe `fiscal_documents.status`. A leitura do planejamento também carrega todos os documentos associados aos itens sem filtrar estado fiscal.

###############

Bug 682

Sintoma: Um raio de geofence explicitamente definido como exceção para uma parada pode ser ignorado no despacho, fazendo a entrega usar o raio da política do tenant ou o padrão de 500 metros.
Provável causa: A migration `20260910190950_harden_geofence_tracking_completion.sql` fazia `dispatch_planned_route_v3` validar `geofence_radius_override` e gravar `geofence_radius_is_override`/`geofence_radius_m`. A migration posterior `20260910192455_complete_address_geocoding_automation.sql` recria a mesma função sem preservar essa lógica, de modo que o marcador de override permanece `false` e o trigger prioriza a política geral.

###############

Bug 683

Sintoma: O filtro “SEM DESTINO” do Planejamento de Rotas aparece quando há cargas sem destino, mas ao selecioná-lo a lista fica vazia e essas mesmas cargas desaparecem.
Provável causa: As opções são montadas com `normalizeCity(load.destination || 'Sem destino')`, porém a filtragem compara `normalizeCity(load.destination).includes(filterDest)`. Para um destino nulo, o primeiro caminho produz `SEM DESTINO` e o segundo produz string vazia, portanto nunca há correspondência.

###############

Bug 684

Sintoma: Selecionar um destino no Planejamento de Rotas pode exibir também cargas de outros destinos cujo texto apenas contém o escolhido, por exemplo “BOM JESUS” inclui “BOM JESUS DA LAPA”.
Provável causa: Embora o seletor seja construído com destinos normalizados distintos, `filteredLoads` usa `normalizeCity(l.destination).includes(filterDest)` em vez de igualdade da chave canônica.

###############

Bug 685

Sintoma: Ao gerar o primeiro planejamento automático para um cliente que possui janela de entrega cadastrada, a nova parada costuma aparecer como “Cliente sem janela cadastrada”; rotas manuais também não recebem a janela automaticamente.
Provável causa: Os IDs usados por `useCustomerDeliveryWindowsForRouting` são extraídos somente das paradas que já existem em `routes`. No momento de gerar uma nova rota, as cargas selecionadas ainda não participam dessa consulta, então `generateAutomaticRoutePlans` recebe um array vazio ou referente a rotas anteriores. Quando a consulta é refeita após criar as paradas, nenhum efeito reaplica as janelas carregadas; `generateStops` manual tampouco as aplica.

###############

Bug 686

Sintoma: Trocar a empresa ativa enquanto o Planejamento de Rotas está aberto mantém na tela rotas, paradas e seleções da empresa anterior; o autosave pode então tentar criar na nova empresa um rascunho contendo IDs e snapshots das cargas antigas.
Provável causa: `routes`, `selectedLoads` e `draftsHydratedRef` não são limpos nem reinicializados quando `currentTenant.id` muda, e a página não é remontada pelo layout nessa troca. Os hooks passam a operar no novo tenant, mas o efeito de hidratação retorna imediatamente porque o ref continua `true`, enquanto `useRoutePlanAutosave` continua recebendo o estado local antigo.

###############

Bug 687

Sintoma: Editar novamente uma rota enquanto um autosave lento ainda está sendo enviado pode gerar o aviso falso de que o rascunho foi alterado em outra sessão e recarregar a versão anterior, descartando a edição mais recente.
Provável causa: `useRoutePlanAutosave` agenda chamadas independentes de `saver.mutate` e não serializa nem bloqueia uma nova gravação enquanto a anterior está pendente. Duas mutações da mesma rota podem ler a mesma `updated_at` e disputar o compare-and-swap; a segunda perde a disputa local, vira `DraftConflictError` e aciona a reidratação destinada a conflitos realmente externos.

###############

Bug 688

Sintoma: Um único registro de despacho local corrompido ou deixado em uma versão incompatível pode esconder todos os demais despachos pendentes daquela conta, impedindo a recuperação até mesmo dos registros válidos e sem oferecer ação para remover apenas o inválido.
Provável causa: `pendingDispatches` percorre o `localStorage`, mas `read` lança ao primeiro item malformado e o `catch` externo converte toda a leitura em `storageError`. O hook então devolve `items: []`, e `DispatchRecoveryPanel` mostra somente o erro genérico, sem isolar a chave problemática nem continuar a varredura.

###############

Bug 689

Sintoma: Ao abrir `/driver/stops?trip=...` para uma viagem específica, a página pode mostrar e permitir ações sobre a última viagem armazenada no aparelho enquanto a viagem solicitada ainda carrega — ou permanentemente, se o ID pedido não existir ou falhar.
Provável causa: `cachedRouteMatches` e `operationalMatches` consideram qualquer snapshot compatível quando `activeTrip` ainda é nulo, sem comparar o snapshot com `tripIdParam`. Isso ativa `showingOfflineSnapshot`, suprime o loading/erro online e define `effectiveTrip`/`effectiveStops` pelo cache antigo, embora a URL solicite outra viagem.

###############

Bug 690

Sintoma: Uma chegada, saída ou outra ação operacional rejeitada definitivamente pelo servidor pode exibir “Ação salva no aparelho” e “Será sincronizada automaticamente”, embora já esteja marcada como “Requer conferência” e não participe da recuperação automática normal.
Provável causa: `syncOne` captura erros não recuperáveis, grava o envelope como `needs_attention` e retorna normalmente `{ queued: true, error }`. Os consumidores, como `DriverStops`, tratam qualquer resultado `queued` como sucesso offline e ignoram `state` e `error`, fazendo o `onError` da mutation nunca executar.

###############

Bug 691

Sintoma: Se a leitura da fila operacional local falhar, os banners e as páginas do motorista passam a indicar zero ações pendentes; chegadas/saídas já salvas deixam de ser sobrepostas na tela e podem ser repetidas sem qualquer aviso de que a fila está indisponível.
Provável causa: `refreshPending` em `useDriverOperationalOffline` captura qualquer erro de `driverOfflineOutbox.list` e o converte silenciosamente em `commands = []` e `pending = 0`. O hook não expõe estado de erro, portanto `DriverOperationalSyncAgent` retorna `null` e os consumidores não distinguem fila vazia de IndexedDB inacessível/corrompido.

###############

Bug 692

Sintoma: O botão “Cheguei” pode aceitar o motorista fora do raio configurado para a entrega ou recusá-lo mesmo estando dentro dele; o comportamento manual diverge da geofence automática e da política do tenant sempre que o raio efetivo não é 500 metros.
Provável causa: `driver_mark_arrival(uuid, double precision, double precision, double precision)` mantém `v_max_distance_m` como constante de 500 e compara a posição somente com esse valor. A função não lê `dispatch_stops.geofence_radius_m`, `geofence_radius_is_override` nem `geofence_radius_policies`, introduzidos posteriormente para calcular o raio efetivo das geofences de entrega.

###############

Bug 693

Sintoma: Em uma viagem com várias cargas, abrir a Home ou a página de Paradas do motorista pode sobrescrever o snapshot operacional completo e deixar somente a carga primária; ao reabrir offline, as demais cargas somem do resumo e dos dados de custódia disponíveis.
Provável causa: `normalizeDriverTrip` reduz a relação `dispatch_trip_loads` a uma única propriedade `loads`. Os efeitos de `DriverHome` e `DriverStops` gravam `DriverOperationalSnapshot.loads` como um novo array contendo apenas essa carga sempre que ela existe, em vez de preservar/completar todas as cargas canônicas que `DriverCargoCustody` havia armazenado.

###############

Bug 694

Sintoma: Um motorista com muitas viagens planejadas pode deixar de ver sua viagem realmente em andamento e receber uma viagem planejada mais nova como “ativa”, caso a viagem iniciada seja mais antiga que as 20 primeiras.
Provável causa: `useActiveTrip` consulta todos os estados ativos juntos, ordena por `created_at desc` e aplica `.limit(20)` antes de `selectDriverCurrentTrip` priorizar `in_transit`/`in_progress`. Assim, viagens planejadas recentes podem expulsar do recorte a única viagem em execução.

###############

Bug 695

Sintoma: Estando online e sem viagem ativa, “Entregas e Coletas” pode abrir a última viagem guardada por até sete dias, ocultar erros das consultas atuais e permitir preencher/enfileirar um novo resultado contra uma viagem já concluída ou reatribuída.
Provável causa: Sem parâmetro `trip`, `readLatest` aceita qualquer `DriverOperationalSnapshot`; `trip = liveTrip ?? storedTrip` usa esse cache mesmo quando `useActiveTrip` conclui com `null`. Como `hasCachedOperation` também remove `driverQuery`, `tripQuery` e `stopsQuery` de `pageError`, o estado online ausente ou falho não invalida o snapshot antigo.

###############

Bug 696

Sintoma: Um envio de entrega que requer conferência por sessão expirada, anexo divergente, caminho de storage incompatível ou resposta remota inválida informa especificamente “Os documentos da parada mudaram”, levando motorista e operação a investigar a causa errada.
Provável causa: O resultado durável expõe `needs_attention` e `attention_code` para vários tipos de falha, mas o `onSuccess` de `submitEvent` testa somente o booleano e usa uma mensagem fixa de realocação fiscal. O código da atenção e sua mensagem real são ignorados.

###############

Bug 697

Sintoma: Uma entrega feita offline pode aceitar um canhoto pela regra básica mesmo quando o tenant ou o cliente possui política de qualidade mais rigorosa, registrando depois a prova como se a política aplicável fosse a baseline.
Provável causa: Offline, `DriverDeliveries` não armazena nem recupera a política resolvida e usa `baselineReceiptScanQualityPolicy`. No banco, `_normalize_delivery_receipt_quality_policy_metadata_v1` e o caminho NFS-e também substituem qualquer snapshot ausente ou com `source: baseline` pela baseline v1, em vez de resolver a política ativa do tenant/cliente; assim a regra customizada pode ser contornada justamente pelo fallback offline.

###############

Bug 698

Sintoma: Uma chamada direta ao RPC de entrega consegue registrar como legível um canhoto que viola os limiares da própria política anexada, bastando declarar `receipt_scan_quality.accepted = true` e `receipt_quality_confirmed = true`.
Provável causa: A validação do banco confirma caminhos, hashes, modo de captura e esses dois booleanos, e apenas verifica se o snapshot da política existe no catálogo. Nenhum trigger ou RPC compara brilho, contraste, nitidez, reflexo, dimensões ou corte informados em `receipt_scan_quality` com os `thresholds` da política normalizada; a decisão produzida no cliente é aceita como autoridade.

###############

Bug 699

Sintoma: Um envio offline antigo que deixe de satisfazer uma validação local da versão atual pode permanecer eternamente como “Aguardando conexão” e ser rejeitado em toda sincronização, sem mudar para “Requer conferência” nem revelar qual rascunho bloqueia a fila.
Provável causa: `replayPendingDeliverySubmissions` envolve `inputFromOfflineDraft`, a construção de `createDeliverySubmission` e `submit` em um `try/catch` que apenas incrementa `rejected`. Se a exceção ocorrer antes de o serviço durável executar `markAttention`, o registro continua `queued` inalterado e será repetido indefinidamente.

###############

Bug 700

Sintoma: Um resultado de entrega salvo offline pode ser sincronizado mesmo depois de sua chegada, jornada ou checklist anterior ter falhado definitivamente e estar aguardando conferência, quebrando a ordem causal capturada no aparelho e gerando um segundo conflito no resultado.
Provável causa: `driverDeliveryOfflineStore.hasPendingPredecessor` considera bloqueadores somente comandos não-entrega cuja criação é anterior e cujo estado seja diferente de `needs_attention`. Ao excluir justamente os antecessores definitivos da verificação, o replay libera a entrega seguinte em vez de mantê-la dependente da resolução operacional.

###############

Bug 701

Sintoma: Um comando de jornada pendente de uma viagem antiga pode mudar o estado exibido da jornada atual e fazer o próximo evento ser gravado/enfileirado contra a viagem antiga, especialmente quando aquela pendência ficou em “Requer conferência”.
Provável causa: `DriverJourney` transforma em `queuedJourney` todos os comandos locais com `kind === 'journey'`, sem filtrar `aggregateId` pela viagem ativa ou pela jornada aberta. Depois concatena esse conjunto aos eventos atuais e usa o último item para calcular `journeyState` e `tripId`.

###############

Bug 702

Sintoma: O checklist armazenado de uma viagem pode liberar indevidamente o início ou fim de jornada de outra viagem, mostrando o pré/pós-checklist como concluído mesmo quando o contexto vivo consultado pertence a um `tripId` diferente.
Provável causa: `DriverJourney` carrega `operationalSnapshot` pela viagem ativa/snapshot de rota, mas pode escolher `tripId` pela última jornada ainda aberta. `preCompleted` e `postCompleted` usam diretamente os arrays do snapshot como alternativa, sem exigir `operationalSnapshot.tripId === tripId`.

###############

Bug 703

Sintoma: Ao abrir diretamente o checklist de uma viagem válida por `?trip=...`, uma falha na busca automática da viagem ativa pode desabilitar ambos os checklists e mostrar erro, embora a viagem solicitada tenha sido carregada corretamente.
Provável causa: `DriverChecklist` sempre executa `useActiveTrip` e inclui `activeTrip.isError` no booleano global `failed`, mesmo quando `requestedTripId` tem precedência e a query `driver_checklist_trip` já validou a viagem explícita.

###############

Bug 704

Sintoma: Mesmo online e sem viagem ativa, a Home do motorista pode continuar mostrando como “Próximo destino” uma parada da última viagem armazenada por até sete dias, ao mesmo tempo em que exibe abaixo a ajuda de “nenhuma carga/viagem”; o atalho de navegação leva ao local antigo.
Provável causa: `cachedRouteMatches` aceita qualquer snapshot quando `primaryTrip` é nulo e `useCachedRoute` também vira verdadeiro incondicionalmente nesse caso, sem distinguir ausência confirmada de viagem online de indisponibilidade de rede. `destinationStops` e `nextStop` passam a usar o cache obsoleto mesmo com as consultas atuais concluídas.

###############

Bug 705

Sintoma: Quando a busca principal não encontra viagem ativa, o fallback por cargas pode devolver uma viagem já concluída/cancelada como atual ou informar nenhuma viagem, embora outra carga do motorista possua um vínculo válido.
Provável causa: `useActiveTrip` consulta `dispatch_trip_loads` para todos os IDs candidatos, ordena apenas pelo `created_at` do vínculo e aplica `.limit(1)` antes de validar motorista e estado da viagem. A consulta seguinte não filtra status e, se o único vínculo escolhido pertencer a outra atribuição, retorna `null` sem tentar os demais candidatos.

###############

Bug 706

Sintoma: Depois que uma tentativa retomada de cancelamento de viagem é recusada por revisão alterada ou novo impedimento, o diálogo fica preso no mesmo “Pedido preservado”: o botão apenas reenvia indefinidamente o comando já obsoleto e não permite atualizar a conferência, o motivo ou gerar uma nova solicitação.
Provável causa: No `catch` de `TripCancellationWorkspace`, a limpeza de `sessionStorage` e de `pending` para `TripCancellationRejected` só ocorre quando `!pending`; durante uma retomada `pending` já contém o comando salvo, portanto uma recusa definitiva mantém justamente o payload que o servidor continuará rejeitando.

###############

Bug 707

Sintoma: Uma correção de viagem materializada pode ser confirmada como tendo preservado os documentos fiscais (`fiscal_changed: false`) mesmo quando um documento vinculado é alterado ou inserido concorrentemente, deixando a fotografia de auditoria diferente do estado fiscal efetivamente comprometido junto com a correção.
Provável causa: `correct_materialized_dispatch_trip` recalcula o contexto fiscal e valida a revisão, mas não bloqueia linhas de `fiscal_documents` nem instala nessa tabela o `guard_materialized_trip_correction`; entre a leitura final do contexto e a gravação do journal, outra transação pode modificar ou criar documentos associados à carga sem disputar nenhuma das travas adquiridas pela correção.

###############

Bug 708

Sintoma: A “Geração Automática de ORT” sempre falha antes de chamar `create_ort_pickup_v1`, exibindo erro de persistência do comando mesmo quando o `localStorage` está disponível; nenhuma coleta é criada para as NFs selecionadas.
Provável causa: `OrtGeracaoTab` prepara a ação `create_ort_pickup`, que existe em `DurableOperatorAction`, mas a função `parse` de `durableOperatorCommand.ts` não inclui `create_ort_pickup` na lista de ações aceitas. Depois de gravar o comando, `prepareDurableOperatorCommand` o relê, o parser devolve `null` e a própria preparação lança `operator_command_durable_storage_failed`.

###############

Bug 709

Sintoma: Se a execução de um checklist for gravada no servidor mas a resposta se perder, o administrador recebe erro e pode reenviar o mesmo formulário; cada nova tentativa cria outra execução e, quando há reprovações, também duplica incidentes e ordens de manutenção para a mesma conferência.
Provável causa: `create_checklist_execution_v1` não recebe `request_id`, não possui journal/chave de idempotência e sempre insere novos registros. `handleExecute` apenas bloqueia cliques durante a promessa atual; no `catch` mantém o diálogo preenchido e permite uma nova chamada indistinguível após uma resposta incerta.

###############

Bug 710

Sintoma: Clicar duas vezes em “Auditar” ou “Confirmar” na auditoria em massa de notas importadas cria dois ou mais eventos de auditoria para a mesma nota; o segundo registro pode afirmar uma nova auditoria embora o estado legado já tenha sido limpo pela primeira chamada.
Provável causa: Os fluxos individual e em massa chamam `audit_imported_notes_v1` sem estado de envio que desabilite os botões, e o RPC não recebe chave idempotente nem verifica uma auditoria anterior: ele sempre insere uma nova linha em `entity_audit_log`, mesmo quando `imported_note_status` já é nulo.

###############

Bug 711

Sintoma: A Rastreabilidade de Produto pode exibir um evento “NF — — Fornecedor” sem número, data, valor, remetente ou destinatário para uma nota que foi excluída logicamente, mantendo um registro fiscal fantasma na linha do tempo.
Provável causa: Em `read_product_history_v1`, o `LEFT JOIN` com `fiscal_documents` exclui linhas com `deleted_at`, mas `matched_items` conserva `item.fiscal_document_id`. Depois, `document_events` testa apenas se esse ID do item não é nulo e cria o evento mesmo quando a junção não encontrou documento, usando todos os demais campos fiscais nulos.

###############

Bug 712

Sintoma: Uma ORT que “Requer revisão” pode ser aprovada ou rejeitada, mas o operador não consegue corrigir nenhum campo extraído; “Dados revisados” é apenas um bloco de JSON não editável e a aprovação pode consolidar exatamente os valores incorretos que motivaram a revisão.
Provável causa: `OrtConsultaTab` renderiza `reviewed_payload`/`extracted_payload` somente dentro de elementos `<pre>`. A ação `review` envia `detail.reviewed_payload || detail.extracted_payload || {}` sem oferecer formulário, editor ou estado local para alterar o payload, apesar de `review_ort_extraction_v1` aceitar `_reviewed_payload` como conteúdo da revisão.

###############

Bug 713

Sintoma: Uma extração de ORT já aplicada e vinculada a uma nota fiscal pode ser marcada posteriormente como “Rejeitada”, embora a nota criada/aplicada continue existindo; o histórico passa a afirmar rejeição para um efeito fiscal ainda ativo e a mesma extração pode alternar novamente para “Aplicado”.
Provável causa: O botão “Rejeitar” só é desabilitado quando o estado já é `rejected`, permanecendo ativo para `applied` e `reviewed`. No servidor, `review_ort_extraction_v1` não valida transições nem bloqueia revisões concluídas: para qualquer decisão `reject` ele grava `status = 'rejected'` mesmo quando `fiscal_document_id` já está preenchido, sem desfazer ou impedir o vínculo fiscal.

###############

Bug 714

Sintoma: Duas sessões que geram ou regeneram simultaneamente a folha de devolução da mesma ocorrência podem criar duas folhas ativas, inclusive com a mesma versão lógica; ambas recebem números diferentes e passam a disputar impressão, assinatura e cancelamento.
Provável causa: `generate_occurrence_return_sheet` procura a folha ativa com um `SELECT ... LIMIT 1` sem bloquear a ocorrência ou a folha encontrada, e a tabela possui apenas índice comum em `occurrence_id`, sem restrição única parcial para estados ativos. Transações concorrentes podem observar “nenhuma folha” (ou a mesma versão anterior) e inserir novos registros independentemente.

###############

Bug 715

Sintoma: É possível excluir uma coleta/ORT já vinculada ou finalizada; todas as NFs associadas perdem silenciosamente o vínculo, voltam a aparecer como candidatas para outra ORT e o histórico da coleta desaparece definitivamente.
Provável causa: `PickupOrders` exibe a ação de exclusão para qualquer estado e `useDeletePickupOrder` executa `DELETE` direto em `pickup_orders`, sem comando auditado nem verificação de vínculos. A FK `fiscal_documents_pickup_order_id_fkey` usa `ON DELETE SET NULL`, portanto a exclusão é aceita e desassocia em cascata os documentos em vez de bloquear a remoção de uma coleta materializada.

###############

Bug 716

Sintoma: Uma coleta já finalizada ou cancelada pode ser reaberta e ter remetente, destinatário, motorista, veículo, data, observações e snapshots históricos sobrescritos pela edição comum, sem registro da alteração.
Provável causa: A lista oferece “Editar” para todas as coletas e `update_pickup_order_v1` valida apenas tenant e `expected_updated_at`; o RPC não restringe o estado atual, não aplica uma máquina de transições e aceita qualquer status permitido pelo `CHECK`, atualizando diretamente também `driver_name_snapshot`, `vehicle_plate_snapshot`, `remitter_name` e `remitter_cnpj` sem evento de auditoria.

###############

Bug 717

Sintoma: A ação destrutiva “Reverter todos os XMLs” pode resetar cargas criadas manualmente e remover suas viagens, paradas, eventos e alocações, embora a confirmação afirme que somente viagens “criadas a partir de XMLs” serão afetadas.
Provável causa: `revert_xml_loads_to_available` classifica como carga de XML todo `load_id` que tenha ao menos um `load_items.fiscal_document_id` não nulo. Não há verificação de lote de importação, origem do documento/carga ou outro marcador de ingestão; como cargas operacionais normais também vinculam itens a notas fiscais, elas entram no mesmo `_load_ids` usado para apagar e resetar o grafo.

###############

Bug 718

Sintoma: “Entregas no período” no relatório do portal inclui entregas realizadas fora das datas escolhidas quando a NF foi emitida dentro do intervalo e omite entregas realizadas no intervalo cuja NF é mais antiga; os status, cidades, atrasos e tempo médio herdam o mesmo recorte temporal incorreto.
Provável causa: `get_client_portal_reports_summary_raw_20260917` filtra a base de entregas por `coalesce(f.issue_date, f.created_at::date) between v_start and v_end`, embora tenha `actual_arrival_at` e datas da parada/viagem disponíveis. Assim, o período da entrega é determinado pela emissão/criação do documento fiscal, não pela ocorrência física contabilizada.

###############

Bug 719

Sintoma: Entregas canceladas, puladas, recusadas, devolvidas ou já encerradas sem horário de chegada podem continuar sendo contadas como “atrasadas” no portal indefinidamente após o horário planejado.
Provável causa: A CTE `delayed` do resumo do portal testa somente `planned_arrival_at < now()` com `actual_arrival_at is null` (ou atraso superior a 30 minutos) e não exclui nenhum estado terminal de `deliveries.status`; portanto a ausência deliberada de chegada em uma parada terminal é interpretada como atraso ativo.

###############

Bug 720

Sintoma: Uma chamada autenticada pode criar uma coleta com IDs válidos de remetente, motorista e veículo, mas gravar nomes, CNPJ e placa de outras pessoas/veículos nos snapshots; listas, PDFs e auditorias passam a mostrar identidades que não correspondem aos vínculos reais.
Provável causa: O wrapper atual de `create_pickup_order_v1` confirma apenas que `remitter_client_id`, `driver_id` e `vehicle_id` pertencem ao tenant, mas delega ao legado `create_pickup_order_unsafe_20260917`, que grava diretamente `remitter_name`, `remitter_cnpj`, `driver_name_snapshot` e `vehicle_plate_snapshot` recebidos no payload em vez de derivá-los das linhas validadas.

###############

Bug 721

Sintoma: O campo “Remetente (Fornecedor)” permite selecionar clientes que não são fornecedores, criando coletas/ORTs atribuídas a uma entidade com papel comercial incompatível e contaminando filtros e relatórios por remetente.
Provável causa: `NewPickupOrderDialog` renderiza `clients.map(...)` sem filtrar `is_supplier`, enquanto `create_pickup_order_v1` e `update_pickup_order_v1` verificam apenas existência e tenant do `remitter_client_id`; nenhum dos caminhos exige que o cliente selecionado esteja cadastrado como fornecedor.

###############

Bug 722

Sintoma: Reutilizar o mesmo `request_id` de uma geração automática de ORT com uma lista diferente de `document_ids` não gera conflito: as novas NFs são acrescentadas à coleta já criada, alterando o resultado de um pedido que deveria ser uma reprodução idêntica e imutável.
Provável causa: `create_ort_pickup_v1` não mantém journal/hash próprio do payload completo. Ele chama `create_pickup_order_v1(_payload - 'document_ids')`, cuja idempotência ignora justamente a lista de documentos; numa repetição, recebe a coleta em cache e depois valida/vincula o novo conjunto informado à mesma `pickup_order_id`.

###############

Bug 723

Sintoma: Um único CT-e autorizado com valor de ICMS malformado no payload torna a auditoria de Simples Nacional/MEI inteira indisponível, impedindo que o operador visualize inclusive todas as outras violações fiscais válidas do tenant.
Provável causa: `monitor_simples_nacional_icms_violations` converte `baseIcms`, `aliquotaIcms` e `valorIcms` diretamente com `::numeric` tanto no filtro quanto no resultado. Qualquer texto não vazio que o PostgreSQL não reconheça como número aborta a consulta completa, sem normalização nem isolamento da linha inválida.

###############

Bug 724

Sintoma: Uma execução de checklist pode registrar um item reprovado com texto arbitrário diferente do template; o histórico, o incidente e a ordem de manutenção passam a descrever uma falha forjada ou enganosa, embora a chave do item seja válida.
Provável causa: `create_checklist_execution_command_v1` valida apenas quantidade, unicidade e correspondência das chaves, mas persiste `_checked_items` integralmente e compõe `v_failed_labels` com `item->>'label'` enviado pelo cliente. O rótulo canônico existente em `v_checklist.items` nunca é comparado nem usado para reconstruir a evidência.

###############

Bug 725

Sintoma: O indicador “Prazo médio (dias)” do portal pode mostrar zero, valor negativo ou apenas a diferença em relação à previsão para entregas cujo início real da viagem não foi registrado, em vez do tempo transcorrido da operação até a entrega.
Provável causa: A CTE `avg_time` calcula `actual_arrival_at - coalesce(trip_started_at, planned_arrival_at)`. Quando `actual_start_at` está ausente, usa o horário planejado de chegada como início do trajeto; assim uma chegada antecipada gera duração negativa e uma chegada pontual gera duração próxima de zero, grandezas que não representam prazo de entrega.

###############

Bug 726

Sintoma: Em cargas legadas ou ainda não alocadas a paradas, várias entregas para destinatários/cidades diferentes podem aparecer no relatório do portal como uma única entrega, com status e cidade escolhidos arbitrariamente de apenas uma das NF-es.
Provável causa: `get_client_portal_reports_summary_raw_20260917` define `delivery_key` como `load:<load_id>` sempre que não encontra `stop_id`, sem incluir cliente, destinatário ou destino. Depois, `deliveries` usa `distinct on (delivery_key)` e conserva uma única linha da carga, embora o modelo permita múltiplos documentos e destinos dentro dela.

###############

Bug 727

Sintoma: Se o servidor gravar uma atualização de progresso ou previsão do motorista mas a resposta se perder, repetir a ação cria outro registro; no progresso, a quantidade entregue é somada novamente e pode alterar indevidamente cidade, saldo e status do monitor.
Provável causa: `useAddProgressUpdate` e `useAddForecast` geram `crypto.randomUUID()` dentro de cada nova execução e não preservam uma intenção pendente para recuperação. Embora os RPCs dedupliquem por `request_id`, uma tentativa manual após resposta incerta sempre usa outra chave e é tratada como comando novo.

###############

Bug 728

Sintoma: Uma planilha pode importar uma previsão de chegada atual e ainda deixar a rota classificada como “Sem atualização”, usando como última atualização apenas uma linha antiga de progresso; a mesma previsão cadastrada manualmente retiraria esse estado.
Provável causa: No laço de previsões de `import_driver_monitoring_workbook_v1`, o `UPDATE` de `driver_route_monitors` altera previsão, cidade, `updated_at` e revisão, mas não altera `last_update_at` nem recalcula `status`. Já `add_driver_forecast_v1` define `last_update_at = clock_timestamp()` e chama `driver_monitor_effective_status`, produzindo semânticas diferentes para o mesmo fato conforme a origem.

###############

Bug 729

Sintoma: Importar planilhas diferentes pode criar simultaneamente duas ou mais rotas abertas para o mesmo motorista, inclusive sobrepostas no mesmo período, deixando KPIs e acompanhamento sem uma rota ativa inequívoca.
Provável causa: `import_driver_monitoring_workbook_v1` insere diretamente em `driver_route_monitors` e não executa a verificação de sobreposição por motorista/veículo/carga existente em `apply_driver_monitor_command`. O fingerprint impede somente repetir o mesmo arquivo; arquivos distintos e concorrência com o cadastro manual ignoram esse invariante.

###############

Bug 730

Sintoma: “Entregas próxima” no registro de progresso aceita números negativos ou absurdamente maiores que o total da rota e os preserva no histórico de atualizações, produzindo previsões operacionais impossíveis.
Provável causa: O input `next_qty` não possui `min`/`max`, `saveProgress` valida apenas `qty`, e `add_driver_progress_v1` restringe somente `deliveries_completed_in_city`. `next_city_deliveries` é convertido diretamente para inteiro e a tabela não possui restrição equivalente.

###############

Bug 731

Sintoma: Consultar o histórico de um produto pelo nome exato mistura itens diferentes que apenas contêm esse texto; por exemplo, buscar “ARROZ” também agrega “ARROZ BRANCO” e “FARINHA DE ARROZ”, somando quantidades, cargas, destinos e documentos numa única trajetória.
Provável causa: `read_product_history_v1` seleciona itens com `position(lower(v_product) in lower(item_description)) > 0` mesmo quando o usuário escolhe uma descrição completa no autocomplete. Não existe modo de correspondência exata nem identidade de produto, e todas as descrições parcialmente coincidentes alimentam os mesmos agregados.

###############

Bug 732

Sintoma: Um checklist reprovado avisa “operação será bloqueada” e aparece no KPI de bloqueios, mas o veículo, a viagem e os fluxos de despacho continuam utilizáveis normalmente; o suposto bloqueio não impede nenhuma operação posterior.
Provável causa: `create_checklist_execution_v1` apenas grava `blocked_operation = true` na própria linha de `checklist_executions`. Não altera estado da viagem/veículo, não cria vínculo obrigatório com a operação e nenhum comando operacional consulta essa coluna antes de liberar planejamento, despacho ou execução.

###############

Bug 733

Sintoma: A confirmação de “Auditar em massa” informa que o status das notas “será alterado para processado”, mas a operação atual pode fazer exatamente o contrário e remover o status legado `processed`; o usuário autoriza uma mudança diferente da que é executada.
Provável causa: O texto do `AlertDialogDescription` em `ImportedNotesSummary` permaneceu baseado no fluxo antigo. O RPC `audit_imported_notes_v1` agora atualiza `imported_note_status` para `null` quando ele vale `processed` e não grava esse status nas demais notas.

###############

Bug 734

Sintoma: É possível excluir pelo Resumo de Notas Importadas uma NF já carregada, despachada, entregue ou usada por CT-e/NFS-e; ela desaparece das consultas fiscais e perde `load_id`, mas itens, paradas, comprovantes e documentos derivados podem continuar apontando para seu UUID, fragmentando a rastreabilidade da operação concluída.
Provável causa: Os botões individual e em massa não restringem o estado da nota, e `soft_delete_fiscal_document` verifica apenas autenticação/papel. O RPC define `deleted_at`, `status = 'deleted'` e `load_id = null` sem validar dependências materializadas nem corrigir/rejeitar vínculos em `load_items`, paradas de despacho, provas e emissões derivadas.

###############

Bug 735

Sintoma: ORTs importadas e já vinculadas a uma NF aparecem com status técnicos sem rótulo — como `saved_and_linked`, `auto_saved_for_grouping` ou `imported_on_execute` —, não podem ser encontradas por nenhum status do seletor e não entram no indicador “Aplicadas”, apesar de já terem sido materializadas.
Provável causa: `recordOrtAudit` grava quatro estados de ingestão (`saved`, `saved_and_linked`, `auto_saved_for_grouping`, `imported_on_execute`), enquanto `OrtConsultaTab` e `review_ort_extraction_v1` reconhecem apenas `pending`, `reviewed`, `applied` e `rejected`. Não há normalização ou migração entre os dois vocabulários de estado.

###############

Bug 736

Sintoma: Em empresas com muitas NFs elegíveis, “Buscar candidatas” pode travar ou estourar limites de resposta/memória, e a tabela inteira fica pesada antes mesmo de qualquer seleção; não há como carregar apenas uma página de resultados.
Provável causa: `read_ort_candidates_v1` agrega o conjunto completo em um único `jsonb_agg`, sem limite, cursor ou total separado. `OrtGeracaoTab` recebe esse JSON integral, calcula totais no navegador e renderiza `candidates.map(...)` sem paginação ou virtualização; a correção do antigo corte em 500 trocou truncamento por materialização ilimitada.

###############

Bug 737

Sintoma: Criar uma ORT manual com “Gerar título no financeiro” marcado informa sucesso, mas nenhum título, recebível ou parcela é criado; valor a receber, condição, vencimento, conta e centro de custo não aparecem em nenhum fluxo financeiro.
Provável causa: `NewManualOrtDialog` envia todos os campos da aba Pagamento apenas dentro de `pickup_orders.manual_meta`. `useCreatePickupOrder`/`create_pickup_order_v1` criam somente a coleta, e `gera_titulo_financeiro` e os demais campos financeiros não são lidos em nenhum outro ponto do código.

###############

Bug 738

Sintoma: Um operador sem perfil administrativo pode cancelar diretamente uma folha de devolução, inclusive já assinada, substituída ou cancelada; chamadas repetidas continuam acrescentando eventos de cancelamento e podem trocar um estado terminal por outro, apesar de a interface reservar essa ação ao administrador.
Provável causa: `OccurrenceReturnSheetPage` exibe “Cancelar folha” somente para `isAdmin`, mas `cancel_occurrence_return_sheet` autoriza `is_tenant_operator_or_admin`. O RPC também não bloqueia a linha nem valida o status atual antes do `UPDATE status = 'cancelled'` e da inserção do histórico.

###############

Bug 739

Sintoma: Alterar o filtro “Zona rural” entre “Todos”, “Apenas rural” e “Excluir rural” não muda nenhuma linha, indicador ou exportação dos Relatórios de Ocorrências.
Provável causa: `OccurrenceReports` mantém o estado `rural`, mas não o inclui no objeto `filters` enviado a `useOccurrences`; o hook também não implementa qualquer condição rural. O seletor é inteiramente desconectado da consulta e dos cálculos.

###############

Bug 740

Sintoma: Ao ultrapassar 500 ocorrências, registros mais antigos somem das tabelas e os KPIs e arquivos PDF/Excel/CSV passam a representar apenas o recorte recente, embora sejam apresentados como totais do período filtrado.
Provável causa: `useOccurrences` encerra a consulta com `.limit(500)` sem paginação, contagem ou aviso de truncamento. `aggregateOccurrences`, as abas e todos os geradores de relatório trabalham diretamente sobre esse mesmo array parcial.

###############

Bug 741

Sintoma: Falhas ao consultar ocorrências, histórico de envios ou lotes importados aparecem como KPIs zerados e tabelas vazias normais; a página ainda oferece exportações com base no fallback, sem informar que as fontes estão indisponíveis.
Provável causa: `OccurrenceReports` extrai apenas `data`/`isLoading` de `useOccurrences` e somente `data` das outras queries, sempre com `[]` como fallback. Nenhum `isError`, `error` ou mecanismo de repetição é renderizado.

###############

Bug 742

Sintoma: “Valor total NFs” fica zerado e as colunas/totais monetários de relatórios de devolução e notas sem saída saem como R$ 0,00 mesmo quando a planilha importada contém valores de nota.
Provável causa: `delivery_occurrences` não expõe `invoice_value` no tipo consultado; a importação guarda o valor legado apenas em `metadata.invoice_value`. `aggregateOccurrences` procura uma propriedade inexistente e os mapeamentos de `generateReturnedReport`/`generateUnservedReport` definem `invoice_value: 0` literalmente.

###############

Bug 743

Sintoma: O Histórico de Envios pode conter um relatório com contagem e totais declarados, mas sem nenhuma linha consultável, quando a gravação dos itens falha; a tentativa é informada como erro embora o cabeçalho órfão já tenha sido persistido.
Provável causa: `useCreateExport` insere primeiro `occurrence_report_exports` e depois, em outra requisição, insere `occurrence_report_export_items`. Não há RPC transacional nem compensação para remover o cabeçalho quando a segunda etapa falha.

###############

Bug 744

Sintoma: Um PDF, Excel ou CSV de ocorrências pode ser baixado com sucesso e logo depois a tela informar “Erro ao registrar snapshot”; o arquivo já saiu do sistema sem histórico correspondente e uma repetição baixa outra cópia potencialmente idêntica.
Provável causa: `generateReturnedReport` e `generateUnservedReport` executam `pdf.save`/`downloadBlob` antes de aguardar `createExport.mutateAsync`. O efeito externo irreversível ocorre antes da preservação auditada que deveria identificar exatamente o relatório emitido.

###############

Bug 745

Sintoma: Relatórios de ocorrências salvos no Histórico de Envios registram `occurrence_count = 0` mesmo contendo várias ocorrências; uma linha legada com várias NFs separadas por `/` também é contabilizada como uma única nota.
Provável causa: Os mapeamentos de `generateReturnedReport` e `generateUnservedReport` omitem `occurrence_id`, então o `Set` usado por `useCreateExport` fica sempre vazio. A contagem de notas usa a string inteira de `invoice_number` e não chama `splitInvoiceNumbers`, embora importações de “sem saída” concatenem múltiplos números nesse campo.

###############

Bug 746

Sintoma: O “Histórico de Envios” lista que um relatório foi gerado/enviado, mas não permite abrir, baixar nem conferir as linhas do snapshot; erros, divergências ou o conteúdo exato enviado não podem ser auditados pela própria interface.
Provável causa: A aba consulta somente `occurrence_report_exports` e renderiza metadados e o botão “Marcar enviado”. Nenhuma consulta lê `occurrence_report_export_items` ou `generated_snapshot`, e não existe ação de detalhe/reconstrução do arquivo preservado.

###############

Bug 747

Sintoma: Informar a data inicial posterior à final nos Relatórios de Ocorrências produz KPIs zerados e tabelas “sem linhas”, fazendo um período inválido parecer ausência real de ocorrências.
Provável causa: Os campos de período não possuem `min`/`max` cruzados nem validação de ordem. `useOccurrences` aplica simultaneamente `gte(periodStart)` e `lte(periodEnd)`, combinação impossível, sem rejeitar ou sinalizar o intervalo invertido.

###############

Bug 748

Sintoma: Um usuário membro de várias empresas pode abrir “Marcar enviado” num relatório da empresa A, trocar o tenant ativo e confirmar o diálogo ainda aberto; o relatório da empresa A é alterado enquanto a interface já está na empresa B, e o cache invalidado é o da empresa errada.
Provável causa: `useMarkExportSent` faz `UPDATE occurrence_report_exports` somente com `.eq('id', params.id)`, sem `.eq('tenant_id', activeTenantId)` nem revisão esperada. A RLS autoriza qualquer tenant do qual o usuário seja membro, e `sendDialog` não é limpo quando o tenant ativo muda.

###############

Bug 749

Sintoma: Importar novamente a mesma planilha legada de ocorrências duplica todas as ocorrências e cria outro lote completo, inflando relatórios de devolução, faltas, sobras e notas sem saída sem qualquer aviso de arquivo repetido.
Provável causa: A idempotência de `import_occurrence_report_batch_v1` cobre apenas a repetição do mesmo `request_id` preservado após resposta incerta. Cada seleção normal do arquivo gera outro UUID; lote e função não guardam fingerprint do conteúdo nem chave natural por ocorrência/linha para reconhecer uma reimportação.

###############

Bug 750

Sintoma: Um usuário do portal sem permissão `can_open_occurrences` para determinado cliente consegue chamar os RPCs diretamente para ler toda a conversa de uma ocorrência visível e enviar novas mensagens nela, embora a interface esconda o botão “Conversar”.
Provável causa: `list_client_occurrence_messages_v2` e `reply_client_occurrence` verificam apenas se `client_id` pertence a `_portal_user_client_ids(_tenant_id)`. Diferentemente de `create_client_occurrence`, nenhum deles chama `_portal_user_has_perm(..., 'can_open_occurrences')`; a restrição existe somente na renderização de `PortalOccurrences` e pode ser contornada pela API.

###############

Bug 751

Sintoma: Se o portal concluir uma solicitação de coleta mas a resposta se perder por timeout ou queda de conexão, tentar novamente cria outra coleta pendente para o mesmo cliente, data e conteúdo.
Provável causa: `request_client_pickup` não recebe `request_id`, não registra hash/resultado em ledger idempotente e insere sempre uma nova linha. `useRequestPortalPickup` também não preserva uma identidade da tentativa, portanto qualquer reenvio após resultado incerto é interpretado como uma nova solicitação.

###############

Bug 752

Sintoma: Uma coleta que era pendente quando o cliente iniciou o cancelamento pode terminar cancelada mesmo que, no intervalo, um operador a tenha vinculado ou finalizado; o estado mais avançado é sobrescrito silenciosamente.
Provável causa: `cancel_client_pickup` lê `status` sem `FOR UPDATE` e depois executa `UPDATE pickup_orders SET status = 'cancelada' WHERE id = _pickup_id`, sem repetir `status = 'pendente'` nem conferir a quantidade alterada. Uma transação concorrente pode mudar o estado entre a validação e o update, que aguardará o lock e ainda gravará o cancelamento sobre o valor novo.

###############

Bug 753

Sintoma: Durante o carregamento de um histórico extenso no portal, coletas podem aparecer duplicadas ou desaparecer quando várias têm o mesmo horário ou quando uma linha é inserida entre duas páginas.
Provável causa: `list_client_pickups_v2` pagina com `LIMIT/OFFSET`, mas ordena somente por `pickup_at DESC`, sem `id` como desempate estável e sem snapshot. `fetchAllPostgrestPages` encadeia essas páginas enquanto empates e inserções podem deslocar suas fronteiras.

###############

Bug 754

Sintoma: Em celular, uma falha de rede, permissão ou servidor ao carregar Canhotos/POD aparece como “Sem canhotos”, sem mensagem de erro nem opção de tentar novamente; a mesma falha é informada corretamente na tabela desktop.
Provável causa: O ramo desktop de `PortalPods` testa `error` após `isLoading`, mas o ramo mobile testa apenas `isLoading` e `filtered.length === 0`. Como o hook fornece `pods = []` quando `data` está ausente, qualquer erro no layout menor que `md` é convertido em estado vazio legítimo.

###############

Bug 755

Sintoma: Um usuário do portal sem permissão financeira consegue obter pela API o CPF/CNPJ do recebedor de cada canhoto acessível, embora esse dado seja omitido no detalhe do embarque quando `can_view_financial` é falso e nem seja exibido na lista.
Provável causa: `list_client_pods_v2` retorna `pod.receiver_document` incondicionalmente para qualquer usuário que possa acessar o documento fiscal. Já `get_client_portal_shipment_detail` aplica `CASE WHEN _can_financial THEN p.receiver_document END`, deixando a proteção inconsistente e permitindo contornar a ocultação chamando o RPC de listagem.

###############

Bug 756

Sintoma: Depois que uma nota fiscal é excluída logicamente, seu canhoto ainda pode aparecer no portal e continuar sendo baixado por URL assinada, enquanto abrir o detalhe da nota é recusado por ela estar excluída.
Provável causa: `list_client_pods_v2`, `portal_user_can_access_fiscal_document` e `portal_user_can_download_fiscal_document` não exigem `fiscal_documents.deleted_at IS NULL`. O detalhe atual faz essa verificação, mas `get_client_pod_metadata` delega ao helper de download sem filtro e ainda libera o caminho do arquivo à Edge Function.

###############

Bug 757

Sintoma: Quando o Storage falha ao gerar a URL de um canhoto, a resposta perde o erro original e vira “Could not sign or audit POD access”; além disso, a tentativa rejeitada não é registrada na auditoria.
Provável causa: No ramo `signErr`, `get-client-pod-signed-url` chama `log_pod_access_v2` com o argumento `_error_message`, mas a função SQL aceita somente tenant, POD, documento, ator, sucesso e fonte. O PostgREST não encontra essa assinatura, a auditoria falha e a Edge Function substitui a falha de assinatura por um erro genérico de auditoria.

###############

Bug 758

Sintoma: No escopo “Todos os clientes”, ter permissão de download para apenas um cliente faz o botão “Baixar” aparecer também nos canhotos dos demais; esses botões inevitavelmente falham somente depois do clique com erro de acesso.
Provável causa: `PortalClientScope.can('can_download_documents')` usa `some` sobre todos os acessos ativos, e `PortalPods` reutiliza esse único booleano em todas as linhas. `list_client_pods_v2` não retorna `client_id` nem uma permissão calculada por documento, portanto a interface não consegue restringir a ação por canhoto como o backend faz.

###############

Bug 759

Sintoma: Notas fiscais excluídas logicamente continuam aparecendo nas páginas “Documentos” e “Mercadorias” do portal; ao tentar abri-las, o usuário encontra “Documento não disponível”, pois o detalhe rejeita a mesma nota.
Provável causa: `list_client_documents_v2` e `search_client_portal_shipments_v2` consultam `fiscal_documents` sem `deleted_at IS NULL`, e `portal_user_can_access_fiscal_document` também considera linhas excluídas. Já `get_client_portal_shipment_detail` exige explicitamente que `deleted_at` seja nulo, criando uma lista de links para recursos que o próprio detalhe bloqueia.

###############

Bug 760

Sintoma: A página “Documentos” pode exibir o ícone verde de POD para uma nota cujo único canhoto está rejeitado, ausente ou já foi aposentado e substituído, sugerindo que há comprovante atual disponível quando não há.
Provável causa: O campo `has_pod` de `list_client_documents_v2` usa apenas `EXISTS` sobre toda a tabela `proof_of_delivery`, sem restringir `is_active`, consultar `current_delivery_proofs`/`available_delivery_proofs`, exigir arquivo ou filtrar estados `uploaded`/`validated`.

###############

Bug 761

Sintoma: Uma única ocorrência aberta e genérica de um cliente pode marcar todas as mercadorias desse cliente como “Com ocorrência”; se for grave, todas também passam a exibir status público de exceção, mesmo sem vínculo com aquelas notas, cargas ou paradas.
Provável causa: Tanto `search_client_portal_shipments_v2` quanto `get_public_shipment_status` aceitam como relacionada a condição `oe.client_id = fd.client_id AND oe.fiscal_document_id IS NULL`, sem exigir `load_id`, `dispatch_stop_id` ou outro vínculo operacional. Assim, um evento apenas no nível do cliente é replicado logicamente para cada documento desse cliente.

###############

Bug 762

Sintoma: Ao navegar pelas páginas de Documentos ou Mercadorias enquanto há novas inserções/atualizações, uma nota pode saltar de página, aparecer duas vezes ou não aparecer; empates de data também produzem fronteiras não determinísticas.
Provável causa: `list_client_documents_v2` e `search_client_portal_shipments_v2` usam paginação por `LIMIT/OFFSET` ordenada apenas por datas mutáveis (`issue_date` com `created_at` ou `updated_at`), sem `id` como desempate e sem snapshot. Alterações entre requisições reordenam o conjunto que os offsets pressupõem imóvel.

###############

Bug 763

Sintoma: O atalho “Saiu para entrega” em Mercadorias normalmente retorna zero resultados mesmo quando a tabela e o detalhe mostram remessas nesse status público.
Provável causa: O chip envia `_status = ['out_for_delivery']`, e `search_client_portal_shipments_v2` compara esse valor com `fiscal_documents.status`. Entretanto, `out_for_delivery` é produzido por `get_public_shipment_status` quando a parada está `departed`; não há fluxo que grave esse valor no status fiscal, portanto o filtro consulta a coluna errada.

###############

Bug 764

Sintoma: Uma carga replanejada pode aparecer duas ou mais vezes no Tracking do portal, inclusive com motorista, veículo, posição e próxima parada de uma viagem antiga ou cancelada; selecionar a carga destaca todos os cartões duplicados e o mapa sofre colisão de chaves.
Provável causa: `get_client_portal_tracking` faz `LEFT JOIN dispatch_trip_loads` por `load_id` e aceita todos os vínculos históricos, sem escolher a viagem vigente nem filtrar `dispatch_trips.status` ou tenant. Cada vínculo gera uma linha de `enriched`, enquanto a interface usa somente `load_id` como identidade e chave React.

###############

Bug 765

Sintoma: O Tracking pode anunciar como “próxima parada” uma parada cancelada, pulada, recusada ou até concluída que não possui `actual_departure_at`, ocultando o próximo destino operacional verdadeiro.
Provável causa: A subconsulta `next_stop` de `get_client_portal_tracking` exige apenas `dispatch_trip_id` e `actual_departure_at IS NULL`, ordenando por `stop_order`. Ela não exclui `stop_terminal_statuses()` nem prioriza estados realmente pendentes/ativos.

###############

Bug 766

Sintoma: O Tracking fica progressivamente pesado e pode exceder limites de resposta/memória quando um cliente acumula muitas cargas ativas ou uma carga possui muitas notas, embora a tela normalmente mostre apenas três notas por cartão.
Provável causa: `get_client_portal_tracking` agrega todas as cargas elegíveis e, dentro de cada uma, todas as `fiscal_documents` em um único JSON, sem limite, cursor ou paginação. A interface recebe e mantém o conjunto integral e só aplica `documents.slice(0, 3)` depois da transferência.

###############

Bug 767

Sintoma: Uma carga pode continuar aparecendo no Tracking porque contém somente notas excluídas logicamente, e notas excluídas também permanecem listadas dentro de cartões de cargas que ainda são válidas.
Provável causa: Tanto a CTE `base` quanto a agregação `documents` de `get_client_portal_tracking` consultam `fiscal_documents` sem `deleted_at IS NULL`. Assim, linhas apagadas ainda qualificam a carga e são serializadas normalmente para o portal.

###############

Bug 768

Sintoma: O popup dos veículos no mapa de Tracking nunca mostra a próxima parada por cidade/UF, mesmo quando a nota vinculada possui cidade e estado de destino; esse contexto aparece somente em outras partes do cartão.
Provável causa: `get_client_portal_tracking` constrói `next_stop` com `'city', NULL::text` e `'state', NULL::text`. `PortalTrackingMap` renderiza “Próxima parada” exclusivamente quando `i.next_stop.city` existe e não usa o campo `destination`, tornando esse trecho do popup inalcançável pelo contrato atual.

###############

Bug 769

Sintoma: O indicador “Coletas programadas” do dashboard do portal permanece sempre em zero, mesmo quando existem coletas futuras pendentes ou já vinculadas.
Provável causa: `get_client_portal_summary_v2` conta somente `pickup_orders.status = 'agendada'`, mas o `CHECK pickup_orders_status_check` aceita apenas `pendente`, `vinculada`, `finalizada` e `cancelada`. Nenhum fluxo consegue gravar o estado consultado pelo KPI.

###############

Bug 770

Sintoma: Notas excluídas logicamente continuam inflando indicadores do dashboard, podem reaparecer em “Próximas entregas” e gerar alertas de atraso ou canhoto pendente com links que levam a um detalhe indisponível.
Provável causa: A CTE `fds` de `get_client_portal_summary_v2` e as consultas de documentos em `get_client_portal_upcoming_deliveries` e `get_client_portal_alerts` não aplicam `fiscal_documents.deleted_at IS NULL`.

###############

Bug 771

Sintoma: O cartão “Ocorrências abertas” pode mostrar zero ou um número menor que a lista de alertas e a página de ocorrências, omitindo casos ainda em análise ou aguardando ação do cliente.
Provável causa: `get_client_portal_summary_v2` conta exclusivamente `public_status = 'open'`, enquanto `get_client_portal_alerts` considera também `in_analysis` e `client_action_required`. Estados ainda não resolvidos usam definições diferentes entre os dois componentes do mesmo dashboard.

###############

Bug 772

Sintoma: Perto da meia-noite no Brasil, entregas podem entrar um dia antes ou depois nos cartões “Entregas hoje” e “Entregas amanhã”.
Provável causa: `get_client_portal_summary_v2` compara `planned_arrival_at::date` com `CURRENT_DATE` sem converter o timestamp para o fuso do tenant ou para `America/Sao_Paulo`. O banco normalmente opera em UTC, enquanto a interface apresenta as datas no horário local.

###############

Bug 773

Sintoma: “Próximas entregas” pode listar documentos sem previsão alguma e entregas previstas até um dia atrás, ao mesmo tempo em que não possui horizonte máximo para definir o que significa “próximas horas”.
Provável causa: `get_client_portal_upcoming_deliveries` aceita `(planned_arrival_at IS NULL OR planned_arrival_at >= now() - interval '1 day')` e não impõe limite superior. Linhas nulas entram no resultado e qualquer previsão futura, por mais distante que seja, é elegível.

###############

Bug 774

Sintoma: A mesma mercadoria pode aparecer com um status no bloco “Próximas entregas” e com outro na página de Mercadorias ou no detalhe, omitindo exceção, chegada ao destino, saída para entrega, devolução e disponibilidade de canhoto.
Provável causa: `get_client_portal_upcoming_deliveries` fabrica `public_status` com um `CASE` de apenas quatro resultados baseado em `fiscal_documents.status`, em vez de chamar `get_public_shipment_status`, que também considera parada, carga, ocorrências e POD.

###############

Bug 775

Sintoma: O dashboard pode omitir alertas críticos e exibir avisos informativos mais recentes ou arbitrários entre os dez retornados, apesar de a lista final aparentar estar ordenada por severidade.
Provável causa: `get_client_portal_alerts` executa `SELECT * FROM unioned LIMIT _limit` sem `ORDER BY` e somente depois ordena o subconjunto dentro de `jsonb_agg`. A prioridade visual não participa da escolha das linhas que sobrevivem ao limite.

###############

Bug 776

Sintoma: Um canhoto explicitamente rejeitado gera apenas o alerta genérico “Canhoto pendente”, sem informar ao cliente que o arquivo foi recusado e precisa de correção.
Provável causa: A CTE `pods` de `get_client_portal_alerts` considera pendente qualquer entrega sem prova `uploaded`/`validated`; não existe ramo para estado `rejected`, embora o contrato TypeScript declare o tipo `pod_rejected`. Assim, rejeição e ausência de envio são indistinguíveis no dashboard.

###############

Bug 777

Sintoma: Títulos faturados e ainda não recebidos desaparecem da aba “Em aberto” do portal; na aba “Todos”, o mesmo estado aparece cru como `invoiced` em vez de um rótulo em português.
Provável causa: `STATUS_FILTERS` inclui `pending`, `open`, `overdue` e `partial`, mas omite o estado canônico `invoiced` usado por `receivables`. `statusLabel` também não possui tradução para `invoiced`, deixando filtro e apresentação incompatíveis com o modelo financeiro atual.

###############

Bug 778

Sintoma: Um título cancelado pode continuar mostrando “Saldo” positivo no portal, fazendo uma cobrança extinta parecer ainda devida ao cliente.
Provável causa: `private.portal_read_financial_titles` calcula `outstanding_amount` sempre como `greatest(amount - received_amount, 0)`, sem zerar o saldo quando `r.status = 'cancelled'`. A página exibe esse valor com destaque mesmo para títulos cancelados na aba “Todos”.

###############

Bug 779

Sintoma: Um usuário do portal pode visualizar e baixar uma NFS-e que não está vinculada à sua nota nem ao seu cliente, bastando que ela referencie um CT-e que também agrega aquela nota entre documentos de clientes diferentes; valores, tomador e arquivo fiscal de terceiro podem ser expostos.
Provável causa: `private.portal_read_fiscal_bundle` inclui NFS-e quando `n.related_cte_ids` contém qualquer CT-e cujo `fiscal_document_ids` contém a nota consultada. Esse ramo transitivo não exige que `n.fiscal_document_ids` contenha a própria nota, que `n.cliente_id` corresponda ao cliente autorizado ou que o pagador/tomador pertença ao mesmo escopo; a mesma regra alimenta `v_allowed` e autoriza o download integral.

###############

Bug 780

Sintoma: O detalhe de uma mercadoria devolvida, recusada, não entregue ou cancelada pode exibir o status público “Recebida”; uma parada já chegada ou que saiu para entrega também não atualiza esse status como ocorre na listagem.
Provável causa: `get_client_portal_shipment_detail_v2` calcula `document.public_status` com um `CASE` simplificado que cobre apenas ocorrência `open`, entrega/POD, `in_transit` e `loading/loaded`, usando `received` para todo o restante. Ele não reutiliza `get_public_shipment_status`, que trata estados terminais e estados da parada.

###############

Bug 781

Sintoma: A Timeline pode mudar retroativamente a data de “Vinculada à carga” ou “Entrega concluída” quando alguém apenas edita a carga ou a nota depois da operação, fazendo eventos históricos parecerem ter ocorrido no momento da última alteração cadastral.
Provável causa: `get_client_portal_shipment_detail_v2` fabrica o evento de vínculo usando `loads.updated_at` e o evento de entrega usando `fiscal_documents.updated_at`, em vez de timestamps imutáveis do vínculo, da saída/chegada ou do evento de conclusão.

###############

Bug 782

Sintoma: Um canhoto rejeitado que ainda possui arquivo é rotulado no cabeçalho como “Canhoto disponível”, pode determinar o botão principal “Baixar canhoto” e parece uma prova válida, apesar do estado de rejeição.
Provável causa: `PortalShipmentDetail` define `firstPod` como o primeiro comprovante atual com `has_file`, sem exigir status `uploaded` ou `validated`. A disponibilidade pública usada pelo backend exige esses estados via `available_delivery_proofs`, mas o cabeçalho e a ação principal usam apenas a presença física do arquivo.

###############

Bug 783

Sintoma: Um usuário que acessa uma nota legitimamente como remetente ou destinatário pode perder placa, tracking e contato do motorista mesmo tendo essas permissões habilitadas na concessão que lhe deu acesso ao documento.
Provável causa: A autorização de documento aceita correspondência por CNPJ e `access_type`, mas `get_client_portal_shipment_detail_v2` calcula `_can_driver` e `_can_vehicle` apenas em linhas de `client_portal_access.client_id = fiscal_documents.client_id`. Ele não aplica as mesmas regras de remetente/destinatário usadas por `portal_user_can_access_fiscal_document` e pelos helpers financeiros/download.

###############

Bug 784

Sintoma: Um usuário que vê mercadorias por acesso de remetente ou destinatário pode encontrar relatórios, indicadores e tracking vazios ou incompletos para essas mesmas notas, embora as listagens e os detalhes as autorizem normalmente.
Provável causa: `get_client_portal_reports_summary_raw_20260917`, `get_client_portal_summary_v2` e `get_client_portal_tracking` montam o escopo apenas com `_portal_user_client_ids` e exigem `fiscal_documents.client_id` nesses IDs. Eles não reutilizam `portal_user_can_access_fiscal_document`, que também reconhece `access_type` e correspondência de CNPJ de remetente/destinatário.

###############

Bug 785

Sintoma: Uma coleta solicitada meses atrás para ocorrer dentro do período escolhido não aparece em “Coletas por status”, enquanto uma coleta criada no período mas agendada para fora dele aparece indevidamente.
Provável causa: A CTE `pickups_by` de `get_client_portal_reports_summary_raw_20260917` filtra `pickup_orders.created_at::date` entre as datas do relatório, em vez de usar `pickup_at`, que é a data operacional apresentada na tela de coletas.

###############

Bug 786

Sintoma: Notas excluídas logicamente ainda entram em “Entregas no período”, status, atrasos, canhotos pendentes, prazo médio e ranking de cidades do relatório do portal.
Provável causa: A CTE `document_deliveries` de `get_client_portal_reports_summary_raw_20260917` consulta `fiscal_documents` sem `deleted_at IS NULL`; depois, todos os agregados são derivados desse conjunto contaminado.

###############

Bug 787

Sintoma: Se o mesmo usuário possui duas concessões com tipos diferentes para um único cliente, o seletor mostra o cliente duplicado, páginas passam a exigir seleção como se houvesse vários clientes e, após escolher uma opção, permissões válidas da outra concessão podem desaparecer arbitrariamente.
Provável causa: A restrição de `client_portal_access` é única por `(tenant_id, user_id, client_id, access_type)`, portanto múltiplas linhas do mesmo cliente são válidas, e `get_user_client_access_detailed` as devolve sem agregação. `PortalClientScopeProvider` usa `clients.length`, localiza `selectedClient` com `find` e reduz `activeClients` a essa primeira linha, em vez de deduplicar o cliente e combinar permissões com `bool_or`; o seletor e `PortalSettings` também usam somente `client_id` como chave React.

###############

Bug 788

Sintoma: Criar um acesso do tipo “Pagador” não concede nenhuma visão específica de documentos cobrados daquele pagador; fora das notas cujo `client_id` já é exatamente o cliente escolhido, o portal permanece vazio como num acesso de leitura comum.
Provável causa: `payer` é aceito pelo `CHECK`, pelo convite e pelo seletor administrativo, mas não aparece em nenhuma condição de `portal_user_can_access_fiscal_document`, `portal_user_can_view_financial`, `portal_user_can_download_fiscal_document` ou acesso a coletas. O backend implementa escopos para remetente/destinatário, mas nunca relaciona o tipo Pagador a `payer`, `payer_group`, CNPJ de tomador ou títulos financeiros.

###############

Bug 789

Sintoma: Dois administradores editando a mesma concessão podem reativar permissões que o outro acabou de remover, trocar cliente/tipo com dados antigos ou sobrescrever silenciosamente a configuração mais recente; ambos recebem confirmação de sucesso.
Provável causa: `PortalAccessDialog` lê uma fotografia da linha e depois envia `UPDATE client_portal_access` apenas por `id` e `tenant_id`, substituindo todos os campos sem incluir `updated_at` esperado. Embora `trg_cpa_updated_at` mantenha uma revisão, ela não é consultada nem usada como compare-and-swap.

###############

Bug 790

Sintoma: Não é possível descobrir quem concedeu, ampliou, desativou, reativou ou removeu um acesso do portal; mudanças em permissões financeiras, downloads e tracking deixam apenas o estado atual.
Provável causa: `PortalAccessTab` executa `insert`, `update` e `delete` diretamente em `client_portal_access`, e a tabela possui somente `created_by`/timestamps. Não há comando auditado, trigger de journal nem chamada a `_log_entity_audit` para preservar ator, valores anteriores e motivo das alterações.

###############

Bug 791

Sintoma: Ao corrigir rapidamente o e-mail pesquisado no diálogo de acesso, o resultado de uma busca anterior pode chegar por último e substituir a conta correspondente ao texto atual; isso aumenta o risco de selecionar e autorizar o usuário errado.
Provável causa: O efeito que chama `search-users-by-email` apenas cancela o temporizador antes do envio. Requisições já iniciadas não recebem `AbortSignal`, número de geração ou comparação com o e-mail atual antes de `setUserResults`, e o ramo de erro também não limpa resultados antigos.

###############

Bug 792

Sintoma: A Auditoria de ICMS pode declarar “100% Consistente” e “Risco Zero” mesmo existindo CT-es autorizados que ela não conseguiu avaliar, por exemplo documentos sem `cte_payload`, com regime ausente/não reconhecido ou materializados somente no catálogo canônico de CT-e.
Provável causa: `monitor_simples_nacional_icms_violations` não devolve cobertura, descartes ou total auditável; ele simplesmente exclui linhas sem payload e exige regime em `('simples','mei','1')`. `CteConsistencyReport` interpreta a ausência de violações nesse subconjunto como prova de consistência de todos os CT-es.

###############

Bug 793

Sintoma: Alterar o regime tributário do cadastro do emitente depois de uma emissão pode fazer uma CT-e antiga entrar ou sair da lista de violações sem que seu XML/payload tenha mudado.
Provável causa: O RPC determina o regime com `coalesce(emitter.regime_tributario, payload...)`, dando prioridade ao valor mutável atual de `tenant_emitters` sobre o snapshot gravado no documento. A auditoria histórica passa a julgar a emissão pelo cadastro de hoje, não pelo regime transmitido naquele CT-e.

###############

Bug 794

Sintoma: Um CT-e do Simples/MEI com base, alíquota ou valor de ICMS negativo é considerado consistente e não aparece na auditoria, apesar de a regra declarada exigir zero absoluto.
Provável causa: O filtro de `monitor_simples_nacional_icms_violations` procura apenas valores `> 0`. Qualquer número negativo é diferente de zero e fiscalmente suspeito, mas nenhuma das três condições usa `<> 0` ou valida faixa não negativa.

###############

Bug 795

Sintoma: Empresas com muitas inconsistências históricas podem travar a Auditoria de ICMS ou exceder limites de resposta/memória; a tela tenta renderizar e filtrar localmente todas as linhas de uma vez.
Provável causa: `monitor_simples_nacional_icms_violations` não aceita limite/cursor nem agrega total, e `CteConsistencyReport` consome o array integral, calcula `violations.length`, executa `filter` no navegador e renderiza todos os resultados sem paginação ou virtualização.

###############

Bug 796

Sintoma: Em telas touch e para navegação por teclado, a ação “Corrigir” de cada inconsistência pode permanecer invisível, embora ainda ocupe a ordem de foco; o usuário não descobre como abrir o CT-e afetado.
Provável causa: O botão usa `opacity-0 group-hover:opacity-100` e não possui `group-focus-within`, estilo de foco próprio que restaure a opacidade nem regra responsiva para dispositivos sem hover.

###############

Bug 797

Sintoma: A Consulta de CT-e pode contabilizar um documento como “com arquivo” e habilitar simultaneamente visualizar DACTE, baixar PDF e baixar XML, mas uma ou duas dessas ações terminam em erro; isso também ocorre com tentativas rejeitadas ou ainda em processamento que apenas receberam um ID do provedor.
Provável causa: `canDownloadCte` retorna verdadeiro quando existe qualquer um entre `hub_document_id`, `pdf_url` ou `xml_url`. A tela reutiliza esse único booleano para os dois formatos, para o filtro “Só com arquivo”, para o KPI e para todas as ações, sem verificar o arquivo solicitado nem se o estado fiscal realmente permite gerá-lo.

###############

Bug 798

Sintoma: Combinar na Consulta de CT-e um estado ou dado fiscal enriquecido com um campo existente apenas no rascunho — por exemplo “Processado” com motorista, placa, contrato ou viagem — pode ocultar um CT-e que satisfaz todos os critérios quando as duas fontes são consideradas juntas.
Provável causa: `useCteSearch` aplica vários filtros diretamente em `cte_documents` antes de associá-lo a `fiscal_documents` e às emissões. Se o rascunho for eliminado por um estado, série, data ou dado que só fica correto após o merge, ele reaparece apenas como `hubRow`; essa linha reconstruída não contém os metadados exclusivos do rascunho, e o filtro local final a elimina novamente.

###############

Bug 799

Sintoma: CT-es complementares, de anulação ou substituição que existem somente no histórico fiscal legado aparecem como “Normal” e desaparecem quando o usuário filtra pelo seu tipo real.
Provável causa: Ao converter um `fiscal_documents` sem linha correspondente em `cte_documents`, `useCteSearch` atribui incondicionalmente `cte_type: 'normal'`. A consulta nem seleciona nem interpreta o tipo do payload/emissão para esses `hubRows`.

###############

Bug 800

Sintoma: O mesmo CT-e pode aparecer duas vezes na consulta — uma linha de rascunho sem recursos do Hub e outra linha fiscal — quando a chave foi armazenada com pontuação, espaços ou outra representação equivalente em uma das fontes.
Provável causa: O merge monta `hubByKey` e procura `hubByKey.get(r.access_key)` usando o texto bruto como chave exata. Embora filtros e outros fluxos removam caracteres não numéricos de chaves fiscais, essa associação não normaliza nenhum dos lados; assim, valores logicamente iguais não são vinculados nem entram corretamente em `usedHubIds`.

###############

Bug 801

Sintoma: Enquanto uma Consulta de CT-e grande está carregando, novas inclusões ou exclusões podem fazer alguns registros sumirem do resultado ou aparecerem repetidos; em históricos muito extensos, a leitura dos rascunhos também gera URLs progressivamente maiores a cada página.
Provável causa: `readSearchPages` usa paginação por `OFFSET` em consultas independentes, sem snapshot ou cursor, de modo que alterações deslocam as fronteiras entre blocos. No caso de `cte_documents`, o mesmo builder `q` ainda é reutilizado e recebe `.order('id')` a cada iteração; o cliente PostgREST acumula novamente a expressão de ordenação na URL em vez de substituí-la.

###############

Bug 802

Sintoma: Ao aplicar filtros no Monitor de CT-e, os novos critérios já aparecem na tela enquanto a tabela, os indicadores, o detalhe e as ações ainda pertencem à consulta anterior; nesse intervalo é possível baixar, recuperar ou cancelar o documento errado.
Provável causa: `useCteMonitor` preserva `placeholderData: prev => prev`, mas `CteMonitor` não distingue placeholder nem bloqueia linhas durante `isFetching`. Somente o botão “Atualizar” usa esse estado, enquanto todo o resultado anterior continua interativo sob a nova chave de consulta.

###############

Bug 803

Sintoma: Depois de uma atualização do Monitor alterar os documentos disponíveis, o checkbox global pode aparecer marcado para um conjunto diferente do realmente selecionado, e seleções de linhas removidas continuam influenciando o botão “Selecionar todos”.
Provável causa: `checked` não é reconciliado após refetch. O estado global compara apenas `checked.size === downloadableRows.length`, sem conferir os IDs, e `toggleAll` também decide limpar ou selecionar exclusivamente pela igualdade das quantidades.

###############

Bug 804

Sintoma: O Monitor oferece “Visualizar”, “PDF” e “XML” em todas as linhas, inclusive rascunhos nunca transmitidos e documentos que possuem somente um dos formatos; selecionar em massa um registro apenas por ter ID do Hub também pode terminar com arquivos faltantes.
Provável causa: Os três botões da tabela e do detalhe não possuem condição de disponibilidade. A seleção considera suficiente qualquer `hub_document_id`, `pdf_url` ou `xml_url`, mas reutiliza esse critério para ambos os formatos, sem validar o arquivo solicitado ou o estado fiscal do documento.

###############

Bug 805

Sintoma: Um CT-e existente somente no histórico fiscal pode exibir como “Nº CT-e” uma referência interna/nota e sempre mostrar série vazia, mesmo que a emissão tenha número e série autorizados; buscar pelo número fiscal real também não encontra essa linha.
Provável causa: `useCteMonitor` não consulta `hub_fiscal_emissions`. Para `hubRows`, preenche `cte_number` e `internal_number` com `fiscal_documents.invoice_number` e fixa `cte_series: null`, ignorando os campos canônicos `number` e `series` da emissão usados pela própria Consulta de CT-e.

###############

Bug 806

Sintoma: O filtro de período de processamento do Monitor inclui ou exclui CT-es legados pela data em que o registro local foi criado, não pela autorização/processamento na SEFAZ; datas de envio, processamento e cancelamento reconstruídas para essas linhas também podem coincidir artificialmente.
Provável causa: Em cada `hubRow`, `useCteMonitor` atribui `created_at` a `sefaz_status_at` e `sent_at`, e volta a usá-lo como `processed_at` ou `cancelled_at` conforme o estado atual. O filtro local final usa esse `processed_at` fabricado, sem ler os timestamps reais da emissão ou do histórico de eventos.

###############

Bug 807

Sintoma: No Monitor, filtrar “Carta de Correção: Não” inclui CT-es legados cuja existência de CC-e é desconhecida, enquanto “Sim” nunca encontra esses documentos mesmo que uma carta tenha sido registrada no provedor.
Provável causa: Todo `hubRow` recebe incondicionalmente `correction_letter: false`. O merge não consulta eventos SEFAZ nem outra fonte da carta de correção, transformando ausência de informação em confirmação negativa e usando esse valor inventado no filtro.

###############

Bug 808

Sintoma: Uma mesma operação de CT-e pode aparecer duas vezes no Monitor durante a transmissão ou após uma migração — como rascunho e como documento do Hub — sobretudo antes de receber chave de acesso ou quando as duas fontes guardam formatações diferentes da chave.
Provável causa: O Monitor associa `cte_documents` a `fiscal_documents` exclusivamente por igualdade textual exata de `access_key`. Ele não tenta o ID compartilhado, o vínculo existente em `hub_fiscal_emissions` nem normaliza a chave; sem o match, o documento fiscal permanece em `hubRows` e o rascunho também é mantido.

###############

Bug 809

Sintoma: Manter o detalhe de um CT-e aberto durante uma atualização pode continuar exibindo o status e os dados antigos e deixar “Cancelar CT-e” disponível mesmo depois de a consulta confirmar que ele já foi cancelado ou alterado.
Provável causa: `selected` armazena o objeto completo clicado e nunca é reconciliado com `rowsData` após refetch. O efeito de deep link abandona a sincronização assim que `selected` existe, e o diálogo continua renderizando indefinidamente essa cópia congelada.

###############

Bug 810

Sintoma: Um CT-e rejeitado pode mostrar “Cancelar CT-e” no detalhe do Monitor e permitir iniciar cancelamento de um documento que nunca foi autorizado; já um CT-e autorizado proveniente do Hub exibe dois botões de cancelamento no mesmo diálogo.
Provável causa: `mapOutboundStatus` converte rejeições em `processed_error`, e o bloco superior habilita cancelamento tanto para `processed` quanto para `processed_error`. Um segundo bloco no rodapé renderiza novamente a mesma ação para qualquer linha `processed` com `source === 'hub'`.

###############

Bug 811

Sintoma: A seção “CT-es transmitidos & notas vinculadas” perde silenciosamente documentos mais antigos quando a empresa ultrapassa 500 emissões, sem informar total nem oferecer próxima página ou busca no histórico restante.
Provável causa: `useIssuedCtes` encerra a consulta de `fiscal_documents` com `.limit(500)`, e `IssuedCtesTable` renderiza somente esse array, sem paginação, cursor ou indicador de truncamento.

###############

Bug 812

Sintoma: Uma indisponibilidade ao consultar o histórico de CT-es transmitidos aparece como “Nenhum CT-e transmitido ao Hub Fiscal ainda”, levando o usuário a acreditar que não existe histórico.
Provável causa: `IssuedCtesTable` extrai apenas `data` e `isLoading` de `useIssuedCtes`; ignora `isError` e `error`. Como o fallback de `data` é `[]`, qualquer falha termina no mesmo estado vazio usado para ausência real de emissões.

###############

Bug 813

Sintoma: CT-es com muitas NF-es vinculadas podem mostrar contagens e listas incompletas; com centenas de CT-es, o histórico inteiro também pode falhar ao tentar resolver os vínculos, embora a consulta das emissões tenha funcionado.
Provável causa: A segunda consulta de `useIssuedCtes` envia até 500 UUIDs em um único `.in('cte_emitted_outbound_id', ...)`, sem particionar o filtro, e não pagina a resposta de notas. Ela fica sujeita tanto ao tamanho máximo da URL quanto ao limite de linhas do PostgREST.

###############

Bug 814

Sintoma: O histórico de CT-es transmitidos pode voltar a exibir documentos fiscalmente excluídos ou duplicados como se fossem emissões normais e somá-los visualmente ao acervo ativo.
Provável causa: A consulta de `useIssuedCtes` filtra apenas `tenant_id` e `document_type = 'outbound'`; ao contrário das consultas canônicas do Monitor e da Consulta, não exige `deleted_at IS NULL` nem `is_duplicate = false`.

###############

Bug 815

Sintoma: A tela permite excluir localmente um CT-e cujo cancelamento foi rejeitado, libera suas NF-es para novo faturamento e pode gerar outro conhecimento para a mesma operação, embora o próprio aviso confirme que o documento original continua válido na SEFAZ.
Provável causa: A condição da tabela oferece “Excluir” quando `sefaz_status === 'cancel_rejected'`, e `useDeleteIssuedCte` abre uma exceção explícita ao bloqueio de documentos autorizados para esse mesmo estado. A exclusão apaga o controle local e limpa os vínculos das fontes sem qualquer baixa fiscal válida.

###############

Bug 816

Sintoma: Excluir um CT-e do histórico pode liberar as NF-es mas falhar antes de remover o documento, ou apagar uma emissão que se tornou autorizada enquanto a confirmação estava aberta, deixando fontes e documento fiscal em estados contraditórios.
Provável causa: `useDeleteIssuedCte` lê o status, atualiza separadamente todas as NF-es vinculadas e só depois executa o `delete`, tudo pelo cliente e sem transação, lock, revisão esperada ou revalidação atômica. Falha intermediária e callback concorrente não são protegidos.

###############

Bug 817

Sintoma: Fechar a prévia editável enquanto um lote de CT-es está sendo transmitido não interrompe a operação; emissões continuam sendo criadas em segundo plano depois que o diálogo desaparece, permitindo ao usuário iniciar outro fluxo sem perceber que o primeiro ainda está ativo.
Provável causa: `transmitting` desabilita o seletor de ambiente e o botão de transmitir, mas o botão “Fechar”, Escape, clique externo e `onOpenChange` continuam livres. Fechar apenas altera `open`; o laço assíncrono de `transmit` não recebe sinal de cancelamento nem mantém uma barreira visível fora do diálogo.

###############

Bug 818

Sintoma: A tabela “Lotes gerados” pode mostrar “Nenhum lote gerado ainda” durante sua própria carga ou após uma falha, e pode continuar exibindo “Carregando...” por causa da consulta de notas mesmo quando os lotes já chegaram.
Provável causa: `Billing` extrai somente `data` de `useCteBatches` e usa `docsLoading`, pertencente a `useBillingDocuments`, para decidir o estado da tabela. O carregamento e o erro reais de `cte_batches` não são observados.

###############

Bug 819

Sintoma: Empresas com muitos lotes deixam de ver silenciosamente os mais antigos em “Lotes gerados”, sem contagem total, paginação ou aviso de recorte.
Provável causa: `useCteBatches` faz um único `select` sem paginação e a tela renderiza diretamente todo o retorno. O histórico fica sujeito ao teto de linhas do PostgREST, tratado como se fosse o conjunto completo.

###############

Bug 820

Sintoma: Um clique em “Cancelar” em “Lotes gerados” altera o lote imediatamente, sem confirmação; falhas podem deixar apenas parte dos documentos cancelada, e um lote que já contenha CT-es emitidos pode ser cancelado só localmente e ter suas NF-es liberadas sem cancelamento na SEFAZ.
Provável causa: O botão chama diretamente `cancelBatch.mutate` sem diálogo nem tratamento de erro. `useCancelCteBatch` primeiro marca o lote como cancelado, depois lê e atualiza os `cte_documents` e por fim libera as fontes em chamadas independentes; não há transação, checagem do estado fiscal dos filhos nem compensação.

###############

Bug 821

Sintoma: O PDF ou XML de um MDF-e pode ficar indisponível quando o Hub não responde, mesmo que a URL do arquivo já esteja persistida no próprio manifesto e apareça no banco.
Provável causa: `downloadMdfeFile` exige `hub_document_id` e sempre chama `hubFiscal.file`. Os campos `pdf_url` e `xml_url` de `load_manifests`, preenchidos pelo espelhamento da emissão, nunca são usados como cache ou contingência, diferentemente do fluxo de arquivos de CT-e.

###############

Bug 822

Sintoma: O MDF-e pode ser enviado para encerramento fiscal com um único clique acidental em “Encerrar”, tanto na carga quanto no histórico geral, sem revisão ou confirmação da ação irreversível.
Provável causa: Os dois botões chamam `useCloseMdfe().mutateAsync` diretamente. Não existe diálogo de confirmação, justificativa, segunda etapa nem resumo do manifesto/carga antes de disparar `hubFiscal.closeMdfe`.

###############

Bug 823

Sintoma: Digitar a sigla natural da “UF origem”, como `MG`, mantém o botão de emissão habilitado, mas o envio é bloqueado somente depois do clique com a mensagem confusa de que falta “Código IBGE da UF”; o valor automático mostrado nesse campo é `31`, não `MG`.
Provável causa: O formulário rotula `originUf` como UF, porém o inicializa com os dois primeiros dígitos do código municipal e o builder exige `digits(input.origin.state).length === 2` para montar `cUF`. `readyToIssue` não valida esse campo, enquanto o input aceita e converte letras para maiúsculas como se esperasse uma sigla.

###############

Bug 824

Sintoma: Um MDF-e com vários CT-es pode ser transmitido sem informar o contratante/tomador de um dos conhecimentos quando esse CT-e está sem documento do tomador, desde que outro CT-e do lote tenha um tomador válido.
Provável causa: `ManifestPanel` monta `takers` e remove silenciosamente entradas cujo `taker_document` fica vazio. `buildMdfePayload` valida apenas os contratantes restantes e usa o emitente como fallback somente quando a lista inteira está vazia; não existe correspondência nem validação um-a-um entre cada CT-e e seu tomador.

###############

Bug 825

Sintoma: O painel habilita a emissão de MDF-e com CNPJ de seguradora incompleto ou malformado e só descobre a rejeição depois de enviar o manifesto ao provedor.
Provável causa: `readyToIssue` verifica apenas se `insurance.cnpj` é truthy, e `buildMdfePayload` exige somente que `providerCnpj` não esteja vazio. O payload remove caracteres não numéricos, mas nunca exige 14 dígitos nem valida o documento antes de transmitir.

###############

Bug 826

Sintoma: Enquanto um histórico grande de MDF-e está sendo carregado, uma nova emissão pode fazer um manifesto ser repetido e outro ser omitido no resultado final, ainda que a ordenação visual pareça estável.
Provável causa: `useMdfeHistory` percorre o histórico com páginas independentes por `OFFSET`. Mesmo ordenando por `(created_at, id)`, não fixa snapshot nem usa cursor; uma inserção no início desloca todos os offsets ainda não lidos durante a mesma consulta.

###############

Bug 827

Sintoma: Vários modos de agrupamento de CT-e produzem exatamente os mesmos grupos apesar de prometerem separar por Numref, Liv.cli, CFOP, placa ou ponto de coleta; notas com valores diferentes nesses critérios acabam reunidas no mesmo conhecimento.
Provável causa: Os modos 2, 5, 6, 10, 11, 13 e 14 leem respectivamente `numref`, `liv_cli`, `cfop`, `vehicle_plate` e `pickup_point` de cada `FiscalDocument`, mas essas propriedades não existem na tabela/tipo `fiscal_documents` carregado por `useBillingDocuments`. O cast para `GroupableFiscalDocument` apenas as declara como opcionais; em execução todas viram `undefined` e a chave usa `∅`.

###############

Bug 828

Sintoma: Empresas diferentes com o mesmo nome podem ter suas notas agrupadas no mesmo CT-e, enquanto variações de grafia do nome de uma mesma empresa podem criar conhecimentos separados.
Provável causa: Os modos de agrupamento identificam remetente e destinatário pelos textos livres `remitter` e `recipient`, normalizados apenas com `trim().toLowerCase()`. Embora as notas possuam `remitter_cnpj`, `recipient_cnpj` e IDs, nenhuma chave usa a identidade fiscal estável das partes.

###############

Bug 829

Sintoma: Nos modos que não incluem destinatário na chave — especialmente “Por Remetente” e “CTRC/ORT por Lote” — notas de clientes ou municípios diferentes podem gerar um único CT-e cujo destinatário, cidade, UF e cliente são somente os da primeira nota.
Provável causa: `buildGroups` permite reunir documentos heterogêneos e, ao criar o grupo, copia `recipient`, `recipient_city`, `recipient_state` e `client_id` apenas do primeiro item. `groupToEditable` usa esse cabeçalho único no payload, mas mantém todos os `fiscal_document_ids` e NF-es do grupo, sem validar homogeneidade.

###############

Bug 830

Sintoma: Recalcular o frete de um CT-e ligado a uma carga com vários conhecimentos pode usar o valor total de todas as NF-es da carga, superestimando a base daquele CT-e específico e até escolhendo o grupo pagador de outra nota.
Provável causa: `useRecalculateCTeFreight` busca todo `fiscal_documents` de entrada pelo mesmo `load_id`, soma todos os valores e escolhe o primeiro `client_id` disponível quando o CT-e não tem cliente. Ele não restringe a consulta às fontes realmente vinculadas ao CT-e por reserva, `cte_emitted_outbound_id` ou snapshot fiscal.

###############

Bug 831

Sintoma: Um CT-e já autorizado pode ter frete, valor, CBS, IBS e tabela de frete alterados localmente pelo recálculo, passando a divergir do XML/DACTE efetivamente autorizado na SEFAZ.
Provável causa: `useRecalculateCTeFreight` aceita qualquer `fiscal_documents` de saída que não tenha `freight_overridden` e executa um `update` direto nos campos financeiros. Não verifica `status`, `sefaz_status`, chave, protocolo ou existência de autorização antes de reescrever o snapshot materializado.

###############

Bug 832

Sintoma: Durante um recálculo em lote de NF-es, um override manual salvo por outro usuário pode ser sobrescrito pelo resultado automático e terminar marcado como override, porém contendo o valor calculado pela tabela.
Provável causa: `useRecalculateInboundFreight` lê `freight_overridden` antes de calcular cada nota e, depois de uma operação potencialmente longa, atualiza somente por `(id, tenant_id)`. O `update` não exige que `freight_overridden` continue falso nem compara `updated_at`/revisão, permitindo corrida com edições manuais.

###############

Bug 833

Sintoma: Um frete pode ser recalculado e gravado sem o respectivo registro de auditoria, enquanto a interface informa a NF como atualizada normalmente.
Provável causa: Após o `update`, `useRecalculateInboundFreight` envolve `logFreightCalculation` em `try/catch` vazio e incrementa `updated` mesmo quando o log falha. O recálculo e a trilha não são atômicos, e a falha de auditoria nem entra no contador `failed`.

###############

Bug 834

Sintoma: Uma tabela de frete configurada pelo campo textual “Pagador” funciona no simulador, mas nunca é escolhida na importação, geração de CT-e, prévia de carga ou recálculos automáticos; esses fluxos usam outra tabela ou informam ausência de tarifa.
Provável causa: `computeSpecificity` compara corretamente `freight_tables.payer` com `FreightInput.payerName`, porém somente `FreightSimulator` preenche `payerName`. Todos os demais chamadores de `calculateFreight` enviam no máximo `clientId` e `payerGroup`, tornando qualquer tabela com `payer` uma incompatibilidade dura.

###############

Bug 835

Sintoma: Importar uma NF histórica, gerar um CT-e para notas antigas ou recalcular fretes já existentes ainda pode usar a tabela vigente hoje, embora o simulador para o mesmo documento use corretamente a vigência da data de emissão.
Provável causa: O motor passou a aceitar `referenceDate`, mas apenas `FreightSimulator` a envia. `Ingestion`, `useGenerateCTE`, `useFiscalDocuments`, `LoadDetail`, `CTeWorkbench` e os dois hooks de recálculo omitem o campo, fazendo `calculateFreight` cair em `localDateInputValue()`.

###############

Bug 836

Sintoma: Uma região genérica, cadastrada para todos os clientes ou grupos pagadores, deixa de ser reconhecida quando o documento possui `client_id` ou `payer_group`; uma tabela de frete por região que deveria servir de fallback não é aplicada.
Provável causa: Ao resolver `client_regions`, `calculateFreight` acrescenta `.eq('client_id', input.clientId)` e `.eq('payer_group', input.payerGroup)` quando esses valores existem. Isso exclui linhas genéricas com colunas nulas, em vez de consultar simultaneamente o mapeamento específico e o genérico e escolher o mais específico.

###############

Bug 837

Sintoma: Editar ou remover uma região pode exibir “Região atualizada” ou “Região removida” mesmo que o registro já tenha sido excluído, tenha deixado de pertencer à empresa acessível ou não tenha sido alterado.
Provável causa: As mutations de `ClientRegions` verificam somente `error` nos comandos `update` e `delete`, sem pedir a linha retornada nem conferir a quantidade afetada. O PostgREST considera uma operação filtrada que encontra zero linhas uma resposta bem-sucedida.

###############

Bug 838

Sintoma: Editar ou remover uma tabela de frete pode produzir confirmação de sucesso sem alterar qualquer registro, deixando a regra antiga ativa ou a exclusão apenas aparente.
Provável causa: `FreightTables` executa `update` e `delete` por ID e tenant, mas não usa `.select()` nem valida a contagem de linhas afetadas. Uma linha removida concorrentemente ou ocultada por RLS resulta em zero alterações sem `error`, acionando os mesmos toasts de sucesso.

###############

Bug 839

Sintoma: Duas pessoas podem editar a mesma região ao mesmo tempo e ambas receber sucesso, mas o último salvamento sobrescreve silenciosamente município, UF, cliente, grupo pagador e nome da região alterados pela primeira.
Provável causa: A edição de `client_regions` envia novamente todo o snapshot do formulário e filtra apenas por `(id, tenant_id)`, sem comparar `updated_at`, versão esperada ou qualquer token de concorrência otimista.

###############

Bug 840

Sintoma: Duas pessoas podem editar simultaneamente a mesma tabela de frete e o último salvamento restaurar valores, vigência e critérios antigos sobre a alteração anterior, embora os dois usuários recebam confirmação de sucesso.
Provável causa: `FreightTables` atualiza o registro completo usando somente `(id, tenant_id)`. Não há versão, comparação de `updated_at` nem bloqueio que detecte que a tabela mudou desde que o formulário foi aberto.

###############

Bug 841

Sintoma: Uma importação de regiões interrompida ou com erros intermediários pode deixar somente parte da planilha gravada, sem lote consultável, retomada ou relação durável das linhas que falharam; a interface mostra apenas contagens e remete os detalhes ao console do navegador.
Provável causa: `handleFileImport` insere cada linha de `client_regions` em uma transação independente dentro de um laço no cliente. Não existe entidade de importação, transação do conjunto ou persistência de erros por linha, de modo que gravações anteriores permanecem confirmadas quando as seguintes falham.

###############

Bug 842

Sintoma: Dois administradores cadastrando ao mesmo tempo tabelas idênticas com períodos diferentes e sobrepostos podem conseguir salvar ambas; depois, cálculos feitos na interseção das vigências falham por ambiguidade.
Provável causa: `guard_freight_table_overlap` implementa a exclusão de intervalos com um `SELECT EXISTS` em trigger `BEFORE`, sem lock por contexto nem constraint de exclusão. Transações concorrentes não enxergam a linha ainda não confirmada uma da outra, e o índice único não bloqueia o caso porque inclui as datas exatas.

###############

Bug 843

Sintoma: Duas tabelas de frete semanticamente iguais podem ser cadastradas variando apenas maiúsculas, minúsculas ou espaços nos critérios; ambas correspondem ao mesmo documento e fazem o cálculo parar com “Mais de uma tabela vigente possui a mesma prioridade”.
Provável causa: O formulário não normaliza os campos textuais e tanto o índice `uq_freight_tables_context` quanto `guard_freight_table_overlap` comparam texto de forma literal. Já `computeSpecificity` compara os mesmos critérios sem diferenciar caixa, criando uma noção de igualdade diferente no cadastro e na execução.

###############

Bug 844

Sintoma: Ao trocar a empresa ativa com o formulário de região ou tabela de frete aberto, os valores digitados para a empresa anterior permanecem; um cadastro novo pode então ser salvo na empresa recém-selecionada, enquanto uma edição antiga pode apenas exibir sucesso sem alterar a origem.
Provável causa: `ClientRegions` e `FreightTables` mantêm `dialogOpen`, `editingId` e `form` em estado local sem efeito de limpeza nem remontagem baseada em `currentTenant.id`. As mutations consultam o tenant atual somente no momento do clique, combinando o novo escopo com o estado antigo.

###############

Bug 845

Sintoma: Um documento histórico encontrado pela busca rápida fora do período atual pode ser simulado com a tabela vigente hoje, apesar de a tela informar que o documento antigo foi carregado.
Provável causa: A busca remota preenche os campos e `docId`, mas não adiciona o documento encontrado ao array `docs`. `handleSimulate` recupera `referenceDate` exclusivamente com `docs.find(document => document.id === docId)?.issue_date`; como a busca falha nesse array, envia `null` e o motor usa a data atual.

###############

Bug 846

Sintoma: Ao carregar um documento no simulador, a região sugerida pode pertencer a outro fornecedor ou grupo pagador que usa o mesmo município/UF, alterando o grupo automático e a tabela de frete avaliada.
Provável causa: `loadFromDoc` e a busca rápida escolhem a primeira região cujo município e UF coincidem, sem comparar `client_id` nem `payer_group`. A região escolhida depois alimenta `destination`, UF, município e o grupo pagador do cálculo.

###############

Bug 847

Sintoma: Depois de selecionar uma região e trocar o fornecedor no simulador, a região incompatível desaparece da lista, mas continua aplicada ao cálculo sem qualquer indicação visual.
Provável causa: `filteredRegions` muda as opções exibidas conforme `clientId`, porém nenhuma rotina limpa ou revalida `regionId`. `handleSimulate` procura o ID antigo no catálogo completo `regions`, não no conjunto filtrado, e continua usando seus dados.

###############

Bug 848

Sintoma: Com o recálculo automático desligado, alterar valores, fornecedor, região ou destino mantém na tela um resultado anterior como se ainda correspondesse aos campos atuais; uma falha silenciosa do recálculo automático também pode preservar o último sucesso.
Provável causa: Os setters dos campos não invalidam `result`. Além disso, o `catch` de `handleSimulate(true)` não grava um resultado de erro nem limpa o anterior, portanto a seção continua renderizando o último `FreightResult` bem-sucedido.

###############

Bug 849

Sintoma: A opção “Excluir cancelados/duplicados” ainda pode listar documentos marcados como duplicados ou removidos logicamente e permitir que seus valores sejam usados na simulação.
Provável causa: A consulta filtra apenas uma lista de valores de `status`; ela não exige `is_duplicate = false` nem `deleted_at IS NULL`. A deduplicação posterior por chave não elimina necessariamente a linha marcada e não cobre identidades sem chave de acesso confiável.

###############

Bug 850

Sintoma: Mesmo com o filtro configurado para CT-e e para documentos válidos, a busca rápida pode carregar uma NF-e, um documento cancelado, rejeitado, duplicado ou removido logicamente.
Provável causa: O fallback remoto de `handleQuickSearch` filtra somente `tenant_id` e número/chave. Ele ignora `docTypeFilter`, `onlyValid`, `status`, `is_duplicate` e `deleted_at`, embora carregue o resultado diretamente nos mesmos campos do simulador filtrado.

###############

Bug 851

Sintoma: Digitar apenas um sufixo curto de número ou chave na busca rápida pode carregar silenciosamente o primeiro entre vários documentos locais compatíveis, mesmo que outro documento fosse o pretendido.
Provável causa: O caminho local usa `filteredDocs.find` com `invoice_number.endsWith(term)` e `access_key.endsWith(term)`. Ele não coleta todas as correspondências nem aplica a verificação de ambiguidade existente no fallback remoto; a ordenação da lista decide qual linha vence.

###############

Bug 852

Sintoma: Em empresas com muitos fornecedores ou regiões, opções válidas deixam de aparecer no simulador, impedindo seleção manual ou levando a sugestões incompletas sem qualquer aviso.
Provável causa: As queries `suppliers-min-freight` e `client-regions-min` executam um único `select` sem paginação. Ao atingir o limite de linhas do PostgREST, `clients`, `regions`, grupos derivados e correspondências automáticas representam somente o primeiro subconjunto.

###############

Bug 853

Sintoma: Uma falha ao carregar fornecedores ou regiões no simulador aparece como seletores vazios e pode produzir um cálculo genérico, em vez de informar que o contexto necessário está indisponível.
Provável causa: As duas queries descartam `isError` e `error` ao desestruturar apenas `data = []`. O botão e o recálculo automático continuam habilitados, tornando uma indisponibilidade indistinguível de catálogos realmente vazios.

###############

Bug 854

Sintoma: No cadastro de um cliente sem grupo pagador, a seção “Tabelas de Frete vinculadas” pode exibir até 50 tabelas de outros clientes e grupos como se estivessem relacionadas ao cadastro aberto.
Provável causa: Quando existe `client.id`, a consulta monta `client_id.eq.<id>,payer_group.ilike.%${form.payer_group || ''}%`. Com grupo vazio, o segundo ramo vira `payer_group ILIKE '%%'` e aceita qualquer tabela do tenant que possua grupo, enquanto o `.limit(50)` mascara a amplitude do resultado.

###############

Bug 855

Sintoma: A lista “Tabelas de Frete vinculadas” pode incluir grupos apenas parcialmente parecidos, omitir tabelas relacionadas pelo campo “Pagador” e esconder vínculos adicionais após 50 resultados, apresentando uma visão incorreta do preço aplicável ao cliente.
Provável causa: `ClientFormDialog` define vínculo como `client_id` exato ou `payer_group ILIKE '%texto%'`, não compara `freight_tables.payer` com o pagador do formulário e aplica `.limit(50)` sem total, paginação ou aviso de truncamento.

###############

Bug 856

Sintoma: Trocar a empresa ativa na aba do simulador mantém documento, fornecedor, região, valores e até o resultado da empresa anterior na tela; o recálculo pode então combinar esses dados com as tabelas da nova empresa.
Provável causa: O estado local de `FreightSimulator` não é reiniciado quando `tenantId` muda e o componente não é remontado por uma chave de tenant. As queries mudam de cache, mas `docId`, IDs selecionados, campos numéricos, destino e `result` permanecem.

###############

Bug 857

Sintoma: Em um cliente existente, clicar em “Consultar cadastro oficial na SEFAZ” altera o banco imediatamente; fechar o diálogo com “Cancelar” não desfaz nome, inscrição estadual e endereço aplicados.
Provável causa: `lookupOfficialRegistry` chama `applyOfficialTaxProfile` antes do botão “Salvar”. Esse comando executa `apply_tax_registry_profile` sobre `clients` e persiste os campos fora do fluxo `onSave`, enquanto “Cancelar” apenas fecha o estado local do diálogo.

###############

Bug 858

Sintoma: Uma atualização oficial de CNPJ/IE/endereço pode ser sobrescrita silenciosamente por alguém que já estava com o formulário do cliente aberto, sem que a proteção contra edição concorrente detecte a mudança.
Provável causa: `apply_tax_registry_profile` atualiza diversos campos de `clients` e `updated_by`, mas não altera `updated_at`. `useUpdateClient` usa justamente o `updated_at` antigo como precondição; como o marcador permanece igual, um formulário obsoleto ainda passa no compare-and-set.

###############

Bug 859

Sintoma: Alterar o CNPJ ou a UF enquanto uma consulta à BrasilAPI/SEFAZ está em andamento pode preencher o formulário atual com razão social, IE e endereço pertencentes à identificação pesquisada anteriormente.
Provável causa: Os inputs continuam editáveis durante `lookupLoading` e as respostas assíncronas não conferem se `tax_id`, UF, tenant ou cliente ainda são os mesmos que originaram a requisição antes de executar `setForm` ou aplicar o perfil.

###############

Bug 860

Sintoma: Trocar o CEP de um cliente que já possui endereço preenchido não atualiza rua, bairro, município, UF nem código IBGE, permitindo salvar o CEP novo combinado com o endereço antigo.
Provável causa: `lookupCep` preenche cada campo como `prev.campo || valorConsultado`. Qualquer valor preexistente vence a resposta do novo CEP, e não há comparação para alertar que os dados pertencem ao CEP anterior.

###############

Bug 861

Sintoma: Ao trocar o CNPJ de um cadastro e consultar a BrasilAPI, o formulário pode combinar a nova razão social e o novo endereço com nome fantasia, e-mail ou telefone da empresa anterior.
Provável causa: `lookupCnpj` sobrescreve `legal_name`, `trade_name` e endereço, mas preserva `company_name`, `email` e `phone` sempre que já são não vazios. Não existe confirmação de que o CNPJ consultado representa a mesma entidade antes de mesclar campos antigos e novos.

###############

Bug 862

Sintoma: É possível salvar cliente/fornecedor com CNPJ ou CPF malformado, e-mail inválido, fator de cubagem negativo, nenhum dos papéis “cliente/fornecedor” ou a exigência “ligar antes” sem telefone, propagando cadastros inutilizáveis para importação e operação.
Provável causa: `handleSubmit` valida somente `company_name`. O botão não pertence a um `form` com validação nativa e os avisos rurais são apenas textos; também não há checks de documento, e-mail, papéis, cubagem ou telefone no banco de dados.

###############

Bug 863

Sintoma: Um clique duplo em “Salvar” ao criar um cliente pode gerar dois cadastros iguais, causando correspondência ambígua por CNPJ nas importações e emissões fiscais.
Provável causa: `ClientFormDialog` não mantém estado de envio nem desabilita o botão durante `await onSave(payload)`. `useCreateClient` não recebe chave idempotente e a tabela `clients` não possui unicidade por tenant/documento, então as duas inserções concorrentes podem concluir.

###############

Bug 864

Sintoma: Trocar a empresa ativa com o cadastro de cliente/fornecedor aberto mantém todos os dados do tenant anterior; um novo cadastro pode ser criado na nova empresa com esse conteúdo, ou uma edição antiga pode falhar somente depois do envio.
Provável causa: O efeito que reinicializa `ClientFormDialog` depende de `client`, `open` e `defaultKind`, mas não de `currentTenant.id`. O componente também não é remontado por tenant, enquanto `useCreateClient`/`useUpdateClient` usam a empresa ativa no momento do clique.

###############

Bug 865

Sintoma: Se inativar ou reativar um cliente falhar por concorrência, permissão ou rede, a tela não apresenta mensagem de erro e pode produzir uma rejeição de promessa não tratada.
Provável causa: `handleToggleActive` aguarda `updateClient.mutateAsync` sem `try/catch`, e o `onClick` não trata a Promise. Diferentemente do salvamento do diálogo, esse caminho não converte a exceção em toast nem oferece nova tentativa.

###############

Bug 866

Sintoma: Clicar repetidamente no status de um cliente enquanto a primeira alteração está em andamento dispara várias mutations; uma pode confirmar a mudança e as demais falharem silenciosamente, deixando o usuário sem saber qual estado foi efetivado.
Provável causa: O botão Ativo/Inativo não é desabilitado por `updateClient.isPending` nem possui trava por linha. Todas as chamadas reutilizam o mesmo `expected_updated_at` do snapshot listado, e os erros posteriores percorrem o caminho sem tratamento de `handleToggleActive`.

###############

Bug 867

Sintoma: Um administrador que participa de duas empresas pode editar um emitente da empresa A, trocar para a empresa B e salvar, movendo o emitente fiscal — e potencialmente deixando referências fiscais cruzadas — para o tenant B.
Provável causa: No caminho de atualização, `useSaveEmitter` monta o payload com `tenant_id` da empresa atualmente selecionada e executa `.update(...).eq('id', input.id)` sem exigir o tenant original. As policies permitem a operação quando o usuário é administrador tanto da linha antiga quanto do novo tenant.

###############

Bug 868

Sintoma: Duas pessoas podem editar simultaneamente o mesmo emitente e a última gravação sobrescrever CNPJ, IE, endereço, regime, filial e estado ativo definidos pela primeira, com ambas recebendo sucesso.
Provável causa: `useSaveEmitter` atualiza todo o snapshot do formulário somente por `id`, sem comparar o `updated_at` lido, versão esperada ou outro mecanismo de concorrência otimista.

###############

Bug 869

Sintoma: Remover um emitente pode exibir “Emitente removido” mesmo quando nenhuma linha foi apagada, por exemplo após exclusão concorrente ou mudança de permissão.
Provável causa: `useDeleteEmitter` verifica somente `error` no `delete`, sem solicitar retorno nem validar a quantidade afetada. Uma operação filtrada que encontra zero linhas é tratada pelo PostgREST como sucesso.

###############

Bug 870

Sintoma: Ao cadastrar emitente e credencial juntos, uma falha no token/segredo pode deixar o emitente criado sem a credencial necessária, apesar de o diálogo permanecer aberto e já ter exibido “Emitente salvo”.
Provável causa: `EmitterFormDialog.handleSave` primeiro confirma `useSaveEmitter` e só depois grava a credencial em outra requisição. Não há transação ou operação composta; `setSavedId` e o toast do emitente ocorrem antes de a segunda etapa poder falhar.

###############

Bug 871

Sintoma: Trocar a empresa ativa mantém abertos os diálogos de edição, credencial e certificado do emitente anterior, misturando o objeto antigo com hooks e mutations já apontados para o novo tenant.
Provável causa: `EmittersSettings` preserva `editing`, `credsFor` e `certificateFor` sem limpá-los na mudança de `currentTenant.id`, e os diálogos não são remontados por tenant. O risco é agravado porque a atualização do emitente não filtra pelo tenant original.

###############

Bug 872

Sintoma: A mesma tela informa, em um ponto, que deixar a credencial vazia usará o token global `HUB_FISCAL_API_KEY` e, em outro, que a credencial é obrigatória e não existe fallback, levando o administrador a acreditar que produção funcionará sem configuração quando pode ser bloqueada.
Provável causa: O texto do `EmitterFormDialog` ainda promete o token padrão, enquanto o `CredentialsDialog` documenta o contrato endurecido sem fallback. Não há uma única fonte de verdade para explicar a resolução efetiva da credencial.

###############

Bug 873

Sintoma: Se a listagem de certificados A1 falhar, o diálogo passa a mostrar “Nenhum certificado A1 cadastrado” e mantém a consulta SEFAZ desabilitada, sem estado de erro ou botão de nova tentativa no próprio painel.
Provável causa: `FiscalCertificateDialog.reload` captura a exceção apenas em um toast, conserva `certificates = []` e finaliza `loading`. A renderização seguinte interpreta o array vazio como resposta bem-sucedida e não guarda `isError` para diferenciar ou repetir a consulta.

###############

Bug 874

Sintoma: Após “Dados oficiais aplicados ao emitente”, o cartão continua exibindo razão social, IE e endereço antigos; reabrir rapidamente o diálogo de certificado pode consultar a SEFAZ com o snapshot anterior.
Provável causa: `FiscalCertificateDialog.apply` chama diretamente a Edge Function e fecha o diálogo, mas não invalida nem atualiza a query `tenant_emitters`. O cache de `useEmitters` permanece com o objeto anterior apesar da alteração no banco.

###############

Bug 875

Sintoma: Uma credencial fiscal pode ser removida com um único clique, sem confirmação; se a exclusão falhar, a interface não mostra erro, e a emissão pode continuar usando um estado que o administrador acredita ter alterado.
Provável causa: O botão de lixeira em `CredentialsDialog` chama `useDeleteHubCredential` diretamente. A mutation não possui `onError`/toast e o comando apaga somente por `id`, sem confirmação nem verificação explícita de tenant e emitente.

###############

Bug 876

Sintoma: A gravação direta de metadados de uma credencial existente pode alterar uma linha de outra empresa acessível ao mesmo administrador ou reatribuí-la ao tenant atual, caso um ID antigo seja reutilizado após troca de empresa.
Provável causa: O ramo de update de `useSaveHubCredential` injeta `tenant_id` atual no patch e filtra somente por `id`; não exige `(tenant_id, emitter_id)` original nem versão. A FK composta valida apenas que o emitente final pertence ao tenant final, não que a linha originalmente editada já pertencia a esse escopo.

###############

Bug 877

Sintoma: Salvar quase ao mesmo tempo “Dados da empresa” e “Seguradora padrão” pode fazer uma das alterações desaparecer; o mesmo pode ocorrer com qualquer outro parâmetro gravado em `tenants.settings` durante essa janela.
Provável causa: `useUpdateCompanyProfile` e `useUpdateInsuranceProfile` fazem read-modify-write do objeto JSON completo em requisições separadas, sem versão ou operação atômica por caminho JSON. Duas mutations podem ler o mesmo snapshot e a última substituir `settings` com uma cópia que não contém a gravação concorrente.

###############

Bug 878

Sintoma: Alterações ainda não salvas nos formulários de empresa ou seguradora podem desaparecer quando a query é revalidada em segundo plano, por foco da janela ou por uma atualização feita em outra parte do sistema.
Provável causa: Ambos os componentes executam `setForm(profile || EMPTY)` em todo novo valor de `profile`, sem estado sujo, comparação de versão ou confirmação. Um refetch bem-sucedido substitui integralmente o formulário local mesmo durante edição.

###############

Bug 879

Sintoma: Os PDFs, relatórios e cabeçalhos do sistema podem exibir CNPJ, e-mail, CEP, site ou UF inválidos salvos como dados oficiais da empresa.
Provável causa: `CompanySettings.save` não valida nenhum campo além da existência prévia de `profile`; os inputs não estão em um `form` com validação nativa e `useUpdateCompanyProfile` aceita qualquer string no JSON de `settings.company`.

###############

Bug 880

Sintoma: É possível cadastrar uma empresa do grupo ou seu primeiro emitente com um CNPJ de 14 dígitos que falha nos dígitos verificadores, criando uma identidade fiscal impossível de usar corretamente.
Provável causa: `TenantDialog`, `normalize_company_profile_v1` e `insert_initial_tenant_emitter_v1` verificam somente a quantidade de dígitos. Nenhum deles chama o validador de CNPJ nem calcula os dois dígitos verificadores.

###############

Bug 881

Sintoma: Dois administradores podem editar a mesma empresa do grupo simultaneamente e a última gravação sobrescrever nome, CNPJ, razão social, endereço e demais dados alterados pela primeira, sem conflito visível.
Provável causa: `update_workspace_tenant_v1` atualiza a linha por tenant/workspace e substitui o objeto `company` recebido, mas não recebe nem compara `updated_at`/versão. O diálogo também envia o snapshot completo carregado na abertura.

###############

Bug 882

Sintoma: Se o usuário trocar a empresa ativa — inclusive para outra workspace — com “Cadastrar empresa tenant” aberto, o conteúdo já preenchido permanece e pode ser criado no grupo da nova empresa, não naquele em que o diálogo foi iniciado.
Provável causa: `WorkspaceTenantsSettings` mantém `editing` e `TenantDialog` montados sem chave ou efeito baseado em `currentTenant.id`. `useCreateWorkspaceTenant` resolve o tenant/workspace autorizador somente no momento do clique em salvar.

###############

Bug 883

Sintoma: Quando a consulta das contas SSX falha, Configurações mostra “Nenhuma integração configurada” e mantém o botão de novo cadastro, fazendo uma indisponibilidade parecer ausência real de contas.
Provável causa: `IntegrationSection` extrai de `useWorkspaceSsxAccounts` apenas `data = []` e `isLoading`; `isError`, `error` e `refetch` são ignorados, de modo que a rejeição cai no mesmo ramo visual de uma lista vazia bem-sucedida.

###############

Bug 884

Sintoma: Criar, atualizar ou remover uma integração, testar login e sincronizar rastreadores pode concluir com sucesso, mas o cartão visível continua antigo ou até permanece após a exclusão até uma recarga manual.
Provável causa: A lista passou a usar a chave `['workspace_ssx_accounts', tenantId]`, porém os sucessos continuam invalidando `['integration_accounts']`. Essas chaves não se intersectam no React Query, então o cache que renderiza `IntegrationSection` não é reconsultado.

###############

Bug 885

Sintoma: “Sync Catálogos” pode informar falha embora o catálogo de telemetria já tenha sido alterado; repetir a ação pode reaplicar a primeira etapa enquanto a governança continua incompleta.
Provável causa: `syncTelemetryMutation` chama `ssx-sync-telemetry` e depois `ssx-sync-governance` em duas operações independentes. Se a segunda falha, a primeira já está confirmada, mas a mutation inteira rejeita sem estado de execução parcial, transação ou token de retomada.

###############

Bug 886

Sintoma: Trocar a empresa ativa com “Nova Integração SSX” ou “Atualizar credencial SSX” aberto mantém usuário, senha e configurações digitados para a conta anterior; o envio combina esse estado com o novo `tenantId` e só então pode falhar por contexto.
Provável causa: `IntegrationSection` não fecha nem limpa `editingAccount`/`dialogOpen` na troca de tenant, e o efeito de `IntegrationDialog` depende apenas de `account` e `open`, não de `tenantId`.

###############

Bug 887

Sintoma: Catálogos SSX grandes deixam telemetrias e mapeamentos válidos fora das telas; a auto-sugestão e os seletores passam a operar sobre um subconjunto sem avisar que houve truncamento.
Provável causa: As consultas de `telemetry_catalog` e `telemetry_mapping` executam um único `select` sem paginação, total ou sondagem do limite PostgREST. A tabela e `mappingByTelId` são construídos somente com as linhas devolvidas.

###############

Bug 888

Sintoma: Alterar ou remover um mapeamento de telemetria pode parecer aceito durante a interação, mas não modificar linha alguma após troca de tenant, exclusão concorrente ou mudança de permissão.
Provável causa: `upsertMapping` atualiza e apaga registros somente por `id`, sem exigir `tenant_id`, pedir retorno ou conferir contagem. Zero linhas afetadas não gera `error`; o `onSuccess` apenas invalida o cache e a seleção reaparece no valor anterior.

###############

Bug 889

Sintoma: Na aba Logs, mensagens de erro e metadados longos ficam cortados e não existe ação para abrir, copiar ou consultar o conteúdo completo, impedindo diagnosticar justamente as falhas mais detalhadas da integração.
Provável causa: A célula de detalhes usa `max-w-[200px] truncate` sobre `error_message`/`JSON.stringify(metadata)` sem `title`, expansão, diálogo de detalhes ou link para o registro.

###############

Bug 890

Sintoma: Remover um rastreador apaga também o histórico de todos os vínculos desse equipamento com veículos e o cursor de ingestão, eliminando evidências de quais veículos usaram a unidade e de onde a coleta parou.
Provável causa: `useProviderUnitMutations.remove` executa `DELETE` físico em `provider_units`. As FKs de `vehicle_tracker_links` e `ingestion_cursors` usam `ON DELETE CASCADE`, e a interface não oferece inativação que preserve essas linhas históricas.

###############

Bug 891

Sintoma: É possível cadastrar manualmente um rastreador com código vazio composto só por espaços ou criar duplicatas semânticas como `ABC`, `abc` e `ABC `; sincronização e polling passam a tratar unidades equivalentes como registros diferentes ou não conseguem identificá-las.
Provável causa: `handleAddUnit` exige apenas que `newCode` seja truthy e `useProviderUnitMutations.create` grava `external_code` sem `trim`/normalização. O índice único compara o texto literal por tenant, conta e código.

###############

Bug 892

Sintoma: Durante o carregamento de muitos rastreadores ou vínculos, uma sincronização concorrente pode fazer linhas repetirem ou desaparecerem da tela e dos seletores daquela abertura.
Provável causa: `useProviderUnits` e `useTrackerLinks` percorrem páginas com `range(from, to)` sem snapshot ou cursor imutável. Inserções, exclusões ou mudanças na ordenação por `created_at` entre requisições deslocam as fronteiras do OFFSET.

###############

Bug 893

Sintoma: Trocar a empresa ativa na aba Rastreadores mantém códigos, conta SSX, veículo e unidade já selecionados; clicar em adicionar/vincular tenta combinar IDs do tenant anterior com o tenant novo e falha somente no banco.
Provável causa: `UnitsSection` não limpa `newCode`, `newLabel`, `newAccountId`, `linkVehicleId` nem `linkUnitId` quando `currentTenant.id` muda. As novas FKs compostas impedem a corrupção, mas a interface continua oferecendo uma ação inválida com estado obsoleto.

###############

Bug 894

Sintoma: Remover um rastreador ou desvincular veículo/unidade pode concluir sem erro mesmo que o registro já não exista ou tenha mudado de empresa, sem indicar que nenhuma linha foi afetada.
Provável causa: As mutations `remove` verificam somente `error` no `delete`/`update` por ID e tenant. Elas não pedem as linhas alteradas nem validam contagem, e o PostgREST considera zero correspondências uma resposta bem-sucedida.

###############

Bug 895

Sintoma: Em uma empresa com mais veículos ativos que o limite PostgREST, a sincronização SSX pode deixar de vincular rastreadores a veículos já cadastrados e terminar como degradada por tentar recriar placas existentes.
Provável causa: Para cada unidade, `ssx-sync-units` faz um único `select` de todos os veículos ativos sem paginação e procura a placa apenas nesse subconjunto. Se o veículo correto ficou fora do retorno, tenta `insert`; a unicidade normalizada da placa rejeita a duplicata e a unidade permanece sem vínculo.

###############

Bug 896

Sintoma: A sincronização de rastreadores fica quadraticamente lenta e pode estourar tempo/rede conforme crescem simultaneamente a frota e o catálogo SSX.
Provável causa: Dentro do laço de cada unidade normalizada, a função consulta novamente todos os veículos ativos do tenant e filtra a placa em memória. Com U unidades e V veículos, transfere e percorre aproximadamente U×V linhas em vez de buscar a placa exata ou carregar o catálogo uma vez.

###############

Bug 897

Sintoma: Um rastreador removido ou desativado no catálogo SSX continua ativo no AGVLog e segue entrando no polling indefinidamente, inclusive após uma sincronização completa via Administration.
Provável causa: `ssx-sync-units` apenas faz upsert dos itens presentes com `active: true`. Não compara o conjunto completo recebido com `provider_units` existentes para inativar ausentes, mesmo quando `catalog_complete` é verdadeiro.

###############

Bug 898

Sintoma: “Sync Rastreadores” pode mostrar toast de sucesso e deixar a conta com status `ok` embora existam conflitos de placa/vínculo que impediram unidades de serem associadas a veículos.
Provável causa: Conflitos incrementam `mappingConflicts` e são gravados na fila, mas não entram em `writeFailures`. A função responde `success: true` e status `ok`; `IntegrationSection` ignora `mapping_conflicts`/`conflict_details` ao montar a mensagem de sucesso.

###############

Bug 899

Sintoma: Uma sincronização parcial de rastreadores pode deixar a conta como degradada e devolver erro, mas não criar entrada na aba Logs, dificultando reconstruir endpoint, duração, itens recebidos e gravações que já ocorreram.
Provável causa: Quando existem `writeFailures` ou descoberta saturada, `ssx-sync-units` atualiza a conta e retorna HTTP 409 antes da chamada a `logIntegration`, que existe somente no caminho integralmente bem-sucedido.

###############

Bug 900

Sintoma: Veículos criados automaticamente pela sincronização SSX são sempre cadastrados como caminhão, mesmo quando a unidade representa carreta, utilitário, automóvel ou outro tipo, afetando filtros e regras operacionais posteriores.
Provável causa: No caminho sem placa já cadastrada, `ssx-sync-units` insere `vehicles` com `type: "truck"` fixo e ignora qualquer classe/tipo disponível no payload e nos metadados normalizados do provedor.

###############

Bug 901

Sintoma: Se o polling automático ficar parado por mais tempo que a janela configurada, posições do intervalo perdido nunca são recuperadas e o histórico passa a ter uma lacuna permanente.
Provável causa: O modo broadband calcula sempre `timeStart = agora - pollWindowMinutes` e não usa `ingestion_cursors.last_success_at` para retomar do último sucesso. Após uma indisponibilidade longa, volta a consultar apenas os minutos recentes.

###############

Bug 902

Sintoma: Posições SSX com timestamp válido em epoch numérico podem ser classificadas como `invalid_timestamp` e enviadas à quarentena, embora o normalizador posterior saiba construir `Date` a partir de número.
Provável causa: `structuralPositionRejection` converte string e número para `Date.parse(String(dateValue))`. Epoch em milissegundos vira uma sequência numérica que `Date.parse` não interpreta como instante, e a linha é rejeitada antes de `normalizePosition` usar `new Date(dateStr)`.

###############

Bug 903

Sintoma: Posições rejeitadas que chegam com nomes de campos em minúsculas perdem ID, unidade, data e coordenadas na quarentena; eventos distintos podem colapsar no mesmo hash e parecer uma única ocorrência repetida.
Provável causa: A validação reconhece variantes como `latitude`, `eventDate` e `trackedUnitIntegrationCode`, mas `QUARANTINE_PAYLOAD_FIELDS` copia somente nomes PascalCase. `buildQuarantineRecord` também extrai poucos aliases, gerando payloads vazios ou incompletos para as outras variantes.

###############

Bug 904

Sintoma: Uma resposta com mais de 1.000 posições inválidas, ambíguas ou sem vínculo aborta o polling inteiro e impede até as posições válidas do mesmo lote de serem persistidas.
Provável causa: `recordQuarantineBatch` envia todas as rejeições em uma única chamada, enquanto `record_ssx_position_quarantine_batch_v1` recusa arrays acima de 1.000. Não há particionamento, e a quarentena é confirmada antes do processamento das linhas válidas.

###############

Bug 905

Sintoma: Um veículo com mais de 5.000 posições na janela consultada faz toda a persistência daquele veículo falhar, embora as posições sejam válidas e pudessem ser gravadas em lotes menores.
Provável causa: `splitPersistenceRows` não divide o array: retorna `[rows]` e lança `ssx_position_batch_too_large` acima de 5.000 linhas ou 7,5 MB. `commitPositionBatch` marca falha para o conjunto inteiro em vez de particioná-lo.

###############

Bug 906

Sintoma: O polling pode responder sucesso depois de receber e persistir posições, mas a conta permanecer em cooldown; execuções automáticas seguintes continuam bloqueadas apesar da recuperação do provedor.
Provável causa: Se `clearAccountCooldown` falha, `broadbandPoll` apenas escreve no console e continua para `logIntegration` e resposta HTTP 200. A falha em limpar o estado de saúde não altera `persistenceFailed` nem o resultado público.

###############

Bug 907

Sintoma: Em uma falha broadband, alguns rastreadores podem receber erro/backoff persistido e outros permanecer sem atualização, deixando políticas de nova tentativa diferentes dentro da mesma frota sem indicação de quais ficaram de fora.
Provável causa: `recordBroadbandFailure` grava `recordPollError` sequencialmente e retorna imediatamente na primeira falha. As gravações anteriores já foram confirmadas, não há transação do conjunto nem lista de unidades não processadas.

###############

Bug 908

Sintoma: Uma posição problemática que volta a ocorrer depois de sua quarentena ter sido resolvida ou ignorada permanece com status resolvido/ignorado e não reaparece como pendência, embora `occurrence_count` e `last_seen_at` aumentem.
Provável causa: O `ON CONFLICT` de `record_ssx_position_quarantine_batch_v1` atualiza contagem, data e payload, mas não restaura `status = 'open'` nem limpa `resolved_at` quando a mesma identidade de erro reaparece.

###############

Bug 909

Sintoma: No polling manual por unidade, uma falha ao consultar o cursor é tratada como primeira execução e pode disparar uma busca de até sete dias no SSX, aumentando carga e risco de rate limit sem revelar o erro original do banco.
Provável causa: `legacyPerUnitPoll` usa `.single()` em `ingestion_cursors`, desestrutura somente `data: cursor` e ignora `error`. Tanto cursor inexistente quanto consulta indisponível viram `cursor = null` e selecionam `initial_poll_window_minutes`.

###############

Bug 910

Sintoma: Pollings manuais/de depuração não aparecem na aba Logs, mesmo quando fazem chamadas SSX, persistem posições, entram em rate limit ou falham parcialmente.
Provável causa: `legacyPerUnitPoll` retorna diretamente o resumo após o laço e nunca chama `logIntegration`; somente o caminho broadband registra uma operação de polling em `integration_logs`.

###############

Bug 911

Sintoma: Depois de o polling abortar por falha de persistência, o orquestrador ainda pode sincronizar violações, recalcular estados e processar a fila como se o lote fosse confiável.
Provável causa: `ssx-poll-positions` devolve HTTP 500 com `abort_reason: "persistence_failure"`, mas `callEdgeFunction` descarta `abort_reason` nas respostas não 2xx e lança apenas `ssx-poll-positions: HTTP 500`. Como os gates posteriores procuram a substring `persistence_failure` em `stats.errors`, eles não reconhecem o aborto.

###############

Bug 912

Sintoma: O recálculo de estado após o polling pode alcançar somente parte dos veículos com posição ou nenhum deles, sem registrar erro, e o pipeline ainda terminar como bem-sucedido.
Provável causa: `agvlog-pipeline-run` faz uma única consulta sem paginação a `positions_last`, ignora o campo `error` e converte `data` ausente em `[]`; limites de resposta truncam os IDs e falhas de leitura são interpretadas como frota vazia antes da chamada a `agvlog-compute-state`.

###############

Bug 913

Sintoma: Após um pico com mais de 50 veículos pendentes, parte da fila operacional pode ficar parada indefinidamente se não chegarem novas posições, deixando viagens, paradas, eventos e alertas sem processamento.
Provável causa: Cada execução de `agvlog-pipeline-run` chama `agvlog-run-queue` uma única vez com `limit: 50` e não drena nem informa o restante. Além disso, novas chamadas à fila só ocorrem quando `stats.total_inserted > 0`, portanto uma execução posterior sem novas inserções não processa o backlog antigo.

###############

Bug 914

Sintoma: Uma execução completa pode gerar snapshots de governança e consultar posições usando um catálogo antigo de rastreadores logo depois de a atualização desse catálogo ter falhado.
Provável causa: A falha de `ssx-sync-units` é apenas acrescentada a `stats.errors`; apesar do comentário de que a governança depende do catálogo atualizado, o orquestrador continua incondicionalmente para `ssx-sync-governance` e para o polling na mesma conta.

###############

Bug 915

Sintoma: Uma execução pode devolver sucesso ao chamador sem atualizar datas, status, contadores ou mensagens de saúde do pipeline, deixando o painel preso em informações antigas.
Provável causa: Qualquer falha do RPC `merge_tenant_pipeline_health_v1` é capturada por um `catch` vazio e não entra em `stats.errors`; o resultado HTTP final é decidido sem considerar se o registro de saúde foi persistido.

###############

Bug 916

Sintoma: “Rodar processamento” pode exibir pipeline concluído, e o agendador pode contabilizar sucesso, mesmo quando o workspace não possui registro SSX ou a conta apontada pelo registro já não existe.
Provável causa: `agvlog-pipeline-run` retorna HTTP 200 com `success: true` nos caminhos `No workspace SSX account` e `No integration accounts`, sem `status` de falha/atenção. Os chamadores tratam a resposta como execução válida e a tela de Alertas monta um toast de sucesso com zeros.

###############

Bug 917

Sintoma: Viagens ativas podem permanecer com estado operacional antigo apesar de o cron continuar recebendo posições novas; o estado só é atualizado quando um administrador dispara uma execução autenticada ou abre a Torre de Controle.
Provável causa: Toda execução cron de `agvlog-pipeline-run` apenas grava `trip_live_status_deferred_reason = "cron_requires_actor_jwt"` e nunca agenda uma continuação autorizada. `update-trip-live-status` é invocado pelo orquestrador somente quando existe JWT de usuário, sem worker ou fila que consuma os adiamentos automáticos.

###############

Bug 918

Sintoma: Pausar a agenda SSX ou escolher coleta a cada 1, 5, 10 ou 15 minutos e sincronização completa a cada 1, 3, 12 ou 24 horas não altera a execução automática, apesar do toast “Agendamento SSX atualizado”.
Provável causa: A versão final de `claim_workspace_ssx_dispatch_v1` foi deliberadamente desacoplada de `tenant_tracking_schedules`: não consulta `enabled`, usa seis horas fixas para modo completo e `ack_workspace_ssx_dispatch_v1` agenda o próximo poll em 180 segundos fixos. A tela continua editando e exibindo a tabela que o dispatcher ativo ignora.

###############

Bug 919

Sintoma: O cartão “Agendamento por empresa” pode continuar mostrando nenhuma/uma execução antiga, status defasado e contador de falhas incorreto enquanto o dispatcher de workspace executa normalmente.
Provável causa: O dispatcher ativo reconhece resultados apenas em `workspace_ssx_accounts`; a redefinição de `ack_workspace_ssx_dispatch_v1` deixou de atualizar `tenant_tracking_schedules.last_finished_at`, `last_status` e `consecutive_failures`, mas `get_tracking_observability_v1` e a interface ainda leem esses campos da tabela antiga.

###############

Bug 920

Sintoma: Sincronizações completas válidas que demoram mais de 110 segundos podem ser classificadas como timeout e repetidas a cada recuperação de lease, executando novamente login, catálogos, unidades, governança, polling e agregação mesmo que a função anterior continue trabalhando no servidor.
Provável causa: `agvlog-ssx-dispatcher` aborta a requisição ao pipeline após 110 segundos, enquanto o pipeline completo encadeia várias etapas sequenciais com timeout individual de até 55 segundos. O aborto do cliente não cancela garantidamente a Edge Function, o ACK não ocorre, `last_full_sync_at` não avança e o lease expira após 300 segundos.

###############

Bug 921

Sintoma: Ao disparar o pipeline a partir de uma empresa irmã do workspace, posições podem ser gravadas na empresa dona histórica da conta enquanto cálculo de estado, fila, agregação e saúde são executados na empresa selecionada; a tela relata veículos tocados, mas o processamento operacional correspondente não acontece.
Provável causa: As telas enviam `currentTenant.id` ao `agvlog-pipeline-run`, porém `ssx-poll-positions` ignora esse tenant para os dados e usa `integration_accounts.tenant_id` ao buscar vínculos e persistir posições. Depois do retorno, o orquestrador usa o `tenant_id` recebido para `positions_last`, `agvlog-run-queue`, agregação e `pipeline_health`, misturando dois escopos na mesma execução.

###############

Bug 922

Sintoma: Administradores de empresas irmãs podem ver “Nenhum dado de pipeline ainda” e gates de prontidão reprovados mesmo com a conta SSX compartilhada sendo executada normalmente para o workspace.
Provável causa: O dispatcher chama `agvlog-pipeline-run` apenas com o `tenant_id` histórico de `integration_accounts`, e a saúde é gravada somente em `tenants.settings.pipeline_health` desse tenant. `IntegrationHealth` consulta exclusivamente as configurações do `currentTenant`, sem ler ou projetar a saúde no nível do workspace.

###############

Bug 923

Sintoma: O reprocessamento completo de estados pode recalcular somente a primeira página de veículos ativos ou nenhum veículo, mas responder sucesso sem avisar que a frota foi truncada ou que a leitura falhou.
Provável causa: No modo `reprocess`, `agvlog-compute-state` consulta `vehicles` uma única vez, sem paginação e sem inspecionar `error`, e transforma `data` ausente em uma lista vazia.

###############

Bug 924

Sintoma: Um administrador que invoque o cálculo com o UUID de um veículo de outra empresa pode mover o registro de estado desse veículo para o tenant atual e criar eventos cruzados, corrompendo o isolamento entre empresas.
Provável causa: O modo `batch` aceita `vehicle_ids` sem validar sua pertença ao `tenant_id`; lê `vehicles_state` apenas por `vehicle_id` usando service role e faz `upsert` com conflito na chave primária global `vehicle_id`, sobrescrevendo inclusive o `tenant_id`. As FKs de estado e evento não são compostas por tenant.

###############

Bug 925

Sintoma: Uma indisponibilidade momentânea ao ler posições ou o estado anterior pode transformar um veículo saudável em `unknown`, reiniciar sua duração de parada ou deixar de emitir uma transição, enquanto a execução aparenta ter calculado o veículo normalmente.
Provável causa: As quatro consultas por veículo (`positions_last`, `vehicles_state`, última posição bruta e duas posições brutas) desestruturam somente `data` e ignoram `error`; falha de banco e ausência real são tratadas da mesma maneira pelo motor de estado.

###############

Bug 926

Sintoma: Se a gravação de um evento de transição falhar depois da atualização de `vehicles_state`, a transição pode desaparecer definitivamente: a nova tentativa já encontra o estado novo e conclui que não há evento a emitir.
Provável causa: `agvlog-compute-state` faz o `upsert` do estado e o `insert` dos eventos em operações separadas, sem transação nem idempotency key. O erro do segundo passo não desfaz o primeiro.

###############

Bug 927

Sintoma: Duas execuções simultâneas do cálculo podem criar eventos duplicados de parada, retomada, offline ou online para o mesmo veículo e a mesma transição.
Provável causa: Cada execução lê o mesmo estado anterior, calcula a transição e grava sem lock, CAS ou restrição única que represente a transição. `vehicle_events` possui apenas UUID aleatório como chave, portanto ambos os inserts são aceitos.

###############

Bug 928

Sintoma: Posições exatamente no Equador ou no meridiano de Greenwich podem manter coordenadas antigas no estado, e rumo 0° (norte) é apagado como `null`; os eventos derivados também perdem coordenadas iguais a zero.
Provável causa: A montagem de `vehicles_state` e do evento usa fallback por truthiness (`lat || anterior`, `lng || anterior`, `heading || null` e `position?.lat || null`) em vez de coalescência nula, tratando o valor numérico válido `0` como ausente.

###############

Bug 929

Sintoma: Ao reprocessar telemetria antiga, eventos de transição aparecem com a hora da execução atual em vez da hora da posição ou do limiar que causou a mudança, distorcendo a cronologia e relatórios por período.
Provável causa: `detectEvents` define sempre `event_at: now.toISOString()`; o timestamp capturado da posição só é usado no cálculo do estado e nunca como instante do evento, inclusive no modo `reprocess`.

###############

Bug 930

Sintoma: Uma falha ao carregar configurações, mapeamentos de telemetria, modelos de rota ou dados do veículo pode fazer a fila processar tudo com limites padrão, sem combustível ou sem rotas e ainda confirmar o item como concluído.
Provável causa: `agvlog-run-queue` ignora os erros das consultas de `tenants`, `telemetry_mapping`, `route_templates` e `vehicles`; dados ausentes são substituídos por `{}`, `[]` ou valores padrão e não impedem o ACK de sucesso.

###############

Bug 931

Sintoma: A fila pode informar leituras e eventos de combustível criados mesmo quando nenhuma gravação ocorreu, além de perder silenciosamente alertas de abastecimento ou drenagem.
Provável causa: `processFuel` não inspeciona o resultado dos `upsert` em `fuel_readings`/`fuel_events` nem dos `insert` em `events`, mas incrementa `readingsCreated` e `eventsCreated` após cada tentativa e retorna normalmente.

###############

Bug 932

Sintoma: Uma viagem pode ser contabilizada como rota analisada/desviada sem existir `route_run`, evento ou alerta correspondente no banco, e o item da fila ainda receber ACK positivo.
Provável causa: `matchRoute` ignora erros do RPC de geofence e de todas as gravações em `route_runs`, `events` e `alert_instances`. O chamador incrementa `route_runs_created` e `events_created` apenas porque a função retornou um objeto, não porque as escritas foram confirmadas.

###############

Bug 933

Sintoma: O mesmo desvio de rota pode abrir um novo alerta a cada reprocessamento da janela de 24 horas, acumulando vários alertas abertos idênticos para veículo, regra e viagem lógica.
Provável causa: `matchRoute` insere diretamente em `alert_instances` para toda regra `route_deviation`, sem procurar alerta existente nem usar chave idempotente. As viagens são apagadas e recriadas com novos IDs em cada processamento, e a tabela de alertas não possui unicidade equivalente.

###############

Bug 934

Sintoma: Uma sessão antiga de excesso de velocidade pode gerar repetidamente novos alertas abertos em cada passagem da fila, embora represente o mesmo episódio histórico.
Provável causa: A deduplicação da regra `overspeed` procura alertas cuja `opened_at` esteja nos últimos 30 minutos em relação ao relógio atual, mas reprocessa sessões de até 24,5 horas. Sessões mais antigas nunca encontram o alerta que elas próprias criaram e são inseridas novamente.

###############

Bug 935

Sintoma: Alertas de parada longa podem permanecer abertos depois do fim, ser encerrados com o horário de outra parada ou até receber `closed_at` anterior ao próprio `opened_at` após reprocessamentos.
Provável causa: Para cada parada, o motor busca qualquer alerta aberto da mesma regra e veículo, sem identidade da parada. A primeira ocorrência é aberta mas não fechada mesmo já tendo `end`; a ocorrência seguinte encerra esse alerta usando o seu próprio `stop.end`, e novas execuções repetem o pareamento em outra ordem de estado.

###############

Bug 936

Sintoma: A classificação de parada noturna fica deslocada em tenants fora do horário fixo de Brasília e também pode errar períodos históricos de horário de verão, apesar de cada empresa possuir timezone configurado.
Provável causa: `detectStopsV2` recebe `tenantTimezone`, mas o parâmetro é descartado como `_timezone`; a hora local é calculada com `getUTCHours() - 3`, fixando BRT para todas as datas e regiões.

###############

Bug 937

Sintoma: Uma lacuna longa de telemetria entre dois pontos pode virar tempo de movimento/parada, distância e até viagem detectada, criando trajetos retilíneos e métricas infladas sobre um período em que não havia sinal.
Provável causa: `detectTrips`, `detectStopsV2`, `computeMovingTime` e `computeTripDistance` somam integralmente o delta e a distância entre pontos consecutivos sem limite máximo de intervalo nem quebra de sessão por perda de sinal. Um único ponto posterior herda todo o gap desde o anterior.

###############

Bug 938

Sintoma: Um veículo reportando velocidade entre 2 e 3 km/h pode aparecer parado no mapa/estado e simultaneamente gerar viagem e tempo em movimento na fila operacional.
Provável causa: `agvlog-compute-state` considera movimento somente acima de 3 km/h, enquanto `agvlog-run-queue.classifyMovement` usa `speed > 2`; os dois motores derivados da mesma posição aplicam limiares incompatíveis.

###############

Bug 939

Sintoma: O processamento de muitos veículos repete uma varredura de todas as paradas recentes da empresa para cada veículo, podendo estourar tempo/cota e ainda criar POIs a partir de um subconjunto truncado e não determinístico.
Provável causa: `autoDetectPois` é chamado dentro de `processVehicle`, consulta 14 dias de `trip_stops` sem paginação nem ordenação e recalcula todos os clusters do tenant em toda iteração da fila, em vez de executar uma vez sobre um snapshot completo.

###############

Bug 940

Sintoma: `times_seen` das chaves de telemetria cresce novamente sempre que a mesma janela de posições é reprocessada e também pode perder incrementos concorrentes, deixando a frequência observada sem relação com a quantidade real de amostras.
Provável causa: `updateTelemetryObservations` incrementa uma vez por chave presente na janela inteira, sem checkpoint ou identidade da posição, usando leitura seguida de `update(existing.times_seen + 1)`. A janela móvel revisita as mesmas posições e duas execuções podem ler e gravar o mesmo contador.

###############

Bug 941

Sintoma: Depois que uma viagem detectada possui ao menos uma parada vinculada, o próximo processamento do veículo pode falhar sempre ao tentar reconstruir a janela, consumir todas as tentativas da fila e nunca atualizar viagens/eventos novos.
Provável causa: `processVehicle` executa `DELETE FROM trips` antes de excluir `trip_stops`, mas `trip_stops.trip_id` referencia `trips.id` sem `ON DELETE CASCADE`. A FK bloqueia a exclusão do pai, o erro agora é lançado imediatamente e o código nunca alcança o delete das paradas.

###############

Bug 942

Sintoma: Um erro transitório repetido cinco vezes deixa o veículo permanentemente pendente e fora de todo processamento automático, sem ação de retry/reset na interface; se ele parar de enviar posições, nunca se recupera sozinho.
Provável causa: `claim_vehicle_processing_queue_v1` seleciona apenas linhas com `attempts < 5`. O ACK de falha incrementa/backoffa a linha, mas não existe dead-letter consumível nem função/tela para reiniciar tentativas; somente a chegada de uma posição mais nova redefine `attempts = 0`.

###############

Bug 943

Sintoma: A chegada de uma posição nova durante um processamento pode iniciar imediatamente um segundo worker para o mesmo veículo; os dois passam a apagar e recriar viagens, paradas e eventos concorrendo entre si, ainda que apenas um ACK final seja aceito.
Provável causa: O claim considera uma linha reclamável antes do fim do lease quando `claimed_position_at` difere de `last_position_at`. O token/CAS protege somente `ack_vehicle_processing_queue_v1`; nenhuma das gravações destrutivas de `processVehicle` é condicionada ao token ainda vigente.

###############

Bug 944

Sintoma: Um veículo com grande volume de posições nas últimas 24,5 horas pode esgotar memória ou tempo da Edge Function mesmo que cada página individual respeite o limite de 5.000 linhas.
Provável causa: `loadPositionProcessingWindow` pagina o banco, mas acumula todas as páginas simultaneamente nos arrays `positions` e `geofencePages` antes de iniciar qualquer cálculo; não há limite total nem processamento incremental/streaming.

###############

Bug 945

Sintoma: Uma viagem ou parada longa que começou antes do início da janela móvel pode permanecer no banco e ganhar outra viagem/parada sobreposta iniciada artificialmente dentro da janela, duplicando duração e eventos na borda de 24,5 horas.
Provável causa: A limpeza remove somente registros cujo `start_at >= windowFrom`, enquanto a detecção recebe posições apenas a partir de `windowFrom`. Registros iniciados antes e ainda sobrepostos à janela não são excluídos nem usados como estado inicial, e o motor pode detectar um novo começo a partir do primeiro trecho visível.

###############

Bug 946

Sintoma: Empresas com mais veículos ativos que o limite de resposta têm métricas diárias geradas somente para a primeira parcela da frota, sem qualquer indicação de quantos veículos foram omitidos.
Provável causa: `agvlog-aggregate-daily` faz uma única consulta de IDs em `vehicles`, sem paginação, contagem ou sondagem de truncamento, e usa o array retornado como universo completo.

###############

Bug 947

Sintoma: Em dias movimentados, contagens e somas de viagens, paradas, excessos, desvios, alertas offline e eventos de combustível podem ser menores que o real mesmo quando a agregação responde sucesso.
Provável causa: Por veículo, somente `positions_raw` é paginada; consultas de `trips`, `trip_stops`, `events`, `alert_instances`, `fuel_events` e até a lista de regras fazem um único `select` sem paginação e tratam a página retornada como conjunto completo.

###############

Bug 948

Sintoma: As métricas de um “dia” no Brasil incluem as primeiras horas do dia local seguinte e excluem as primeiras horas do dia escolhido, divergindo de relatórios e operação no timezone configurado da empresa.
Provável causa: A função usa `AAAA-MM-DDT00:00:00Z` até `23:59:59.999Z` e o dia padrão de `toISOString()`, sem ler `tenants.timezone` nem converter os limites do calendário local para UTC.

###############

Bug 949

Sintoma: Uma viagem que atravessa a meia-noite tem toda a distância e duração atribuídas ao dia em que começou; se começou antes do dia consultado, sua parcela dentro desse dia não é contabilizada.
Provável causa: A agregação seleciona viagens apenas por `start_at` dentro do intervalo e soma os campos completos já calculados da viagem, sem recortar segmentos pela interseção temporal com o dia.

###############

Bug 950

Sintoma: As últimas horas de cada dia podem nunca entrar em `metrics_daily`, deixando relatórios históricos definitivamente abaixo do realizado depois que o calendário avança.
Provável causa: O dispatcher ativo retirou o cron diário dedicado e o modo `full` chama a agregação sem informar `day`; cada execução recalcula somente o dia UTC corrente. Ao mudar o dia, não existe execução de fechamento/revisão do dia anterior para incorporar dados posteriores ao último full daquele dia.

###############

Bug 951

Sintoma: `offline_minutes` pode ultrapassar 1.440 minutos em um único dia ou variar conforme alertas arbitrariamente truncados, especialmente quando existem ocorrências sobrepostas/duplicadas.
Provável causa: A função busca todo o histórico de alertas offline sem filtro temporal, paginação ou ordenação, recorta cada intervalo isoladamente para o dia e soma durações sem unir sobreposições nem limitar ao tamanho do dia.

###############

Bug 952

Sintoma: Um dia com abastecimento pode mostrar “combustível consumido” negativo, e drenagens/abastecimentos intermediários tornam o valor incompatível com o consumo real do veículo.
Provável causa: `fuel_consumed` é calculado apenas como primeira leitura menos última leitura do dia; `fuel_refuel_events`, `fuel_drain_events` e a capacidade/unidade não são usados para ajustar entradas, saídas ou mudanças de escala.

###############

Bug 953

Sintoma: Desativar um veículo pode impedir a criação ou correção de métricas dos dias em que ele ainda operava, fazendo o histórico desaparecer ou permanecer incompleto após uma reexecução.
Provável causa: A agregação inicia exclusivamente por `vehicles.active = true`, inclusive quando recebe um `day` histórico; não seleciona veículos que possuam telemetria/viagens no período solicitado.

###############

Bug 954

Sintoma: A agregação pode exceder o tempo da Edge Function em frotas moderadas mesmo sem grande volume por veículo, deixando apenas os primeiros `metrics_daily` atualizados antes do erro global.
Provável causa: O código processa veículos sequencialmente e executa mais de dez consultas independentes por veículo, incluindo a mesma consulta de regras offline repetida para cada um, sem batch, concorrência limitada ou RPC agregado.

###############

Bug 955

Sintoma: Um veículo com centenas de milhares de posições em um dia pode fazer a agregação falhar por memória ou limite de argumentos JavaScript ao calcular a velocidade máxima.
Provável causa: Embora leia posições em páginas, a função acumula todas as velocidades em arrays e chama `Math.max(...speeds)`, expandindo cada amostra como argumento em vez de manter soma, contagem e máximo incrementalmente.

###############

Bug 956

Sintoma: O sincronizador de violações pode ignorar um backoff de rate limit já registrado e voltar a chamar o SSX antes dos 15 minutos, agravando o bloqueio sem revelar a falha de leitura local.
Provável causa: A consulta de `ssx_rule_violation_cursors` desestrutura somente `data: violationCursor` e ignora `error`; uma falha é interpretada como cursor sem `last_error_code`, pulando a proteção de rate limit.

###############

Bug 957

Sintoma: Depois de existir ao menos uma posição, o cron continua consultando violações para as últimas 1.000 posições a cada ciclo mesmo quando nenhuma posição nova chegou, consumindo cota do provedor e aumentando risco de rate limit sem trabalho novo.
Provável causa: `get_ssx_rule_violation_window_v1` retorna `should_poll = true` também quando `v_max <= v_last`, reconstruindo sempre a janela de overlap; o estado `idle` só é retornado quando nunca houve `provider_position_id`.

###############

Bug 958

Sintoma: Quando o SSX rejeita o filtro com limite superior, violações fora da janela podem ser persistidas e o cursor local pode avançar como se toda a faixa pretendida tivesse sido comprovadamente lida, causando lacunas ou repetição excessiva.
Provável causa: O fallback `documented_lower_bound` envia apenas `IdPosition >= start`, mas `fetchRange` continua tratando a resposta como correspondente a `[start, end]`; os itens nem sequer preservam/validam `IdPosition`, e uma resposta com menos de 500 linhas marca `completedThrough = end`.

###############

Bug 959

Sintoma: Uma janela com mais de 5.000 violações únicas pode consumir até 32 chamadas ao SSX e depois perder o lote inteiro por falha de persistência, repetindo o mesmo custo nas tentativas seguintes.
Provável causa: A divisão recursiva acumula todos os resultados em `rawItems` e envia um único array a `upsert_ssx_rule_violations_v1`, cujo contrato rejeita mais de 5.000 itens ou 8 MB; não há chunking da gravação nem avanço parcial antes desse RPC.

###############

Bug 960

Sintoma: Falhas de sincronização de violações — schema inválido, saturação, rate limit, persistência ou conflito de cursor — não aparecem na aba Logs, embora a execução bem-sucedida apareça.
Provável causa: `logIntegration` existe somente depois do upsert e ACK de sucesso; o bloco `catch` tenta apenas registrar erro no cursor, escreve no console e retorna 502, sem criar `integration_logs`.

###############

Bug 961

Sintoma: O pipeline pode terminar com status geral de sucesso embora a sincronização de violações tenha sido adiada por rate limit e nenhuma chamada nem leitura tenha ocorrido.
Provável causa: `ssx-sync-rule-violations` responde HTTP 200 com `success: true`, `status: "deferred"` e zero itens durante o backoff. `agvlog-pipeline-run` lê apenas `upserted`, não propaga `status`/`reason` para atenção ou erro.

###############

Bug 962

Sintoma: Fórmulas, papéis, carretas ou regras podem desaparecer do snapshot local quando o endpoint SSX devolve apenas uma página limitada, mesmo que ainda existam no provedor.
Provável causa: Os quatro recursos globais de `ssx-sync-governance` são solicitados uma única vez sem paginação nem detecção de resposta saturada; qualquer array válido é passado a `replace_ssx_tracking_snapshot_v1`, que apaga todo o snapshot anterior e o substitui pelo subconjunto recebido.

###############

Bug 963

Sintoma: Workspaces com mais de 250 rastreadores ou mais de 250 regras nunca sincronizam governança para os itens excedentes, mesmo após infinitas novas execuções.
Provável causa: A função sempre ordena e processa apenas os primeiros 250 códigos, registra `unit_limit_exceeded`/`rule_limit_exceeded` e retorna parcial, mas não mantém cursor ou próxima página; toda repetição escolhe exatamente o mesmo prefixo.

###############

Bug 964

Sintoma: Um rastreador ativo com código externo vazio não recebe regras compatíveis nem regras vinculadas e também não é listado entre os recursos que falharam, fazendo o snapshot parcial parecer completo para essa unidade.
Provável causa: Os códigos são transformados com `String(...).trim()` e depois removidos por `.filter(Boolean)` antes das chamadas; nenhum failure é acrescentado para as linhas descartadas.

###############

Bug 965

Sintoma: Se o SSX devolver duas entradas com a mesma chave externa e payloads divergentes, uma delas desaparece silenciosamente e o snapshot é registrado como sucesso, escondendo a ambiguidade de origem.
Provável causa: `normalizeSnapshot` usa um `Set` e simplesmente executa `continue` para chaves repetidas, preservando a primeira ocorrência em vez de rejeitar o schema ou registrar conflito.

###############

Bug 966

Sintoma: Depois de o SSX rejeitar o login, a conta pode continuar usando o token antigo comprovadamente inválido e, quando o backoff termina, o próprio `ssx-login` pode devolvê-lo como cache válido sem autenticar novamente.
Provável causa: Os caminhos HTTP 401/erro não limpam `token_cache` nem `token_expires_at`. Após o backoff, a checagem de cache considera somente a expiração local maior que 60 minutos e retorna `success: true`, ignorando `status = invalid_credentials` e o erro anterior.

###############

Bug 967

Sintoma: Credenciais recusadas com 401 não pausam o pipeline para intervenção; execuções automáticas continuam tentando sincronização e polling, gerando falhas repetidas em vez de mostrar `attention_required`.
Provável causa: O login grava `status = invalid_credentials`, mas não define `credential_reentry_required` e usa `last_error = "SSX login rejected with HTTP 401"`. O gate do orquestrador exige a flag ou a frase “informada novamente”, portanto não reconhece esse estado como necessidade de ação humana.

###############

Bug 968

Sintoma: Salvar uma senha nova enquanto um login antigo ainda está em andamento pode terminar com a conta marcada `ok` e um token obtido pela credencial anterior; uma resposta antiga de falha também pode marcar a credencial nova como inválida.
Provável causa: `ssx-login` lê credenciais, chama o provedor e depois atualiza a conta apenas por `id`, sem comparar `updated_at`, hash/revisão da credencial ou manter lock. `agvlog-integration-upsert` pode trocar a credencial no intervalo, mas a resposta tardia ainda sobrescreve o estado novo.

###############

Bug 969

Sintoma: Alterações recentes em Administration, códigos de pessoa, versão de API ou outros ajustes SSX podem desaparecer quando um login simultâneo termina.
Provável causa: Todos os caminhos de login constroem `settings` a partir de uma fotografia antiga e gravam o objeto JSON inteiro com `{ ...settings, ... }`; não há merge atômico no banco nem compare-and-swap contra edições concorrentes da conta.

###############

Bug 970

Sintoma: Respostas HTTP 200 do SSX sem token válido não aparecem na aba Logs, embora alterem status/backoff e façam o teste de login falhar.
Provável causa: O ramo `!token || token.length < 10` atualiza a conta e retorna 502 antes de chamar `logIntegration`; os demais erros de autenticação possuem log, mas esse caso de schema/token ausente não.

###############

Bug 971

Sintoma: Se `ExpiresIn` vier como timestamp Unix absoluto em milissegundos, um token de curta validade pode ser considerado válido por sete dias e circular muito depois de expirar no provedor.
Provável causa: Valores entre `1e12` e `1e15` são divididos por 1.000 e tratados como duração em segundos; o código não subtrai `Date.now()` para timestamps absolutos e depois apenas limita o resultado incorreto ao teto de sete dias.

###############

Bug 972

Sintoma: O login pode responder com backoff/credencial inválida, mas a conta não guardar esse status nem o prazo de retry; a execução seguinte repete a chamada imediatamente e o painel conserva o estado antigo.
Provável causa: Nos ramos de falha de descriptografia, rede, HTTP e token ausente, o resultado do `update` em `integration_accounts` não é verificado. A resposta de erro ao cliente é emitida mesmo se a persistência de `status`, `last_error` e `settings` falhou.

###############

Bug 973

Sintoma: Um endpoint SSX de login que aceita a conexão mas não conclui a resposta pode prender a função até o limite da plataforma; o pipeline desiste aos 55 segundos, mas a execução de login pode continuar e gravar estado tardiamente.
Provável causa: O `fetch(loginUrlWithParams)` não usa `AbortController` nem o `requestTimeoutMs` configurado para a conta. O timeout do chamador encerra apenas a espera HTTP externa e não fornece cancelamento cooperativo garantido à função já em execução.

###############

Bug 974

Sintoma: O endpoint de diagnóstico devolve `success: true` mesmo quando o token está inválido ou quando testes críticos de PositionHistory/Telemetry falham, permitindo que um chamador genérico apresente conectividade aprovada.
Provável causa: Todas as falhas funcionais são codificadas apenas dentro de `tests`; tanto o retorno antecipado por token inválido quanto o retorno final usam HTTP 200 e `success: true`, sem um campo de sucesso global derivado da quantidade de testes `fail`.

###############

Bug 975

Sintoma: Um diagnóstico com Administration habilitado pode exceder o tempo máximo da função antes de chegar aos testes de Tracking ou registrar o resumo, principalmente quando vários endpoints apenas expiram.
Provável causa: Veículos, rastreadores, posições e telemetria são testados sequencialmente; cada combinação de URL, token e formato pode aguardar até 15 segundos, mas não existe orçamento/timeout global para interromper a matriz acumulada de tentativas.

###############

Bug 976

Sintoma: Um diagnóstico pode ser entregue normalmente ao administrador sem deixar qualquer registro na aba Logs, impossibilitando auditar quais endpoints e formatos foram testados.
Provável causa: `logDiagnostic` aguarda `logIntegration`, mas não verifica nem propaga falha de persistência; o helper é chamado antes da resposta, porém seu resultado não participa do status retornado.

###############

Bug 977

Sintoma: Um motorista já existente no SSX pode ser tratado como ausente e receber tentativa de inserção duplicada quando seu registro não está na primeira página retornada por `ListPerson`.
Provável causa: `ssx-insert-person` solicita a lista completa uma única vez, sem paginação, filtro pelo código de integração ou detecção de saturação, e procura o UUID local somente no array recebido.

###############

Bug 978

Sintoma: A atualização de um motorista pode ser bloqueada com `SSX_PERSON_ROLE_NOT_FOUND` embora o cargo configurado exista no provedor.
Provável causa: `ListPersonRole` também é chamado uma única vez e o código valida o cargo apenas no array retornado, sem paginação nem busca direta; cargos além do limite de resposta são indistinguíveis de cargo inexistente.

###############

Bug 979

Sintoma: Uma falha de listagem, validação de contato/cargo ou confirmação remota apaga o `provider_person_id` anteriormente confirmado do motorista, perdendo o vínculo conhecido justamente durante uma tentativa de ressincronização.
Provável causa: `setDriverStatus` sempre grava `provider_person_id: providerPersonId`, cujo padrão é `null`. Todos os estados intermediários/de erro (`needs_contact`, `error`, `needs_role`, `sent`, `pending_confirmation`) chamam o helper sem ID e sobrescrevem o valor existente.

###############

Bug 980

Sintoma: Dois cliques/administradores sincronizando o mesmo motorista ao mesmo tempo podem enviar duas inserções ao SSX ou deixar o status local refletindo a resposta mais antiga.
Provável causa: As execuções consultam `ListPerson` e decidem entre insert/update sem lock, idempotency key ou CAS de status/revisão; ambas podem observar ausência antes de qualquer inserção e as atualizações locais posteriores são apenas por `(id, tenant_id)`.

###############

Bug 981

Sintoma: Falhas ao listar pessoas ou cargos SSX alteram o motorista para `error`/`needs_role`, mas não criam registro na aba Logs com endpoint, duração ou classe do erro.
Provável causa: `logIntegration` só é chamado depois da mutação Insert/Update; todos os retornos antecipados de `ListPerson` e `ListPersonRole` saem da função sem persistir auditoria da tentativa externa.

###############

Bug 982

Sintoma: Depois de sincronizar um motorista, editar nome, contato, documentos, CNH, cargo ou outros dados mantém o selo “Sincronizado” e remove a única ação de envio, de modo que as alterações nunca chegam ao SSX.
Provável causa: O update de `DriverDialog` preserva `provider_person_sync_status = 'synced'`; não existe trigger para voltar a `not_synced` quando campos exportados mudam, e a tela só renderiza o botão SSX quando o status é diferente de `synced`.

###############

Bug 983

Sintoma: Uma chave `AGVLOG_ENCRYPTION_KEY` curta, longa ou com caracteres não hexadecimais pode ser aceita silenciosamente pelo cache administrativo e derivar outra chave — potencialmente preenchida com zeros — causando perda de descriptografia ou proteção criptográfica diferente da configurada.
Provável causa: `encryptAesGcm`/`decryptAesGcm` aplicam `padEnd(64, '0').slice(0, 64)` e `hexToBytes` usa `parseInt` sem validar formato, ao contrário do validador estrito usado no salvamento da credencial.

###############

Bug 984

Sintoma: Uma chamada SSX pode entregar os headers e depois travar durante o corpo da resposta, prendendo a Edge Function além do `requestTimeoutMs` configurado.
Provável causa: `ssxPost` cancela o timer imediatamente após `fetch` resolver e só então aguarda `resp.text()`. O corpo da resposta deixa de estar protegido pelo AbortController, embora ainda faça parte da operação HTTP.

###############

Bug 985

Sintoma: Um HTTP 200 com JSON malformado é diagnosticado como “resposta vazia” em vez de erro de parse, levando fallbacks e mensagens operacionais a sugerirem ausência de dados quando o contrato foi quebrado.
Provável causa: `ssxPost` define `errorClass = 'parse_error'`, mas `buildAttemptLog` substitui a classe de qualquer resposta `ok` sem itens por `empty_response`; `deriveErrorFromAttempts` vê somente essa classificação sobrescrita.

###############

Bug 986

Sintoma: Uma resposta contendo mais de uma coleção pode ser tratada como vazia mesmo quando possui itens válidos, fazendo descoberta/diagnóstico tentar formatos extras ou concluir que não há rastreadores.
Provável causa: `extractResponseItems` retorna a primeira chave de array encontrada em sua ordem fixa; se `Data: []` coexistir com `Items: [...]` (ou equivalente aninhado), o array vazio vence e as outras coleções nunca são examinadas.

###############

Bug 987

Sintoma: Em workspaces grandes, um proprietário/administrador válido pode receber `Forbidden` nas operações SSX porque sua empresa não apareceu na primeira página; em volume ainda maior, a própria consulta de memberships pode exceder o limite de URL.
Provável causa: `getWorkspaceRoleForAccount` busca todos os tenants em um único `select` sem paginação e envia todos os IDs retornados em um único `.in('tenant_id', tenantIds)`, também sem particionamento.

###############

Bug 988

Sintoma: Configurações SSX malformadas podem produzir polling no futuro, timeout imediato ou chamadas excessivamente longas, em vez de serem rejeitadas como configuração inválida.
Provável causa: `readAccountConfig` repassa `poll_window_minutes`, `request_timeout_ms` e `api_version` diretamente de `settings` usando apenas `||`, sem verificar tipo, finitude, faixa ou formato antes de alimentar cálculos, timers e URLs.

###############

Bug 989

Sintoma: Coordenadas, velocidade ou outros números textuais iguais a `Infinity` podem ser aceitos na normalização e contaminar banco e cálculos geográficos com valores não finitos.
Provável causa: `pickNumber` usa `parseFloat` e testa apenas `!isNaN(n)`, não `Number.isFinite(n)`; `Infinity` passa na validação e é devolvido como número legítimo.

###############

Bug 990

Sintoma: A obtenção do token separado de Administration pode ficar pendurada indefinidamente e depois gravar o cache de forma tardia, bloqueando diagnósticos e sincronizações que dependem dela.
Provável causa: `getAdminToken` executa `fetch` no `/Login` sem AbortController ou timeout, embora a conta já possua `requestTimeoutMs` e as demais chamadas usem `ssxPost` com limite.

###############

Bug 991

Sintoma: Quando candidatos de endpoint falham de maneiras diferentes, a mensagem final pode afirmar “rota não encontrada” mesmo que outro candidato tenha revelado autenticação inválida, timeout ou indisponibilidade do servidor, direcionando recuperação e backoff errados.
Provável causa: `deriveErrorFromAttempts` dá prioridade absoluta a qualquer `route_not_found`, depois `body_incompatible`, antes de `auth_error` e falhas de rede; a classificação não considera qual candidato é canônico nem a gravidade/recência das respostas.

###############

Bug 992

Sintoma: Atuadores, eventos, sensores ou telemetrias podem desaparecer do catálogo privado após uma sincronização aparentemente válida quando o SSX devolve uma página limitada.
Provável causa: `ssx-sync-telemetry` faz uma única chamada por catálogo, sem paginação nem detecção de saturação, e passa qualquer array válido a `replace_ssx_tracking_reference_catalog_v1`, que substitui integralmente o conjunto anterior da conta.

###############

Bug 993

Sintoma: “Sync Catálogos” pode informar sucesso e contar todas as telemetrias privadas, mas a tela pública continuar sem parte ou todas elas.
Provável causa: Depois do replace confirmado, cada item de telemetria é espelhado individualmente em `telemetry_catalog`; o resultado de cada `upsert` é ignorado, nenhuma falha entra em `failures` e o contador retornado vem apenas do snapshot privado.

###############

Bug 994

Sintoma: Telemetrias removidas do SSX continuam aparecendo indefinidamente em seletores e mapeamentos globais, mesmo depois de sincronizações completas que já não as contêm.
Provável causa: `replace_ssx_tracking_reference_catalog_v1` remove corretamente itens antigos do snapshot por conta, mas o espelho `telemetry_catalog` recebe somente upserts; não existe exclusão/reconciliação dos IDs globais ausentes na nova fotografia.

###############

Bug 995

Sintoma: Se um catálogo SSX devolver duas linhas com o mesmo ID e nomes diferentes, uma delas é descartada silenciosamente e a sincronização termina como sucesso, ocultando a inconsistência do provedor.
Provável causa: `normalizeCatalog` mantém um `Set` e usa `continue` em IDs repetidos, preservando arbitrariamente a primeira linha em vez de rejeitar ou registrar o conflito.

###############

Bug 996

Sintoma: A sincronização via Administration pode declarar `catalog_complete: true` usando apenas a primeira página de veículos/rastreadores, deixando unidades válidas de fora sem acionar o alerta de descoberta saturada.
Provável causa: `tryAdminVehicleDiscovery` e `tryAdminTrackerDiscovery` chamam cada endpoint List uma única vez, sem paginação nem verificação de total/limite. A flag `discoverySaturated` é calculada exclusivamente para o fallback de PositionHistory, nunca para o catálogo Administration.

###############

Bug 997

Sintoma: Uma resposta vazia transitória da descoberta Tracking pode marcar a conta `ok`, gravar `last_units_sync_at` e impedir nova tentativa automática durante o cache, mesmo que nenhum rastreador tenha sido confirmado.
Provável causa: `empty_response` com HTTP 2xx é convertido em `success: true, items: []`; a função percorre zero unidades, não registra falha e atualiza a conta exatamente como uma sincronização completa bem-sucedida.

###############

Bug 998

Sintoma: Rastreadores sem placa no catálogo podem ser contabilizados como sincronizados e deixar a conta saudável, mas nunca ganhar vínculo com veículo; o polling seguinte recebe a unidade ativa e descarta/quarentena suas posições por falta de mapping.
Provável causa: O `provider_unit` é upsertado e `upsertedCount` incrementado antes da resolução do veículo. Quando `plate` é nula, o bloco inteiro de criação/vínculo é simplesmente pulado, sem `skipped`, conflito ou `writeFailure`.

###############

Bug 999

Sintoma: Quando o catálogo de trackers contém identificadores ou placas repetidos, metadados como IMEI, serial e código do dispositivo podem ser associados à unidade errada sem qualquer conflito reportado.
Provável causa: Os mapas de enriquecimento usam `Map.set` para código de veículo, placa e código de tracker; duplicatas sobrescrevem silenciosamente a entrada anterior e `findTrackerEnrichment` escolhe o último item segundo a ordem arbitrária da resposta.

###############

Bug 1000

Sintoma: Qualquer operação SSX pode terminar com sucesso sem registro de auditoria, e nenhum chamador consegue distinguir log persistido de log perdido.
Provável causa: O helper compartilhado `logIntegration` envolve o `insert` em `try/catch`, mas o cliente Supabase devolve falhas de banco no campo `error` em vez de lançar exceção. O resultado é descartado, então a maioria das falhas de gravação não entra no `catch` nem é propagada.

###############

Bug 1001

Sintoma: Atribuir ou remover um veículo pode exibir “Vínculo atualizado” mesmo quando o motorista já foi excluído, mudou de tenant ou nenhuma linha foi alterada.
Provável causa: `assignMutation` executa `update` filtrado por `id`/`tenant_id`, mas verifica apenas `error`; não solicita a linha atualizada nem distingue resposta de zero linhas antes do toast de sucesso.

###############

Bug 1002

Sintoma: Duas atribuições simultâneas podem deixar dois motoristas apontando para o mesmo veículo (ou dois veículos para o mesmo motorista), enquanto o lado oposto do vínculo aponta somente para um deles.
Provável causa: A unicidade de `current_vehicle_id`/`current_driver_id` é mantida apenas por um trigger que busca e limpa outras linhas, sem índices únicos nem locks. Transações concorrentes podem não enxergar a atribuição ainda não confirmada uma da outra; `pg_trigger_depth() > 1` impede a atualização recíproca de reparar o lado perdedor.

###############

Bug 1003

Sintoma: Excluir um motorista já removido por outra sessão pode mostrar “Motorista removido” embora a operação não tenha apagado registro algum.
Provável causa: `deleteMutation` não usa `.select()` nem verifica contagem/linha retornada; no PostgREST, um `delete` que afeta zero linhas não é erro e segue para o toast de sucesso.

###############

Bug 1004

Sintoma: Estados SSX como “precisa de contato”, “precisa de cargo”, “enviado” e “aguardando confirmação” aparecem todos como “Não sincronizado”, ocultando do administrador a ação necessária e a ambiguidade de uma mutação remota.
Provável causa: `syncStatusBadge` reconhece somente `synced` e `error`; qualquer outro `provider_person_sync_status` cai no mesmo badge genérico sem mensagem ou detalhe.

###############

Bug 1005

Sintoma: Excluir localmente um motorista já sincronizado deixa a pessoa ativa no SSX; recriar o cadastro gera outro UUID de integração e pode produzir duas pessoas remotas para o mesmo indivíduo.
Provável causa: A exclusão em `Drivers` remove diretamente a linha `drivers` e não chama endpoint de desativação/exclusão SSX nem cria uma pendência de reconciliação antes de perder `provider_person_id` e o UUID usado como identidade externa.

###############

Bug 1006

Sintoma: “Rodar processamento” pode exibir “Pipeline concluído” justamente quando a execução terminou pedindo intervenção do administrador, ocultando credenciais inválidas, configuração incompleta ou outra pendência operacional.
Provável causa: `agvlog-pipeline-run` responde HTTP 200 com `{ success: false, status: 'attention_required' }` quando `needs_attention` não está vazio. `ProcessButton` verifica somente o erro da invocação e `data.error`; não testa `data.success` nem `data.status`, invalida os alertas e mostra o toast positivo com contadores zerados.

###############

Bug 1007

Sintoma: Reconhecer ou fechar um alerta já removido, inacessível ou alterado por outra sessão pode exibir “Alerta reconhecido/fechado” mesmo sem atualizar registro algum.
Provável causa: `ackMutation` e `closeMutation` executam `UPDATE alert_instances` por `id` e `tenant_id`, mas verificam somente `error`. Nenhuma delas solicita a linha atualizada ou distingue a resposta válida de zero linhas do PostgREST antes de disparar o toast de sucesso.

###############

Bug 1008

Sintoma: Um alerta fechado por uma sessão pode voltar para “Reconhecido” quando outra sessão confirma uma tela antiga; o registro reaberto ainda conserva `closed_at`, ficando simultaneamente reconhecido e fechado nos dados.
Provável causa: O ACK atualiza incondicionalmente qualquer linha para `status: 'ack'`, sem exigir o estado anterior `open`, versão esperada ou limpar `closed_at`. A interface decide mostrar o botão com base no snapshot carregado, portanto um ACK atrasado sobrescreve um fechamento concorrente.

###############

Bug 1009

Sintoma: A ação “Remover regra” falha para qualquer regra que já tenha produzido ao menos um alerta histórico, de modo que a interface oferece uma exclusão que normalmente se torna impossível depois do primeiro uso.
Provável causa: `deleteMutation` tenta apagar fisicamente `alert_rules`, enquanto `alert_instances.rule_id` possui FK para a regra sem `ON DELETE SET NULL` ou cascata. Não há fluxo de arquivamento/soft delete nem bloqueio explicativo prévio; os alertas existentes fazem o banco rejeitar a remoção.

###############

Bug 1010

Sintoma: Se o administrador trocar de empresa com “Nova Regra” aberto, pode criar na empresa nova uma regra que referencia a geofence selecionada na empresa anterior; essa regra nunca encontra a cerca esperada e pode manter o monitoramento incorreto silenciosamente.
Provável causa: `NewRuleDialog` permanece montado na troca de `tenantId` e preserva `geofenceId` no estado local. A inserção usa o novo `tenantId` com o ID antigo dentro de `params`; `alert_rules_positive_thresholds` valida apenas que o texto não seja vazio e não existe FK/trigger que confirme que a geofence pertence ao mesmo tenant.

###############

Bug 1011

Sintoma: Empresas com muitas regras ou geofences podem ter regras omitidas da administração e cercas válidas ausentes do seletor de nova regra, sem paginação ou aviso de truncamento.
Provável causa: Tanto a query principal de `alert_rules` quanto `alert-rule-geofences` fazem um único `select` ordenado, sem cursor, paginação ou contagem. Ao atingir o limite máximo de linhas da API, a interface trata a primeira página como coleção completa.

###############

Bug 1012

Sintoma: Trocar a empresa ativa com uma OS aberta para edição permite salvar alterações na ordem da empresa anterior enquanto a tela já exibe a empresa nova, misturando o contexto visual e o alvo efetivo da gravação.
Provável causa: `MaintenanceOrdersPage` não limpa `editing`, `form` nem fecha o diálogo quando o tenant muda. `useUpdateMaintenanceOrder` atualiza somente por `id`, sem filtrar o tenant ativo; como a RLS autoriza outros tenants dos quais o usuário também é administrador, o ID antigo continua gravável.

###############

Bug 1013

Sintoma: Duas pessoas podem editar a mesma ordem de manutenção ao mesmo tempo e ambas receber “OS atualizada”, mas o último envio restaura silenciosamente problema, diagnóstico, custos, responsável, status e demais valores antigos sobre a primeira alteração.
Provável causa: O formulário reenvia praticamente todo o snapshot carregado e `useUpdateMaintenanceOrder` condiciona o `UPDATE` apenas ao `id`. Embora a tabela possua `updated_at`, o valor lido não é usado como revisão esperada, CAS ou detecção de edição concorrente.

###############

Bug 1014

Sintoma: Reabrir ou cancelar uma OS concluída mantém sua data de conclusão preenchida; relatórios e integrações podem tratar uma ordem atualmente aberta/cancelada como já concluída.
Provável causa: `handleSave` define `completed_at` quando o novo status é `completed`, mas para qualquer outro status reutiliza `editing?.completed_at`. Não existe ramo que limpe o timestamp ao sair do estado concluído nem invariant correspondente no banco.

###############

Bug 1015

Sintoma: Editar uma OS cujo odômetro registrado é exatamente zero e salvar qualquer outro campo apaga essa leitura, convertendo-a em valor ausente.
Provável causa: `openEdit` inicializa `odometer_km` com `String(o.odometer_km || '')`; o zero válido cai no fallback vazio. No salvamento, string vazia é convertida em `null` e sobrescreve a leitura original.

###############

Bug 1016

Sintoma: Depois de vincular uma OS a um veículo ou responsável, a própria tela de edição não permite remover o vínculo; só é possível trocá-lo por outro cadastro.
Provável causa: Os dois `Select` recebem o UUID atual e oferecem somente veículos/funcionários como opções. Não há opção “Nenhum”, botão de limpar nem tratamento de valor vazio que permita enviar `vehicle_id` ou `responsible_employee_id` como `null` em uma edição.

###############

Bug 1017

Sintoma: As observações de uma ordem de manutenção não podem ser visualizadas nem alteradas pela página; ao criar uma OS, também não há campo para registrá-las, apesar de o dado existir e ser enviado pelo fluxo.
Provável causa: O estado e o payload de `MaintenanceOrdersPage` incluem `notes`, e `openEdit` até carrega `o.notes`, mas o conteúdo do diálogo não renderiza nenhum `Input`/`Textarea` ligado a `form.notes`.

###############

Bug 1018

Sintoma: Trocar a empresa ativa com um patrimônio aberto para edição permite salvar a ficha antiga enquanto a tela já está no contexto da empresa nova.
Provável causa: `Assets` preserva `editing`, `form` e o diálogo durante a troca de tenant. `useUpdateAsset` executa o `UPDATE` somente por `id`, sem exigir o tenant ativo; um usuário administrador nas duas empresas continua autorizado pela RLS a modificar a linha antiga.

RESOLVIDO

###############

Bug 1019

Sintoma: Duas pessoas podem editar o mesmo patrimônio simultaneamente e ambas receber confirmação, mas a última gravação restaura silenciosamente nome, estado, responsável, localização, custo e demais campos antigos sobre as mudanças da primeira.
Provável causa: O formulário envia um snapshot completo e `useUpdateAsset` condiciona a atualização apenas ao `id`. O `updated_at` lido não participa de comparação de versão, CAS ou rejeição de edição obsoleta.

RESOLVIDO

###############

Bug 1020

Sintoma: Depois que um responsável é atribuído a um patrimônio, não é possível deixá-lo novamente sem responsável pela tela; o seletor só permite transferi-lo para outra pessoa.
Provável causa: O `Select` de responsável contém exclusivamente os funcionários retornados e não oferece opção “Nenhum” nem controle de limpeza. Embora o payload converta string vazia em `null`, a interface não fornece um caminho para voltar a esse valor após a seleção.

RESOLVIDO

###############

Bug 1021

Sintoma: Transferir um patrimônio de responsável, alterar sua localização ou mudar seu estado pela página não cria histórico de movimentação; a ficha mostra somente o estado final e perde quem entregou, quem recebeu, motivo e data da mudança.
Provável causa: `Assets.handleSave` atualiza diretamente `assets.responsible_employee_id`, `current_location` e `status`. Os hooks `useCreateAssetMovement`/`useAssetMovements` existem, mas não são usados por nenhuma tela ou automação, e não há trigger que materialize essas alterações em `asset_movements`.

###############

Bug 1022

Sintoma: O mesmo código patrimonial pode ser cadastrado mais de uma vez com espaços nas extremidades ou variação de maiúsculas/minúsculas, aparecendo visualmente como duplicado e tornando buscas e identificação ambíguas.
Provável causa: `handleSave` usa `trim()` apenas para testar se o código está vazio, mas envia `form.asset_code` original. O índice único `idx_assets_code_tenant` compara o texto bruto de forma sensível a caixa e espaços; não há normalização no cliente nem no banco.

###############

Bug 1023

Sintoma: Deixar o custo de aquisição em branco registra R$ 0,00 em vez de “não informado”; limpar um custo existente também o transforma em zero, fazendo o valor total confundir ausência de dado com aquisição gratuita.
Provável causa: `handleSave` converte `form.acquisition_cost` vazio diretamente para `0` e grava esse número em `acquisition_cost`, embora a coluna seja anulável e o formulário use vazio para representar ausência nos demais campos opcionais.

RESOLVIDO

###############

Bug 1024

Sintoma: Quando a consulta de funcionários falha, a página mostra todos os indicadores zerados e “Nenhum funcionário encontrado”, sem informar que o cadastro está indisponível.
Provável causa: `Employees` extrai somente `data` e `isLoading` de `useEmployees`, usa `[]` como fallback e nunca observa `isError`/`error`. O fim do carregamento com falha percorre exatamente os mesmos estados vazios usados por uma empresa sem funcionários.

###############

Bug 1025

Sintoma: Trocar a empresa ativa com o formulário de funcionário aberto permite salvar a ficha da empresa anterior enquanto a página já apresenta o contexto da empresa nova.
Provável causa: `Employees` preserva `editing`, `form` e o diálogo na troca de tenant. `useUpdateEmployee` atualiza somente por `id`, sem filtrar o tenant ativo; um administrador que participa das duas empresas continua autorizado pela RLS a gravar a linha antiga.

###############

Bug 1026

Sintoma: Duas pessoas podem editar simultaneamente o mesmo funcionário e ambas receber confirmação, mas o último salvamento restaura silenciosamente dados pessoais, lotação, documentos, estado e observações antigos sobre a primeira alteração.
Provável causa: O formulário reenvia todo o snapshot e `useUpdateEmployee` condiciona o `UPDATE` apenas ao `id`. A tabela possui `updated_at` e `version`, porém nenhum deles é usado como revisão esperada ou controle otimista.

###############

Bug 1027

Sintoma: Um CPF com 11 dígitos mas inválido pode ser aceito como identidade real, e dois funcionários com o mesmo CPF podem ser fundidos na mesma pessoa canônica do workspace, propagando nome, contato e estado de um cadastro sobre projeções do outro.
Provável causa: O formulário e a tabela `employees` não validam dígitos verificadores, normalização ou unicidade de `doc_cpf`. O trigger de pessoas compartilhadas considera qualquer sequência com exatamente 11 dígitos como `identity_key = 'cpf:...'` e usa `ON CONFLICT ... DO UPDATE`, transformando coincidência/erro de digitação em identidade global compartilhada.

###############

Bug 1028

Sintoma: É possível registrar uma CNH sem número, com categoria arbitrária ou com validade incoerente, e esses dados ainda alimentam alertas e exibições de conformidade como se fossem documentos válidos.
Provável causa: `Employees.handleSave` envia `cnh_number`, `cnh_category` e `cnh_expiry` de forma independente e valida somente o nome do funcionário. A categoria é um texto livre e não há regra no banco exigindo combinação consistente, categoria permitida ou data associada a um número de CNH.

###############

Bug 1029

Sintoma: Funcionários com histórico muito grande podem ter contratos e ações de ocorrência antigos omitidos da ficha, enquanto os títulos e tabelas apresentam o subconjunto como histórico completo.
Provável causa: `useEmployeeContracts` e `useEmployeeIncidentActions` executam um único `select` sem paginação, cursor, total ou detecção de truncamento. Diferentemente das consultas de folha e acertos da mesma ficha, essas duas permanecem limitadas à página máxima da API.

###############

Bug 1030

Sintoma: Clicar em “Desativar” um contrato pode não produzir efeito e não exibir erro algum; o operador não sabe se o contrato continuou ativo nem se deve tentar novamente.
Provável causa: O botão chama `update.mutate(...)` sem `await`, toast, `onError` ou estado visual próprio. A rejeição de `useUpdateEmployeeContract` fica apenas no estado interno do React Query e nenhuma mensagem é renderizada pela ficha.

###############

Bug 1031

Sintoma: Marcar um funcionário como “Desligado” não registra a data de desligamento; folhas e relatórios que dependem de `termination_date` podem tratá-lo como empregado durante toda a competência ou por tempo indefinido.
Provável causa: A tabela e os fluxos de folha possuem `employees.termination_date`, mas o formulário de `Employees` não mostra nem envia esse campo. A mudança de `status` para `terminated` também não possui trigger que preencha a data ou encerre o contrato ativo.

###############

Bug 1032

Sintoma: Um funcionário desligado continua marcado como pessoa ativa no cadastro canônico do workspace e pode permanecer ativo nas projeções compartilhadas das outras empresas.
Provável causa: `sync_workspace_person_projection` calcula a atividade de funcionários como `status <> 'inactive'`. Como `terminated` é diferente de `inactive`, o trigger grava `workspace_people.active = true` para desligados, em vez de restringir atividade a estados efetivamente vigentes.

###############

Bug 1033

Sintoma: Alterar o CPF de um funcionário muda o CPF exibido na pessoa compartilhada, mas conserva a identidade canônica baseada no CPF antigo; cadastrar depois outra pessoa com o documento antigo pode fundi-la ao funcionário errado.
Provável causa: Quando já existe `workspace_person_tenant_links`, `sync_workspace_person_projection` atualiza `workspace_people.name`, `cpf`, contato e dados de origem, mas não recalcula `identity_key`. A chave única continua `cpf:<documento anterior>` enquanto a coluna `cpf` já contém o valor novo.

###############

Bug 1034

Sintoma: Trocar a empresa com a ficha detalhada de um funcionário aberta produz um painel híbrido: contratos, ocorrências, folha, motorista e acertos continuam vindo da empresa anterior, enquanto adiantamentos passam a ser consultados na empresa nova; ainda é possível desativar o contrato antigo nesse contexto misto.
Provável causa: `detailEmployee` não é limpo na troca de tenant. A maioria das queries do detalhe usa somente `employee.id`/`driver_id` na chave e no filtro, mas `useEmployeeAdvances` inclui `currentTenant.id`; `useUpdateEmployeeContract` também atualiza apenas por ID. Assim cada seção reage de forma diferente à mesma mudança de contexto.

###############

Bug 1035

Sintoma: Trocar a empresa com “Novo veículo” aberto conserva todos os dados digitados e permite cadastrá-los na empresa recém-selecionada; numa edição, o mesmo gesto mantém o veículo antigo no diálogo e termina em uma falsa mensagem de conflito concorrente.
Provável causa: `Vehicles` não fecha nem limpa `editingVehicle`/`dialogOpen` na mudança de tenant, e o efeito de inicialização de `VehicleDialog` depende apenas de `open` e `vehicle`, não de `tenantId`. A criação usa o novo tenant com o formulário preservado; a edição combina o ID antigo com o filtro do tenant novo e recebe zero linhas.

###############

Bug 1036

Sintoma: Atribuir/remover motorista ou excluir um veículo pode exibir “Vínculo atualizado”/“Veículo removido” mesmo quando o registro foi apagado, mudou de empresa ou nenhuma linha foi afetada.
Provável causa: `assignMutation` e `deleteMutation` verificam somente o campo `error` dos comandos filtrados por ID/tenant. Nenhuma operação pede retorno ou contagem, então a resposta bem-sucedida de zero linhas do PostgREST segue para o toast positivo.

###############

Bug 1037

Sintoma: Remover um veículo que ainda não possui referências restritivas pode apagar silenciosamente posições, estado, eventos, abastecimentos, manutenções, odômetro, vínculos de rastreador e atribuições; a confirmação genérica não informa a perda histórica envolvida.
Provável causa: A tela executa `DELETE` físico em `vehicles`. Diversas FKs operacionais usam `ON DELETE CASCADE` (`positions_raw`, `positions_last`, `vehicles_state`, `vehicle_events`, `vehicle_fueling`, `vehicle_maintenance`, `vehicle_odometer`, `vehicle_tracker_links` e `vehicle_driver_assignments`), e não existe fluxo de inativação/arquivamento nem resumo de dependências antes da exclusão.

###############

Bug 1038

Sintoma: Um veículo removido de uma empresa pode reaparecer automaticamente depois que sua projeção em outra empresa do workspace é editada, embora a interface tenha confirmado a exclusão.
Provável causa: A exclusão apaga somente a linha/projeção local e seu `workspace_vehicle_tenant_links`, não o `workspace_vehicles` canônico nem as projeções irmãs. Em qualquer atualização posterior, `sync_workspace_vehicle_projection` percorre todos os tenants e recria com `insert_shared_projection` a projeção cujo link está ausente.

###############

Bug 1039

Sintoma: O cadastro aceita como placa qualquer sequência não vazia depois de remover pontuação — inclusive um único caractere ou formato impossível — e ela passa a ser a identidade compartilhada do veículo no workspace.
Provável causa: `VehicleDialog` apenas converte para maiúsculas, remove caracteres não alfanuméricos e testa se restou algum texto. O trigger canônico repete somente a verificação de vazio; não há validação de placa brasileira antiga/Mercosul, tamanho ou estrutura.

###############

Bug 1040

Sintoma: Configurar explicitamente limite de velocidade igual a zero não produz o comportamento salvo; o processamento aplica o limite do tenant ou 80 km/h, enquanto o cadastro continua exibindo zero.
Provável causa: A tela e o CHECK aceitam `speed_limit_kmh >= 0`, mas `agvlog-run-queue` resolve o limite com `vehicleData?.speed_limit_kmh || tenantSettings.overspeed_limit_kmh || 80`. O zero válido é tratado como ausência por truthiness.

###############

Bug 1041

Sintoma: Campos inteiros como ano de fabricação, máximo de paletes e limite de velocidade aceitam decimais no formulário, passam pela validação local e só falham no banco com uma mensagem técnica ao salvar.
Provável causa: O helper `num` usa `step="any"` para todos os campos e `handleSubmit` valida apenas finitude/não negatividade. Depois converte com `Number` e envia valores fracionários para colunas PostgreSQL `integer`, sem conferir `Number.isInteger` nem aplicar passos específicos.

###############

Bug 1042

Sintoma: Qualquer membro autenticado de uma empresa do workspace pode recuperar a senha do rastreador de um veículo por consulta direta, inclusive quando a coluna protegida `vehicles.tracker_password` não pode ser selecionada pelo navegador.
Provável causa: O trigger de frota grava `to_jsonb(new)` integralmente em `workspace_vehicles.source_data`, incluindo `tracker_password`. A tabela canônica concede `SELECT` de todas as colunas a `authenticated` sob a policy `workspace_member_read`; não há revogação do campo JSON nem remoção da senha antes de persistir `source_data`, contornando a proteção de coluna aplicada somente a `vehicles`.

###############

Bug 1043

Sintoma: Um usuário comum de qualquer empresa do workspace pode consultar dados pessoais e trabalhistas completos de motoristas e funcionários das empresas irmãs — como CPF, endereço, filiação, cônjuge, documentos, observações e dados de origem — mesmo sem acesso administrativo ao tenant de origem.
Provável causa: `sync_workspace_person_projection` armazena `to_jsonb(new)` completo em `workspace_people.source_data`, e a migração concede `SELECT` integral nessa tabela a todo `authenticated` que satisfaça apenas `private.is_workspace_member(workspace_id)`. O JSON não é reduzido a campos mestres compartilháveis e a policy não exige papel administrativo nem vínculo com o tenant originador.

###############

Bug 1044

Sintoma: Membros de empresas irmãs conseguem ler pelo cadastro canônico informações fiscais, contábeis e comerciais que deveriam permanecer locais, como inscrições, regime tributário, códigos contábeis, grupo orçamentário, notas de pagamento e configurações de impostos de clientes/fornecedores.
Provável causa: `apply_shared_projection_columns` exclui explicitamente esses campos ao copiar `clients` entre tenants, mas `sync_workspace_party_projection` ainda grava a linha inteira em `workspace_parties.source_data`. A policy de leitura da tabela canônica autoriza qualquer membro do workspace a selecionar esse JSON, anulando na prática a separação criada pela lista de campos excluídos.

###############

Bug 1045

Sintoma: Um administrador de uma única empresa pode conceder a qualquer usuário vinculado como motorista acesso ativo a todas as outras empresas do workspace, sem aprovação dos proprietários desses tenants.
Provável causa: Ao sincronizar um `driver` com `user_id`, `sync_workspace_person_projection` percorre todos os tenants irmãos e insere `tenant_memberships(role = 'driver', active = true)` usando `SECURITY DEFINER`. A autorização da alteração é verificada apenas pela RLS da linha de origem; o trigger não exige autoridade do ator em cada tenant destinatário.

###############

Bug 1046

Sintoma: Desativar um motorista, remover seu usuário ou excluir o vínculo na empresa de origem não revoga os acessos de motorista criados automaticamente nas empresas irmãs; a conta pode conservar acesso indefinidamente.
Provável causa: O trigger compartilhado somente insere memberships ativos quando encontra `user_id`. Não existe ramo simétrico para desativar/remover os `tenant_memberships` propagados quando `active` vira falso, o usuário muda ou o vínculo é apagado; também não há marca de origem que permita reconciliá-los depois.

###############

Bug 1047

Sintoma: Alterar o CNPJ/CPF de um cliente ou fornecedor muda o documento exibido na entidade canônica, mas mantém a identidade baseada no documento anterior; um cadastro posterior com o número antigo pode ser fundido à empresa errada.
Provável causa: No ramo em que já existe `workspace_party_tenant_links`, `sync_workspace_party_projection` atualiza `tax_id` e demais dados de `workspace_parties`, mas não recalcula `identity_key`. A chave única continua `tax:<documento anterior>` embora a linha passe a declarar outro documento.

###############

Bug 1048

Sintoma: Mesmo depois de excluir todas as projeções locais de um cliente, pessoa ou veículo, seus dados canônicos — incluindo o `source_data` sensível — podem permanecer consultáveis indefinidamente por membros do workspace.
Provável causa: As FKs fazem a exclusão da projeção apagar apenas a linha de `workspace_*_tenant_links`. Não existe trigger `AFTER DELETE` que remova ou reconcilie `workspace_parties`, `workspace_people` ou `workspace_vehicles` quando o último link desaparece; as policies continuam autorizando a leitura pelo workspace, independentemente de existir projeção ativa.

###############

Bug 1049

Sintoma: Se o catálogo de clientes falhar, a tela de Pedidos mantém a listagem normal, mostra o seletor de cliente vazio e ainda permite criar um pedido sem vínculo, como se a empresa realmente não tivesse clientes.
Provável causa: `Orders` extrai apenas `data` de `useClients`, substitui falha/carregamento por `[]` e não observa `isError`, `error` ou `isLoading` dessa query. `OrderForm` recebe somente o array e o salvamento não exige `client_id`.

###############

Bug 1050

Sintoma: Trocar a empresa com um pedido novo aberto conserva todos os valores e permite cadastrá-los na empresa nova; numa edição, mantém o pedido antigo no diálogo e acusa incorretamente que outra pessoa o alterou.
Provável causa: `Orders` não limpa `dialogOpen`/`editingOrder` na troca de tenant, e `OrderForm` mantém seu estado local enquanto continua montado. A criação usa o `currentTenant` novo; a atualização combina o ID/`updated_at` antigos com o filtro do novo tenant e interpreta zero linhas como conflito concorrente.

###############

Bug 1051

Sintoma: Digitar manualmente os campos “Valor ICMS”, “Valor PIS”, “Valor COFINS”, “Valor CBS” ou “Valor IBS” não tem efeito: ao salvar, o sistema substitui silenciosamente todos eles pelos valores calculados.
Provável causa: Esses valores são inputs editáveis comuns, mas `handleSubmit` chama `calculateOrderTotals(form)` e sobrescreve cada campo com base/alíquota antes de montar o payload. A interface não os marca como somente leitura nem avisa que a edição manual será descartada.

RESOLVIDO

###############

Bug 1052

Sintoma: Deixar as bases de ICMS, CBS ou IBS vazias gera e grava valores de imposto calculados sobre o frete total, porém salva as próprias bases como `null`; o pedido fica sem evidência da base que produziu o tributo.
Provável causa: O helper `base` usa `total` apenas temporariamente quando o texto está vazio. `calculateOrderTotals` atualiza os campos de valor, mas não preenche `icms_base`, `cbs_base` ou `ibs_base`; na conversão final, os textos vazios viram `null`.

RESOLVIDO

###############

Bug 1053

Sintoma: Um desconto maior que todo o subtotal é aceito e gravado integralmente, enquanto o total do frete é forçado a zero; os componentes deixam de fechar matematicamente e relatórios podem exibir desconto superior ao serviço cobrado.
Provável causa: `calculateOrderTotals` calcula `Math.max(subtotal - discount, 0)` sem rejeitar ou limitar `discount_value` ao subtotal. A validação posterior exige apenas números finitos e não negativos, portanto a inconsistência é persistida.

RESOLVIDO

###############

Bug 1054

Sintoma: Por chamada direta à API, um administrador pode pular qualquer etapa do pedido, voltar de entregue para recebido ou cancelar depois da expedição, embora o formulário permita somente as transições definidas pelo fluxo operacional.
Provável causa: `getNextStatuses` restringe exclusivamente as opções renderizadas no frontend. `useUpdateOrder` executa `UPDATE` direto e o banco valida apenas que `status` pertence ao conjunto permitido; não existe comando/trigger que compare o estado anterior e autorize a transição.

###############

Bug 1055

Sintoma: Clicar duas vezes rapidamente em “Salvar” na criação de pedido pode criar o registro na primeira requisição e logo depois exibir erro de número duplicado da segunda, fazendo o usuário acreditar que a operação falhou apesar de o pedido já existir.
Provável causa: O botão interno de `OrderForm` não recebe nem observa `createOrder.isPending`/`updateOrder.isPending`, e `handleSubmit` pode chamar o callback assíncrono várias vezes em paralelo. O índice único impede o segundo insert, mas não evita o envio duplicado nem reconcilia o sucesso parcial percebido.

RESOLVIDO

###############

Bug 1056

Sintoma: O mesmo número de pedido pode ser cadastrado em variantes com espaços nas pontas ou diferenças de maiúsculas/minúsculas, aparecendo como duplicado visualmente e tornando busca e integrações ambíguas.
Provável causa: O botão apenas testa `form.order_number.trim()` para habilitar o salvamento, mas envia a string original. `idx_orders_number` é único sobre o texto bruto `(tenant_id, order_number)`, sem `btrim`, normalização de caixa ou coluna canônica.

###############

Bug 1057

Sintoma: Empresas com muitos centros de custo deixam de ver parte dos centros ativos nos filtros e parte do cadastro na tela de gerenciamento, sem paginação, total ou aviso de que a lista foi cortada.
Provável causa: As queries `cost_centers` e `cost_centers_full` de `useCostCenters` fazem cada uma um único `select` ordenado, sem `range`, cursor ou detecção de saturação. Os consumidores tratam os arrays devolvidos como catálogos completos.

###############

Bug 1058

Sintoma: Não é possível descobrir quem criou, reativou, ativou, desativou ou excluiu um centro de custo; mudanças que alteram classificação financeira deixam somente o estado atual ou desaparecem com a exclusão.
Provável causa: `cost_centers` não possui `created_by`/`updated_by`; `create_or_reactivate_cost_center_v1` retorna o ator mas não o persiste, e toggle/delete são comandos diretos sem inserção em `entity_audit_log` ou ledger próprio.

###############

Bug 1059

Sintoma: Uma falha no catálogo de centros de custo deixa filtros financeiros e o seletor de nova despesa silenciosamente vazios; a despesa ainda pode ser registrada sem o centro pretendido, como se nenhum centro estivesse cadastrado.
Provável causa: `useCostCenters` expõe `isFullError` apenas para o gerenciador. `Financial` e `ManualExpenseWorkspace` consomem somente `fullData || []`, não exibem erro/carregamento nem bloqueiam a preparação; como `cost_center_id` é opcional, o fallback vazio segue até o comando financeiro.

###############

Bug 1060

Sintoma: Trocar a empresa depois de gerar a prévia de uma planilha rural conserva as correspondências da empresa anterior e cria um lote na empresa nova; as linhas então falham ou tentam combinar IDs antigos com o tenant atual.
Provável causa: `preview` não é limpo quando `currentTenant.id` muda e não guarda o tenant para o qual foi construído. `useCommitRuralImport` ignora o contexto da prévia e usa o `currentTenant` vigente no clique, embora `matched_client_id`, `matched_remitter_id` e `existing_profile_id` tenham sido resolvidos no tenant original.

RESOLVIDO

###############

Bug 1061

Sintoma: A importação pode contabilizar uma linha como “atualizada” mesmo quando o perfil foi excluído depois da prévia ou pertence a outro contexto e nenhuma linha recebeu alteração.
Provável causa: O ramo de update filtra por `existing_profile_id`/tenant, verifica somente `error` e incrementa `updated++` sem solicitar retorno ou contagem. Um `UPDATE` PostgREST que atinge zero linhas é considerado sucesso e o cliente correspondente ainda é marcado como rural.

RESOLVIDO

###############

Bug 1062

Sintoma: Quando existem clientes diferentes com o mesmo nome normalizado, a prévia associa destinatário e fornecedor a um deles arbitrariamente, podendo gravar instruções rurais no cadastro errado sem indicar ambiguidade.
Provável causa: `buildRuralImportPreview` cria um único `Map<string, client>` por `normalizeText(company_name)` e cada `set` sobrescreve silenciosamente a correspondência anterior. A consulta não possui ordenação nem a rotina coleta múltiplos candidatos para exigir desambiguação por cidade/documento.

RESOLVIDO

###############

Bug 1063

Sintoma: Depois de importar instruções, telefone, acesso por estrada e exigência de contato, a lista de perfis mostra os dados novos mas os KPIs gerais podem continuar contando o cliente como sem instrução, sem telefone ou sem estrada de terra.
Provável causa: A listagem lê `client_rural_delivery_profiles`, enquanto `useRuralClientsSummary` calcula os indicadores em `clients.rural_driver_instructions`, `rural_contact_phone`, `rural_requires_contact` e `rural_access_type`. A importação atualiza no cliente somente `is_rural` e `rural_updated_at`; não sincroniza os campos que alimentam os cards e não há trigger para isso.

RESOLVIDO

###############

Bug 1064

Sintoma: A página se apresenta como “Cadastro e instruções”, mas não oferece criar, editar, desativar ou corrigir individualmente um perfil rural; qualquer ajuste exige preparar e reimportar uma planilha.
Provável causa: Os hooks `useCreateRuralProfile` e `useUpdateRuralProfile` existem, porém não são usados em nenhum componente. `RuralClients` renderiza os perfis apenas como linhas de leitura e disponibiliza somente o fluxo de importação em massa.

###############

Bug 1065

Sintoma: Uma prévia com mais de 200 linhas confirma e importa linhas que o usuário nunca consegue revisar na tela, sem aviso de que a tabela visual foi truncada.
Provável causa: O resumo mostra `preview.rows.length`, mas o corpo renderiza incondicionalmente `preview.rows.slice(0, 200)`. Não há paginação, “mostrar mais” nem mensagem informando quantas linhas ficaram ocultas antes do botão “Confirmar importação”.

RESOLVIDO

###############

Bug 1066

Sintoma: Uma importação concluída com falhas não informa no toast nem no histórico quantas gravações falharam ou quais clientes precisam de correção; o operador vê apenas criados, atualizados e não encontrados.
Provável causa: O hook persiste `error_count` e o JSON `errors`, mas `handleCommit` ignora `res.errors`, e a tabela “Últimas importações” não renderiza `error_count`, detalhes ou ação para abrir `errors`. O badge `completed_with_errors` é a única indicação, sem diagnóstico recuperável pela interface.

RESOLVIDO

###############

Bug 1067

Sintoma: O filtro por data do Histórico do Produto pode incluir eventos do dia vizinho ou excluir eventos do dia solicitado para empresas fora do horário de Brasília, divergindo da data operacional do tenant.
Provável causa: `read_product_history_v1` calcula `event_day` e formata detalhes de parada sempre com `America/Sao_Paulo`. A função não lê o timezone configurado da empresa; apenas o instante enviado ao frontend é formatado pelo navegador.

###############

Bug 1068

Sintoma: Consultar um produto comum sem período pode gerar uma resposta JSON enorme, estourar tempo/memória da função e travar o navegador, embora a tela aparente paginar 50 eventos por vez.
Provável causa: `read_product_history_v1` agrega todos os documentos, cargas, coletas, paradas e eventos correspondentes em um único `jsonb_agg`, sem limite ou cursor. `ProductHistory` recebe o array integral, calcula resumos e só depois aplica `usePagination` no cliente.

###############

Bug 1069

Sintoma: O autocomplete de produto pode sugerir apenas um item repetido e omitir outras descrições compatíveis; se a consulta falhar, simplesmente não abre sugestão alguma, como se não houvesse correspondências.
Provável causa: A query limita 50 linhas de `load_items` sem ordenação antes de deduplicar descrições e reduzir a 12 opções. Muitas ocorrências do mesmo produto ocupam todo o lote; o componente também ignora `isError`/`error` dessa query.

###############

Bug 1070

Sintoma: Notas excluídas logicamente continuam aparecendo com número, fornecedor, destinatário e valor na Rastreabilidade de Produto e seguem inflando o indicador “Valor das NFs únicas” e o CSV.
Provável causa: A query de `ProductTraceability` relaciona `fiscal_documents` sem filtrar `deleted_at IS NULL` e nem sequer seleciona esse campo. As linhas apagadas permanecem enriquecendo `load_items` e entram normalmente na deduplicação de valores por `fiscal_document_id`.

RESOLVIDO

###############

Bug 1071

Sintoma: A Rastreabilidade de Produto fica progressivamente lenta e consome memória/rede proporcional a todo o histórico filtrado, apesar de exibir apenas 50 linhas por página.
Provável causa: `fetchAllPostgrestPages` percorre e materializa todas as páginas de `load_items` com joins antes de calcular indicadores, exportação e `usePagination`. A paginação visível é somente um `slice` do array já totalmente transferido.

###############

Bug 1072

Sintoma: Abrir no Excel um CSV de Rastreabilidade pode executar fórmulas injetadas em fornecedor, produto, destinatário, motorista ou outros textos vindos dos cadastros/documentos.
Provável causa: `exportCsv` apenas envolve células em aspas e duplica aspas internas. Não neutraliza valores iniciados por `=`, `+`, `-` ou `@` com `csvSafeCell`, embora outros exportadores do projeto já possuam esse helper.

RESOLVIDO

###############

Bug 1073

Sintoma: Trocar a empresa ativa conserva todos os filtros da Rastreabilidade, inclusive o UUID de motorista da empresa anterior; a empresa nova pode então aparecer sem item algum até que o usuário perceba e limpe o filtro invisivelmente inválido.
Provável causa: `filters` e `appliedFilters` não são reinicializados quando `currentTenant.id` muda. A query passa a filtrar o novo tenant por `loads.driver_id = <ID antigo>`, enquanto o seletor já foi repovoado com motoristas novos e não possui opção correspondente ao valor preservado.

RESOLVIDO

###############

Bug 1074

Sintoma: Um protocolo pode ser criado já com status “Devolvido” sem data de devolução; ele aparece como devolvido, mas a coluna correspondente fica vazia e relatórios mensais passam a usar a data de lançamento como substituta.
Provável causa: Os botões “Marcar como devolvido” e “Salvar e gerar protocolo” permitem enviar `status: 'returned'` com `returned_at: null`. `create_pallet_return_protocol` grava esse estado diretamente e, ao contrário de `update_pallet_return_status`, não preenche nem exige a data efetiva.

###############

Bug 1075

Sintoma: Protocolos importados como “Confirmado” ficam sem data e sem usuário de confirmação; a aba de protocolos exibe “—” em “Confirmado” apesar do status confirmado e a auditoria não contém uma transição de confirmação.
Provável causa: A importação chama `create_pallet_return_protocol` já com `status: 'confirmed'`. A RPC de criação grava somente o status inicial e nunca atribui `confirmed_at`/`confirmed_by`; esses campos são preenchidos apenas pela RPC posterior de mudança de status.

###############

Bug 1076

Sintoma: O cartão “Total paletes” pode não ser igual à soma de PBR, CHEP e Outros e crescer com rascunhos, agendamentos ou cancelamentos, enquanto os três cartões por tipo consideram somente devoluções realizadas.
Provável causa: `kpis.totalPallets` soma `total_quantity` de todos os protocolos carregados, mas `totalsByPalletType` exclui `draft`, `scheduled` e `cancelled` antes de calcular PBR, CHEP e demais tipos.

RESOLVIDO

###############

Bug 1077

Sintoma: Trocar a empresa ativa com um lançamento ou uma importação de paletes preparados conserva os dados da empresa anterior; um formulário manual ou a prévia da planilha pode então ser confirmado e criar os mesmos registros na empresa nova.
Provável causa: Os estados do formulário (`supplierName`, datas, itens, motorista e placa) e `previewList` vivem na página e não são reinicializados quando `currentTenant.id` muda. As mutations, por sua vez, consultam o tenant corrente somente no momento do clique.

RESOLVIDO

###############

Bug 1078

Sintoma: Falhas ao consultar protocolos, tipos de palete ou clientes são apresentadas como listas vazias; o usuário pode acreditar que não há lançamentos/cadastros e começar a digitar fornecedores ou tipos manualmente.
Provável causa: A página aplica valores padrão `[]` aos três hooks e só observa `isLoading` dos protocolos. Nenhum `isError`/`error` é renderizado, portanto o estado de erro cai nas mesmas mensagens e seletores vazios usados para uma resposta válida sem dados.

###############

Bug 1079

Sintoma: A página de devolução de paletes pode consumir memória, rede e CPU excessivas ou travar o navegador conforme cresce o histórico, embora a tabela não ofereça paginação e o usuário geralmente visualize apenas uma pequena parte.
Provável causa: `usePalletProtocols` usa `fetchAllPostgrestPages` para materializar todos os protocolos e todos os itens relacionados no cliente. KPIs, quatro relatórios, duas tabelas e exportações são recalculados sobre o conjunto integral, sem paginação no servidor nem agregações dedicadas.

###############

Bug 1080

Sintoma: Duas alterações simultâneas de status do mesmo protocolo podem sobrescrever uma à outra e produzir um histórico impossível, com duas transições registradas a partir do mesmo estado anterior embora somente a última permaneça no protocolo.
Provável causa: `update_pallet_return_status` lê a linha sem `FOR UPDATE`, valida a transição usando esse snapshot e depois faz `UPDATE` somente por `id`, sem estado/revisão esperados. Transações concorrentes podem validar o mesmo status antigo, aguardar o lock e gravar em sequência sem revalidar.

###############

Bug 1081

Sintoma: Um administrador pode reabrir um protocolo confirmado como “Devolvido”, mas ele continua carregando data/usuário de confirmação, recebedor, assinatura e comprovante da confirmação anterior; telas e exportações passam a mostrar evidências de confirmação em um registro não confirmado.
Provável causa: `update_pallet_return_status` permite explicitamente a transição `confirmed -> returned`, porém só define `confirmed_at` e `confirmed_by` ao confirmar e nunca limpa esses campos nem os dados de assinatura quando sai desse estado.

###############

Bug 1082

Sintoma: Reemitir o PDF de um protocolo antigo pode trocar razão social, CNPJ, endereço, contato ou logotipo pelos dados atuais da empresa, impedindo reproduzir fielmente o documento emitido na data da devolução.
Provável causa: A criação feita pela página não envia `company_snapshot`, deixando a coluna como `{}`. `printProtocol` ignora esse snapshot de qualquer forma e monta o PDF exclusivamente com o resultado atual de `useCompanyProfile` e `currentTenant`.

###############

Bug 1083

Sintoma: Ao importar um arquivo Excel com devoluções distribuídas em várias abas, somente a primeira é pré-visualizada e importada; as demais desaparecem silenciosamente, mas a operação é apresentada como importação do arquivo inteiro.
Provável causa: `parsePalletReturnSheet` escolhe diretamente `wb.SheetNames[0]` e retorna um único `ParsedPalletReturn`; `handleFile` embrulha esse resultado sozinho em `previewList`, sem percorrer nem avisar sobre as outras planilhas.

RESOLVIDO

###############

Bug 1084

Sintoma: Uma planilha cujo total declarado diverge da soma dos itens pode ser importada normalmente e, além da inconsistência ignorada, uma devolução idêntica já existente pode não ser reconhecida como duplicada.
Provável causa: `commitImport` não exclui nem pede confirmação para entradas com `hasTotalDivergence`. Na deduplicação, `sameTotal` compara o registro existente com `p.totalDeclared` quando ele está presente, enquanto a RPC grava como `total_quantity` a soma real dos itens.

RESOLVIDO

###############

Bug 1085

Sintoma: Duas devoluções diferentes do mesmo fornecedor, na mesma data e com a mesma quantidade total, são tratadas como duplicadas mesmo quando possuem tipos e distribuições de paletes distintos; a segunda é descartada da importação.
Provável causa: A deduplicação da importação consulta apenas `supplier_name_snapshot`, `issue_date` e `total_quantity`. A função `protocolDedupeKey`, que inclui a composição ordenada dos itens, existe no importador mas não é usada pelo fluxo de persistência.

RESOLVIDO

###############

Bug 1086

Sintoma: Reimportar a mesma devolução com diferenças apenas de caixa, acentos ou espaços no nome do fornecedor cria outro protocolo em vez de detectar a duplicidade.
Provável causa: A conciliação com clientes normaliza nome, acentos e caixa, mas a busca de duplicados usa `.eq('supplier_name_snapshot', p.supplier)` com o texto cru da planilha; não há chave normalizada nem comparação pela identidade do cliente conciliado.

RESOLVIDO

###############

Bug 1087

Sintoma: Adicionar, ativar ou desativar um tipo de palete pode falhar sem qualquer mensagem; no cadastro novo, os campos ainda são limpos imediatamente, fazendo o usuário perder o conteúdo digitado e acreditar que o tipo foi salvo.
Provável causa: `PalletTypesEditor` chama `upsertType.mutate` sem callbacks de erro/sucesso e limpa o formulário de forma síncrona. A página também não renderiza `upsertType.error` nem dispara toast para essa mutation.

RESOLVIDO

###############

Bug 1088

Sintoma: A verificação de tipos e o build falham antes de gerar a aplicação, impedindo publicar inclusive módulos sem relação com custódia de carga.
Provável causa: `TripCargoCustody.tsx` importa `useState` duas vezes do React, em duas declarações consecutivas. O `tsc` confirma `TS2300: Duplicate identifier 'useState'` nas linhas 1 e 2.

RESOLVIDO

###############

Bug 1089

Sintoma: Selecionar “Rejeitar” em uma divergência deixa a custódia permanentemente bloqueada em carregamento: a divergência continua sendo considerada pendente, mas não pode mais ser revisada, corrigida nem removida para liberar a saída.
Provável causa: A revisão endurecida aceita transição somente quando o estado atual é `pending`, tornando `rejected` terminal. Entretanto, tanto o cálculo de `ready_to_depart` quanto a lista de bloqueios continuam tratando `status IN ('pending','rejected')` como não resolvido, e não existe comando posterior para sair de `rejected`.

###############

Bug 1090

Sintoma: O operador precisa aprovar, rejeitar ou marcar como corrigidas avarias, faltas, sobras e problemas de lacre sem conseguir abrir as fotos obrigatórias que deveriam comprovar a ocorrência.
Provável causa: O dossiê busca `snapshot.evidence` com `storage_path`, mas `TripCargoCustody` nunca renderiza essa coleção nem gera URL assinada. Nos lacres mostra apenas “evidência vinculada” e nas divergências exibe somente descrição e valores.

###############

Bug 1091

Sintoma: Confirmar novamente uma carga ainda em estado de carregamento pode criar cópias das mesmas divergências de volume, paletes, peso ou ocorrência manual, multiplicando revisões para um único fato e impedindo a liberação até tratar todas elas.
Provável causa: `confirm_cargo` é permitido em `loading`, zera e regrava as conferências e executa novos `INSERT` em `trip_cargo_divergences` a cada chamada. Não há chave de identidade, busca por divergência aberta equivalente ou atualização do registro anterior; após o sucesso, a interface descarta o `requestId`, então outro clique usa uma identidade nova.

###############

Bug 1092

Sintoma: Se uma foto de carga já estiver salva no dossiê e o motorista selecionar apenas a foto de amarração faltante — ou o inverso — o botão de confirmar permanece desabilitado, embora a validação executada no clique aceite exatamente essa combinação.
Provável causa: `evidenceComplete` exige ou os dois arquivos no estado local ou os dois tipos já presentes em `snapshot.evidence`. Já `confirmCargo` valida `loading` e `tie_down` de forma independente, aceitando para cada tipo arquivo local ou evidência armazenada; o `disabled` impede chegar a essa regra correta.

RESOLVIDO

###############

Bug 1093

Sintoma: Uma tentativa incompleta de resolver vários lacres pode deixar fotos de retorno no storage sem registro de evidência; isso ocorre, por exemplo, quando uma foto é enviada enquanto outro lacre do mesmo lote falha por motivo curto ou arquivo ausente e o motorista abandona a tela.
Provável causa: `resolveInstalledSeals` inicia uploads dentro de `Promise.all`, mas o `catch` apenas exibe toast. Diferentemente de `confirmCargo`, não mantém `uploadedPaths` nem chama `removeSecureFiles` quando qualquer validação, upload ou RPC do conjunto falha.

RESOLVIDO

###############

Bug 1094

Sintoma: A custódia pode ser marcada como retornada enquanto a viagem operacional ainda está em trânsito ou em progresso, produzindo estados contraditórios e permitindo que a operação avance para o encerramento antes da conclusão formal da viagem.
Provável causa: A tela só habilita “Registrar retorno à base” quando `snapshot.trip_status === 'completed'`, mas `driver_update_trip_cargo_v1` não repete essa condição. A ação direta `mark_returned` exige apenas custódia `departed`, paradas em estados terminais e checklist pós-viagem.

###############

Bug 1095

Sintoma: Documentos fiscais cancelados, removidos ou adicionados depois do aceite da viagem podem continuar faltando ou sobrando na conferência; o motorista é obrigado a confirmar uma referência obsoleta ou consegue sair sem conferir uma referência nova.
Provável causa: `sync_trip_cargo_expected` é executada apenas quando o controle é criado no aceite. Consultar e confirmar o dossiê não ressincroniza o catálogo; além disso, a função usa somente `INSERT ... ON CONFLICT DO NOTHING` para documentos e não remove checks cuja fonte deixou de ser elegível.

###############

Bug 1096

Sintoma: Uma carga cujo peso, volume ou quantidade esperada de paletes seja desconhecida pode abrir divergência automática contra zero assim que o motorista informa a medida real, apresentando uma diferença que nunca foi planejada.
Provável causa: Os campos esperados são anuláveis, mas `confirm_cargo` compara `coalesce(expected_*, 0)` com o valor confirmado. Assim, ausência de referência vira expectativa zero e ainda grava `expected_value` nulo na divergência criada.

###############

Bug 1097

Sintoma: Trocar a empresa ativa enquanto a lista de custódias está numa página avançada pode exibir “Nenhuma custódia encontrada” na empresa nova mesmo havendo diversos dossiês na primeira página.
Provável causa: O estado `page` só volta a 1 quando o filtro de situação muda. A mudança de `currentTenant.id` altera a chave da consulta, mas preserverva o número da página anterior e solicita diretamente esse `OFFSET` no novo tenant.

RESOLVIDO

###############

Bug 1098

Sintoma: Abrir um dossiê durante uma atualização do motorista pode falhar com a mensagem genérica de resposta inválida, mesmo quando todos os dados no banco são válidos; atualizar a página logo depois tende a fazê-lo funcionar.
Provável causa: `getTripCargoControl` lê primeiro os totais das cinco coleções e depois busca cada coleção em RPCs independentes, paralelas e paginadas. Qualquer inserção de evidência, lacre ou divergência entre esses snapshots muda `total_count`; o cliente exige igualdade exata com o total inicial e rejeita o dossiê inteiro, sem nova tentativa.

###############

Bug 1099

Sintoma: O operador não consegue identificar com segurança qual viagem, motorista, veículo ou carga está revisando sem conhecer UUIDs internos; registros diferentes com prefixos semelhantes ficam praticamente indistinguíveis e favorecem ação no dossiê errado.
Provável causa: A listagem e o detalhe exibem somente os oito primeiros caracteres de `trip_id`, `driver_id`, `vehicle_id` e `load_id`. `list_trip_cargo_controls_v2` e o snapshot não retornam número da viagem/carga, nome do motorista nem placa para a interface apresentar identificadores operacionais.

###############

Bug 1100

Sintoma: Mesmo removendo o erro de importação da página de custódia, a verificação de tipos continua falhando em `FreightAuditDrawer`, mantendo o build bloqueado.
Provável causa: O drawer encadeia `.catch()` ao resultado tipado como `PromiseLike<void>` produzido por `.then()` no query builder do Supabase; esse contrato só garante `then` e o `tsc` acusa `TS2339: Property 'catch' does not exist on type 'PromiseLike<void>'`.

RESOLVIDO

###############

Bug 1101

Sintoma: A aplicação também não passa na verificação de tipos ao compilar as operações de criação e edição de rotas operacionais.
Provável causa: `useOperationalRoutes` espalha `Partial<OperationalRoute>` diretamente em `TablesInsert`/`TablesUpdate<'operational_routes'>`. A propriedade `destinations` usa `RouteDestination[]`, cujo objeto contém índice `unknown`, e portanto não é atribuível ao tipo JSON gerado; o `tsc` emite `TS2322` nas duas mutations.

RESOLVIDO

###############

Bug 1102

Sintoma: A página de resolução de endereços impede a verificação de tipos do projeto, mesmo que a consulta só seja habilitada quando há empresa selecionada.
Provável causa: `tenantId` permanece tipado como `string | undefined` dentro de `queryFn` e é enviado ao argumento obrigatório `_tenant_id` sem guarda ou asserção. A opção `enabled: Boolean(tenantId && isAdmin)` não estreita o tipo no closure, resultando em `TS2322`.

RESOLVIDO

###############

Bug 1103

Sintoma: A página de Rotas Operacionais mantém outro erro de compilação ao tentar mostrar quantos registros inválidos foram descartados do catálogo.
Provável causa: O `queryFn` de `useOperationalRoutes` pode retornar `[]` quando falta contexto ou um `OperationalRouteCatalog` nos demais casos. Por isso `routesQuery.data` é inferido como `never[] | OperationalRouteCatalog`, e acessar `.invalidCount` produz `TS2339`.

RESOLVIDO

###############

Bug 1104

Sintoma: Um operador pode confirmar a exclusão de uma Rota Operacional, receber “Rota removida” e continuar com o registro intacto no banco e na próxima atualização da lista.
Provável causa: A página é utilizável por operadores, mas as políticas concedem `DELETE` somente pela regra administrativa herdada; a política específica de operador cobre apenas `INSERT` e `UPDATE`. `useDeleteOperationalRoute` executa o delete sem `.select()`/contagem e trata a resposta de zero linhas por RLS como sucesso.

RESOLVIDO

###############

Bug 1105

Sintoma: Quando a página avisa que existem rotas com destinos incompatíveis e orienta corrigi-las, não há como localizar, editar, desativar ou excluir esses registros pela própria interface.
Provável causa: `parseOperationalRouteCatalog` incrementa `invalidCount`, mas descarta completamente cada linha inválida antes de entregar `routes` à página. O alerta conserva apenas a quantidade, sem IDs ou dados mínimos para oferecer qualquer ação corretiva.

RESOLVIDO

###############

Bug 1106

Sintoma: Duas pessoas editando a mesma Rota Operacional podem salvar com sucesso e a última gravação apagar silenciosamente nome, descrição, classificação, região, status ou destinos atualizados pela primeira.
Provável causa: `useUpdateOperationalRoute` envia o snapshot completo do formulário e atualiza somente por `id`; não inclui `updated_at`/revisão esperada no filtro nem usa uma RPC com comparação atômica. O `updated_at` enviado é apenas o novo valor, não uma condição de concorrência.

RESOLVIDO

###############

Bug 1107

Sintoma: Trocar a empresa ativa com o diálogo “Nova Rota Operacional” aberto conserva nome, região e destinos digitados na empresa anterior e permite cadastrá-los na empresa nova; numa edição, a mesma troca termina apenas em erro tardio ao salvar o ID antigo.
Provável causa: `dialogOpen`, `editingId` e `form` não são reinicializados quando `currentTenant.id` muda. A mutation de criação lê o tenant corrente no clique, enquanto a de edição mantém no formulário um ID carregado no tenant anterior.

RESOLVIDO

###############

Bug 1108

Sintoma: Trocar a empresa ativa na página de resolução de endereços enquanto se está numa página avançada pode mostrar uma fila vazia na nova empresa, mesmo havendo endereços pendentes nas primeiras páginas.
Provável causa: O estado `page` não é reinicializado na mudança de `tenantId`; a nova chave da query reaproveita o mesmo `_page_offset`, e o ajuste para a última página só ocorre depois de receber a resposta deslocada.

RESOLVIDO

###############

Bug 1109

Sintoma: Ao percorrer a fila de endereços, registros podem se repetir ou ser pulados entre páginas, especialmente depois de usar “Buscar opções” em algum item.
Provável causa: `get_active_address_resolution_queue_v2` pagina por `OFFSET` ordenado por `updated_at,id`. A pesquisa faz `upsert` da linha e altera `updated_at`, movendo-a no conjunto entre requisições; inserções, resoluções e novas tentativas também mudam as fronteiras sem cursor ou snapshot estável.

RESOLVIDO

###############

Bug 1110

Sintoma: O painel de Auditoria do Frete apresenta “Histórico (10)” como se fossem todos os cálculos, embora possa haver registros anteriores omitidos sem aviso nem opção de navegar ou carregar mais.
Provável causa: `FreightAuditDrawer` aplica `.limit(10)` e não solicita contagem total, cursor ou páginas adicionais. O título usa somente `logs.length`, tornando o limite técnico indistinguível do histórico completo.

RESOLVIDO

###############

Bug 1111

Sintoma: Em empresas com mais inconsistências que o limite de linhas da API, a Auditoria de consistência omite parte dos problemas e calcula cartões, domínios e páginas como se o subconjunto recebido fosse o resultado completo.
Provável causa: `audit_data_consistency_v2` retorna uma linha por ocorrência, mas `DataAudit` chama a RPC uma única vez, sem `.range`, cursor ou total. A paginação de 50 registros ocorre somente depois, com `usePagination`, sobre o array já limitado pelo PostgREST.

RESOLVIDO

###############

Bug 1112

Sintoma: Trocar a empresa ativa após filtrar a auditoria por um domínio pode exibir “Nenhuma inconsistência detectada” na nova empresa mesmo quando os cartões indicam problemas em outros domínios.
Provável causa: `domainFilter` não é reinicializado quando `currentTenant.id` muda. Se o domínio antigo não existir no novo resultado, nenhum botão correspondente aparece, mas `filtered` continua vazio e aciona a mensagem verde de ausência de inconsistências.

RESOLVIDO

###############

Bug 1113

Sintoma: Uma resposta incompleta ou incompatível do RPC de observabilidade pode ser exibida como zero links, zero conflitos, zero erros e agenda nos valores padrão, em vez de alertar que as métricas não são confiáveis.
Provável causa: `parseTrackingObservability` não valida o envelope nem campos obrigatórios; objetos ausentes e todo valor não numérico são convertidos silenciosamente para `{}` e `0`, enquanto intervalos inválidos viram 3 minutos e 6 horas. A query é considerada bem-sucedida e a tela renderiza esses fallbacks como dados reais.

RESOLVIDO

###############

Bug 1114

Sintoma: A etapa “Pipeline automático comprovado por 24h+” pode ficar verde após uma longa interrupção, bastando haver uma execução recente e 24 sucessos acumulados em qualquer período histórico.
Provável causa: `evaluateSsxReadiness` exige `first_successful_run_at` antigo, `last_successful_run_at` nos últimos 30 minutos e `successful_run_count >= 24`, mas o contador é cumulativo. Não verifica continuidade, distribuição dos sucessos nas últimas 24 horas nem falhas/interrupções dentro dessa janela.

RESOLVIDO

###############

Bug 1115

Sintoma: Um timestamp textual inválido nos dados de saúde do pipeline, conta SSX ou observabilidade pode lançar uma exceção durante a renderização e derrubar toda a página de Saúde da Integração.
Provável causa: `formatTime` aceita qualquer string e passa `new Date(iso)` diretamente a `formatDistanceToNow`, que lança para `Invalid Date`. Os objetos `tenant.settings.pipeline_health` e o parser de observabilidade não validam o formato ISO antes da chamada.

RESOLVIDO

###############

Bug 1116

Sintoma: O cabeçalho “Saúde da Integração SSX” pode exibir o badge `healthy` mesmo com pipeline parado, agenda falhando, posições antigas, conflitos de mapeamento ou erros na fila de tracking.
Provável causa: `operationalStatus` considera exclusivamente se existem contas e se todas têm `account.status === 'ok'`. Nenhuma das métricas de pipeline, observabilidade, frescor, agendamento, conflitos ou prontidão participa do status destacado no título.

RESOLVIDO

###############

Bug 1117

Sintoma: Ao abrir “Importar extrato”, uma falha na consulta das contas bancárias deixa o seletor de conta vazio, sem aviso nem opção de tentar novamente, fazendo parecer que não existem contas disponíveis e impedindo preparar a importação.
Provável causa: `StatementImportDialog` usa apenas `(accounts.data || [])` de `useBankAccounts()` para montar as opções. Os estados `isPending`, `isError` e `error` do hook não são renderizados nem bloqueiam o formulário com uma explicação ou ação de recuperação.

RESOLVIDO

###############

Bug 1118

Sintoma: Na tela de extratos importados, não é possível restringir a listagem a uma conta bancária específica; pesquisar pelo nome pode misturar contas com nomes semelhantes e não oferece seleção inequívoca pelo identificador.
Provável causa: `StatementListFilters` e `finance_private.list_statements` suportam `account_id`, mas `FinanceStatements` não renderiza nenhum campo de conta e mantém `draft.account_id` permanentemente vazio. A busca disponível faz apenas correspondência textual conjunta em nome do arquivo e nome da conta.

RESOLVIDO

###############

Bug 1119

Sintoma: Consultar ou paginar as linhas de um extrato com histórico extenso fica progressivamente mais lento e retransmite repetidamente todo o histórico, embora cada página mostre apenas 30 linhas.
Provável causa: `finance_private.statement_lines_original` agrega em `history` todos os `finance_events` da importação, sem limite ou cursor, e inclui esse array integral em toda resposta paginada de linhas. `StatementHistoryDetail` recebe novamente o conjunto completo a cada troca de página ou filtro.

RESOLVIDO

###############

Bug 1120

Sintoma: Um pedido local corrompido ou incompatível bloqueia permanentemente tanto a preservação de previsões de caixa quanto a revisão manual de datas esperadas para aquela empresa e usuário, sem ação visível para descartar o registro e recomeçar.
Provável causa: `CashForecastPreserve` e `CashForecastAgendaConfirmation` transformam qualquer falha de `pendingCashForecast`/`pendingCashForecastAgenda` em `corrupt = true` e passam a impedir os envios. As interfaces mostram apenas “Pedido salvo incompatível”, sem remover ou substituir as chaves `agvlog:cash-forecast:v1:*` e `agvlog:cash-forecast-agenda:v1:*` do `localStorage`.

RESOLVIDO

###############

Bug 1121

Sintoma: Se o pedido salvo de revisão de identidade de uma linha ou de reversão de uma decisão/conciliação estiver malformado, essas ações ficam bloqueadas pelo restante da sessão, sem botão para descartar a recuperação inválida.
Provável causa: `StatementIdentityReview`, `StatementReviewReversal` e `ReconciliationReversal` capturam falhas ao interpretar suas chaves do `sessionStorage`, guardam `restored.error` e desabilitam permanentemente preparação/confirmação. Diferentemente de `StatementReconciliation`, esses três componentes não expõem uma ação para remover a chave defeituosa e limpar o estado de recuperação.

RESOLVIDO

###############

Bug 1122

Sintoma: Depois de gerar o link temporário do arquivo original de um extrato, uma nova tentativa que falha pode continuar exibindo o link anterior já vencido junto com a mensagem de erro, levando o usuário a insistir em um acesso inválido.
Provável causa: `StatementHistoryDetail.original()` limpa apenas `error` antes de solicitar outra URL assinada; o estado `link` só é substituído em caso de sucesso e nunca é zerado no início da tentativa nem nos caminhos de falha. Como a URL dura 60 segundos, a âncora antiga permanece renderizada.

RESOLVIDO

###############

Bug 1123

Sintoma: No “Histórico anterior” da conciliação bancária, é possível escolher início posterior ao fim ou um intervalo superior a dez anos; a tela dispara a consulta e substitui todos os indicadores e abas por um erro genérico, sem indicar qual data precisa ser corrigida.
Provável causa: `LegacyBankReconciliation` mantém dois inputs de data independentes, sem `min`, `max`, formulário com validação ou cálculo de intervalo, e sempre habilita `useLegacyReconciliationSummary`. O RPC rejeita `_period_start > _period_end` e períodos acima de 3.660 dias, mas essas regras não são reproduzidas nem explicadas na interface.

RESOLVIDO

###############

Bug 1124

Sintoma: Um registro corrompido ou incompatível de fechamento bancário no navegador bloqueia fechar e reabrir períodos daquela conta por toda a sessão, sem permitir descartar o pedido inválido e reiniciar a decisão.
Provável causa: `AccountPeriodCloseWorkspace` converte qualquer falha ao interpretar `finance-account-period-decision:*` do `sessionStorage` em `restored.error` e usa esse valor imutável para impedir `prepare` e `submit`. O painel só mostra a mensagem de bloqueio; não há a ação de limpeza já existente no fluxo de conciliação manual.

RESOLVIDO

###############

Bug 1125

Sintoma: Abrir as evidências de um fechamento bancário grande pode transferir e manter em memória milhares de movimentos e dependências de uma só vez; os botões de página reduzem apenas o que aparece na tela, sem reduzir a resposta ou o custo da consulta.
Provável causa: `account_period_closure_evidence` devolve integralmente `c.snapshot` e agrega todas as linhas de `finance_account_period_dependencies` sem limite ou cursor. `AccountPeriodEvidenceWorkspace` só aplica `slice` no navegador para movimentos e dependências depois de receber e validar todo o pacote.

RESOLVIDO

###############

Bug 1126

Sintoma: Um pedido local inválido de contagem, fechamento, reversão de contagem ou reabertura do caixa físico bloqueia todas as novas decisões sobre aquela conta durante a sessão, sem opção para descartar a recuperação defeituosa.
Provável causa: `CashPeriodCloseWorkspace` converte qualquer falha ao ler `finance-cash-period-decision:*` do `sessionStorage` em `restored.error`; `locked` e `submit` passam a impedir todos os fluxos, mas o painel não oferece remoção da chave nem reinicialização do estado.

RESOLVIDO

###############

Bug 1127

Sintoma: Se o registro preservado de uma transferência integral ou de uma etapa de transferência estiver corrompido/incompatível, novas transferências ficam bloqueadas naquela sessão e nem “Retomar etapa anterior” permite limpar o impasse.
Provável causa: `InternalTransferDialog` e `TransferStageDialog` guardam falhas de leitura das chaves `finance-transfer:*` e `finance-transfer-stage:*` em `restored.error`, que desabilita preparação e confirmação. Nenhum dos diálogos possui ação para apagar a recuperação inválida; no modo `recover`, o segundo mostra somente que não há etapa recuperável.

RESOLVIDO

###############

Bug 1128

Sintoma: Ao registrar a chegada de uma transferência em uma página anterior da lista, continuar navegando pelas páginas pode pular outras pendências ou exibir uma página vazia, embora ainda existam transferências em trânsito.
Provável causa: `finance_private.pending_transfers` pagina o conjunto mutável com `LIMIT/OFFSET`. Cada chegada remove uma linha desse conjunto, deslocando todas as posições seguintes, enquanto `PendingTransfers` mantém o número da página e não volta ao início nem usa cursor estável após `onRecorded`.

RESOLVIDO

###############

Bug 1129

Sintoma: A tela “Movimentações registradas” não permite filtrar os lançamentos por conta bancária, obrigando o usuário a misturar contas diferentes ou depender de busca textual que nem sequer pesquisa o nome da conta.
Provável causa: `MovementFilters` e `finance_private.list_movements` suportam `account_id`, mas `MovementWorkspace` não renderiza seletor de conta e mantém `draft.account_id` sempre vazio. A busca do servidor considera descrição, beneficiário, documento e referência, não `bank_accounts.name`.

RESOLVIDO

###############

Bug 1130

Sintoma: O formulário de movimentação oferece contas bancárias inativas; o usuário consegue preencher todo o lançamento e só descobre ao enviar que a conta não pode receber novos registros.
Provável causa: `MovementEntryDialog` monta o seletor com `accounts.data?.map(...)` sem filtrar `account.active`, embora `record_movement` exija uma conta ativa e devolva `finance_invalid_account`. Os diálogos de transferência, por contraste, aplicam explicitamente `.filter(a => a.active)`.

RESOLVIDO

###############

Bug 1131

Sintoma: Um rascunho corrompido de movimentação bloqueia permanentemente novos lançamentos para a empresa e usuário durante a sessão, sem permitir apagar o conteúdo inválido pela interface.
Provável causa: `restore()` captura qualquer falha ao interpretar `finance-movement-draft:*` e define `restored.error`; o formulário inteiro e o envio ficam desabilitados, mas `MovementEntryDialog` oferece apenas “Fechar e manter rascunho”, sem ação para remover a chave defeituosa do `sessionStorage`.

RESOLVIDO

###############

Bug 1132

Sintoma: Ao clicar em “Registrar movimentação” dentro do histórico de uma conta bancária, um rascunho válido salvo anteriormente para outra conta prevalece silenciosamente sobre a conta atualmente selecionada, facilitando registrar o valor na conta errada.
Provável causa: A chave `finance-movement-draft:${tenant}:${actor}` é compartilhada por todas as contas e `restore()` devolve o formulário salvo sem confrontar `form.account` com `initialAccount`. Existe aviso equivalente para divergência de `initialDriver`, mas nenhum aviso ou bloqueio para divergência da conta inicial.

RESOLVIDO

###############

Bug 1133

Sintoma: Abrir a conferência de correção de uma movimentação muito referenciada pode ficar progressivamente lento e carregar uma resposta enorme; a paginação de impedimentos e dependências não reduz o volume consultado nem transferido.
Provável causa: `movement_correction_context` materializa em um único JSON todas as linhas do grafo de dependências, comandos, eventos, correções relacionadas, fechamentos e reaberturas. `MovementCorrectionReviewWorkspace` recebe o objeto integral e apenas usa `slice` no cliente para mostrar blocos de 30 registros.

###############

Bug 1134

Sintoma: Um pedido corrompido de invalidação de movimentação bloqueia definitivamente a correção daquele registro no dispositivo, sem botão para descartar o conteúdo inválido e iniciar uma nova revisão.
Provável causa: `MovementVoidConfirmation` marca `restored.corrupt` ao falhar na leitura de `finance-movement-void:*` do `localStorage` e impede `prepare`/`submit`. A única saída renderizada é uma mensagem para preservar os dados; nenhuma ação remove ou substitui a chave inconsistente.

RESOLVIDO

###############

Bug 1135

Sintoma: Um único adiantamento com muitas devoluções vinculadas pode tornar toda a página de saldos lenta ou grande demais, mesmo após a correção que passou a paginar os adiantamentos antes de calcular suas posições.
Provável causa: Para cada um dos até 30 adiantamentos da página, `driver_advance_position` ainda percorre todas as linhas de `driver_advance_returns` e devolve o array `history` completo, sem limite ou cursor. `DriverAdvanceReturns` renderiza esse histórico integral dentro de cada `<details>`.

###############

Bug 1136

Sintoma: Um pedido local corrompido de devolução de adiantamento não pode ser descartado pela interface; a tela avisa que outra operação não deve começar, mas ainda permite abrir o diálogo e só falha novamente ao tentar enviar.
Provável causa: `DriverAdvanceReturns` define `corrupt` quando `pendingDriverAdvanceReturn` rejeita a chave `driver-advance-return` do `localStorage`, porém não oferece ação de limpeza e os botões “Vincular devolução registrada” são desabilitados apenas por `pending`, não por `corrupt`. O outbox volta a lançar ao consultar a mesma chave inválida no envio.

RESOLVIDO

###############

Bug 1137

Sintoma: Registros locais corrompidos podem bloquear indefinidamente a criação, revisão, anexação de comprovantes ou registro em lote de despesas, sem ação de descarte disponível para o usuário.
Provável causa: `ExpenseCreationRecoveryPanel`, `ExpenseReviewRecoveryPanel`, `ExpenseArtifactPanel` e `ExpenseBatchDialog` exibem seus respectivos erros de recuperação quando os dados do `localStorage`/`sessionStorage` não passam nos schemas, mas nenhum desses caminhos inválidos remove a chave. O descarte da criação só aparece quando o pedido pôde ser interpretado, e o lote oferece apenas “Fechar e guardar rascunho”.

###############

Bug 1138

Sintoma: Em “Comprovantes adicionais”, o usuário pode selecionar e enviar PDF, XLS ou XLSX, mas depois do upload não aparece botão para anexar o arquivo ao gasto; ao fechar o detalhe, o documento deixa de ser localizável por essa tela.
Provável causa: `ExpenseArtifactPanel` aceita e envia `jpeg`, `png`, `pdf`, `xls` e `xlsx`, porém só renderiza “Anexar cópia validada” quando o artefato está em `sanitized_derivative`. O pipeline produz esse estado apenas para JPEG/PNG; documentos permanecem em quarentena ou dados validados, enquanto `readExpenseArtifacts` lista somente comprovantes efetivamente vinculados.

###############

Bug 1139

Sintoma: Se a consulta dos comprovantes adicionais de um gasto falhar, o painel fica permanentemente bloqueado nessa abertura: não permite anexar um novo comprovante e não oferece botão para repetir a consulta.
Provável causa: `ExpenseArtifactPanel` desabilita o fieldset quando `!data` e, em `query.isError`, renderiza apenas “Não foi possível consultar os comprovantes deste gasto”. Diferentemente de outros painéis financeiros, não chama `query.refetch()` nem expõe uma ação de recuperação.

RESOLVIDO

###############

Bug 1140

Sintoma: Paginar a lista de despesas pode transferir repetidamente históricos extensos para cada gasto da página, tornando a consulta cada vez mais pesada conforme crescem os eventos do lote e do item.
Provável causa: `finance_private.list_expenses` agrega, dentro de cada uma das até 30 linhas paginadas, todos os `finance_events` tanto do `expense_item` quanto do `expense_batch`, sem limite ou cursor. Eventos do mesmo lote ainda são repetidos no JSON de cada gasto pertencente a esse lote, e `ExpenseHistoryDetail` só os renderiza depois da transferência integral.

###############

Bug 1141

Sintoma: Em “Gastos conferidos”, informar data inicial posterior à final faz a listagem e todos os indicadores desaparecerem e mostra apenas uma falha genérica, sem apontar o intervalo inválido.
Provável causa: `FinanceExpenses` envia `from` e `to` sem `min`, `max` ou validação no `onSubmit`; `finance_private.list_expenses` rejeita `from_date > to_date`, e o erro passa pelo tradutor genérico `financeError`.

RESOLVIDO

###############

Bug 1142

Sintoma: Uma responsabilidade de custo com muitas devoluções torna a carteira e o detalhe progressivamente pesados, embora a interface mostre as devoluções em páginas visuais de 20 itens.
Provável causa: `expense_cost_effective` percorre e agrega todas as linhas de `cost_disposition_returns` em `returns` para cada disposição. `CostDispositionReturnHistory` recebe o array integral e só aplica `slice` no navegador; a API não possui limite ou cursor para esse histórico.

###############

Bug 1143

Sintoma: Um pedido salvo incompatível de devolução de responsabilidade financeira bloqueia novas correções de custo para a empresa e usuário, sem permitir descartar o registro inválido pela interface.
Provável causa: `CostDispositionReturnConfirmation` converte qualquer falha de `pendingCostDispositionReturn` em `corrupt = true` e impede `execute`, mas renderiza apenas a mensagem “novas correções estão bloqueadas”. Não há ação para remover ou substituir a chave `cost-disposition-return` do `localStorage`.

RESOLVIDO

###############

Bug 1144

Sintoma: Abrir qualquer página de “Responsabilidades e valores a recuperar” fica cada vez mais lento conforme cresce o histórico global de regularizações, mesmo que a página mostre somente 30 gastos.
Provável causa: O wrapper atual de `finance_private.cost_dispositions` chama a consulta paginada e depois recalcula os totais criando `sources` para todos os `expense_cost_regularizations` do tenant. Para cada gasto distinto executa `expense_cost_coverage`, que por sua vez recompõe custo, disposições e todas as devoluções antes de somar os indicadores globais.

###############

Bug 1145

Sintoma: Um registro corrompido de despesa avulsa ou de cancelamento de despesa avulsa bloqueia novas confirmações naquele fluxo durante toda a sessão, sem permitir que o usuário descarte a recuperação inválida.
Provável causa: `ManualExpenseWorkspace` e `ManualExpenseCancellationWorkspace` transformam falhas ao interpretar suas chaves `finance-manual-expense:*` e `finance-manual-expense-cancellation:*` do `sessionStorage` em `restored.error`, usado para desabilitar preparação e envio. Nenhum componente oferece ação para remover a chave defeituosa e reiniciar.

RESOLVIDO

###############

Bug 1146

Sintoma: Revisar o cancelamento de uma despesa avulsa com muitos vínculos pode carregar uma resposta enorme e renderizar milhares de referências de uma vez, tornando o painel lento justamente quando há impedimentos.
Provável causa: `manual_expense_cancellation_context` agrega integralmente comandos, pagamentos, vínculos, evidências, gastos, adiantamentos, itens de folha, itens de acerto, obrigações e dependências de fechamento em `snapshot`, sem limite ou cursor. `ManualExpenseCancellationWorkspace` percorre cada array completo dentro do detalhe, também sem paginação visual.

###############

Bug 1147

Sintoma: Se a consulta das saídas disponíveis falhar ao registrar uma despesa avulsa já paga, o usuário não consegue selecionar o pagamento e não há ação para tentar a consulta novamente sem fechar e reabrir todo o diálogo.
Provável causa: `ManualExpenseMovementPicker` renderiza apenas “Não foi possível consultar as saídas” quando `query.error`; não chama `query.refetch()` nem disponibiliza botão de recuperação, enquanto a seleção é obrigatória sempre que “Já foi paga com uma saída registrada” está marcada.

RESOLVIDO

###############

Bug 1148

Sintoma: Depois de preencher o fim do período da carteira de contas a pagar, avançar a data inicial para depois desse fim ainda deixa a consulta habilitada; ao enviar, a tela mostra apenas a falha genérica da carteira e repetir a consulta nunca resolve enquanto as datas permanecerem invertidas.
Provável causa: O campo final usa apenas `min={draft.from}`, que não limpa nem invalida no estado um valor anterior agora incompatível, e `apply` não valida `from <= to`; a exceção ocorre na refinagem de `payablePortfolioFiltersSchema` antes mesmo da RPC e cai no mesmo tratamento de erro de uma indisponibilidade do servidor.

RESOLVIDO

###############

Bug 1149

Sintoma: Em uma empresa com muitos títulos e históricos de pagamentos/custos, abrir qualquer página da carteira de contas a pagar pode ficar progressivamente lento, consumir muita memória no banco ou exceder o tempo da requisição, embora a interface mostre no máximo 30 títulos.
Provável causa: `finance_private.payable_portfolio` executa `payable_portfolio_evidence` e `payable_effective_cost_evidence` para todos os títulos filtrados, constrói para cada um o JSON completo com `payment_cost_versions` e cobertura, agrega todos esses objetos novamente no fingerprint e só depois aplica `limit 30 offset`; assim, a paginação limita apenas a resposta final, não o trabalho nem a memória da consulta.

###############

Bug 1150

Sintoma: Depois de preencher o fim do intervalo de vencimentos das contas a receber, mover a data inicial para depois desse fim ainda dispara a consulta; a lista inteira some e a tela informa apenas que os títulos não puderam ser consultados, embora o problema seja um filtro local que continuará inválido em toda nova tentativa.
Provável causa: `ListFilterBar` recebe `max` e `min` para orientar os inputs, mas `ReceivablesScreen` não reconcilia um valor já preenchido nem valida `from <= to`; `readReceivablesPage` envia o par diretamente e `receivables_page_by_origin` o rejeita como `finance_invalid_filters`, tratado pela mensagem genérica de indisponibilidade.

RESOLVIDO

###############

Bug 1151

Sintoma: Abrir a carteira de recebíveis pode ficar progressivamente lento conforme crescem os títulos, as renegociações, as parcelas e suas alocações, mesmo quando o painel precisa exibir somente alguns totais agregados.
Provável causa: O cálculo de `overdue` em `receivable_portfolio_summary` chama `receivable_installment_position(_tenant,id)` duas vezes para cada título ativo. Cada chamada reconstrói o snapshot financeiro, conta todo o histórico de acordos, carrega a versão vigente e agrega todas as alocações por parcela; a posição não é materializada nem reutilizada entre o teste de status e a soma dos vencidos.

RESOLVIDO

###############

Bug 1152

Sintoma: Selecionar um comprovante para um recebível renegociado e errar a distribuição entre parcelas envia o arquivo mesmo assim; a validação recusa a operação depois do upload, e fechar o diálogo ou desistir deixa o comprovante armazenado sem vínculo recuperável. Rejeições do servidor depois do envio produzem o mesmo resíduo.
Provável causa: `ReceivableFinancialDialog.submit` chama `uploadPaymentAttachment` antes de verificar `requires_reallocation`, somar `installment_allocations` e montar/enviar o comando. Não existe exclusão compensatória do objeto em `receipts` quando uma dessas validações falha, quando o comando é recusado ou quando o diálogo é abandonado apó o upload.

RESOLVIDO

###############

Bug 1153

Sintoma: Depois de registrar ou reverter um desconto/perda dentro do diálogo de recebimentos, uma nova baixa na mesma abertura ainda mostra a distribuição antiga das parcelas e termina recusada por revisão divergente, mesmo que o estado financeiro geral do título já tenha sido atualizado.
Provável causa: `refreshReceivableAdjustment` invalida `receivable-financial-context`, mas não a chave `receivable-agreement-position`; em `ReceivableFinancialDialog`, a consulta de parcelas depende apenas de empresa, ator e recebível, sem a revisão do contexto. Assim, a posição em cache não é refeita apó o ajuste alterar o saldo e as alocações.

RESOLVIDO

###############

Bug 1154

Sintoma: Um pedido de desconto ou perda corrompido no armazenamento local bloqueia permanentemente todas as novas baixas sem caixa daquela empresa e usuário; o painel pede para preservar os dados, mas não permite descartar o registro incompatível nem recomeçar.
Provável causa: `ReceivableAdjustmentConfirmation.sync` transforma qualquer falha de `pendingReceivableAdjustment` em `corrupt = true`, e `execute` bloqueia enquanto essa marca existir. O ramo de erro apenas renderiza uma mensagem, sem remover a chave `agvlog:receivable-adjustment:v1:*` nem oferecer uma ação de descarte.

RESOLVIDO

###############

Bug 1155

Sintoma: Um pedido local de aplicação ou liberação de crédito de cliente que fique corrompido bloqueia todas as novas operações de crédito daquela empresa e usuário, sem uma forma de descartar o registro incompatível.
Provável causa: `CustomerCreditConfirmation.sync` converte qualquer erro de `pendingCustomerCredit` em `corrupt = true`, condição que impede `execute`; a interface exibe somente “Preserve os dados; nova operação bloqueada” e nunca remove nem substitui a chave `agvlog:customer-credit:v1:*` do `localStorage`.

RESOLVIDO

###############

Bug 1156

Sintoma: Um comprovante anexado a um recebimento confirmado não pode ser aberto, baixado ou sequer identificado posteriormente pela interface; o histórico mostra valor, conta, data, notas e vínculos, mas oculta completamente a evidência enviada.
Provável causa: A página de recebimentos retorna `attachment_path` em cada linha e o contrato o valida, porém `ReceivablePaymentsPanel` nunca renderiza esse campo nem solicita uma URL assinada do bucket privado `receipts`; não existe outro leitor de comprovantes de contas a receber no frontend.

RESOLVIDO

###############

Bug 1157

Sintoma: Um pedido local de devolução de crédito corrompido bloqueia todas as novas vinculações de saída para a empresa e o usuário, sem permitir descartar a recuperação incompatível.
Provável causa: `CustomerCreditRefundConfirmation` define `corrupt = true` quando `pendingCustomerCreditRefund` falha e impede `execute` nessa condição; o ramo correspondente mostra apenas uma mensagem para preservar os dados, sem ação que remova a chave `agvlog:customer-credit-refund:*` do `localStorage`.

RESOLVIDO

###############

Bug 1158

Sintoma: Clicar duas vezes em “Reverter vínculo incorreto” pode efetivar a reversão na primeira requisição e, logo depois, substituir a confirmação por uma mensagem de falha da segunda; o usuário é levado a acreditar que nada ocorreu embora a capacidade do crédito e da saída já tenha sido restaurada.
Provável causa: O botão do histórico em `CustomerCreditRefundPanel` chama `reverseCustomerCreditRefund` diretamente dentro de um handler assíncrono, sem trava, estado `busy`, desabilitação ou identificador idempotente. A função do banco aceita apenas uma reversão por `refund_id`, portanto chamadas concorrentes produzem um sucesso e uma rejeição, e ambas escrevem no mesmo `notice`.

RESOLVIDO

###############

Bug 1159

Sintoma: Se a recuperação local de uma correção de vínculo de recebimento ficar corrompida, a correção daquele pagamento permanece bloqueada durante toda a sessão, mesmo que o usuário queira abandonar o pedido inválido e iniciar outro.
Provável causa: `ReceiptAllocationCorrection` captura a falha de leitura da chave `finance-receipt-correction:*` em `restored.error`, usa esse valor imutável para impedir preparação e envio e não fornece ação de descarte nem sincroniza a remoção posterior da chave no `sessionStorage`.

RESOLVIDO

###############

Bug 1160

Sintoma: Um pedido local corrompido de associação de recebimento antigo impede associar ou desfazer o vínculo daquele recebimento durante toda a sessão; fechar e reabrir o diálogo apenas restaura o mesmo bloqueio, sem opção de reinício.
Provável causa: `LegacyReceivableAssociationWorkspace` converte qualquer falha ao interpretar `finance-legacy-receivable-association:*` em `restored.error` e desabilita todos os comandos quando esse valor existe, mas nunca remove a chave defeituosa do `sessionStorage` nem oferece um botão de descarte.

RESOLVIDO

###############

Bug 1161

Sintoma: Corrigir o vínculo de uma baixa de recebível renegociado e, sem fechar o diálogo, tentar registrar outro recebimento continua mostrando a posição anterior das parcelas; a operação só falha no servidor por revisão divergente ou necessidade de realocação.
Provável causa: `ReceiptAllocationCorrection.refresh` invalida o contexto financeiro, a lista e o histórico, mas omite `receivable-agreement-position`. A consulta de parcelas em `ReceivableFinancialDialog` também não inclui a revisão financeira na chave, portanto conserva em cache a distribuição calculada antes de a correção reabrir saldo no título.

RESOLVIDO

###############

Bug 1162

Sintoma: Se a consulta do histórico de baixas de uma conta a pagar falhar, o diálogo não permite tentar novamente; pagamentos, correções e associações antigas permanecem invisíveis até fechar e reabrir toda a conta.
Provável causa: `PayablePaymentDialog` renderiza somente “Não foi possível carregar o histórico de baixas” quando `usePayablePayments` retorna erro, sem botão que chame `refetch`; o painel completo do histórico é substituído pelo alerta.

RESOLVIDO

###############

Bug 1163

Sintoma: Um pedido corrompido de vínculo entre conta a pagar e saída bloqueia novas baixas daquele título durante toda a sessão, sem permitir abandonar a recuperação inválida.
Provável causa: `PayableMovementLink` grava a falha de leitura de `finance-payable-link:*` em `restored.error` e usa esse valor imutável para desabilitar consulta, revisão e confirmação. O componente não oferece ação que remova a chave defeituosa do `sessionStorage`.

RESOLVIDO

###############

Bug 1164

Sintoma: Uma recuperação corrompida de desvinculação de baixa impede corrigir aquele vínculo de conta a pagar durante toda a sessão; o aviso não oferece forma de descartar o pedido e refazer a operação.
Provável causa: `PayableLinkReversal` transforma qualquer erro ao interpretar `finance-payable-reversal:*` em `restored.error`, bloqueia `prepare` e `submit` nessa condição e não remove nem substitui o registro incompatível no `sessionStorage`.

RESOLVIDO

###############

Bug 1165

Sintoma: Um registro local corrompido de associação de pagamento antigo bloqueia tanto a associação quanto sua correção para aquele pagamento durante toda a sessão, e reabrir o diálogo restaura o mesmo impedimento.
Provável causa: `LegacyPayableAssociationWorkspace` guarda a falha de `finance-legacy-payable-association:*` em `restored.error` e desabilita todas as ações quando ela existe, mas não disponibiliza descarte da chave defeituosa no `sessionStorage`.

RESOLVIDO

###############

Bug 1166

Sintoma: Um pedido de aprovação corrompido no armazenamento local bloqueia a aprovação de todas as contas a pagar daquela empresa e usuário; o painel apenas manda preservar os dados e não permite descartar a recuperação incompatível.
Provável causa: `PayableApprovalConfirmation.sync` define `corrupt = true` quando `pendingPayableApproval` falha e `execute` recusa qualquer operação nessa condição. O ramo visual não remove nem substitui a chave global `agvlog:payable-approval:v1:*` do `localStorage`.

RESOLVIDO

###############

Bug 1167

Sintoma: Se o pedido local de salvamento de conta com XML ficar corrompido, novas contas com XML permanecem bloqueadas mesmo depois de usar “Descartar XML abandonado”; a interface afirma que o upload foi descartado, mas toda nova tentativa volta a falhar pela recuperação incompatível.
Provável causa: `usePayableXmlSave.read` captura a falha de `pendingPayableXml`, mas `discardUpload` chama apenas `discardPayableXmlUpload`, que limpa a chave `agvlog:payable-xml-file:v1:*` e o artefato. A chave corrompida independente `agvlog:payable-xml:v1:*` do outbox nunca é removida nem possui descarte próprio.

RESOLVIDO

###############

Bug 1168

Sintoma: Clicar em “Baixar XML original” pode não abrir nem baixar nada em navegadores com bloqueio de pop-ups, e a tela também não informa a falha, apesar de ter obtido a URL assinada corretamente.
Provável causa: `PayableXmlHistory.openOriginal` aguarda a chamada assíncrona de `createSignedUrl` e só depois executa `window.open`; nesse momento a abertura já não pertence diretamente ao gesto do clique e pode ser bloqueada. O retorno nulo de `window.open` é ignorado, portanto `downloadError` continua vazio.

RESOLVIDO

###############

Bug 1169

Sintoma: Navegar por qualquer página do histórico temporal de recebíveis fica progressivamente mais lento e pode exceder memória ou tempo de consulta conforme aumentam as versões capturadas, embora cada resposta mostre somente 50 eventos.
Provável causa: `finance_private.receivable_captured_history` recalcula a revisão em toda chamada com `string_agg(md5(to_jsonb(v)::text), '')` sobre todos os eventos visíveis da empresa ou do título. O `limit 50 offset` é aplicado apenas depois desse hash integral, portanto a paginação não limita o trabalho necessário para produzir cada página.

RESOLVIDO

###############

Bug 1170

Sintoma: Se a consulta inicial da posição de uma renegociação falhar, o diálogo fica vazio com a mensagem de erro e não oferece nova tentativa; é preciso fechar e reabrir todo o recebível para consultar novamente.
Provável causa: `ReceivableAgreementDialog` renderiza `positionQuery.error` apenas como texto e não disponibiliza um botão para `positionQuery.refetch()`. Como a consulta usa `retry: false`, não existe recuperação na montagem atual.

RESOLVIDO

###############

Bug 1171

Sintoma: Um pedido de renegociação corrompido no armazenamento local impede confirmar ou recuperar acordos para toda a empresa e usuário, mas a tela continua permitindo preencher e gerar prévias que sempre falham no envio; não há como descartar o pedido incompatível.
Provável causa: `ReceivableAgreementDialog.sync` captura o erro de `pendingReceivableAgreement` apenas em `error`, sem um estado de descarte ou remoção da chave `agvlog:receivable-agreement:*`. Como `pending` permanece nulo, o formulário não é bloqueado, mas o outbox reencontra o mesmo JSON inválido em toda confirmação.

RESOLVIDO

###############

Bug 1172

Sintoma: Depois de revogar uma renegociação com mais de 30 versões, o histórico volta a ficar truncado nas 30 primeiras entradas; o total é exibido, mas não existe controle para acessar as páginas seguintes.
Provável causa: A consulta paginada de histórico continua ativa e o `<details>` inferior renderiza `historyQuery.data.rows`, porém os botões que alteram `historyOffset` ficam dentro do bloco condicionado a `position.installments.length`. Uma posição revogada não possui parcelas vigentes, ocultando somente a navegação.

RESOLVIDO

###############

Bug 1173

Sintoma: O usuário consegue adicionar e preencher mais de 100 parcelas em uma renegociação, mas só descobre no fim, ao gerar a prévia, que todo o acordo é recusado; nenhuma indicação ou limite evita o trabalho perdido.
Provável causa: O botão “Adicionar parcela” sempre acrescenta uma nova linha e não verifica `rows.length`, enquanto `receivable_agreement_context` aceita apenas entre 1 e 100 itens. A restrição existe exclusivamente no servidor e não participa do estado desabilitado nem da validação local.

RESOLVIDO

###############

Bug 1174

Sintoma: Um pedido local corrompido de abertura ou correção de abertura bloqueia novas aberturas bancárias e de caixa físico naquela conta durante toda a sessão, sem permitir descartar o registro inválido.
Provável causa: `AccountOpeningWorkspace` armazena qualquer falha ao interpretar `finance-account-opening:*` em `restored.error` e impede `submit`, a contagem de caixa e os comandos de revisão enquanto o valor existe. O painel não remove a chave defeituosa do `sessionStorage` nem oferece reinicialização.

RESOLVIDO

###############

Bug 1175

Sintoma: Registros locais corrompidos podem bloquear o registro de pagamento de acerto, o vínculo desse pagamento a uma saída e a correção do vínculo, cada um sem qualquer ação de descarte; fechar e reabrir restaura o mesmo impedimento.
Provável causa: `SettlementPaymentWorkspace`, `SettlementMovementWorkspace` e `SettlementLinkReversal` convertem falhas das chaves `finance-settlement-payment:*`, `finance-settlement-link:*` e `finance-settlement-reversal:*` em `restored.error`, usado para desabilitar todos os envios. Nenhum dos três componentes limpa ou substitui a entrada incompatível no `sessionStorage`.

RESOLVIDO

###############

Bug 1176

Sintoma: Registros locais corrompidos podem bloquear associações e correções de custos de manutenção, compra direta, aquisição de estoque e atribuição de consumo, sem uma forma de descartar o pedido inválido em nenhum desses painéis.
Provável causa: `LegacyCostAssociation`, `MaintenanceDirectPartAssociation`, `MaintenanceLaborAssociation`, `StockAcquisitionAssociation` e `StockConsumptionAttribution` transformam erros de parsing de suas chaves `finance-*` do `sessionStorage` em `restored.error` e bloqueiam preparação/envio. Todos exibem somente o aviso de recuperação, sem remoção da chave defeituosa.

RESOLVIDO

###############

Bug 1177

Sintoma: Um pedido salvo incompatível pode bloquear indefinidamente cancelamento coordenado de descarga, correção ou regularização de custo, correção/extinção de complemento, correção da cobrança e reparação do título para a empresa e o usuário, sem opção de descarte.
Provável causa: `UnloadingCancellationConfirmation`, `UnloadingCostCorrectionConfirmation`, `UnloadingCostRegularizationConfirmation`, `UnloadingOpenComplementConfirmation`, `OpenComplementExtinctionConfirmation`, `UnloadingOriginCorrectionConfirmation` e `UnloadingProjectionRepairConfirmation` definem `corrupt = true` quando seus outboxes do `localStorage` não passam no schema. Cada ramo corrompido apenas bloqueia `execute` e mostra uma mensagem para preservar os dados; nenhum remove ou substitui a chave correspondente.

RESOLVIDO

###############

Bug 1178

Sintoma: Um pedido salvo incompatível pode bloquear aprovação/cancelamento de adiantamentos a funcionários ou o vínculo de seu pagamento para toda a empresa e usuário, sem forma de descartar a recuperação inválida.
Provável causa: `EmployeeAdvanceActionDialog` e `EmployeeAdvancePaymentConfirmation` convertem falhas dos respectivos outboxes em `corrupt = true`, impedem `execute` e renderizam apenas a orientação para preservar os dados. Nenhum dos componentes remove ou reinicializa a chave corrompida no `localStorage`.

RESOLVIDO

###############

Bug 1179

Sintoma: Um pedido local corrompido de cancelamento de gasto bloqueia definitivamente novos cancelamentos daquele gasto durante a sessão, e o painel não permite abandonar o registro incompatível.
Provável causa: `ExpenseCancellationReview` guarda falhas ao interpretar `finance-expense-cancellation:*` em `restored.error`, que torna a própria elegibilidade falsa e impede `submit`. Não existe ação para remover a chave defeituosa do `sessionStorage`.

RESOLVIDO

###############

Bug 1180

Sintoma: Registros locais corrompidos podem bloquear tanto a aprovação/correção da cobertura de extratos quanto a revisão do corte financeiro legado de uma conta, sem permitir descartar os pedidos inválidos.
Provável causa: `StatementCoverageReview` e `LegacyCutReview` transformam falhas das chaves `finance-statement-coverage:*` e `finance-legacy-cut-review:*` em `restored.error` e desabilitam preparação e envio durante toda a montagem. Nenhum painel oferece limpeza da entrada corrompida no `sessionStorage`.

RESOLVIDO

###############

Bug 1181

Sintoma: Um pagamento de acerto que foi vinculado e corrigido muitas vezes pode tornar todas as páginas do seletor de saídas progressivamente maiores e mais lentas, embora cada página liste no máximo 20 candidatas.
Provável causa: A versão final de `finance_private.get_settlement_payment_movements` agrega em `history` todos os registros de `finance_settlement_movement_links`, suas reversões e eventos para o pagamento, sem limite ou cursor. O array completo acompanha novamente cada página de candidatas e `SettlementMovementWorkspace` o renderiza integralmente.

RESOLVIDO

###############

Bug 1182

Sintoma: Ao navegar pelas entradas/saídas elegíveis ou pelo histórico de associações antigas, uma associação ou reversão concorrente pode fazer registros serem pulados, repetidos ou deixar uma página vazia, sem qualquer aviso de que o conjunto mudou.
Provável causa: `legacy_payable_association` e `legacy_receivable_association` paginam candidatos e histórico com o mesmo `LIMIT/OFFSET`, mas seus endpoints recebem apenas `_page`; embora devolvam uma `revision`, não aceitam nem confrontam uma revisão esperada nas páginas seguintes. Os componentes apenas incrementam o número da página sobre conjuntos mutáveis.

RESOLVIDO

###############

Bug 1183

Sintoma: A análise de cancelamento de um gasto operacional pode ficar progressivamente lenta e devolver uma resposta enorme quando o gasto, seu título ou a viagem acumulam muitos vínculos e dependências, mesmo que a tela só precise apontar o bloqueio do cancelamento.
Provável causa: `finance_private.unloading_cost_cancellation_context` agrega integralmente em `snapshot` comandos de origem, títulos, pagamentos, rateios, vínculos financeiros e legados, históricos de manutenção/estoque, acertos, adiantamentos, folha, obrigações e dependências de fechamento, todos sem limite ou cursor. `ExpenseCancellationReview` recebe o pacote completo e, quando há impedimento, percorre cada array completo para exibi-lo nos detalhes.

RESOLVIDO

###############

Bug 1184

Sintoma: Contas que passaram por muitas correções de saldo inicial tornam a consulta de abertura progressivamente maior e mais lenta; o custo também reaparece em previsões de caixa, embora elas usem apenas a abertura ativa e o saldo calculado.
Provável causa: `finance_private.account_opening` agrega todas as aberturas e reversões da conta em `history`, sem limite ou cursor, e `AccountOpeningReview` renderiza o array inteiro. Além disso, `cash_forecast_collect_before_agenda` chama essa mesma função para cada conta sem fechamento e inclui o objeto completo — inclusive todo o histórico — no cálculo de `source_revision`, apesar de não devolver nem consumir esse histórico na projeção.

RESOLVIDO

###############

Bug 1185

Sintoma: Consultar o corte financeiro de uma única conta e de um período de até um ano pode ficar extremamente lento, consumir muita memória e devolver um manifesto gigantesco conforme qualquer histórico financeiro do tenant cresce, inclusive registros de outras contas e datas.
Provável causa: `finance_private.legacy_cut_manifest` agrega primeiro todas as linhas do tenant de 18 tabelas financeiras em arrays JSON, explicitamente sem `LIMIT`, e só depois percorre esses arrays em PL/pgSQL para descartar itens fora da conta/período. O objeto `evidence` mantém as tabelas completas, entra no hash da revisão, é preservado no snapshot e também é devolvido integralmente a `LegacyCutReview`, embora a interface mostre apenas a contagem de cada array.

RESOLVIDO

###############

Bug 1186

Sintoma: Revisar a cobertura bancária de um período com muitos lançamentos ou várias aprovações anteriores pode produzir respostas cada vez maiores, travar a tela e repetir grandes blocos de evidência histórica que ela não exibe.
Provável causa: `statement_coverage_snapshot` materializa sem paginação importações, linhas brutas, verificações, transações bancárias, revisões e reversões do período. Em seguida, `statement_coverage_review` agrega sem limite todas as aprovações e usa `to_jsonb(a)`, incluindo em cada item o snapshot completo preservado; `StatementCoverageReview` percorre todo o histórico, mas de cada snapshot mostra somente o resumo e as âncoras.

RESOLVIDO

###############

Bug 1187

Sintoma: Durante a paginação das associações de mão de obra, peças, aquisições ou consumos de estoque, alterações concorrentes podem fazer custos/aquisições ou itens do histórico serem pulados, repetidos ou mudarem de página sem aviso.
Provável causa: `maintenance_labor_context`, `maintenance_direct_part_context`, `stock_acquisition_context` e `stock_consumption_context` paginam candidatos e histórico mutáveis com `LIMIT/OFFSET`, mas seus leitores recebem somente página e busca e não devolvem/validam uma revisão estável do conjunto. Os componentes navegam incrementando o número da página sobre uma fotografia que pode mudar entre requisições.

RESOLVIDO

###############

Bug 1188

Sintoma: Abrir a atribuição de consumo de um item com muitas aquisições e reservas pode ficar cada vez mais lento mesmo exibindo apenas 30 aquisições por página.
Provável causa: `stock_consumption_context` materializa todas as aquisições do item antes do `LIMIT` e executa duas somas correlacionadas sobre `finance_stock_acquisition_dependencies` para cada uma. Não há índice por `(tenant_id, acquisition_link_id)` — a chave primária intercala `source_kind` e `source_id` antes do vínculo — nem índice dos vínculos por `(tenant_id, stock_item_id)`, de modo que a página limitada ainda provoca varreduras repetidas de conjuntos inteiros.

RESOLVIDO

###############

Bug 1189

Sintoma: Um adiantamento de funcionário pago em muitas parcelas torna a abertura e cada nova prévia de pagamento progressivamente maiores e mais lentas, apesar de existir uma tela de histórico paginada em 30 linhas.
Provável causa: `employee_advance_position` chama `payable_portfolio_evidence` para montar a prova completa e depois percorre novamente todos os pagamentos ativos para construir `footprints` sem limite. O array integral é incorporado à posição, ao hash e à resposta de `employee_advance_payment_context`; `EmployeeAdvancePaymentDialog` ainda renderiza todos esses comprovantes no resumo, independentemente do endpoint paginado de histórico.

RESOLVIDO

###############

Bug 1190

Sintoma: Consultar a primeira ou qualquer página da integridade dos registros antigos pode ficar progressivamente lenta com o volume financeiro total da empresa, embora a interface mostre no máximo 30 itens de cada grupo.
Provável causa: `legacy_integrity_inventory` materializa primeiro a saída completa de `legacy_integrity_rows` e só então aplica `LIMIT/OFFSET`. Essa função percorre nove tabelas inteiras do tenant e, para cada linha, faz várias consultas dinâmicas de pais, aliases, contas, importações e referências bancárias; todo esse trabalho é repetido integralmente em cada página antes de recortar os resultados.

RESOLVIDO

###############

Bug 1191

Sintoma: Enquanto o usuário percorre as páginas de acertos, uma aprovação, recálculo, pagamento ou atualização concorrente pode fazer acertos serem pulados, repetidos ou desaparecerem da consulta que a tela apresenta como um snapshot estável.
Provável causa: `list_driver_settlements_v2` fixa somente a inclusão por `created_at <= snapshot_at`, mas lê os valores atuais de `status`, `trip_completed_at`, pendências, saldos e demais filtros/ordenação. Como esses campos continuam mutáveis e o cursor usa `trip_completed_at, created_at, id`, uma atualização posterior ao snapshot pode mover uma linha através da fronteira do cursor ou removê-la/adicioná-la ao conjunto sem invalidar o escopo.

RESOLVIDO

###############

Bug 1192

Sintoma: Os filtros “Finalizada de/até” dos acertos podem incluir viagens das últimas horas do dia anterior e excluir viagens concluídas nas últimas horas da data final em São Paulo.
Provável causa: `list_driver_settlements_v2` compara o `timestamptz trip_completed_at` diretamente com parâmetros `date` e com `_date_to + interval '1 day'`, sem conversão explícita para `America/Sao_Paulo`. A coerção usa o fuso da sessão do banco (normalmente UTC), enquanto a tela apresenta as datas civis ao operador e formata os horários no fuso local.

RESOLVIDO

###############

Bug 1193

Sintoma: Ao avançar pelas páginas de custódias, ações normais do motorista ou do operador podem fazer dossiês aparecerem duas vezes ou serem pulados, mesmo sem criar uma nova custódia.
Provável causa: `list_trip_cargo_controls_v2` continua paginando com `LIMIT/OFFSET` e ordena por `control.updated_at DESC, id DESC`. Aceite, carregamento, lacres, divergências, retorno e fechamento atualizam a própria linha e a deslocam entre páginas; o endpoint não fixa snapshot, revisão nem cursor para detectar ou impedir a mudança das fronteiras.

RESOLVIDO

###############

Bug 1194

Sintoma: Em empresas com muitos motoristas ou veículos atuais e históricos, abrir Acertos de Motoristas ou o diálogo de novo acerto pode baixar e renderizar milhares de opções de uma vez, deixando a página lenta ou sem resposta antes mesmo de aplicar um filtro.
Provável causa: `list_driver_settlement_filter_options` agrega sem limite todos os motoristas ativos ou já usados em qualquer acerto e todos os veículos ativos ou históricos em dois arrays completos. `useDriverSettlementFilterOptions` não pagina nem pesquisa, e tanto `DriverSettlements` quanto `NewManualSettlementDialog` criam um `SelectItem` para cada elemento.

RESOLVIDO

###############

Bug 1195

Sintoma: Os filtros de data de carregamento da geração de ORT podem incluir cargas do dia vizinho ou omitir cargas do primeiro/último dia selecionado, especialmente perto da meia-noite local.
Provável causa: `read_ort_candidates_v1` converte diretamente `coalesce(load.actual_load_at, load.scheduled_load_at)::date` para confrontar `cargFrom`/`cargTo`. As colunas são `timestamptz`, portanto o dia é calculado no fuso da sessão do banco, sem usar o timezone do tenant nem `America/Sao_Paulo`, enquanto a interface envia datas civis.

RESOLVIDO

###############

Bug 1196

Sintoma: A realocação pode autorizar uma carga acima da capacidade do veículo quando um ou mais itens atuais ou movidos não possuem peso ou quantidade de paletes informados, apresentando a validação como concluída apesar da medida desconhecida.
Provável causa: O novo `move_load_items_between_loads` calcula `sum(i.pallet_count)` e `sum(i.weight_kg)` com `coalesce(..., 0)`. O `SUM` ignora cada valor nulo, portanto itens sem medida contribuem como zero aos totais projetados; a guarda testa apenas se a soma conhecida ultrapassa `max_pallets`/`max_weight_kg` e não bloqueia nem sinaliza composição incompleta.

RESOLVIDO

###############

Bug 1197

Sintoma: Ao realocar todos os itens de uma carga planejada sem viagem, a resposta informa corretamente que a origem foi removida, mas o evento de auditoria da mesma realocação preserva `source_removed: false`, produzindo duas versões incompatíveis do resultado.
Provável causa: O wrapper atual chama primeiro `move_load_items_between_loads_capacity_guard_20260917`; a função interna registra `move_items_out` antes de apagar cargas sem viagem e, portanto, grava `source_removed = false`. Só depois o wrapper executa `delete_load_if_empty` e altera o JSON retornado com `jsonb_set`, sem corrigir ou substituir o evento de auditoria já persistido.

RESOLVIDO

###############

Bug 1198

Sintoma: Um operador pode excluir uma Rota Operacional a partir de uma lista antiga mesmo depois que outra pessoa acabou de corrigir seus destinos, periodicidade ou classificação, apagando a alteração concorrente sem qualquer aviso.
Provável causa: Embora `useUpdateOperationalRoute` agora confronte `expectedUpdatedAt`, `useDeleteOperationalRoute` envia um `DELETE` filtrado apenas por `tenant_id` e `id`. A nova policy autoriza a exclusão direta, mas não há revisão esperada, RPC com lock/CAS nem confirmação de que o registro ainda corresponde ao que foi apresentado no diálogo.

RESOLVIDO

###############

Bug 1199

Sintoma: Depois que uma Rota Operacional é excluída, não há registro confiável de quem a removeu, quando ocorreu a exclusão nem quais destinos e regras foram apagados, comprometendo investigação e recuperação de uma ação indevida.
Provável causa: `useDeleteOperationalRoute` executa hard delete diretamente em `operational_routes`, e a nova policy apenas libera essa operação a operadores. A tabela possui triggers específicos para proteger/auditar mudança de nome, mas nenhum trigger de exclusão ou preservação; o fluxo também não chama um RPC de comando nem grava `_log_entity_audit` antes de remover a linha.

RESOLVIDO

###############

Bug 1200

Sintoma: Depois de replanejar paradas ou rota de uma viagem sem receber imediatamente outra posição, a Torre de Controle pode continuar exibindo geometria, desvio, atraso, ETA e alerta automático calculados para o plano anterior como se fossem atuais.
Provável causa: A migração final `20260917132000_make_control_tower_reader_catalog_compatible.sql` remove de `get_active_trips_live` as confrontações com `control_tower_private.context_revision` e `route_plan_revision`; passa a aceitar qualquer `trip_live_status` recente da mesma posição e simplesmente escolhe a rota OSRM mais recentemente atualizada. `get_open_trip_alerts` também deixa de confrontar a revisão gravada no alerta, validando-o apenas pelo estado potencialmente obsoleto devolvido por esse leitor.

RESOLVIDO

###############

Bug 1201

Sintoma: A Torre de Controle aumenta rapidamente a carga no banco conforme crescem viagens ativas, paradas e cargas, pois cada navegador repete duas varreduras completas a cada dez segundos e pode degradar a atualização ao vivo para todos os operadores.
Provável causa: `useActiveTripsLive` e `useOpenTripAlerts` consultam em paralelo a cada 10 s. `get_active_trips_live` agrega sem limite todas as viagens ativas e, para cada uma, todas as paradas anteriores, pendentes, cargas e contagens de documentos; `get_open_trip_alerts` chama internamente `get_active_trips_live` outra vez antes de filtrar alertas, duplicando integralmente o trabalho e a materialização JSON de cada ciclo.

RESOLVIDO

###############

Bug 1202

Sintoma: Durante a paginação da fila de endereços, um destino antigo que volte a precisar de validação pode não aparecer em nenhuma das páginas restantes, embora passe a integrar as contagens de pendentes do mesmo “snapshot”.
Provável causa: `get_active_address_resolution_queue_v2` fixa somente `created_at <= snapshot_at` e percorre o cursor por `(created_at, id)`, mas define o conjunto ativo pelo `status` atual. Os triggers de endereço reutilizam a linha existente com `ON CONFLICT ... DO UPDATE SET status='pending'`, preservando seu `created_at`; se ela for reativada depois que o cursor já passou por essa posição, entra atrás da fronteira e é ignorada até reiniciar a consulta. As invalidações automáticas da interface refazem a página atual, mas não limpam `snapshotRef` nem os cursores acumulados.

RESOLVIDO

###############

Bug 1203

Sintoma: Enquanto alguém navega pelas páginas de Documentos Fiscais, novas notas, exclusões lógicas, mudanças de status ou vínculos com cargas podem fazer documentos repetirem, sumirem ou mudarem de página sem aviso.
Provável causa: `get_fiscal_documents_page_v1` pagina o conjunto atual com `OFFSET/LIMIT`. Embora ordene deterministicamente por `created_at DESC, id DESC`, não fixa snapshot nem revisão e os próprios filtros de `status`, `load_id` e `deleted_at` são mutáveis; qualquer inclusão ou alteração antes do offset desloca todas as fronteiras que o número da página pressupõe estáveis.

RESOLVIDO

###############

Bug 1204

Sintoma: A busca de Documentos Fiscais pode não encontrar nomes legítimos que contenham vírgula, parênteses, aspas, percentual ou barra invertida e pode retornar documentos não relacionados quando o texto contém sublinhado.
Provável causa: `useFiscalDocumentsPage` ainda passa o termo por `safePostgrestSearch`, que substitui `[,%()"\\]` por espaços mesmo agora enviando o valor como parâmetro de RPC; isso muda o texto pesquisado antes dos `ILIKE`. Ao mesmo tempo, `_` não é escapado e chega ao PostgreSQL como curinga de um caractere, pois `get_fiscal_documents_page_v1` concatena diretamente o termo ao padrão `%...%`.

RESOLVIDO

###############

Bug 1205

Sintoma: Um usuário do portal que conheça o ID de uma ocorrência interna ou que tenha aberto uma ocorrência antes de ela ser ocultada pode continuar lendo toda a conversa e publicar novas mensagens nela, mesmo depois de `visible_to_client` ser desativado.
Provável causa: `list_client_occurrence_messages_v2` e `reply_client_occurrence` localizam `operational_events` somente por tenant/ID e autorizam pelo `client_id`. Nenhum dos RPCs exige `visible_to_client = true` ou `client_opened = true`; assim, o controle de visibilidade aplicado às listagens e detalhes do portal não protege o endpoint direto de mensagens.

RESOLVIDO

###############

Bug 1206

Sintoma: Monitoramentos já chegados, concluídos ou cancelados continuam exibindo as ações “Registrar” e “Previsão”; o usuário preenche os diálogos normalmente e só ao salvar recebe o erro de monitor fechado.
Provável causa: `MonitorsTable` renderiza e habilita os botões de progresso e previsão para todas as linhas, sem confrontar o estado terminal. A restrição existe apenas dentro de `add_driver_progress_v1` e `add_driver_forecast_v1`, enquanto a interface condiciona somente o botão “Chegou” aos estados `arrived`, `completed` e `cancelled`.

RESOLVIDO

###############

Bug 1207

Sintoma: Se o tenant já possuir uma OS com o número que a nova sequência tenta emitir — por exemplo `OS-2026-000001` — nenhuma nova ordem de manutenção consegue ser criada; todas as tentativas repetem indefinidamente o mesmo conflito de unicidade.
Provável causa: A migração cria `maintenance_order_sequences` vazia sem inicializá-la a partir dos `order_number` existentes. `next_maintenance_order_number` começa sempre em 1 e o incremento acontece na mesma transação do `INSERT` da OS; quando o índice `maintenance_orders_tenant_number_uidx` rejeita o número, toda a transação reverte também o avanço da sequência, fazendo a tentativa seguinte gerar exatamente o valor bloqueado outra vez.

RESOLVIDO

###############

Bug 1208

Sintoma: Uma OS aberta nas últimas horas de 31 de dezembro no Brasil pode receber o prefixo do ano seguinte, divergindo da data local de abertura e dos relatórios operacionais.
Provável causa: `next_maintenance_order_number` monta `OS-<ano>` com `extract(year from current_date)` no timezone da sessão do banco. A função não consulta o timezone do tenant nem converte `clock_timestamp()` para `America/Sao_Paulo`; em sessões UTC, a virada do prefixo ocorre três horas antes da virada civil brasileira.

RESOLVIDO

###############

Bug 1209

Sintoma: Excluir a leitura mais recente de odômetro ao mesmo tempo em que outra sessão inclui uma leitura nova pode deixar `vehicles.odometer_km` apontando para a leitura anterior, mesmo que a nova leitura exista e seja a mais atual.
Provável causa: `tg_validate_vehicle_odometer` adquire o advisory lock por veículo apenas em `INSERT`/`UPDATE`; o trigger não é executado em `DELETE`. A exclusão e a inclusão podem, portanto, calcular a projeção em snapshots diferentes e disputar o mesmo `UPDATE vehicles`: se o `AFTER DELETE` aguardar a gravação do insert mas conservar um snapshot que ainda não vê a linha nova, ele termina sobrescrevendo `odometer_km` com o valor histórico. `tg_sync_vehicle_odometer` não adquire o lock ausente nem revalida após esperar.

RESOLVIDO

###############

Bug 1210

Sintoma: Abrir a gestão de canhotos fica progressivamente mais lenta e pode exceder memória ou tempo de resposta conforme crescem os comprovantes ativos, mesmo que o usuário queira consultar apenas uma página ou um filtro específico.
Provável causa: `get_delivery_receipt_filter_catalog_v1` materializa todos os `delivery_receipts` ativos e devolve integralmente opções distintas de motoristas, veículos, fornecedores, viagens, cargas, clientes, cidades e estados, sem busca, limite ou cursor. A derivação de cargas ainda executa uma lateral com três fontes por comprovante; `DeliveryReceipts` carrega esse catálogo completo junto da tela e o mantém apenas por 60 segundos.

RESOLVIDO

###############

Bug 1211

Sintoma: Um administrador pode alterar ou excluir diretamente uma movimentação de inventário já registrada sem que o saldo agregado seja revertido ou recalculado; histórico e `inventory_balances` passam a representar quantidades diferentes.
Provável causa: A policy `Admins can manage inventory_movements` concede `ALL`, mas `trg_inventory_movement_balance` executa `update_inventory_balance` somente em `AFTER INSERT`. Não há bloqueio de `UPDATE`/`DELETE`, trigger compensatório nem comando auditado de correção que retire o efeito antigo e aplique o novo antes de modificar o fato histórico.

RESOLVIDO

###############

Bug 1212

Sintoma: A página de Inventário pode demorar progressivamente, consumir muita memória ou travar em tenants com histórico grande, pois abrir a tela transfere e mantém todos os movimentos e todos os saldos antes de mostrar qualquer filtro.
Provável causa: `useInventoryMovements` e `useInventoryBalances` usam `fetchAllPostgrestPages` até esgotar as tabelas. A busca, os filtros de cliente/local/tipo/data, os indicadores e as tabelas são calculados no navegador, e `Inventory` renderiza integralmente os arrays filtrados sem paginação, virtualização ou consulta remota limitada.

RESOLVIDO

###############

Bug 1213

Sintoma: O Monitoramento de Motoristas pode ficar progressivamente mais lento, consumir muita memória e produzir relatórios gigantes conforme cresce o histórico, mesmo quando o usuário precisa apenas das rotas atuais.
Provável causa: `useDriverMonitorsList`, `useMonitorForecasts` e `useMonitorUpdates` foram alterados para percorrer todas as páginas com `fetchAllPostgrestPages`, mas a interface continua sem paginação ou virtualização. A aba de previsões baixa inclusive todo o histórico do tenant para só depois filtrar no navegador pelos IDs dos monitores carregados, e as tabelas/KPIs/exportações operam sobre os arrays completos.

RESOLVIDO

###############

Bug 1214

Sintoma: Remover um corredor monitorado apaga também todo o histórico de execuções daquela rota, eliminando os registros que sustentavam contagens de trajetos normais e desvios anteriores.
Provável causa: `Routes.deleteMutation` executa `DELETE` físico diretamente em `route_templates`. As FKs de `route_runs` e `route_waypoints` usam `ON DELETE CASCADE`, portanto a exclusão propaga para as execuções históricas e a geometria; não há arquivamento/inativação obrigatório, resumo das dependências nem preservação/auditoria do conteúdo removido.

RESOLVIDO

###############

Bug 1215

Sintoma: A tela de corredores pode ficar lenta ou travar conforme crescem rotas, pontos, cercas, POIs e execuções recentes, mesmo antes de o usuário aplicar uma busca.
Provável causa: `Routes` percorre integralmente cinco coleções com `fetchAllPostgrestPages` e renderiza todos os templates sem paginação. Para cada rota visível, `getRouteStats` volta a filtrar todo o array de `route_runs` e `getRouteWaypoints` volta a filtrar todos os pontos — inclusive durante a busca e novamente na renderização — produzindo custo quadrático no navegador além da transferência completa.

RESOLVIDO

###############

Bug 1216

Sintoma: Dois administradores editando simultaneamente o mesmo corredor podem sobrescrever silenciosamente nome, limites, cerca e todos os pontos da alteração um do outro; ambos recebem confirmação de sucesso.
Provável causa: `save_route_template_v1` atualiza o template por `(id, tenant_id)` sem receber ou comparar `updated_at`/revisão esperada. Em seguida apaga todos os `route_waypoints` e recria o array enviado pelo diálogo, também sem CAS; a chave idempotente evita repetir a mesma tentativa, mas não detecta que outra edição foi confirmada desde a abertura do formulário.

RESOLVIDO

###############

Bug 1217

Sintoma: Ao substituir um contrato ativo, o contrato anterior e o novo passam a vigorar no mesmo dia de início, criando uma sobreposição de um dia no histórico trabalhista e tornando ambíguo qual vínculo cobre essa data.
Provável causa: `create_employee_contract_v1` encerra o contrato atual com `end_date = v_start` e cria o novo com `start_date = v_start`. O restante do domínio trata ambas as extremidades como inclusivas — o gerador confronta `start_date <= period_end` e `end_date >= period_start` e soma `+ 1` no rateio — portanto o término anterior deveria preceder o início novo ou haver uma regra explícita de exclusividade temporal.

RESOLVIDO

###############

Bug 1218

Sintoma: Ao avançar pelas páginas do histórico de uma importação de extrato enquanto novas revisões ou reversões são registradas, um evento pode aparecer duas vezes ou deixar de aparecer na navegação.
Provável causa: `finance_private.statement_history` ordena os eventos por `created_at DESC, id DESC`, mas pagina com `LIMIT/OFFSET` sem cursor nem instante de corte. Inserções no início da coleção deslocam as posições entre duas chamadas, enquanto `StatementHistoryDetail` mantém apenas o número da página e aceita o novo total como se todas as páginas pertencessem ao mesmo retrato.

RESOLVIDO

###############

Bug 1219

Sintoma: Ao revisar manualmente linhas sob um filtro de classificação e depois avançar de página, algumas linhas ainda pendentes podem ser puladas ou reaparecer em outra página.
Provável causa: `finance_private.statement_lines` aplica o filtro de `classification` e pagina o conjunto mutável com `LIMIT/OFFSET`. A própria revisão ou reversão altera a classificação, invalida a consulta e remove/adiciona a linha ao conjunto, mas `StatementHistoryDetail` preserva `filters.page`; o deslocamento seguinte passa a ser calculado sobre posições diferentes, sem cursor, snapshot ou retorno automático à primeira página.

RESOLVIDO

###############

Bug 1220

Sintoma: Mesmo depois de um administrador registrar formalmente que a devolução de um canhoto físico foi dispensada, o encerramento da custódia continua acusando esse canhoto como pendente e exige outra justificativa administrativa para fechar a viagem.
Provável causa: `record_delivery_receipt_physical_status_v1` define `physical_status = 'waived'` como exceção terminal, restrita a administrador e já auditada com motivo. Porém `private.close_trip_cargo` conta como pendente todo comprovante cujo status seja diferente de `received`; assim `waived` volta a acionar o caminho de override, em vez de ser reconhecido como dispensa já aprovada.

RESOLVIDO

###############

Bug 1221

Sintoma: Abrir o Histórico do POD de uma nota com muitas reentregas, correções e evidências pode ficar progressivamente lento, gerar uma resposta enorme ou travar a página.
Provável causa: `get_operator_pod_history_v1` agrega integralmente, em uma única resposta, todas as tentativas, resultados, provas, alocações e ocorrências da nota, sem limite, cursor ou paginação por coleção. `PodHistory` recebe e renderiza esses arrays completos; nenhum corte protege a consulta ou o navegador conforme o histórico cresce.

RESOLVIDO

###############

Bug 1222

Sintoma: Um dossiê de custódia muito grande volta a consumir rede e memória proporcionalmente a todo o seu histórico e pode travar o navegador, apesar de o backend agora expor páginas de até 500 registros.
Provável causa: `getTripCargoControl` usa `get_trip_cargo_collection_page_v1`, mas percorre imediatamente todas as páginas das cinco coleções em paralelo e remonta arrays completos de cargas, documentos, lacres, evidências e divergências antes de devolver o snapshot à tela. A paginação eliminou o teto por resposta do RPC, porém não limita o volume transferido, mantido nem renderizado pelo cliente.

RESOLVIDO

###############

Bug 1223

Sintoma: Excluir um rascunho de CT-e com falha pode apagar o histórico detalhado das tentativas SEFAZ e deixar registros de emissão rejeitada/erro sem vínculo com o documento que os originou, dificultando auditoria e diagnóstico posteriores.
Provável causa: `delete_failed_cte_draft_v1` permite a limpeza quando `hub_fiscal_emissions` contém apenas estados `error`/`rejected`, mas apaga fisicamente `cte_documents` sem registrar auditoria. A FK de `cte_sefaz_events` usa `ON DELETE CASCADE`, removendo os eventos, enquanto a FK de `hub_fiscal_emissions` usa `ON DELETE SET NULL`, preservando a tentativa já dissociada do rascunho.

RESOLVIDO

###############

Bug 1224

Sintoma: Reutilizar por engano o mesmo `request_id` para outra planilha de monitoramento pode devolver como “duplicado” o resultado de uma importação diferente; em concorrência, uma das planilhas pode falhar e, na repetição, passar a aparentar que foi importada sem que seus dados tenham sido gravados.
Provável causa: `import_driver_monitoring_workbook_v1` procura lote por `file_fingerprint = v_fingerprint OR request_id = v_request` e retorna o registro encontrado sem conferir se ambos os identificadores e o conteúdo correspondem ao pedido atual. O advisory lock inclui somente o fingerprint; duas planilhas distintas com o mesmo `request_id` usam locks diferentes, disputam o índice único e depois o conflito é reinterpretado silenciosamente como replay do lote vencedor.

RESOLVIDO

###############

Bug 1225

Sintoma: Para uma empresa configurada fora do fuso de São Paulo, previsões de chegada e horários iniciais importados do monitoramento são armazenados no instante errado, podendo antecipar ou atrasar alertas, status e ordenação da rota.
Provável causa: `add_driver_forecast_v1` e `import_driver_monitoring_workbook_v1` convertem datas/horas locais com `AT TIME ZONE 'America/Sao_Paulo'` fixo, e `driver_monitor_effective_status` também decide atraso pela data nesse mesmo fuso. As funções não consultam `tenants.timezone`, embora o restante do domínio já mantenha esse fuso por empresa e o use em cálculos operacionais.

RESOLVIDO

###############

Bug 1226

Sintoma: Se um `request_id` já usado numa atualização de progresso ou previsão for reutilizado com outro motorista, rota ou conteúdo, a API responde com o registro antigo como se a nova ação tivesse sido confirmada, sem aplicar os dados enviados.
Provável causa: `add_driver_progress_v1` e `add_driver_forecast_v1` implementam replay procurando apenas `(tenant_id, request_id)` e retornam imediatamente a linha encontrada. Não armazenam nem comparam hash do payload, `monitor_id`, autor ou demais campos antes de aceitar a repetição, portanto uma colisão ou reutilização de chave não é distinguida de uma retransmissão idêntica.

RESOLVIDO

###############

Bug 1227

Sintoma: Uma chamada direta pode marcar como “auditada” uma nota de entrada comum, já auditada ou que nunca teve o estado legado de processamento, criando eventos de auditoria que afirmam uma revisão inexistente e retornando sucesso sem limpar estado algum.
Provável causa: `audit_imported_notes_v1` valida somente existência, tenant, tipo `inbound` e ausência de exclusão lógica. Não exige `imported_note_status = 'processed'` nem outra evidência de que o documento pertence à fila auditável antes de inserir `imported_note_audited`; a restrição existente está apenas no conjunto filtrado pela interface e pode ser contornada pela RPC pública.

RESOLVIDO

###############

Bug 1228

Sintoma: Ocorrências e coletas próximas da meia-noite podem entrar no dia anterior ou seguinte no Relatório do Portal, e o período padrão de 90 dias pode começar/terminar numa data diferente da data civil da empresa.
Provável causa: `get_client_portal_reports_summary_raw_20260917` deriva `v_start`/`v_end` com `now()::date` e filtra `operational_events.created_at::date`, `pickup_orders.created_at::date` e o fallback de `fiscal_documents.created_at::date` no fuso da sessão do banco. A função não converte os instantes por `tenants.timezone` antes de confrontá-los com as datas civis informadas pelo usuário.

RESOLVIDO

###############

Bug 1229

Sintoma: Se uma carga for despachada ou realocada enquanto “Reverter todos os XMLs” está em execução, a reversão pode deixar uma viagem ou vínculo de despacho recém-criado apontando para uma carga que já voltou a `planned` e perdeu motorista, veículo e `trip_id`.
Provável causa: `revert_xml_loads_to_available` descobre `_load_ids`, `_affected_trip_ids` e `_trip_ids` sem bloquear as cargas nem seus vínculos de despacho. Outra transação pode criar uma viagem ou `dispatch_trip_loads` depois desse snapshot; ela não entra nos arrays removidos, mas o `UPDATE loads` posterior ainda reseta a carga, produzindo um grafo operacional parcialmente revertido.

RESOLVIDO

###############

Bug 1230

Sintoma: Vínculos históricos já contaminados entre empresas — conta SSX, rastreador e veículo de tenants diferentes — continuam válidos e consultáveis, podendo seguir alimentando posições e seletores mesmo após a correção das chaves estrangeiras.
Provável causa: As três FKs compostas adicionadas por `20260917091500_enforce_tracker_tenant_refs.sql` são criadas como `NOT VALID`. Isso protege apenas novas gravações; não há migração posterior que localize, bloqueie, corrija ou valide as linhas preexistentes, e os leitores continuam sem excluir explicitamente referências cujo `tenant_id` diverge.

RESOLVIDO

###############

Bug 1231

Sintoma: Patrimônios e movimentações já contaminados com responsáveis ou ativos de outra empresa continuam armazenados após a correção e podem permanecer assim mesmo quando outros campos do patrimônio são editados.
Provável causa: `20260917071500_validate_asset_tenant_refs.sql` adiciona apenas triggers para novos `INSERT` e para `UPDATE OF` das colunas de referência. Não há varredura/backfill dos registros existentes; uma edição de nome, estado ou localização não dispara a validação, e o histórico antigo de `asset_movements` também permanece sem reconciliação.

RESOLVIDO

###############

Bug 1232

Sintoma: Reutilizar um `request_id` de importação de faltas com outra planilha pode devolver o lote anterior como replay bem-sucedido, mesmo que nenhum caso do novo arquivo tenha sido criado; duas planilhas concorrentes com a mesma chave também podem produzir esse resultado após uma repetição.
Provável causa: `import_merchandise_shortage_batch_v1` procura lote por `request_id = _request_id OR file_hash = _file_hash` e retorna o registro encontrado sem conferir a correspondência dos dois identificadores nem do payload. O advisory lock usa somente `file_hash`, portanto arquivos distintos com a mesma chave não são serializados pelo mesmo lock e a colisão no índice não é tratada como incompatibilidade de pedido.

RESOLVIDO

###############

Bug 1233

Sintoma: Um lote de importação de faltas pode declarar uma quantidade de linhas diferente do número de casos realmente recebido e importado, deixando totais de origem e processamento contraditórios no histórico.
Provável causa: `import_merchandise_shortage_batch_v1` aceita `_row_count` independente de `_cases`: valida apenas que o número seja não negativo e que o array tenha no máximo 10.000 itens. Nunca exige `_row_count = jsonb_array_length(_cases)`, mas grava o primeiro em `row_count` e incrementa `imported_count` pelo segundo.

RESOLVIDO

###############

Bug 1234

Sintoma: Duas alterações simultâneas do mesmo caso de falta podem sobrescrever status e responsabilidades e ainda registrar dois eventos históricos afirmando que ambos partiram do mesmo estado anterior.
Provável causa: `update_merchandise_shortage_status` lê `tenant_id` e `_old_status` sem `FOR UPDATE`, não recebe revisão/estado esperado e depois atualiza somente por `id`. Requisições concorrentes podem observar o mesmo status, aguardar a gravação uma da outra e executar em sequência; cada uma insere `status_changed` com o snapshot antigo que já deixou de ser verdadeiro.

RESOLVIDO

###############

Bug 1235

Sintoma: Manutenções antigas que já apontavam para veículo, patrimônio, funcionário ou incidente de outra empresa continuam contaminadas após a correção e podem permanecer assim quando descrição, valor, status ou outras colunas são alteradas.
Provável causa: `20260917053000_fix_fleet_and_atomic_followups.sql` instala `tg_validate_vehicle_maintenance_tenant` somente para novos registros e para `UPDATE OF tenant_id, vehicle_id, asset_id, employee_id, incident_id`. Não há backfill/validação dos dados existentes; atualizações em qualquer outra coluna não disparam o trigger nem impedem que a referência cruzada continue ativa.

RESOLVIDO

###############

Bug 1236

Sintoma: Uma importação de ocorrências pode atribuir a responsabilidade a um usuário que já foi removido ou desativado na empresa, deixando o caso associado a alguém sem acesso para acompanhá-lo.
Provável causa: O wrapper atual de `import_occurrence_report_batch_v1` valida `responsible_user_id` apenas pela existência de qualquer linha em `tenant_memberships` com o mesmo tenant e usuário. A consulta não exige `membership.active = true`, ao contrário das verificações de autorização usadas nos fluxos operacionais.

RESOLVIDO

###############

Bug 1237

Sintoma: Quando um funcionário troca de contrato no meio da competência, a folha paga somente a fração do contrato mais recente e omite os dias trabalhados sob o contrato anterior.
Provável causa: O gerador corrigido usa um `LEFT JOIN LATERAL` que escolhe apenas um contrato sobreposto ao período, ordenado pelo `start_date` mais recente. O rateio posterior calcula somente esse contrato selecionado; não soma proporcionalmente todos os vínculos que cobriram partes distintas da competência, e a entrada da folha comporta apenas um `contract_id` canônico.

RESOLVIDO

###############

Bug 1238

Sintoma: Recalcular a folha depois de marcar um funcionário como desligado pode remover integralmente a entrada da competência em que ele trabalhou parte do mês, junto com salário proporcional, adiantamentos, descontos e reembolsos daquele período.
Provável causa: `generate_payroll_period` percorre apenas funcionários cujo estado atual é nulo, `active` ou `on_leave`, e a limpeza corrigida apaga entradas em rascunho/calculadas que deixem de satisfazer esse filtro. Ela não considera `termination_date` nem um contrato que se sobreponha à competência para manter o desligado elegível até sua data final.

RESOLVIDO

###############

Bug 1239

Sintoma: Em empresas cujo fuso configurado não é o de São Paulo, o filtro por datas da Auditoria financeira pode incluir eventos do dia vizinho e excluir eventos ocorridos nas primeiras ou últimas horas do dia escolhido.
Provável causa: `finance_private.audit_events` transforma `from`/`to` em limites com `AT TIME ZONE 'America/Sao_Paulo'` fixo e inclusive declara esse valor no campo `timezone` da resposta. A consulta não lê `tenants.timezone`, embora as datas sejam apresentadas como período civil da empresa.

RESOLVIDO

###############

Bug 1240

Sintoma: Enquanto o usuário navega pelas páginas da Auditoria financeira, a chegada de novos eventos pode fazer registros antigos repetirem ou serem pulados, sem aviso de que a coleção mudou.
Provável causa: `finance_private.audit_events` ordena por `created_at DESC, id DESC`, mas pagina com `LIMIT/OFFSET` e não recebe cursor, revisão nem instante de corte. Inserções no início deslocam todas as posições seguintes, enquanto a interface conserva apenas o número da página.

RESOLVIDO

###############

Bug 1241

Sintoma: Consultar qualquer página de períodos da folha fica progressivamente mais lenta conforme cresce o histórico total, mesmo que a resposta mostre no máximo 30 competências.
Provável causa: `get_finance_payroll_period_page_v2` monta `candidates` com todos os períodos e executa `finance_private.payroll_period_projection` para cada candidato antes de aplicar o filtro de pagamento e o `LIMIT/OFFSET`. A paginação reduz somente o JSON final, não o custo de recompor entradas, títulos e pagamentos de todo o acervo.

RESOLVIDO

###############

Bug 1242

Sintoma: Durante a navegação pelos períodos da folha, uma aprovação, cancelamento, reabertura ou pagamento concorrente pode fazer competências repetirem, sumirem ou deixar uma página vazia, especialmente com filtros de situação financeira.
Provável causa: `get_finance_payroll_period_page_v2` filtra e ordena projeções mutáveis e usa `LIMIT/OFFSET` sem snapshot ou cursor. O estado do período e o `payment_status` projetado podem mudar entre chamadas, deslocando registros através das fronteiras enquanto o cliente continua incrementando o mesmo número de página.

RESOLVIDO

###############

Bug 1243

Sintoma: Enquanto o usuário percorre os arquivos preservados de uma conta bancária, novos uploads podem fazer artefatos repetirem ou serem pulados entre páginas.
Provável causa: `list_finance_account_artifacts_v1` ordena por `created_at DESC, id`, mas recebe e devolve apenas um `offset`. Não fixa snapshot nem usa cursor; inserir um artefato no início desloca todas as posições posteriores e invalida silenciosamente o `next_offset` calculado na resposta anterior.

RESOLVIDO

###############

Bug 1244

Sintoma: Um clique duplo ou a repetição após perda de resposta ao reverter um vínculo de devolução de crédito pode efetivar a reversão na primeira chamada e terminar exibindo erro na segunda, fazendo o usuário acreditar que a ação falhou.
Provável causa: `reverse_finance_customer_credit_refund_v1` não recebe `request_id` nem mantém journal de resultado. A unicidade por `refund_id` impede duplicar o efeito, mas toda repetição cai em `refund_reversal_unavailable`; `CustomerCreditRefundPanel` também não bloqueia o botão durante a Promise e substitui a mensagem de sucesso pela falha concorrente.

RESOLVIDO

###############

Bug 1245

Sintoma: Corrigir manualmente a conta de um extrato ou reverter uma devolução de crédito não aparece no filtro “Somente intervenções manuais” da Auditoria financeira e é exibido com o rótulo genérico, sem opção específica no filtro de ação.
Provável causa: Os comandos gravam `statement_account_reassigned` e `customer_credit_refund_reversed`, mas não incluem `after_data.manual_intervention = true`. `finance_private.audit_events` também não contém essas ações na lista de fallback, e `financeAuditActions` não define nenhum dos dois rótulos usados pela interface.

RESOLVIDO

###############

Bug 1246

Sintoma: O histórico detalhado de uma importação de extrato não mostra que a conta bancária foi corrigida, embora a alteração tenha sido concluída e exista um evento financeiro correspondente.
Provável causa: `reassign_finance_statement_account_v1` grava o evento com `entity_type = 'finance_statement_import'`, enquanto `finance_private.statement_history` consulta exclusivamente `entity_type = 'statement_import'` para o mesmo `entity_id`. A divergência literal exclui toda reatribuição do histórico exibido no extrato.

RESOLVIDO

###############

Bug 1247

Sintoma: A página de Cercas Virtuais fica progressivamente lenta, consome muita memória e pode travar o navegador em empresas com muitas cercas, veículos e ocupações simultâneas, mesmo quando o usuário busca apenas uma cerca específica.
Provável causa: Para eliminar o antigo truncamento, `Geofences` passou a percorrer integralmente `geofences` e todos os `geofence_states` marcados como internos, além de carregar posições e veículos da frota. A busca e os indicadores são calculados no navegador, todas as cercas e posições são desenhadas no mapa e toda a lista filtrada é renderizada sem paginação, virtualização ou agregações dedicadas.

RESOLVIDO

###############

Bug 1248

Sintoma: Abrir o detalhe de um veículo antigo pode transferir e renderizar milhares de alertas e eventos de geofence, tornando toda a ficha lenta ou inutilizável mesmo que o usuário permaneça na aba de visão geral.
Provável causa: `VehicleDetails` dispara imediatamente `vehicle_alerts` e `vehicle_geo_events`, e ambas as queries usam `fetchAllPostgrestPages` sem janela temporal nem limite total. Os arrays completos alimentam contadores e são renderizados integralmente nas abas, que não têm paginação ou virtualização; o carregamento também não é condicionado à ativação dessas abas.

RESOLVIDO

###############

Bug 1249

Sintoma: Abrir a consulta antiga de centros de custo pode gerar centenas de requisições, consumir muita memória e travar a página em empresas com longo histórico financeiro, inclusive quando o período selecionado é apenas “Últimos 30 dias”.
Provável causa: `LegacyCostCenters` percorre integralmente e em paralelo todas as páginas de `payables`, `receivables`, `bank_transactions`, `driver_expenses` e `maintenance_orders` que tenham centro de custo. O corte de 30/90 dias só é aplicado depois no navegador; totais, gráfico, exportação e todas as linhas da tabela também trabalham sem paginação, agregação no servidor ou virtualização.

RESOLVIDO

###############

Bug 1250

Sintoma: Se qualquer uma das cinco fontes da consulta antiga de centros de custo falhar, a tela termina exibindo todos os KPIs zerados e “Nenhum lançamento encontrado”, fazendo uma indisponibilidade parecer ausência real de dados.
Provável causa: `fetchAllPostgrestPages` propaga o erro de qualquer página e faz a query composta falhar por inteiro, mas `LegacyCostCenters` desestrutura somente `data` e `isLoading`, usa `data = []` e nunca observa `isError`, `error` ou oferece nova tentativa. O fallback vazio alimenta diretamente os totais, gráfico e estado vazio.

RESOLVIDO

###############

Bug 1251

Sintoma: Abrir o Histórico de Importações pode consumir memória excessiva, gerar uma longa sequência de requisições e travar a interface quando existem muitos lotes, mesmo que o usuário queira consultar somente um relatório recente.
Provável causa: `IngestionReports` usa `fetchAllPostgrestPages` para materializar todos os relatórios que correspondem aos filtros e seleciona `*`, trazendo também os arrays JSON completos de cobertura e itens para revisão de cada lote. Os indicadores são reduzidos no navegador e todos os relatórios são renderizados de uma vez, sem paginação, virtualização, resumo separado ou carregamento do detalhe sob demanda.

RESOLVIDO

###############

Bug 1252

Sintoma: Abrir no Excel um CSV de auditoria de ingestão pode executar uma fórmula ou comando originado de número de nota, destinatário, nome de campo ou motivo de revisão controlado pelo arquivo importado.
Provável causa: `downloadReportCsv` usa uma função `esc` que apenas coloca aspas quando encontra vírgula, ponto e vírgula ou quebra de linha. Valores iniciados por `=`, `+`, `-` ou `@` são exportados sem prefixo neutralizador; mesmo as aspas aplicadas por delimitador não impedem que programas de planilha interpretem o conteúdo como fórmula.

RESOLVIDO

###############

Bug 1253

Sintoma: Editar o cliente, o tipo ou qualquer permissão de um acesso do portal que estava inativo reativa silenciosamente a concessão, permitindo que o usuário externo volte a acessar o portal sem o administrador acionar “Reativar”.
Provável causa: `PortalAccessDialog.save` monta o payload com `active: true` tanto para criação quanto para edição. No ramo `editing`, esse mesmo objeto é enviado por `UPDATE client_portal_access`, sobrescrevendo o estado inativo da linha embora o diálogo não mostre nem solicite alteração de status.

RESOLVIDO

###############

Bug 1254

Sintoma: Paginar as evidências vinculadas de um fechamento bancário grande continua transferindo e processando todas as dependências em cada página, de modo que a nova paginação pouco reduz a memória, o tempo de resposta e o tamanho do JSON.
Provável causa: `get_finance_account_period_evidence_page` substitui somente `snapshot.facts.movements` pelo recorte atual e devolve o restante de `c.snapshot` intacto, inclusive o array integral `snapshot.dependencies`. A função ainda agrega todas as dependências do snapshot e da tabela para calcular `integrity.dependencies_match` a cada chamada, embora devolva paralelamente uma segunda coleção `dependencies` paginada.

RESOLVIDO

###############

Bug 1255

Sintoma: Enquanto um usuário percorre o histórico permanente de fechamentos de uma conta, a criação de um novo fechamento pode fazer períodos repetirem ou serem pulados entre páginas, sem qualquer aviso de que a coleção mudou.
Provável causa: `finance_private.account_period_history` ordena por `period_end DESC, created_at DESC, id DESC`, mas pagina com `LIMIT/OFFSET` e não recebe revisão, instante de corte nem cursor. Como novos fechamentos entram no início, todos os offsets já apresentados pela interface são deslocados durante a navegação.

RESOLVIDO

###############

Bug 1256

Sintoma: Durante a navegação pelos Acertos de Motoristas, aprovações, pagamentos, novas despesas ou recálculos concorrentes podem fazer um acerto sumir do resultado ou nunca aparecer na página correta, embora a consulta informe estar presa ao mesmo snapshot.
Provável causa: `list_driver_settlements_v2` congela apenas inclusões posteriores por `driver_settlements.created_at <= snapshot_at`. Os filtros e a chave do cursor usam campos mutáveis — `status`, `km_review_status`, totais pendentes, `needs_recalculation` e `trip_completed_at` — sem preservar a revisão desses valores; atualizações podem mover uma linha para dentro, para fora ou através da fronteira já percorrida.

RESOLVIDO

###############

Bug 1257

Sintoma: Clicar em “Atualizar” ou gerar/recalcular acertos pode manter acertos recém-criados ausentes da lista e dos indicadores, mesmo depois de a consulta terminar com sucesso.
Provável causa: `DriverSettlements` inicializa `snapshotAt` uma vez e o botão de atualização chama apenas `refetch()`. As mutations também apenas invalidam `['driver_settlements']`; nenhuma delas executa `resetPaging`, renova o snapshot ou limpa os cursores. Como o RPC exclui linhas com `created_at > snapshot_at`, toda criação posterior permanece invisível até o usuário alterar algum filtro ou remontar a tela.

RESOLVIDO

###############

Bug 1258

Sintoma: A Central de Operações conta cargas devolvidas, recusadas, com falha ou encerradas por entrega parcial como “ativas” e pode mantê-las também no indicador de atrasadas indefinidamente após o prazo operacional.
Provável causa: `get_operations_load_counts_v1` define o universo ativo apenas como `status NOT IN ('delivered', 'cancelled')`. Isso diverge dos estados terminais reconhecidos pela aplicação — `partial_delivery`, `returned`, `refused` e `failed` — e ainda inclui `divergent`; as mesmas linhas passam pela expressão de atraso baseada em ETA ou agendamento antigo.

RESOLVIDO

###############

Bug 1259

Sintoma: Um operador pode registrar por chamada direta um horário arbitrário de chegada no monitoramento, alterar o estado para chegado/concluído e evitar o comando versionado e o histórico de auditoria; depois disso o timestamp fica imutável e aparenta ser uma evidência protegida.
Provável causa: A policy `drm_update` permite `UPDATE` direto de qualquer coluna de `driver_route_monitors` a owner/admin/operator. O trigger `preserve_driver_monitor_arrival_time` só rejeita mudanças quando `OLD.actual_returned_at` já não é nulo, portanto aceita a primeira gravação por REST sem ticket, revisão esperada, validação de transição, motivo ou inserção em `driver_monitoring_history`.

RESOLVIDO

###############

Bug 1260

Sintoma: Depois de uma devolução e reentrega, o Histórico do Produto pode multiplicar quantidade, peso e paletes da mesma nota e exibir paradas antigas/corrigidas como parte da trajetória atual, sem distinguir as tentativas.
Provável causa: `read_product_history_v1` monta `matched_items` a partir de `load_items` e `relevant_stops` a partir de `dispatch_stop_documents` brutos. O modelo preserva linhas de tentativas anteriores e expõe `current_load_items`/`current_dispatch_stop_documents` para selecionar a alocação vigente, mas o leitor ignora essas projeções e agrega todas as versões por documento e carga.

RESOLVIDO

###############

Bug 1261

Sintoma: Um checklist composto somente por itens opcionais pode ser salvo integralmente como N/A e ainda receber status “Aprovado”, embora nenhuma verificação tenha sido confirmada como OK.
Provável causa: `create_checklist_execution_v1` impede N/A apenas quando o item do template é obrigatório. Depois calcula `v_status` primeiro por `v_failed = 0`, classificando como `passed` inclusive o caso `v_passed = 0`, `v_failed = 0` e todos os itens com status `na`.

RESOLVIDO

###############

Bug 1262

Sintoma: Execuções históricas de checklist podem continuar ligadas a template, veículo, funcionário, viagem, incidente ou manutenção de outra empresa, aparecendo com referências cruzadas ou impossíveis apesar de novas gravações serem protegidas.
Provável causa: A migração `20260917101500_create_checklist_execution_command.sql` adiciona as seis chaves estrangeiras compostas de `checklist_executions` com `NOT VALID` e não executa saneamento nem `VALIDATE CONSTRAINT`. O banco verifica somente inserções/alterações posteriores e mantém todas as violações legadas aceitas antes da correção.

RESOLVIDO

###############

Bug 1263

Sintoma: Ao carregar mensagens antigas e trocar rapidamente para outra ocorrência ou empresa, mensagens da conversa anterior podem aparecer misturadas na nova conversa do portal.
Provável causa: `usePortalOccurrenceMessages.loadOlder` captura o tenant e a ocorrência da chamada, mas a Promise não recebe `AbortSignal`, geração nem comparação de contexto antes de executar `setOlderMessages`. O efeito de troca limpa o array, porém uma requisição antiga que terminar depois volta a anexar sua página ao estado compartilhado do novo diálogo.

RESOLVIDO

###############

Bug 1264

Sintoma: As páginas de Coletas, Canhotos/POD e Ocorrências do portal ficam progressivamente lentas, fazem muitas requisições em sequência e podem travar o navegador de clientes com histórico extenso, mesmo que o usuário precise consultar apenas os registros mais recentes.
Provável causa: `usePortalPickups`, `usePortalPods` e `usePortalOccurrences` chamam `fetchAllPostgrestPages` até esgotar os respectivos RPCs, acumulando todo o histórico em memória. As três páginas percorrem os arrays completos com `map`, sem paginação, carregamento incremental ou virtualização na interface; a correção do antigo corte de 200 registros apenas transferiu o problema para materialização integral.

RESOLVIDO

###############

Bug 1265

Sintoma: Durante o carregamento de muitos Canhotos/PODs ou Ocorrências no portal, registros podem aparecer duplicados ou desaparecer quando um comprovante/evento é criado ou alterado enquanto as páginas seguintes ainda estão sendo buscadas.
Provável causa: `usePortalPods` e `usePortalOccurrences` percorrem os resultados em lotes com `LIMIT/OFFSET`, mas `list_client_pods_v2` ordena por horários sem `id` como último desempate e `list_client_occurrences_v2` ordena apenas por `created_at`; nenhum RPC fixa um snapshot. Inserções ou mudanças nos campos de ordenação deslocam as fronteiras que `fetchAllPostgrestPages` pressupõe estáveis.

RESOLVIDO

###############

Bug 1266

Sintoma: O gate “Pipeline automático comprovado por 24h+” pode ficar verde sem que a coleta automática de posições tenha funcionado continuamente, por exemplo após sucessos horários obtidos apenas com diagnósticos manuais, sincronização de unidades ou agregação diária.
Provável causa: `agvlog-pipeline-run` define `_increment_success` somente pela ausência de erros/atenções, independentemente de `mode`, e `merge_tenant_pipeline_health_v1` adiciona todo sucesso a `recent_successful_runs`. `evaluateSsxReadiness` verifica apenas a presença de um timestamp por hora, sem exigir que essas entradas pertençam ao modo automático `poll`/`full` nem que tenham executado a etapa de polling.

RESOLVIDO

###############

Bug 1267

Sintoma: Ao criar um monitoramento manual à noite no fuso de São Paulo, a previsão de retorno pode ser salva um dia além do prazo informado, fazendo o motorista permanecer “no prazo” por um dia extra e atrasando os alertas de retorno.
Provável causa: `DriverMonitoring.expectedReturnDate` transforma `startedAt` em `Date`, soma o prazo com `setUTCDate` e usa a parte de data do `toISOString`. Entre 21h e 23h59 locais, o instante já pertence ao dia seguinte em UTC; o backend aceita essa data pronta e não a recalcula a partir do dia civil de `started_at` em `America/Sao_Paulo`.

RESOLVIDO

###############

Bug 1268

Sintoma: É possível criar um monitoramento “Ativo” com zero entregas previstas; ele entra nos KPIs de motoristas em rota, mas nunca possui entrega restante nem transiciona automaticamente para “Retornando”, produzindo uma rota operacional sem trabalho associado.
Provável causa: O formulário “Novo Monitoramento” aceita `min={0}` e `saveMonitor` valida apenas o nome. `apply_driver_monitor_command` também aceita `total_deliveries = 0` porque rejeita somente valores negativos ou menores que o progresso anterior, enquanto a importação equivalente exige explicitamente total maior que zero.

RESOLVIDO

###############

Bug 1269

Sintoma: Preencher o campo “Horário término” ao registrar entregas do dia pode fazer o salvamento falhar por formato de data/hora ou gravar um horário deslocado conforme o fuso da sessão, embora a tela solicite apenas uma hora local.
Provável causa: A interface envia o valor de um `<input type="time">`, como `14:30`, para `city_finished_at`, cuja coluna é `time without time zone`; porém `add_driver_progress_v1` converte o texto primeiro com `::timestamptz`. A importação da mesma informação usa corretamente `::time`, evidenciando a incompatibilidade do caminho manual.

RESOLVIDO

###############

Bug 1270

Sintoma: Registrar hoje um progresso referente a uma data antiga faz a rota deixar de aparecer como “Sem atualização”, enquanto informar acidentalmente uma data futura também é aceito; o indicador passa a medir o momento do lançamento no sistema e não a data operacional declarada.
Provável causa: `add_driver_progress_v1` não limita nem relaciona `_payload.update_date` com o período do monitor. Após inserir a linha, define `last_update_at = clock_timestamp()` e calcula o estado com esse mesmo instante, ignorando a data informada; já a importação deriva `last_update_at` da última `update_date`, criando semânticas divergentes entre entrada manual e planilha.

RESOLVIDO

###############

Bug 1271

Sintoma: Downloads de CT-e, NFS-e e PDF de títulos feitos pelo portal não deixam trilha de quem acessou o arquivo, e um endereço copiado pode continuar abrindo o documento fora do portal mesmo após a permissão do usuário ser revogada.
Provável causa: `private.portal_read_fiscal_bundle` e `private.portal_read_financial_titles` apenas validam a sessão no momento da chamada e devolvem diretamente `pdf_url`/`xml_url` persistidos nas tabelas. Não geram URL assinada curta vinculada ao acesso, não passam por um proxy autenticado e não inserem evento de auditoria de download; a autorização deixa de atuar assim que a URL bruta é entregue ao navegador.

RESOLVIDO

###############

Bug 1272

Sintoma: Na página “Títulos” do portal, o usuário pode ficar preso em “Nenhum título encontrado” sem botões para voltar, mesmo ainda existindo títulos, quando estava numa página posterior e pagamentos/cancelamentos reduzem o total para 50 ou menos.
Provável causa: `PortalTitles` mantém `page` quando os dados são revalidados e não normaliza o índice contra o novo `total`. Os controles Anterior/Próxima só são renderizados quando `total > limit`; se a consulta com `offset = page * 50` volta vazia e o total caiu para no máximo 50, a tela remove justamente o único controle que permitiria retornar à primeira página.

###############

Bug 1273

Sintoma: O gate de qualidade falha em `npm run lint:errors`, impedindo que o pipeline completo `npm run check` e uma entrega passem mesmo quando o código da aplicação está compilando.
Provável causa: `src/test/routePlanningReportedBugs.test.ts` contém a expressão regular `/onSuccess: \(_, route\) => \{[\s\S]*?\n    \},/` com quatro espaços literais. A regra ESLint `no-regex-spaces` trata essa sequência como erro e exige uma quantificação como `{4}`; a execução atual termina com 1 erro.

###############

Bug 1274

Sintoma: A suíte Vitest falha de forma reproduzível em `routeConsistency.test.ts` no caso “warning para excesso de paletes”, impedindo o gate de testes mesmo quando a validação está bloqueando corretamente uma rota acima da capacidade.
Provável causa: `validateRouteConsistency` passou a inserir excesso de paletes, peso e volume em `blockingErrors`, tornando `valid = false`, mas o teste ainda procura `/excedem/` em `warnings` e exige `valid = true`. A expectativa não foi atualizada junto com a mudança da regra de aviso para bloqueio.

###############

Bug 1275

Sintoma: Todos os testes de `settlementAdjustmentFrontendDatabase.test.tsx` que precisam abrir um acerto falham antes de exercitar o comportamento esperado, exibindo `range is not a function`; o grupo reporta 12 falhas na suíte completa.
Provável causa: O leitor de detalhes de acerto passou a paginar itens, eventos e pagamentos por `fetchAllPostgrestPages`, encadeando `.range(from, to)`, mas o builder Supabase simulado pelo teste implementa apenas `select`, `eq`, `order`, `abortSignal`, `maybeSingle` e `then`. O mock ficou incompatível com o contrato atualmente usado pela aplicação.

###############

Bug 1276

Sintoma: Os testes de interface financeira de recebíveis mantêm o formulário bloqueado com “Não foi possível conferir as parcelas da renegociação” e falham em massa antes de confirmar pagamentos, estornos e recuperações; a suíte completa reporta 14 falhas nesse arquivo.
Provável causa: `ReceivableFinancialDialog` agora sempre chama `get_finance_receivable_installment_position` por `readReceivableAgreementPosition`, mas o dispatcher RPC de `receivableFinancialFrontendDatabase.test.tsx` conhece apenas contexto, página de pagamentos, comando financeiro, opções de movimentos e correção de vínculo. A chamada nova cai em `Unexpected RPC`, enquanto as expectativas antigas continuam supondo que o formulário estará habilitado.

###############

Bug 1277

Sintoma: Os dois testes do assistente de faturamento manual em `clientInvoiceLifecycleFrontendDatabase.test.tsx` não avançam da segunda etapa e exibem `Falha ao montar a prévia: Cannot read properties of null (reading 'legal_name')`, quebrando tanto a criação quanto a recuperação após perda de resposta no gate automatizado.
Provável causa: O teste simula `useCompanyProfile` com `{ data: null }`, embora o contrato atual do hook entregue um perfil ou um objeto vazio; `NewInvoiceWizard` só aplica o valor padrão da desestruturação quando `data` é `undefined` e, diante do `null` artificial, tenta acessar imediatamente `companyProfile.legal_name`.

###############

Bug 1278

Sintoma: Quatro dos cinco cenários de `replanningFrontendDatabase.test.tsx` falham antes de abrir o replanejamento porque a opção de carga destino aparece desabilitada, impedindo o gate de validar transferência, recuperação, nova parada e conflito concorrente.
Provável causa: A consulta `reallocation_load_meta` de `LoadReallocation` passou a paginar por `fetchAllPostgrestPages`, encadeando `.in(...).order(...).order(...).range(...)`, mas o mock Supabase desse teste encerra a cadeia em `.in()` e não implementa `order` nem `range`. A consulta entra em erro, ativa `hasReadError` e desabilita os seletores; o teste interpreta corretamente o bloqueio da interface, mas seu adaptador não acompanha mais o contrato consultado.

###############

Bug 1279

Sintoma: O cenário de fatura parcialmente recebida em `clientInvoiceLifecycleFrontendDatabase.test.tsx` exibe `Falha ao consultar faturas: Invoice command must not write tables directly`, não renderiza nenhuma fatura nem os botões de ação e impede a validação dos saldos liquidado e restante.
Provável causa: `useClientInvoices` passou a executar em paralelo a RPC protegida `list_client_invoice_financials` e uma leitura paginada de `client_invoices` para conferir a completude do conjunto, mas o teste configura `mock.from` para sempre lançar por assumir que todo o fluxo usaria somente RPC. O próprio leitor da tela aciona essa sentinela antiga antes que o cenário possa comparar os saldos.

###############

Bug 1280

Sintoma: Em um navegador configurado em um fuso diferente de São Paulo, o horário inicialmente exibido ou carregado nos formulários de abastecimento, despesa, coleta e ORT é salvo em um instante diferente do mostrado. A diferença equivale à distância entre o fuso do dispositivo e o de São Paulo, podendo também fazer uma coleta editada mudar de horário sem que o usuário o altere.
Provável causa: `localDateTimeInputValue` produz deliberadamente uma string sem offset com o relógio de `America/Sao_Paulo`, adequada ao controle `datetime-local`, mas `FuelingTab`, `DriverExpenseForm`, `ExpenseCreationForm`, `NewPickupOrderDialog` e `NewManualOrtDialog` convertem essa string com `new Date(valor).toISOString()`. O construtor interpreta uma string sem fuso no timezone local do navegador, não no timezone usado para preenchê-la.

###############

Bug 1281

Sintoma: Falhas ao consultar veículos, alertas, métricas diárias, histórico semanal ou eventos recentes são exibidas no Dashboard como valores reais iguais a zero, “Sem dados de métricas”, “Nenhum alerta” ou “Nenhum evento nas últimas 24h”. Assim, uma indisponibilidade do banco pode parecer uma operação normal sem atividade.
Provável causa: Com exceção do estado da frota, as consultas de `Dashboard` não usam seus estados `isError`/`error`. Os resultados recebem padrões como `0` e `[]`, e a renderização reutiliza os mesmos estados vazios para resposta válida sem registros e para requisição rejeitada.

###############

Bug 1282

Sintoma: Em uma empresa com mais de aproximadamente 142 veículos que possuam métricas em todos os sete dias, os gráficos “Atividade Diária (7 dias)” e “Km por Veículo (7 dias)” passam a somar apenas parte da frota e podem omitir dias mais recentes, sem avisar que a série está truncada.
Provável causa: A consulta `dashboard_weekly` lê `metrics_daily` com um único `select`, ordenado apenas por `day`, sem paginação, contagem ou detecção do limite de linhas da API. O frontend agrega o array parcial como se contivesse todas as combinações de veículo e dia.

###############

Bug 1283

Sintoma: Depois das 21h em São Paulo, o gráfico “Atividade Diária (7 dias)” pode mostrar apenas seis dias e os totais de “Km por Veículo (7 dias)” deixam de incluir o primeiro dia da janela. Em dispositivos configurados em outro fuso, o recorte também pode começar um dia antes ou depois do calendário operacional usado pelos indicadores de hoje.
Provável causa: `Dashboard` calcula a data inicial com `new Date()`, subtrai seis dias no calendário local do navegador e então usa `toISOString().slice(0, 10)`, enquanto a data de hoje da mesma tela é calculada por `localDateInputValue` em `America/Sao_Paulo`. A conversão do limite para UTC pode trocar o dia civil antes de enviá-lo ao filtro de `metrics_daily`.

###############

Bug 1284

Sintoma: O gate automatizado falha em `unboundedReimportCleanupAclDatabase.test.ts` no cenário “keeps the frontend on the previewed, date-bounded contract”, mesmo que a reimportação atual continue limitada pelas datas e execute a limpeza protegida no banco.
Provável causa: O teste procura textualmente uma chamada direta de `BatchReimportDialog` para `clear_reimport_batch_data` com `_tenant_id`, `_start_date` e `_end_date`. O frontend foi alterado para chamar o comando atômico `replace_reimport_batch_v1`, que recebe as mesmas datas no payload e invoca a limpeza delimitada dentro da transação; a asserção não foi atualizada para o novo contrato e obtém `undefined`.

###############

Bug 1285

Sintoma: Apagar a data em qualquer seletor do histórico na ficha de um veículo faz a página lançar `Data local inválida` durante a renderização, derrubando simultaneamente as abas de linha do tempo, viagens, velocidade e combustível em vez de apenas suspender a consulta até uma nova data ser escolhida.
Provável causa: Os quatro controles gravam diretamente `event.target.value` em `historyDate`, que pode ser uma string vazia, e `VehicleDetails` executa incondicionalmente `localDateUtcRange(historyDate)` dentro de `useMemo`. O utilitário lança para qualquer valor que não siga `AAAA-MM-DD`, antes que os `enabled` das consultas possam impedir a leitura.

###############

Bug 1286

Sintoma: Ao exportar o XLSX de Ocorrências Operacionais com uma data final selecionada, a aba de resumo por motorista deixa de contar praticamente todas as cargas criadas nesse último dia. A planilha pode, por exemplo, listar ocorrências de 17/09 no detalhe e mostrar entregas, notas e valor por motorista apenas até a meia-noite que iniciou 17/09.
Provável causa: O filtro principal transforma `dateTo` no fim do dia, mas `exportReport` reutiliza o objeto `Date` original, que representa 00:00, e consulta `loads.created_at <= periodTo.toISOString()`. A busca do resumo não ajusta o limite final para 23:59:59.999 nem usa um limite exclusivo no início do dia seguinte.

###############

Bug 1287

Sintoma: Usuários cujo dispositivo esteja em um fuso diferente do calendário operacional da empresa podem incluir ocorrências do dia vizinho e excluir eventos do primeiro ou do último dia escolhidos nos filtros de Ocorrências Operacionais; os atalhos “hoje” e “últimos 7 dias” também mudam de período conforme o fuso do navegador.
Provável causa: `operationalEventFilters` deriva os limites com `setHours(0...)` e `setHours(23...)` no timezone local do navegador, e os presets são criados por `startOfDay(new Date())`. O hook não consulta `tenants.timezone` nem aplica o calendário de `America/Sao_Paulo` usado por outras telas antes de enviar os instantes ao RPC paginado.

###############

Bug 1288

Sintoma: Um preset criado por “Salvar filtros atuais” perde motorista, cliente, carga, impacto mínimo/máximo, opção de somente impacto e responsabilidade. Pior: ao aplicar esse preset depois de usar outros filtros avançados, os valores anteriores continuam ativos silenciosamente, de modo que o resultado não corresponde nem ao estado salvo nem ao nome do preset.
Provável causa: `PresetFilters`, `saveCurrentAsPreset` e `applyPreset` tratam apenas busca, status, tipo, severidade, veículo e datas. Os demais estados que compõem `useOperationalEventsFiltered` não são persistidos e tampouco redefinidos quando um preset é aplicado.

###############

Bug 1289

Sintoma: Um preset de Ocorrências Operacionais salvo em uma empresa pode ser oferecido em outra empresa do mesmo usuário e reaplicar o UUID de um veículo que não existe no tenant atual, produzindo uma tabela vazia enganosa até o filtro ser limpo manualmente.
Provável causa: A chave de armazenamento é `opEvents.presets.v1.<user_id>` e não inclui `currentTenant.id`, embora o preset persista `vehicleId`, que é tenant-scoped. Não há migração, descarte nem validação do recurso salvo ao trocar de empresa.

###############

Bug 1290

Sintoma: Um valor JSON válido, porém com formato inesperado, em `opEvents.presets.v1.<user_id>` pode derrubar Ocorrências Operacionais ao abrir o menu de presets; por exemplo, `{}` causa erro ao executar `customPresets.map`, sem oferecer recuperação pela própria tela.
Provável causa: O efeito protege apenas a exceção de `JSON.parse` e grava diretamente qualquer valor decodificado em um estado tipado como array. Não existe validação de esquema, normalização para `[]` nem remoção da entrada incompatível antes de renderizar e manipular os presets.

###############

Bug 1291

Sintoma: Os períodos rápidos “7 dias”, “30 dias” e “90 dias” de Ocorrências Operacionais incluem respectivamente oito, 31 e 91 datas civis quando se conta o dia atual; os presets nativos “Abertas últimos 7 dias” e “Resolvidas últimos 7 dias” repetem o mesmo excesso e podem trazer ocorrências um dia mais antigas que o rótulo promete.
Provável causa: Os limites começam em `subDays(startOfDay(new Date()), 7|30|90)` e não possuem limite final anterior ao dia atual. Como o intervalo inclui tanto o dia resultante da subtração quanto hoje, seria necessário subtrair 6, 29 ou 89 dias para representar essa quantidade de dias civis inclusivos.

###############

Bug 1292

Sintoma: Notas fiscais já excluídas logicamente podem reaparecer na aba “Notas paradas” de Alertas como pendências que precisam ser corrigidas, ocupando o limite de 200 linhas e direcionando o usuário para uma lista em que o documento pode não estar mais disponível.
Provável causa: `StaleFiscalDocsSection` filtra tenant, tipo, ausência de carga, status diferente de cancelado e data, mas não aplica `deleted_at IS NULL` à consulta de `fiscal_documents`.

###############

Bug 1293

Sintoma: Uma nota emitida exatamente sete dias atrás aparece sob o título “Notas com mais de 7 dias” e recebe o badge vermelho “0 dia(s)”, embora ainda não tenha ultrapassado o próprio fechamento calculado para emissão + 7 dias.
Provável causa: O corte é a data atual menos sete dias e a consulta usa `issue_date <= cutoff`, incluindo a igualdade. Na renderização, `closingDate` é emissão + 7 dias e `differenceInCalendarDays` retorna zero nesse caso, evidenciando que a linha ainda não está “com mais de 7 dias”.

###############

Bug 1294

Sintoma: O gate automatizado falha em `fiscalListFailureStates.test.tsx` antes de testar o estado de erro do Monitor CT-e, lançando `useLocation() may be used only in the context of a <Router> component` ao renderizar `CteMonitor`.
Provável causa: `CteMonitor` passou a usar `useSearchParams` para abrir um documento referenciado pela URL, mas o teste ainda monta o componente diretamente com `render(<CteMonitor />)` e não fornece `MemoryRouter` ou outro contexto de roteamento.

###############

Bug 1295

Sintoma: O botão “Abrir CT-e” no detalhe do Resumo de Notas Importadas navega para o Monitor CT-e, mas não filtra nem abre o CT-e escolhido; o usuário chega à listagem geral e precisa procurar o documento novamente.
Provável causa: `ImportedNotesSummary` gera a URL `/cte-monitor?cte=<cte_id>`, enquanto `CteMonitor` lê somente os parâmetros `fiscalDocumentId` e `docNumber`. O parâmetro `cte` enviado pelo botão nunca é consumido.

###############

Bug 1296

Sintoma: Ao abrir o Monitor CT-e por um link com `?fiscalDocumentId=...`, fechar o diálogo do documento pode fazê-lo reabrir imediatamente, impedindo o usuário de permanecer na listagem sem remover manualmente o parâmetro da URL ou sair da página.
Provável causa: Fechar o diálogo executa apenas `setSelected(null)`, mas mantém `fiscalDocumentId` nos `searchParams`. O efeito de deep link observa `selected`, encontra o mesmo registro ainda presente em `rowsData` e torna a selecioná-lo assim que o estado volta a `null`.

###############

Bug 1297

Sintoma: Navegar, sem desmontar a tela, de um link do Monitor CT-e para outro com `docNumber` ou `fiscalDocumentId` diferente pode manter o filtro e o detalhe do documento anterior, deixando a URL indicar um CT-e enquanto a interface mostra outro.
Provável causa: `docNumber` é copiado de `useSearchParams` somente nos inicializadores de `filters` e `draft`, sem efeito para alterações posteriores. O efeito de `fiscalDocumentId` também retorna antecipadamente enquanto qualquer `selected` existe, portanto não substitui o diálogo aberto quando o parâmetro muda.

###############

Bug 1298

Sintoma: Em dispositivos configurados fora do fuso operacional da empresa, os filtros de emissão e processamento do Monitor CT-e e os filtros de emissão da Pesquisa de CT-e podem incluir documentos do dia vizinho e excluir as primeiras ou últimas horas das datas escolhidas.
Provável causa: `useCteMonitor` e `useCteSearch` transformam datas civis com `localDayBoundary`, que cria `new Date('AAAA-MM-DDT00:00:00')` no timezone local do navegador. O limite não usa `tenants.timezone` nem o calendário fixo de São Paulo empregado em outros fluxos antes de consultar colunas `timestamptz`.

###############

Bug 1299

Sintoma: Os atalhos “Hoje”, “7 dias”, “30 dias” e “90 dias” da Pesquisa de CT-e incluem documentos com emissão futura; além disso, os três períodos numéricos começam 7, 30 ou 90 dias antes e incluem também hoje, cobrindo pelo menos oito, 31 ou 91 datas civis em vez da quantidade anunciada.
Provável causa: `setPeriod` define somente `issueDateStart` e sempre limpa `issueDateEnd`. O início é produzido por `localDaysAgo(days)` com a subtração do número inteiro mostrado no rótulo, sem criar o limite superior de hoje nem descontar um dia para uma janela civil inclusiva.

###############

Bug 1300

Sintoma: Em um navegador cujo dia civil esteja diferente do dia atual em São Paulo, o cartão “manutenções próximas — nos próximos 7 dias” pode incluir serviços a oito dias ou deixar de mostrar os que vencem no sétimo dia da janela.
Provável causa: `MaintenanceTab` calcula `today` com `localDateInputValue()` em `America/Sao_Paulo`, mas calcula `horizon` com `format(addDays(new Date(), 7), 'yyyy-MM-dd')` no timezone local do navegador. Os dois extremos comparados lexicograficamente podem pertencer a calendários diferentes.

###############

Bug 1301

Sintoma: Um CT-e existente apenas em `fiscal_documents` pode exibir o valor total da carga também como valor do frete no Monitor e na Pesquisa de CT-e; quando o frete não foi informado, as duas telas apresentam um frete fictício igual ao valor da nota em vez de indicar dado ausente.
Provável causa: Ao montar `hubRows`, `useCteMonitor` e `useCteSearch` usam `Number(d.freight_value ?? d.value ?? 0)` para `freight_value`, embora `fiscal_documents.freight_value` e `fiscal_documents.value` sejam campos financeiros distintos e o mesmo `d.value` já alimente `cargo_value`.

###############

Bug 1302

Sintoma: A suíte `planningScreens.test.tsx` falha no cenário que verifica a recuperação de um despacho já confirmado: a tela não chega ao estado vazio esperado e o teste não consegue localizar “Nenhuma carga pendente para roteirização”, interrompendo o gate após os oito cenários anteriores passarem.
Provável causa: `usePendingLoadsForRouting` passou a paginar as leituras com `.range(from, to)`, mas o mock encadeável de Supabase desse arquivo ainda expõe apenas `select`, `eq`, `is`, `in` e `order`. A chamada inexistente a `range` rejeita a query durante a renderização do teste.

###############

Bug 1303

Sintoma: Uma manutenção agendada que possui também uma “próxima data” pode deixar de aparecer como atrasada na data real do serviço e só gerar alerta na data posterior; por exemplo, serviço agendado para hoje com próxima revisão daqui a meses é tratado como se a obrigação atual ainda estivesse distante.
Provável causa: `MaintenanceTab` define `alertDate` como `m.next_date || m.scheduled_date`. A presença de `next_date` oculta completamente `scheduled_date` nos cálculos de atrasadas e próximas, embora os campos representem marcos diferentes do ciclo de manutenção.

###############

Bug 1304

Sintoma: É possível salvar uma manutenção no estado “Agendada” sem descrição, data agendada, próxima data ou limite de quilometragem; o registro fica no histórico como uma obrigação vazia que jamais entra nos alertas de atraso ou proximidade.
Provável causa: O diálogo chama `useCreateMaintenance` sem validar campos obrigatórios ou exigir ao menos um gatilho temporal/quilométrico. No banco, `description` aceita a string vazia, `scheduled_date`, `next_date` e `next_odometer` aceitam `NULL`, e o status padrão continua sendo `scheduled`.

###############

Bug 1305

Sintoma: Quando há abastecimentos parciais entre dois registros de tanque cheio, o histórico atribui toda a distância percorrida apenas aos litros do último abastecimento cheio, superestimando o km/L e subestimando o custo por quilômetro do período.
Provável causa: `useConsumptionHistory` filtra primeiro o histórico para manter somente `is_full_tank` e, em cada intervalo, divide a diferença de odômetro apenas por `f.liters` e usa apenas `f.total_cost`. Os litros e custos dos abastecimentos parciais ocorridos desde o tanque cheio anterior são descartados do cálculo.

###############

Bug 1306

Sintoma: O cartão “Média km/L” pode exibir uma média diferente do consumo global real, dando o mesmo peso a um trecho muito curto e a um trecho de centenas de quilômetros.
Provável causa: `useConsumptionHistory` calcula `avgKmPerLiter` pela média aritmética dos índices de cada intervalo (`sum(kmPerLiter) / quantidade`). A média agregada de consumo precisa ponderar as observações, dividindo a distância total pelo total de litros considerado nos mesmos intervalos.

###############

Bug 1307

Sintoma: Se duas leituras de odômetro possuem o mesmo `recorded_at`, a ficha do veículo pode exibir a leitura anterior como “Odômetro Atual”, calcular quilômetros registrados a partir dela e usar esse valor defasado como mínimo do formulário, mesmo que uma leitura mais nova no mesmo instante tenha quilometragem maior.
Provável causa: `useVehicleOdometerList` ordena `recorded_at` decrescente, mas usa `id` na ordem crescente padrão, e `OdometerTab` assume que `readings[0]` é a última leitura. O trigger que sincroniza `vehicles.odometer_km`, por outro lado, resolve empates pelo maior par `(recorded_at, id)`, portanto banco e interface elegem linhas opostas quando o timestamp empata.

###############

Bug 1308

Sintoma: `loadReallocationScreen.test.tsx` deixa a realocação bloqueada por erro de leitura e não observa os toasts de sucesso nem a remoção confirmada da carga origem; no gate com `--bail=1`, o primeiro cenário interrompe a execução depois de 383 arquivos e 3.142 testes aprovados.
Provável causa: Assim como outro teste de replanejamento, o mock Supabase deste arquivo encerra `.in()` devolvendo uma `Promise` e não implementa os métodos `.order(...).order(...).range(...)` agora usados pela consulta paginada `reallocation_load_meta`. A tela entra corretamente em `hasReadError`, desabilita “Mover” e nenhum RPC de realocação é chamado.

###############

Bug 1309

Sintoma: Empresas com grande histórico de cargas e itens podem esperar milhares de requisições e esgotar memória ao abrir “Mover Cargas entre Veículos”, mesmo que pretendam realocar apenas dois registros; a página também cria todos os grupos e opções no navegador de uma só vez.
Provável causa: `LoadReallocation` chama `useLoads`, cujo catálogo inclui cargas inativas e acumula todas as páginas de até 500 linhas, para só depois filtrar os status ativos localmente. Em seguida, `reallocation_load_meta` percorre todos os IDs ativos em blocos e baixa todas as páginas de `load_items` com relações fiscais antes de montar `groupedLoads`; não há busca remota, paginação visual ou limite total.

###############

Bug 1310

Sintoma: Cargas cujas notas possuem remetente, mas não destinatário ou cidade preenchidos, são agrupadas nos seletores de realocação como “Sem cliente identificado · Sem cidade” e o cartão da carga também pode ocultar completamente o remetente, dificultando distinguir cargas de fornecedores diferentes.
Provável causa: `loadMeta` calcula e armazena `remitter`, porém `groupedLoads` usa exclusivamente `meta.client` e nunca incorpora o remetente à chave; a tentativa posterior de extrair `[FORN: ...]` procura um prefixo que jamais foi criado. Em `LoadColumn`, o bloco de resumo só é montado quando existem destinatários ou cidades e o subbloco que contém remetentes também depende de `recipients.length > 0`.

###############

Bug 1311

Sintoma: Na realocação, notas distintas de emissores diferentes que compartilham o mesmo número aparecem fundidas em um único grupo “NF”; usar o checkbox do grupo seleciona e pode mover todas elas juntas, embora o operador tenha a impressão de estar escolhendo um só documento.
Provável causa: `LoadColumn` agrupa os itens pela chave `INV-${invoice_number}`. A chave ignora `fiscal_document_id`, CNPJ do remetente, série e chave de acesso, portanto números de nota que são únicos apenas dentro de um emissor colidem no mesmo bloco e compartilham a ação de seleção coletiva.

###############

Bug 1312

Sintoma: Um grupo de nota com mais de um item pode mostrar um valor total multiplicado pelo número de itens; uma NF de R$ 1.000 representada por três linhas aparece como R$ 3.000 no cartão de realocação.
Provável causa: Durante o agrupamento, `LoadColumn` executa `group.totalValue += fd.value` para cada `load_item`. Como `fd.value` é o valor integral do mesmo documento fiscal repetido na relação de cada item, o cálculo soma a nota novamente em vez de contabilizá-la uma única vez por `fiscal_document_id`.

###############

Bug 1313

Sintoma: Cargas com mais itens que o limite de resposta do PostgREST perdem silenciosamente parte da composição nas telas que usam `useLoadItems`; na realocação, itens antigos não podem ser selecionados, os totais e a capacidade aparente ficam incompletos e uma movimentação que parece caber pode ser rejeitada apenas pelo banco.
Provável causa: `useLoadItems` faz um único `select` de `load_items` com relações e apenas ordena por `created_at`, sem `.range`, cursor, paginação ou contagem. `LoadReallocation` trata o array retornado como a composição completa tanto para renderizar origem/destino quanto para o pré-cálculo de paletes e peso.

###############

Bug 1314

Sintoma: Um operador pode excluir um item manual a partir de uma composição antiga depois que outra pessoa acabou de corrigir sua descrição, quantidade, paletes, peso, volume, status ou observação; a edição recém-confirmada é apagada sem aviso e a exclusão ainda aparece como bem-sucedida.
Provável causa: `LoadItemsPanel` envia à exclusão somente `item.id`, e `delete_load_item_v3` bloqueia e apaga a versão atualmente persistida sem receber nem comparar o estado/revisão que o operador visualizou. O fluxo de atualização possui `expected`, mas o fluxo destrutivo não oferece CAS equivalente.

###############

Bug 1315

Sintoma: Quando a leitura dos itens de uma carga falha, o painel mostra “Nenhum item encontrado”, calcula ocupação e totais como zero e continua oferecendo inclusão de NF ou item manual; o operador pode agir sobre uma composição que parece vazia, mas está apenas indisponível.
Provável causa: `LoadItemsPanel` desestrutura de `useLoadItems` somente `data` e `isLoading`, aplica `items = []` e não observa `isError`, `error` ou `refetch`. Esse array vazio alimenta simultaneamente a mensagem, a capacidade local, os filtros e as ações de inclusão.

###############

Bug 1316

Sintoma: O diálogo “Item manual” permite adicionar uma linha genérica com quantidade, paletes e peso todos iguais a zero e sem pedido ou descrição; esse item sem carga física passa a fazer parte da composição e pode impedir que uma carga seja reconhecida como vazia.
Provável causa: O formulário inicia todas as métricas em zero, mantém “Adicionar” habilitado e substitui a descrição vazia por `Item`. A validação compartilhada de preparação exige somente números finitos e não negativos, mas não exige nenhuma medida positiva nem identidade/descrição significativa para a criação.

###############

Bug 1317

Sintoma: Todos os sete cenários de `financePayrollScreen.test.tsx` quebram durante a renderização de `PeriodEntries`, impedindo o gate de verificar saldos, pagamentos, exceções, paginação, troca de período e estados de carregamento da folha.
Provável causa: `PayrollPeriodEntries` passou a importar e executar `usePayrollGenerationIssues` (além de `useChangePayrollPeriodState`), mas o mock integral de `@/hooks/usePayroll` no teste ainda exporta apenas os hooks antigos de entradas, aprovação, fechamento e geração. O Vitest lança imediatamente “No usePayrollGenerationIssues export is defined”.

###############

Bug 1318

Sintoma: Depois de corrigir contratos ou vínculos e clicar em “Recalcular”, a tela pode continuar exibindo pendências antigas e manter “Aprovar” desabilitado, embora o novo cálculo já tenha apagado ou substituído essas pendências no banco; o operador precisa atualizar a página ou provocar outro refetch para prosseguir.
Provável causa: `generate_payroll_period` reutiliza o mesmo período, apaga e recria `payroll_generation_issues`, porém o `onSuccess` de `useGeneratePayrollPeriod` invalida apenas `payroll_periods`, `payroll_entries` e os custos financeiros. A chave `payroll_generation_issues` consumida por `PeriodEntriesContent` permanece válida no cache com o resultado anterior.

###############

Bug 1319

Sintoma: Se um acerto incluído na folha já tiver pagamento externo que não foi representado nos itens, “Aprovar” falha repetidamente, mas a pendência que explicaria qual acerto precisa de correção nunca aparece na tela nem permanece disponível para diagnóstico.
Provável causa: `approve_payroll_period` primeiro insere `settlement_paid_outside_payroll` em `payroll_generation_issues`. A migração `20260917033000_fix_reported_payroll_lifecycle.sql` injeta logo depois uma exceção quando existe qualquer issue não resolvida; a exceção reverte a mesma transação e, portanto, também desfaz a issue recém-inserida que deveria orientar o operador.

###############

Bug 1320

Sintoma: No cadastro de adiantamento, a data aparenta ser opcional e pode ser apagada; mesmo assim “Registrar” continua habilitado e a tentativa termina em erro, sem a validação local indicar que falta a data.
Provável causa: `RegisterAdvanceDialog` não marca nem valida `advanceDate` e desabilita o botão apenas pelo motivo e estado da mutation. Já `employeeAdvanceRegistrationCommandSchema` exige que `advance_date` corresponda estritamente a `YYYY-MM-DD`, portanto o valor vazio só é rejeitado depois que o fluxo de persistência é iniciado.

###############

Bug 1321

Sintoma: Se a consulta de funcionários falhar ao abrir “Registrar adiantamento”, o seletor fica simplesmente vazio, sem carregamento, erro ou opção de tentar novamente; o operador não consegue distinguir indisponibilidade de uma empresa sem funcionários.
Provável causa: `RegisterAdvanceDialog` desestrutura apenas `data` de `useEmployees` com fallback para `[]` e ignora `isPending`, `isFetching`, `isError`, `error` e `refetch`. O mesmo array vazio é renderizado como a lista definitiva do seletor.

###############

Bug 1322

Sintoma: Os dois cenários de `PortalDocumentsFilters.test.tsx` falham antes de testar retorno da última página, busca, troca de cliente ou limpeza de filtros, porque a renderização não contém o botão “Próxima”.
Provável causa: A tela e `usePortalDocuments` migraram de um array simples para o contrato paginado `{ rows, hasMore }`, mas o mock do teste ainda retorna o array diretamente. `PortalDocuments` lê `documentsPage?.rows` como vazio e `documentsPage?.hasMore` como falso, ocultando a tabela e toda a paginação.

###############

Bug 1323

Sintoma: Um usuário autenticado do portal pode contornar a paginação da interface e solicitar de uma vez uma quantidade arbitrariamente grande de documentos ou mercadorias, aumentando sem controle o trabalho, a memória e o volume de resposta do banco para seu conjunto acessível.
Provável causa: Os RPCs `list_client_documents_v2` e `search_client_portal_shipments_v2` aplicam diretamente `_limit` e `_offset` fornecidos pelo chamador em `LIMIT/OFFSET`, sem faixa permitida nem rejeição de valores negativos ou excessivos. O frontend usa 51/50, mas as funções `SECURITY DEFINER` são executáveis diretamente por `authenticated`.

###############

Bug 1324

Sintoma: Um documento fiscal de valor exatamente zero aparece no portal com “—” na coluna Valor, igual a um documento cujo valor foi ocultado por falta de permissão ou não foi informado; o cliente não consegue distinguir R$ 0,00 de ausência de dado.
Provável causa: `PortalDocuments` escolhe a apresentação com `d.value ? d.value.toLocaleString(...) : '—'`. Como zero é falso em JavaScript, o valor financeiro legítimo é descartado em vez de ser testado apenas contra `null`/`undefined`.

###############

Bug 1325

Sintoma: Um cliente pode abrir pelo portal uma ocorrência sem tipo ou descrição útil, preenchendo esses campos apenas com espaços; também pode enviar textos arbitrariamente longos, poluindo a fila operacional e a auditoria com registros impossíveis de classificar ou ler adequadamente.
Provável causa: `PortalOccurrences.submit` testa somente a veracidade das strings, sem `trim` ou limites, e envia os valores crus. O RPC `create_client_occurrence` repete a lacuna: valida a permissão e os vínculos, mas insere `_event_type`, `_description` e `_severity` sem normalização, comprimento ou enumeração defensiva.

###############

Bug 1326

Sintoma: O cliente pode solicitar no portal uma nova coleta com data e hora já passadas; ela é aceita como pendente e entra na operação como se ainda devesse ser programada, contaminando filas e indicadores de coletas futuras.
Provável causa: O campo `datetime-local` de `PortalPickups` não define `min` nem compara a escolha com o instante atual. O RPC `request_client_pickup` valida apenas a permissão e a existência do cliente e insere `_pickup_at` diretamente, sem exigir valor não nulo ou futuro.

###############

Bug 1327

Sintoma: `activeMovementOptions.test.ts` interrompe a validação conjunta dos oito seletores financeiros ao analisar as opções de movimento de pagamento de acerto, com erro de schema por ausência de `history_page`, `history_page_size` e `history_has_more`.
Provável causa: O contrato `settlementMovementOptionsSchema` já exige o histórico paginado introduzido por `20260917072228_page_settlement_payment_link_history.sql`, mas `createActiveMovementOptionsDatabase` monta o fixture somente até `20260910184543_finance_active_movement_options` e não instala essa migração posterior. A função exercitada continua devolvendo o formato predecessor.

###############

Bug 1328

Sintoma: Depois que uma coleta pendente é cancelada pelo portal, não é possível auditar qual usuário realizou a ação, em que contexto ou por qual motivo; resta apenas o status final “cancelada” e o horário genérico de atualização da linha.
Provável causa: `cancel_client_pickup` executa somente `UPDATE pickup_orders SET status = 'cancelada', updated_at = now()`. Diferentemente da criação, não chama `_log_entity_audit`, não recebe motivo e não grava autor ou evento de transição; o diálogo do frontend também confirma o cancelamento sem coletar justificativa.

###############

Bug 1329

Sintoma: Se uma resposta à mensagem de ocorrência for gravada e a confirmação se perder por timeout ou queda de rede, o portal mantém o texto e orienta implicitamente a tentar de novo; a nova tentativa cria uma segunda mensagem idêntica na conversa.
Provável causa: `useReplyPortalOccurrence` chama `reply_client_occurrence` apenas com ocorrência e texto, sem `request_id` persistente. O RPC sempre faz um novo `INSERT` em `client_occurrence_messages` e não possui chave de idempotência ou replay, enquanto o diálogo só limpa o texto após receber uma resposta confirmada.

###############

Bug 1330

Sintoma: O cliente consegue enviar novas mensagens em uma ocorrência que já foi resolvida, mas a resposta não reabre nem altera a situação do caso; a conversa ganha atividade nova enquanto a ocorrência continua classificada como encerrada e pode ficar fora das filas de acompanhamento.
Provável causa: `PortalOccurrences` oferece “Conversar” também para linhas com `resolved_at`, e `reply_client_occurrence` valida somente tenant, cliente e texto. A função insere a mensagem e atualiza `client_opened`, sem bloquear estado terminal nem limpar `resolved_at`/`resolution` ou mudar `public_status` para reanálise.

###############

Bug 1331

Sintoma: Em uma conversa do portal com mais de 100 mensagens, mensagens antigas já visíveis podem desaparecer e surgir um intervalo oculto quando novas respostas chegam por polling/realtime; o botão de carregar anteriores pode continuar encerrado, tornando parte do histórico inacessível até reabrir a conversa.
Provável causa: `usePortalOccurrenceMessages` refaz continuamente a janela das 100 mensagens mais novas, mas conserva `olderMessages` e `olderHasMore` obtidos contra a fronteira anterior. Quando inserções deslocam essa janela, forma-se um buraco entre o novo último item de `latestMessages` e o primeiro lote antigo; o merge deduplica por ID, porém não detecta nem busca essa lacuna e um `olderHasMore = false` permanece fixo.

###############

Bug 1332

Sintoma: `legacyPayableAssociationOptions.test.ts` falha já no primeiro cenário e deixa sem executar as verificações de capacidade compartilhada, reversão/reassociação, paginação, autorização e distinção do histórico canônico, pois o parser não encontra `page_revision` na resposta.
Provável causa: `legacyPayableContextSchema` foi atualizado para o contrato estável de `20260917072951_stabilize_legacy_association_paging.sql`, que inclui revisão de catálogo e assinatura adicional, mas o teste instala explicitamente apenas `20260910143920_finance_legacy_payable_association_options.sql` sobre o fixture antigo. O leitor exercitado ainda devolve o JSON predecessor sem `page_revision`.

###############

Bug 1333

Sintoma: Se o portal registrar uma ocorrência e perder a resposta da requisição, reenviar o formulário preservado cria outra ocorrência operacional com o mesmo cliente, tipo, gravidade e descrição; a equipe passa a tratar o mesmo relato como casos distintos.
Provável causa: `useCreatePortalOccurrence` e `create_client_occurrence` não usam `request_id`, outbox nem chave idempotente. Cada chamada executa um novo `INSERT` em `operational_events`, enquanto `PortalOccurrences` só fecha e limpa o formulário após receber a confirmação de sucesso.

###############

Bug 1334

Sintoma: Se o cancelamento de uma coleta for confirmado no banco mas a resposta se perder, o portal informa falha e mantém a coleta aparentando estar pendente; repetir a ação retorna “Only pending pickups can be cancelled”, sem confirmar ao cliente que o primeiro pedido já foi aplicado.
Provável causa: `useCancelPortalPickup` só invalida a listagem no `onSuccess` recebido pelo navegador, e `cancel_client_pickup` não recebe identidade de tentativa nem retorna replay idempotente. Após o primeiro commit incerto, a nova chamada encontra `status = 'cancelada'` e trata o estado desejado já alcançado como erro.

###############

Bug 1335

Sintoma: Um usuário autenticado do portal pode chamar diretamente as listagens de coletas e ocorrências com um limite arbitrariamente grande, ignorando os lotes de 200 da interface e forçando o banco a montar e transferir todo o histórico acessível em uma única resposta.
Provável causa: `list_client_pickups_v2` e `list_client_occurrences_v2` aplicam `_limit` e `_offset` diretamente no SQL, sem validar faixa, nulidade ou valores negativos. Os hooks fornecem parâmetros moderados, mas ambos os RPCs `SECURITY DEFINER` permanecem executáveis por `authenticated` fora do frontend.

###############

Bug 1336

Sintoma: Uma única resposta na conversa de ocorrência pode conter texto arbitrariamente grande, aumentando sem limite o armazenamento, o tráfego de cada página/polling e o custo de renderização do diálogo para todos que abrirem o caso.
Provável causa: O `Textarea` de `OccurrenceThreadDialog` não possui `maxLength`, e `reply_client_occurrence` valida apenas que `btrim(_message)` não seja vazio. A coluna e o parâmetro são `text`, sem limite de tamanho no RPC ou no banco.

###############

Bug 1337

Sintoma: No escopo “todos os clientes”, um usuário com permissão de coleta ou ocorrência em apenas alguns clientes perde os botões de cancelar coletas e conversar até selecionar um cliente específico, inclusive nas linhas dos clientes em que tem a permissão válida.
Provável causa: `PortalPickups` e `PortalOccurrences` só liberam ações de linha no escopo global quando todas as concessões possuem a permissão (`requestableClients.length === access.length` / equivalente). Os RPCs de listagem não retornam `client_id`/permissão efetiva por linha, então o frontend não consegue autorizar individualmente e bloqueia também os registros permitidos.

###############

Bug 1338

Sintoma: O cenário “rejects a later page when a concurrent association changes candidates or history” de `legacyReceivableAssociationOptions.test.ts` falha com `closing_invalid_state_transition` antes de provocar a mudança concorrente e, por isso, não valida a proteção de `page_revision`.
Provável causa: O teste insere um segundo pagamento histórico no mesmo recebível usando `withLegacyReceiptSeed`, mas o helper desabilita apenas `guard_receivable_payment_history`. Os demais efeitos da inserção ainda recalculam o recebível e tentam atualizar novamente o relatório de fechamento já em `partially_paid`; o guard de lifecycle interpreta essa regravação de estado como transição inválida e aborta a preparação do cenário.

###############

Bug 1339

Sintoma: No dashboard do portal, uma nota pode receber o selo “Ocorrência” porque outra mercadoria de outro cliente, mas transportada na mesma carga, possui uma ocorrência aberta; além do falso alerta, isso revela ao primeiro cliente que existe uma exceção operacional alheia.
Provável causa: `get_client_portal_upcoming_deliveries` calcula `has_open_occurrence` procurando `operational_events` somente por `oe.load_id = fd.load_id`, `visible_to_client` e estado aberto. A subconsulta não correlaciona `oe.client_id` nem `oe.fiscal_document_id` com a nota/cliente da linha retornada.

###############

Bug 1340

Sintoma: O botão “Baixar” de canhotos no portal pode não abrir arquivo algum em navegadores com bloqueio de pop-ups, mesmo depois de o servidor gerar a URL assinada com sucesso; a interface também não avisa que a nova aba foi bloqueada.
Provável causa: `PortalPods` e `PortalShipmentDetail` aguardam `download.mutateAsync(...)` antes de chamar `window.open`. Como a abertura ocorre depois de uma operação assíncrona, ela já pode estar fora do gesto direto do clique; além disso, o retorno nulo de `window.open` é ignorado como se o download tivesse sido iniciado.

###############

Bug 1341

Sintoma: Na tabela desktop de “Mercadorias” do portal, a coluna “Volumes” exibe a quantidade de pallets (ou zero), podendo informar um total diferente da quantidade real de volumes da nota.
Provável causa: `PortalShipments` renderiza `r.pallet_count ?? 0` sob o cabeçalho “Volumes”. O tipo `ShipmentRow` e `search_client_portal_shipments_v2` também omitem `fiscal_documents.volume_count`, impedindo a tela de usar o dado correspondente ao rótulo.

###############

Bug 1342

Sintoma: Se uma nota ficar vinculada por engano a uma carga de outra empresa, o portal do cliente autorizado para a nota pode receber número, estado e viagem da carga estrangeira, além de dados da parada associados a ela.
Provável causa: `fiscal_documents.load_id` possui apenas FK simples para `loads(id)`, sem garantir igualdade de `tenant_id`, e `search_client_portal_shipments_v2` faz `LEFT JOIN loads l ON l.id = fd.load_id` sem restringir `l.tenant_id = _tenant_id`. A função `SECURITY DEFINER` autoriza a nota, mas não valida o escopo da carga antes de projetar seus campos.

###############

Bug 1343

Sintoma: Os dois cenários de erro de `operatorRegistryScreensFrontend.test.tsx` falham com “Found multiple elements with the role alert” e deixam de verificar que falhas das listas de motoristas e veículos não são apresentadas como cadastro vazio.
Provável causa: O teste configura `mock.rpc.mockResolvedValue(...)` para falhar todas as chamadas da tela, incluindo a lista principal e o catálogo auxiliar. As telas agora expõem corretamente ambos os erros com `role="alert"`, mas a asserção ainda usa `screen.findByRole('alert')`, que exige um único elemento, em vez de simular só o recurso pretendido ou localizar o alerta pelo nome/conteúdo.

###############

Bug 1344

Sintoma: A aba “MDF-e” da página Documentos do portal permanece vazia para MDF-es emitidos pelo fluxo fiscal atual, embora o título da página prometa listar NF-e, CT-e e MDF-e.
Provável causa: A aba envia `_document_type = 'mdfe'` para `list_client_documents_v2`, que consulta exclusivamente `fiscal_documents`. O ciclo atual de MDF-e persiste os manifestos em `load_manifests` e as emissões em `hub_fiscal_emissions`, sem espelhar um registro `fiscal_documents.document_type = 'mdfe'`; portanto o leitor do portal consulta a fonte errada para esse tipo.

###############

Bug 1345

Sintoma: As abas “NF-e” e “CT-e” de Documentos podem mostrar zero resultados para notas importadas e CT-es emitidos pelos fluxos atuais, embora os mesmos registros apareçam quando “Todos” está selecionado.
Provável causa: A interface filtra pelos literais `nfe` e `cte`, e `list_client_documents_v2` exige igualdade exata com `fiscal_documents.document_type`. Porém o reimportador atual grava notas como `inbound`, enquanto `prepare_cte_issue` grava o documento de saída como `outbound`; os tipos de UI não correspondem à taxonomia persistida pelos escritores canônicos.

###############

Bug 1346

Sintoma: O dashboard do portal, anunciado como acompanhamento “em tempo real”, pode permanecer indefinidamente com indicadores, próximas entregas e alertas desatualizados enquanto o usuário mantém a página aberta.
Provável causa: `usePortalSummary`, `usePortalUpcomingDeliveries` e `usePortalAlerts` definem apenas `staleTime: 60_000`, sem `refetchInterval` nem assinatura de mudanças. O término do `staleTime` apenas marca o cache como vencido; não dispara nova consulta até ocorrer outro gatilho, como remontagem ou foco da janela.

###############

Bug 1347

Sintoma: Uma solicitação de coleta feita pelo portal pode gravar destinatário e observações arbitrariamente grandes ou compostos apenas por espaços, inflando armazenamento, tráfego e renderização de todas as listagens que carregam o histórico completo.
Provável causa: O formulário de `PortalPickups` não define `maxLength` nem normaliza os dois textos, `request_client_pickup` os insere sem `btrim` ou limite, e as colunas `recipient_name`/`notes` são `text` sem restrição no banco.

###############

Bug 1348

Sintoma: Um título financeiro vencido e ainda não quitado pode continuar aparecendo no portal como “Pendente” ou “Em aberto”, sem indicação de atraso; o rótulo “Vencido” depende de um estado materializado que o fluxo normal de recebíveis não atualiza com a passagem do tempo.
Provável causa: `private.portal_read_financial_titles` devolve e filtra diretamente `receivables.status`, e `PortalTitles` traduz `overdue` sem comparar `due_date` com a data atual. Outros leitores financeiros tratam vencimento como condição derivada (`status` aberto + `due_date < today`), mas o leitor do portal não reproduz essa regra nem mantém o estado automaticamente.

###############

Bug 1349

Sintoma: O teste `OperationsCenterFailureStates.test.tsx` falha no contrato de contagens exatas mesmo com a Central de Operações obtendo corretamente as contagens de cargas pelo RPC dedicado `get_operations_load_counts_v1`.
Provável causa: A asserção lê o texto-fonte de `OperationsCenter.tsx` e ainda exige o padrão antigo `.select('id', { count: 'exact', head: true }) ... cargas ativas`. A implementação migrou essa contagem para um RPC agregado e valida `active_count`, `in_transit_count` e `delayed_count` com `requireExactCount`, mas o teste baseado em expressão regular não foi atualizado para o novo contrato.

###############

Bug 1350

Sintoma: Uma única posição de frota com latitude/longitude não finita ou fora dos limites geográficos pode quebrar o mapa inteiro da Central de Operações, em vez de isolar o veículo inválido e manter os demais marcadores visíveis.
Provável causa: `fetchFleetPositionPages` devolve `positions_last` sem validar coordenadas, e `OperationsCenter` considera válida qualquer dupla apenas não nula antes de repassá-la ao `MapContainer`, `MapAutoFit` e `Marker`. As colunas `positions_last.lat/lng` não têm `CHECK` de faixa/finidade no banco, enquanto o leitor não aplica `Number.isFinite`, `[-90,90]` e `[-180,180]` antes de renderizar no Leaflet.

###############

Bug 1351

Sintoma: Ao substituir um canhoto, os eventos “Canhoto recebido” e “Canhoto validado” da versão anterior desaparecem retroativamente da Timeline da mercadoria, embora a aba de comprovantes ainda preserve essa versão no histórico.
Provável causa: A timeline de `get_client_portal_shipment_detail_v2` lê PODs somente de `available_delivery_proofs`, view restrita ao comprovante atual ativo em estado `uploaded`/`validated`. As versões aposentadas usadas em `proof_history` nunca participam das duas ramificações de timeline, então a cronologia é reconstruída apenas a partir da versão vigente.

###############

Bug 1352

Sintoma: Uma mercadoria que teve uma ocorrência já resolvida continua exibindo permanentemente o selo vermelho “Ocorrência” no cabeçalho do detalhe, sugerindo uma exceção ativa mesmo quando não existe pendência atual.
Provável causa: `get_client_portal_shipment_detail_v2` devolve em `occurrences` todo evento visível ligado à nota, sem limitar a estados não resolvidos, e `PortalShipmentDetail` mostra o badge destrutivo sempre que `data.occurrences.length > 0`. O componente não diferencia histórico resolvido de ocorrência aberta.

###############

Bug 1353

Sintoma: A suíte `financeLegacyCutCorrectionIntegration.test.ts` falha antes de validar a correção e a reutilização de um recebimento, rejeitando o retorno real de `get_finance_legacy_cut_review` por ausência de paginação e por receber arrays onde o contrato atual exige resumos de evidência.
Provável causa: O banco efêmero do teste instala somente `20260910151011_finance_legacy_integrity_inventory.sql` e `20260910163116_finance_legacy_cut_reviews.sql`, mas analisa o resultado com `legacyCutReviewSchema`, já atualizado para o formato introduzido por `20260917075247_scope_and_page_legacy_cut_manifest.sql`. Como essa migração não é aplicada pela fixture, faltam `page`, `sources_has_more`, contadores e `movement_voids`, e `manifest.evidence` ainda contém arrays completos em vez de objetos `{ count, revision }`.

###############

Bug 1354

Sintoma: Clicar em “Abrir ocorrência” no detalhe de uma mercadoria não abre uma ocorrência vinculada àquela entrega; após o cadastro, o novo registro pode não aparecer na própria aba de ocorrências da NF nem em sua timeline.
Provável causa: `PortalShipmentDetail` navega apenas para `/portal/occurrences`, sem transportar `documentId`, cliente ou carga. O formulário de `PortalOccurrences` cadastra somente `client_id`, tipo, gravidade e descrição, embora `useCreatePortalOccurrence` aceite `load_id`/`order_id`; assim, `_load_id` e `_order_id` chegam nulos a `create_client_occurrence`, e a API nem oferece `fiscal_document_id`. Já o detalhe da mercadoria só inclui ocorrências ligadas à NF, à parada ou à carga, descartando o registro genérico recém-criado.

###############

Bug 1355

Sintoma: Uma posição de veículo com latitude ou longitude fora dos limites geográficos pode derrubar o mapa de Tracking do portal para o cliente, ocultando também as demais cargas que possuem coordenadas válidas.
Provável causa: `get_client_portal_tracking` repassa `positions_last.lat/lng` sem validação; `usePortalTracking` normaliza apenas `speed`, e tanto `PortalTracking` quanto `PortalTrackingMap` aceitam qualquer valor cujo tipo seja `number`. A dupla é enviada diretamente a `MapContainer`, `MapAutoFit` e `Marker`, embora `positions_last` não possua `CHECK` que limite latitude a `[-90, 90]` e longitude a `[-180, 180]`.

###############

Bug 1356

Sintoma: Os relatórios “Ocorrências por tipo” e “Ranking de cidades” do portal podem omitir categorias e cidades válidas sem qualquer aviso; os CSVs exportados repetem o subconjunto incompleto como se fosse o relatório integral.
Provável causa: `get_client_portal_reports_summary_v2` aplica `LIMIT 20` a `occ_by_type` e `LIMIT 15` a `top_cities`, mas não devolve total, flag de truncamento nem categoria “outros”. `PortalReports` apresenta os arrays como se fossem completos e `downloadCsv` exporta somente essas linhas já cortadas.

###############

Bug 1357

Sintoma: Os 14 cenários de `financeLegacyCutReviews.test.ts` falham antes de testar aprovação, invalidação, bloqueios, vínculos ou estornos do corte legado, todos rejeitando o manifesto retornado por falta dos campos paginados atuais.
Provável causa: A preparação do arquivo usa `createLegacyIntegrityDatabase` e instala `20260910163116_finance_legacy_cut_reviews.sql`, mas nunca aplica `20260917075247_scope_and_page_legacy_cut_manifest.sql`. Mesmo assim, `preview` analisa toda resposta com o `legacyCutReviewSchema` atual, que exige `page`, `page_size`, flags/contadores, evidências resumidas e `movement_voids`; a fixture continua devolvendo o contrato antigo com arrays integrais.

###############

Bug 1358

Sintoma: Seis suítes de correção de movimentos (`financeMovementCorrectionContext`, `manualMovementVoidCommand`, `movementCorrectionPreview`, `publicManualMovementVoid`, `expenseReceiptArtifactDatabase` e `uploadQuarantineDatabase`) abortam ainda no `beforeAll` com `finance_movement_correction_installation_incomplete`; todos os 46 cenários ficam ignorados, e duas delas ainda geram erro secundário ao tentar fechar um banco que nunca foi criado.
Provável causa: `createMovementCorrectionContextDatabase` parte de `createVoidAwareMonetaryProofDatabase`, que já aplica `20260917075247_scope_and_page_legacy_cut_manifest.sql` e transforma `finance_private.legacy_cut_manifest` em um wrapper para `legacy_cut_manifest_page`. Depois a fixture reinstala `20260910190516_finance_movement_correction_context.sql`, cuja readiness antiga exige encontrar o texto literal `finance_movement_voids` diretamente na definição de `legacy_cut_manifest`; o wrapper atual não contém esse token, embora o núcleo continue tratando os voids, e o preflight derruba toda a preparação.

###############

Bug 1359

Sintoma: Os nove cenários de `financeLegacyCutSettlementMapping.test.ts` não conseguem validar vínculos de acerto, estornos, divergências, capacidade compartilhada ou isolamento por tenant; a primeira leitura aborta com `ZodError` porque o manifesto não possui a paginação atual e ainda devolve todas as evidências como arrays.
Provável causa: A suíte cria o banco diretamente por `createClosedPeriodLateCompositionDatabase`, cujo encadeamento termina no manifesto legado completo e não aplica `20260917075247_scope_and_page_legacy_cut_manifest.sql`. O helper `read` já analisa a resposta com o `legacyCutReviewSchema` atual, que exige `page`, `page_size`, contadores/flags, evidências resumidas, `integrity_count` e `movement_voids`; assim o fixture e o contrato consumido ficaram em versões diferentes.

###############

Bug 1360

Sintoma: A geração automática de CT-e para uma carga com muitas NF-es pode ignorar o cliente/grupo pagador correto e calcular o frete por uma tabela genérica ou pelo destino de outra nota, mesmo usando o valor total de todas as NF-es.
Provável causa: `useGenerateCTE` soma `value` de todas as notas da carga, mas faz uma segunda consulta de contexto com `.limit(50)`, sem ordenação, e escolhe a primeira linha que possua `client_id` (ou simplesmente a primeira). Um cliente presente somente depois desse corte nunca alimenta `calculateFreight`; além disso, cargas com destinatários diferentes herdam cidade e UF de uma linha arbitrária do lote parcial.

###############

Bug 1361

Sintoma: Depois de 200 relatórios de ocorrências gerados, os registros mais antigos desaparecem da aba “Histórico”; se algum deles ainda não foi enviado, o operador perde inclusive a única ação visual para marcá-lo como enviado.
Provável causa: `useReportExports` ordena `occurrence_report_exports` por criação e aplica `.limit(200)`. `OccurrenceReports` renderiza esse lote como o histórico completo, sem total, aviso de truncamento, busca, paginação ou cursor, e o botão “Marcar enviado” existe somente nessas linhas carregadas.

###############

Bug 1362

Sintoma: O CT-e automático criado pelo detalhe da carga pode gravar no campo de destinatário uma cidade/descrição de rota — ou literalmente “Destino não informado” — em vez da razão social do destinatário existente na NF-e de origem.
Provável causa: `useGenerateCTE` seleciona `recipient` nas NF-es de referência, mas nunca usa esse valor no `insert` de `fiscal_documents`; o payload define `recipient: load.destination || 'Destino não informado'`. `loads.destination` é o destino logístico exibido como rota (`origem → destino`), enquanto `refDoc.recipient` contém a identidade fiscal que foi descartada.

###############

Bug 1363

Sintoma: O CT-e automático do detalhe da carga é salvo sem CNPJ/CPF do destinatário, embora a NF-e usada como origem possua esse documento; consultas, portal, relatórios e preparação de MDF-e passam a tratar o destinatário como não identificado ou deixam de resolver seu cadastro/endereço.
Provável causa: A consulta de referência de `useGenerateCTE` nem seleciona `recipient_cnpj`, e o `insertPayload` não preenche esse campo. Em contraste, `useAuthorizedCteList` depende de `recipient_cnpj` para localizar o cliente destinatário e seus dados, e os demais leitores exibem ou compõem identidades fiscais diretamente a partir dessa coluna.

###############

Bug 1364

Sintoma: É possível “Confirmar e Gerar CT-e” sem nenhum emitente ativo cadastrado; o sistema anuncia sucesso e cria um documento `confirmed` sem `emitter_id` e sem CNPJ do remetente, que depois não possui identidade fiscal suficiente para emissão e integrações.
Provável causa: Se as duas buscas de emitente de `useGenerateCTE` não retornarem linha, o fluxo não bloqueia a criação. O payload usa o nome do tenant como fallback de `remitter`, grava `emitter_id: null` e `remitter_cnpj: null`, mas ainda define `status: 'confirmed'` e mostra o toast de CT-e gerado.

###############

Bug 1365

Sintoma: Os três cenários de `financeStatementWorkbookArtifactDatabase.test.ts` são ignorados porque a suíte aborta no `beforeAll` com `finance_movement_correction_installation_incomplete`; o teardown ainda produz um segundo erro ao executar `db.close()` sobre `undefined`.
Provável causa: A suíte depende de `createUploadQuarantineDatabase`, que passa pelo mesmo encadeamento incompatível já observado nas fixtures de correção de movimentos: o manifesto paginado atual é instalado antes de um preflight antigo que procura `finance_movement_voids` literalmente no wrapper de `legacy_cut_manifest`. Como a criação do banco falha antes de atribuir `db`, nenhum teste de artefato XLS/XLSX chega a executar e o `afterAll` não é protegido.

###############

Bug 1366

Sintoma: `DriverHomeTracking.test.tsx` falha no cenário de indisponibilidade da posição, exibe também “Falha ao carregar a operação” e gera repetidos avisos de `Maximum update depth exceeded`, em vez de isolar e validar somente o erro de telemetria esperado.
Provável causa: O mock encadeável de `supabase.from` da suíte implementa `select`, `eq`, `not`, `order`, `limit` e `maybeSingle`, mas não implementa `.range`. `DriverHome` passou a carregar todas as cargas por `fetchAllPostgrestPages(...range(from,to))`; a chamada inexistente quebra `driver_my_loads` e cria um segundo `role="alert"`. Além disso, os mocks de `useCurrentDriver`/`useActiveTrip` devolvem novos objetos e novas funções a cada render, acionando repetidamente efeitos que persistem snapshots e atualizam estado.

###############

Bug 1367

Sintoma: O mapa inicial do motorista pode lançar erro ou ficar inutilizável ao receber uma parada legada ou posição do veículo com coordenadas não finitas/fora do globo, derrubando justamente a tela usada para iniciar e acompanhar a rota.
Provável causa: `DriverHome` aceita qualquer `latitude`/`longitude` não nulo das paradas, aplica apenas `Number(...)` e faz o mesmo com a telemetria retornada por `useDriverHomeVehiclePosition`; `isFreshPositionObservation` valida somente o horário. `DriverDeliveryMap` envia esses números sem checagem a `MapContainer`, `MapAutoFit`, `Polyline` e `Marker`. As restrições recentes preservam linhas legadas inválidas e não protegem a leitura de posições já gravadas.

###############

Bug 1368

Sintoma: Uma única telemetria com latitude/longitude não finita ou fora do globo pode derrubar o Mapa da Frota inteiro, ocultando inclusive os demais veículos que possuem posição válida.
Provável causa: `list_workspace_fleet_snapshot_v1` repassa `positions_last.lat/lng` sem validar faixa, `useWorkspaceFleetSnapshot` apenas converte o retorno para o tipo esperado e `FleetMap` considera posicionada qualquer linha cujas duas coordenadas sejam diferentes de `null`. Esses valores alimentam diretamente o centro, `MapAutoFit` e todos os `Marker` do Leaflet; `positions_last` não possui `CHECK` geográfico que proteja leitores de dados legados ou gravados por caminhos privilegiados.

###############

Bug 1369

Sintoma: Uma posição inválida de qualquer veículo pode tornar indisponível o mapa da tela de Geofences, impedindo visualizar ao mesmo tempo as cercas válidas e os demais veículos monitorados.
Provável causa: `Geofences` filtra as linhas de `useFleetPositions` somente por frescor temporal com `isFreshPositionObservation`, sem verificar finitude ou limites de `lat/lng`, e envia todas elas ao centro do `MapContainer` e aos `CircleMarker`. O leitor comum `fetchFleetPositionPages` também devolve `positions_last` sem saneamento e a tabela não impõe limites geográficos às coordenadas.

###############

Bug 1370

Sintoma: Abrir a visão geral ou o histórico no Detalhe do Veículo pode quebrar o mapa quando a última posição ou qualquer ponto bruto do período contém coordenadas não finitas/fora dos limites geográficos; um único ponto corrompido também impede visualizar o restante do trajeto válido.
Provável causa: `useVehiclePosition` entrega a linha de `positions_last` sem validação e `list_vehicle_position_history_v1` devolve `positions_raw.lat/lng` diretamente. `VehicleDetails` usa esses valores como centro, marcador, `Polyline` e `CircleMarker` sem filtrar `Number.isFinite` nem as faixas de latitude/longitude, enquanto ambas as tabelas de telemetria carecem de `CHECK` geográfico.

###############

Bug 1371

Sintoma: Sem posições recentes da frota, uma geofence válida localizada exatamente na latitude 0 ou longitude 0 abre o mapa com zoom local no ponto padrão do Brasil; a cerca fica fora da área visível e aparenta não ter sido desenhada.
Provável causa: `Geofences` encontra corretamente a primeira cerca habilitada com coordenadas, mas monta o centro como `Number(center_lat) || -14.235` e `Number(center_lng) || -51.9253`. Como zero é falsy em JavaScript, qualquer eixo igual a `0` é substituído pelo fallback, apesar de ser uma coordenada válida aceita por `geofences_center_check`; o zoom permanece em 14 e não há ajuste de limites para recuperar o círculo distante.

###############

Bug 1372

Sintoma: Definir “0” no tempo de serviço de uma parada faz o planejamento prever 20 minutos de atendimento e deslocar a saída e todas as chegadas seguintes, embora o valor zero continue aceito e possa ser gravado como duração da parada.
Provável causa: `StopDraftTable` permite `min={0}` e preserva zero, e `dispatch_planned_route_v3` também valida apenas que `service_time_minutes` não seja negativo. Porém `simulateStopTimeline` calcula `Math.max(0, Number(s.service_time_minutes) || 20)`, tratando o zero legítimo como ausência e usando 20. Assim os timestamps simulados/persistidos podem contradizer o próprio `service_time_minutes = 0` salvo na mesma parada.

###############

Bug 1373

Sintoma: O único cenário de `receivableAdjustmentDialog.test.tsx` falha de forma isolada e na bateria global porque nunca encontra o campo “Motivo”; em seu lugar, o diálogo mostra `permission denied for function get_finance_receivable_installment_position` e mantém a confirmação indisponível.
Provável causa: A suíte simula `readReceivableAdjustment`, histórico e envio, mas não simula o novo `ReceivableInstallmentAllocationFields` nem `readReceivableAgreementPosition`. Ao abrir uma prévia de aplicação, esse subcomponente executa uma chamada real pelo cliente Supabase do teste, recebe a negação de permissão e chama `onChange(null)`. Com `distribution === null`, a condição `fresh` nunca é satisfeita e o formulário que o teste tenta manipular não é renderizado; outras suítes do mesmo fluxo já substituem explicitamente esse subcomponente.

###############

Bug 1374

Sintoma: Uma última posição legada com horário não finito pode derrubar a visão geral e a aba de telemetria do Detalhe do Veículo, em vez de apenas mostrar que a data de captura está indisponível.
Provável causa: `resolvePositionTelemetry` rejeita corretamente um `captured_at` que não possa ser convertido em instante, mas `VehicleDetails` continua usando a existência de `positionLast` como prova de validade e chama `format`/`formatDistanceToNow` sobre `new Date(positionLast.captured_at)` em três pontos. `positions_last.captured_at` é `timestamptz NOT NULL`, porém não possui `CHECK (isfinite(captured_at))`; portanto valores PostgreSQL como `infinity` gravados por dados legados ou caminhos privilegiados chegam ao frontend como data inválida e fazem o date-fns lançar `RangeError`.

###############

Bug 1375

Sintoma: Em períodos com mais de 1.000 combinações diárias de veículo, os KPIs, os dois gráficos, o ranking e o CSV da tela Relatórios somam apenas uma parte da operação, sem indicar que existem linhas omitidas.
Provável causa: A consulta `reports_metrics` faz um único `select` em `metrics_daily`, sem paginação, contagem ou sondagem de truncamento, e todos os agregados de `Reports` tratam o primeiro lote devolvido pela API como o conjunto completo do período.

###############

Bug 1376

Sintoma: Uma falha ao consultar `metrics_daily` aparece na tela Relatórios como KPIs zerados, gráficos “Sem dados”, ranking vazio e exportação desabilitada, fazendo uma indisponibilidade do banco parecer um período operacional sem atividade.
Provável causa: `Reports` lê somente `data` e `isLoading` de `useQuery`; quando a promise rejeita, `data` recebe o padrão `[]` e nenhum estado `isError`/`error` é renderizado. O mesmo array vazio alimenta totais, gráficos, tabela e botão de CSV tanto para uma resposta legitimamente vazia quanto para uma consulta malsucedida.

###############

Bug 1377

Sintoma: Ao abrir Relatórios sem filtros, a descrição promete os últimos sete dias, mas a consulta inclui oito datas civis; depois das 21h em São Paulo, tanto o início quanto o fim ainda podem avançar um dia e incluir amanhã enquanto excluem o dia mais antigo esperado.
Provável causa: O padrão subtrai sete dias de `new Date()` e usa limites inclusivos `gte`/`lte`, resultando em hoje mais sete dias anteriores. Em seguida, converte ambos os instantes com `toISOString()` antes de extrair o dia por `calendarDay`; a conversão para UTC troca a data civil brasileira no fim da noite, embora o filtro seja um campo `date` sem horário.

###############

Bug 1378

Sintoma: Os indicadores “Paletes/Viagem” do Relatório de Produtividade podem mostrar uma média menor que a ocupação real quando uma mesma viagem transporta duas ou mais cargas; o valor por motorista sofre a mesma distorção apesar do rótulo afirmar que a unidade é viagem.
Provável causa: O KPI geral soma os paletes e divide pela quantidade de cargas com paletes, enquanto `driverMetrics.avgPallets` divide os paletes pelo total de cargas do motorista. Nenhum dos cálculos agrupa por `trip_id`, embora múltiplas cargas possam pertencer ao mesmo despacho e a própria tabela de eficiência já use um conjunto de viagens únicas.

###############

Bug 1379

Sintoma: O Relatório de Produtividade pode exibir taxa de sucesso de 100% para a empresa ou para um motorista que, no mesmo período, também teve cargas recusadas, devolvidas, com falha ou entrega parcial.
Provável causa: O denominador da taxa inclui exclusivamente cargas em `delivered` e `divergent`; estados terminais malsucedidos reconhecidos pelo catálogo canônico — `partial_delivery`, `returned`, `refused` e `failed` — não contam nem como sucesso nem como insucesso. Assim eles desaparecem da amostra e não reduzem o percentual apresentado.

###############

Bug 1380

Sintoma: A bateria global pode falhar em `financeVoidAwareMonetaryProofs.test.ts` com `UNKNOWN: unknown error, open ...finance-void-aware-monetary-proofs-effective-2026-09-10.json`; mesmo quando passa isoladamente, executar a suíte modifica um artefato rastreado e deixa a árvore de trabalho suja.
Provável causa: O cenário “exports effective installed proof definitions and hashes” chama `writeFileSync` incondicionalmente sobre um caminho fixo dentro de `docs/qa`, sem flag explícita de captura, arquivo temporário ou escrita atômica. O conteúdo depende das definições efetivamente instaladas pela fixture, portanto uma execução normal sobrescreve o snapshot versionado; na bateria concorrente do Windows, o acesso direto ao mesmo destino também fica sujeito a falha transitória de abertura.

###############

Bug 1381

Sintoma: O cartão “Cargas Ativas” do Painel Operacional inclui cargas devolvidas, recusadas, com falha e encerradas por entrega parcial, inflando o trabalho corrente mesmo quando esses registros já chegaram a estados terminais.
Provável causa: `OperationsDashboard` considera ativa qualquer carga cujo status não seja `delivered`, `divergent` ou `cancelled`. A lista canônica de estados terminais também contém `partial_delivery`, `returned`, `refused` e `failed`, mas a tela mantém todos eles em `activeLoads`.

###############

Bug 1382

Sintoma: “Sucesso Entrega” no Painel Operacional mostra 100% quando ainda não existe nenhuma carga finalizada e também pode permanecer em 100% apesar de haver devoluções, recusas, falhas ou entregas parciais no histórico.
Provável causa: O cálculo usa somente `delivered` e `divergent` como universo concluído e define explicitamente `100` quando esse denominador é zero. Os demais estados terminais malsucedidos não entram na amostra, e ausência de evidência é apresentada como sucesso perfeito.

###############

Bug 1383

Sintoma: Falhas ao carregar qualquer uma das fontes do Painel Operacional podem aparecer como cartões zerados, gráficos “Sem pedidos/estoque”, mensagens positivas como “Nenhuma ocorrência aberta 🎉” ou tabelas parciais compostas com as outras fontes, sem indicação de indisponibilidade.
Provável causa: `OperationsDashboard` extrai apenas `data` de oito hooks — pedidos, cargas, saldos, veículos, ocorrências, funcionários, manutenções e estoque — e substitui cada falha por `[]`. Nenhum `isError`, `error`, estado de leitura parcial ou ação de nova tentativa é observado antes de calcular e renderizar os indicadores.

###############

Bug 1384

Sintoma: Um veículo carregado acima da capacidade aparece com exatamente 100% de ocupação no Painel Operacional, ocultando a magnitude e até a existência da sobrecarga; por exemplo, 30 paletes em capacidade 20 são exibidos como 100%, não 150%.
Provável causa: `vehicleOccupancy` soma corretamente os paletes das cargas atuais, mas envolve o percentual em `Math.min(100, ...)`. A barra e o texto recebem somente o valor já truncado, impossibilitando diferenciar lotação exata de qualquer excesso.

###############

Bug 1385

Sintoma: Ao navegar pelas páginas da Aprovação de Despesas enquanto outra sessão aprova, rejeita ou cria gastos, o operador pode pular uma despesa ou ver outra repetida; a atualização em tempo real não preserva um retrato consistente da lista.
Provável causa: `list_driver_expenses_for_review` ordena por `expense_at/id` e pagina com `LIMIT 50 OFFSET`, mas não recebe cursor, instante de corte nem revisão do conjunto. `useExpenseReviewList` invalida as consultas quando `driver_expenses` muda e refaz a página mantendo o mesmo `offset`; como uma revisão move a linha entre “Pendentes” e “Revisadas”, todas as posições seguintes se deslocam entre chamadas.

###############

Bug 1386

Sintoma: Ao paginar “Recebíveis fiscais”, observações podem ser puladas ou repetidas enquanto o worker processa a fila; o polling também pode deixar uma página vazia e exibir, por exemplo, “Página 5 de 4” depois que itens saem do filtro atual.
Provável causa: `finance_private.list_fiscal_queue` ordena por `observed_order` e aplica `LIMIT 30 OFFSET`, sem cursor, revisão ou snapshot. `FinanceFiscalQueue` refaz automaticamente a mesma página a cada 30 segundos, mas não a reduz quando `total` encolhe; transições concorrentes entre `pending`, `review`, `applied` e `superseded` mudam as posições e a quantidade de páginas entre leituras.

###############

Bug 1387

Sintoma: A data de emissão das notas na tela de Faturamento e no XML “Exportar XML” pode aparecer um dia anterior ao valor gravado; uma nota com `issue_date = 2026-09-17`, por exemplo, é exibida/exportada como 16/09/2026 em navegadores no horário de Brasília.
Provável causa: `fiscal_documents.issue_date` é uma coluna `date`, devolvida como `AAAA-MM-DD`, mas `BillingPage` executa `new Date(d.issue_date)` antes de chamar `format`. JavaScript interpreta esse formato sem horário como meia-noite UTC, que corresponde às 21h do dia civil anterior em `America/Sao_Paulo`; o mesmo helper incorreto é usado na tabela e na tag `<Emissao>` do arquivo.

###############

Bug 1388

Sintoma: Trocar de empresa com a tela de Faturamento aberta pode manter filtros e cargas selecionadas da empresa anterior, ignorar a preferência já salva para a nova empresa e, após 600 ms, sobrescrever essa preferência com os valores do tenant antigo.
Provável causa: A chave de `useUserUiPreference` inclui `currentTenant.id`, mas `hydratedRef` é marcado uma única vez e nunca volta a `false` quando `prefKey` muda. Os estados locais também não são reinicializados na troca; quando a consulta da nova chave termina, a hidratação é pulada e o efeito de auto-save, agora ligado ao novo `savePreference`, persiste os estados remanescentes sob a chave da nova empresa.

###############

Bug 1389

Sintoma: `npx vitest run src/test/supabaseBaselineContract.test.ts` falha sempre no contrato “keeps the complete driver-monitoring aggregate tenant-safe”, apesar de o hook continuar filtrando as consultas pelo locatário atual.
Provável causa: A asserção em `supabaseBaselineContract.test.ts:590` procura literalmente `.eq('tenant_id', tenantId)`, mas `useDriverMonitoring.tsx` passou a usar a expressão equivalente `.eq('tenant_id', currentTenant!.id)`; o teste valida a grafia de uma variável local, não o comportamento de isolamento.

###############

Bug 1390

Sintoma: Diversas suítes que reutilizam a cadeia de entrega/financeiro — entre elas `customerCreditApplication`, `financeInvoiceCompanyBoundary`, `financeFreshReceivableDelegation`, `fiscalDashboardSummary`, `operationCorrectionFinanceFrontendDatabase`, `financeLoadPaymentInternalRelease`, `customerCreditPublicCatalog` e `financeReceiptCorrectionInvoiceLifecycleCompatibility` — abortam antes de testar a regra de negócio com `relation "current_load_items" already exists`; as duas primeiras falham inclusive isoladas em 6/6 cenários cada.
Provável causa: A cadeia de banco de teste passa por `installCompositionFixture`, que cria `public.current_load_items` como view sintética, e depois por `createDeliveryAttemptDatabase`, que executa integralmente `20260830135338_introduce_delivery_attempt_allocations.sql`; essa migração usa `create view public.current_load_items` sem remover ou substituir a view já instalada, abortando toda criação da fixture.

###############

Bug 1391

Sintoma: `npx vitest run src/test/operationalRouteDeleteDatabase.test.ts` aprova o primeiro cenário, mas os dois seguintes falham durante o `beforeEach` com `duplicate key value violates unique constraint "loads_pkey"`, sem exercitar a exclusão de rota que deveriam validar.
Provável causa: O `beforeEach` trunca apenas `operational_routes` e `tenant_memberships`, porém chama `seedOperatorReferencePagination` em todos os testes; esse seed também insere cargas, clientes, motoristas e veículos com IDs fixos, que permanecem da execução anterior e colidem já na segunda preparação.

###############

Bug 1392

Sintoma: Trocar a empresa ativa com “Registrar adiantamento” aberto mantém o funcionário selecionado, valor, data, motivo, método e referência da empresa anterior; a lista de funcionários passa a ser a da empresa nova, mas “Registrar” ainda tenta enviar o ID antigo nesse novo contexto e termina recusado ou com uma combinação incoerente.
Provável causa: `Payroll` mantém `RegisterAdvanceDialog` montado sem uma `key` ligada ao tenant, e os estados locais do formulário não são limpos quando `currentTenant.id` muda. `useEmployeeAdvanceRegistration` e `useEmployees` adotam o novo tenant, enquanto `employeeId` e os demais campos continuam capturados no componente existente.

###############

Bug 1393

Sintoma: Uma falha ao consultar os períodos da folha torna também a aba de adiantamentos, o cadastro de novo adiantamento e suas ações totalmente inacessíveis, embora esse módulo use consultas próprias e não dependa de haver períodos carregados; resta apenas a mensagem “Não foi possível conferir os períodos da folha”, sem tentativa de recarregar.
Provável causa: `Payroll` executa `if (periodError) return ...` antes de renderizar o cabeçalho, as abas, `AdvancesTable` e `RegisterAdvanceDialog`. Assim, o erro de `usePayrollPeriods` interrompe toda a página em vez de ficar restrito ao conteúdo da aba “Períodos”, e o retorno antecipado também omite um botão de `refetch`.

###############

Bug 1394

Sintoma: Abrir uma folha com muitos funcionários fica progressivamente pesado e, a cada atualização automática de 30 segundos, recalcula e transfere novamente todas as entradas, títulos e pagamentos, embora a tabela mostre apenas 50 funcionários por página.
Provável causa: `get_finance_payroll_entries` chama `payroll_payment_projection`, que monta `entries`, agrega títulos/pagamentos e executa `jsonb_agg` de toda a folha sem cursor nem limite. `usePayrollEntries` recebe o array completo e `PeriodEntriesContent` implementa a paginação somente no navegador com `filtered.slice(...)`; o `refetchInterval` repete o trabalho integral.

###############

Bug 1395

Sintoma: Trocar a empresa ativa na página “Financeiro” mantém o cliente e o centro de custo escolhidos na empresa anterior; os cards de carteira, fiscal e custos passam a consultar o novo tenant com IDs que não pertencem a ele e podem aparentar não ter dados, enquanto painéis sem esses filtros já exibem informações da empresa nova.
Provável causa: Os estados `draft` e `filters` de `Financial` são inicializados uma vez e não são reinicializados nem chaveados por `currentTenant.id`. `useClients`, `useCostCenters` e todas as consultas adotam o tenant novo, mas `filters.client` e `filters.costCenter` preservam os identificadores da empresa anterior, produzindo um contexto visual híbrido.

###############

Bug 1396

Sintoma: Os períodos rápidos “Últimos 7 dias”, “Últimos 30 dias” e “Últimos 90 dias” da página Financeiro abrangem respectivamente 8, 31 e 91 datas civis, incluindo um dia anterior adicional nos resumos de carteira, custos registrados e documentos fiscais.
Provável causa: `portfolioFilters` define o início subtraindo exatamente 7, 30 ou 90 dias da data atual e mantém hoje como fim; como os limites `from` e `to` são inclusivos, deveria subtrair `N - 1` para que o total de dias correspondesse ao rótulo exibido.

###############

Bug 1397

Sintoma: Ao navegar pelas páginas de “Gastos conferidos”, o registro simultâneo de um novo lote pode repetir um gasto já visto e pular outro; a própria confirmação de lote na tela invalida a consulta mantendo o número da página, reproduzindo o deslocamento a partir da página 2.
Provável causa: `finance_private.list_expenses` ordena os gastos por `occurred_on DESC, created_at DESC, id DESC` e pagina com `LIMIT size OFFSET (page-1)*size`, sem cursor, revisão ou instante de corte. Quando linhas são inseridas antes do offset, `FinanceExpenses` refaz a página numérica sobre uma sequência diferente.

###############

Bug 1398

Sintoma: Consultar até a primeira página de 30 “Gastos conferidos” fica progressivamente lenta conforme cresce o histórico, e avançar entre páginas repete o processamento integral de todos os gastos do filtro em vez de limitar o trabalho às linhas visíveis.
Provável causa: Antes de aplicar `LIMIT/OFFSET`, `finance_private.list_expenses` materializa todo o conjunto e executa por linha `expense_cost_coverage` (duas vezes), `expense_cost_effective`, `effective_cost_amount`, `expense_receipt_count`, soma de alocações e joins financeiros; depois percorre novamente o conjunto completo para totais, categorias e centros de custo. A paginação reduz apenas o array final de linhas, não o custo da consulta.

###############

Bug 1399

Sintoma: Ao registrar uma nova movimentação enquanto consulta uma página posterior de “Movimentações registradas”, a atualização pode repetir uma linha já vista e pular outra, pois o número da página é mantido embora a nova entrada tenha deslocado a ordenação.
Provável causa: `finance_private.list_movements` ordena por `occurred_on DESC, created_at DESC, id` e aplica `LIMIT size OFFSET (page-1)*size`, sem cursor, snapshot ou revisão. `MovementWorkspace` invalida `finance-movements` após registrar uma movimentação, mas não redefine `filters.page`, refazendo o mesmo offset sobre um conjunto diferente.

###############

Bug 1400

Sintoma: Ao avançar pelas páginas de “Contas a Receber” enquanto um novo título é criado, um título pode aparecer novamente na página seguinte ou ser pulado na navegação.
Provável causa: `finance_private.receivables_page_by_origin` ordena os candidatos por `created_at DESC, id DESC`, mas pagina por `LIMIT 50 OFFSET ((_page - 1) * 50)` sem cursor nem revisão estável. A inserção de um título no início do conjunto entre duas requisições desloca a fronteira das páginas.

###############

Bug 1401

Sintoma: A suíte `financeAccountCache.test.tsx` falha isoladamente em dois dos três cenários por timeout, sem chegar a validar que a lista de contas ativas é separada por usuário nem que a invalidação refaz a consulta.
Provável causa: `useFinancialPayments.useBankAccounts` passou a encadear `.order('name').order('id').range(...)` para paginação completa, mas o mock Supabase do teste encerra a cadeia na primeira chamada de `order` e devolve imediatamente a promessa de `mock.read`; a segunda chamada de `order` é inexistente e a query termina em erro, deixando `isSuccess` permanentemente falso.

###############

Bug 1402

Sintoma: Abrir até a primeira página de “Contas a Receber” fica progressivamente lento e pode exceder memória ou tempo de consulta conforme cresce a carteira, embora a interface mostre no máximo 50 títulos.
Provável causa: Antes de aplicar o `LIMIT`, `finance_private.receivables_page_by_origin` materializa todos os recebíveis da empresa e classifica cada linha com consultas correlacionadas a `finance_unloading_charges` e `finance_fiscal_receivable_origins`; em seguida materializa novamente todos os candidatos filtrados e conta o conjunto completo. A paginação reduz apenas o JSON final, não o volume classificado e mantido em memória pelo banco.

###############

Bug 1403

Sintoma: Ao importar um novo extrato enquanto está numa página posterior de “Extratos importados”, a atualização pode repetir um arquivo já visto e pular outro, pois a tela mantém o número da página mesmo após inserir o novo registro no início da lista.
Provável causa: `finance_private.list_statements_original` ordena por `created_at DESC, id DESC` e pagina com `LIMIT size OFFSET (page - 1) * size`, sem cursor, snapshot ou revisão. `StatementWorkspace.onImported` invalida a consulta, mas não redefine `filters.page`, refazendo o mesmo deslocamento sobre um conjunto que acabou de mudar.

###############

Bug 1404

Sintoma: Abrir até a primeira página de “Extratos importados” fica progressivamente lento e pode exceder memória ou tempo de consulta conforme crescem os arquivos e suas linhas, embora a interface mostre apenas 20 extratos.
Provável causa: Antes do `LIMIT`, `finance_private.list_statements_original` materializa todos os imports do filtro e, para cada um, agrega por classificação e conta linhas com pendência, além de buscar a última verificação; só depois pagina o resultado. O wrapper atual ainda executa outras duas contagens correlacionadas para cada linha devolvida. A paginação limita a resposta, mas não o processamento integral que a precede.

###############

Bug 1405

Sintoma: A suíte `clientInvoiceCreditSettlementLabels.test.tsx` falha isoladamente nos dois cenários antes de validar os rótulos e a autorização de cancelamento, lançando `Cannot read properties of undefined (reading 'data')` ao renderizar o diálogo.
Provável causa: `ClientInvoiceLifecycleDialog` passou a renderizar o histórico completo por `api.history.data`, mas o mock de `useClientInvoiceLifecycle` dessa suíte ainda devolve apenas `query`, `submit` e estados da operação, sem a propriedade `history`. O componente acessa o contrato novo imediatamente e a renderização de teste aborta.

###############

Bug 1406

Sintoma: Depois que uma conta bancária é desativada, ela desaparece dos seletores de “Extratos importados” e “Histórico anterior”; seus registros continuam visíveis quando todas as contas são consultadas, mas não é mais possível filtrar nem abrir diretamente o histórico específico dessa conta encerrada.
Provável causa: `FinanceStatements` e `LegacyBankReconciliation` alimentam seus seletores com `useFinancialPayments.useBankAccounts`, cuja consulta aplica obrigatoriamente `.eq('active', true)`. Uma consulta adequada para operações novas é reutilizada como diretório histórico, excluindo contas inativas que ainda possuem extratos, transações e conciliações preservados.

###############

Bug 1407

Sintoma: Ao reverter uma devolução de crédito de cliente, a página abre um prompt nativo e bloqueante do navegador em vez do diálogo acessível da aplicação; informar menos de cinco caracteres ou cancelar fecha a interação sem explicar a validação. A suíte `appDialog.test.ts` também falha ao detectar esse uso proibido.
Provável causa: `CustomerCreditRefundPanel.reverseLink` chama diretamente `window.prompt('Motivo da reversão (mínimo 5 caracteres)')` e apenas retorna silenciosamente quando o texto normalizado é curto. Esse caminho não usa o serviço compartilhado de diálogos nem mantém estado de erro e foco dentro do React.

###############

Bug 1408

Sintoma: A suíte `routeMatcher.test.ts` falha isoladamente em dois de oito cenários: ainda espera que uma cidade ambígua escolha arbitrariamente a rota de menor nome e que “Porto Velho” seja associado por aproximação ao destino “Velho”.
Provável causa: `matchOperationalRoute` agora aceita somente correspondência exata normalizada e devolve `matched: null` quando há zero ou mais de um candidato, mas o teste e seu comentário ainda descrevem a implementação anterior, que escolhia um candidato em ambiguidades e fazia fallback fuzzy por palavra.

###############

Bug 1409

Sintoma: A suíte `freightCalculator.test.ts` falha isoladamente em três de seis cenários porque ainda exige que tabelas restritas a grupo pagador ou pagador permaneçam elegíveis quando o cálculo não informa esses dados.
Provável causa: `computeSpecificity` agora trata qualquer critério preenchido na tabela sem valor correspondente no input como incompatibilidade de `-100`, evitando aplicar uma tarifa específica a um pagador desconhecido; os testes preservam o contrato anterior de “soft matching”, procuram até uma mensagem “não desqualifica” que não é mais produzida e esperam pontuação não negativa.

###############

Bug 1410

Sintoma: A suíte `productionConfiguration.test.ts` falha no contrato “keeps high-volume registries paginated at the database boundary”, embora a listagem fiscal continue paginada e agora possua cursor e revisão estável.
Provável causa: O teste ainda procura literalmente `.range(from, from + pageSize - 1)` em `useFiscalDocuments.tsx`, mas `useFiscalDocumentsPage` migrou para a RPC `get_fiscal_documents_page_v1` com cursor composto, `page_limit` e `expected_revision`. A asserção textual não foi atualizada para o contrato mais novo.

###############

Bug 1411

Sintoma: A suíte `ssxFiscalRecoveryContract.test.ts` falha no cenário “polls only transient NFS-e states” porque exige que documentos NFS-e ainda em rascunho sejam consultados periodicamente no provedor.
Provável causa: O teste reutiliza para CT-e e NFS-e a mesma lista literal de estados transitórios, incluindo `draft`, mas `nfse-status-poll` exclui deliberadamente o rascunho local de `PENDING` e só consulta estados já submetidos ou com resultado remoto incerto. A expectativa comum não acompanha a diferença de ciclo de vida entre os dois documentos.

###############

Bug 1412

Sintoma: A suíte `legacyCutProjectionContract.test.ts` falha isoladamente nos três cenários; até exemplos que deveriam ser válidos são rejeitados pelo schema antes de testar as regras de evidência incompleta, unicidade de pagamentos ou aliases bancários.
Provável causa: O helper `review` ainda fabrica o manifesto antigo, com `evidence` contendo arrays e sem `page`, `page_size`, indicadores `sources_has_more`/`blockers_has_more`, resumos de evidência, contagens de integridade e `movement_voids`. `legacyCutManifestSchema` tornou esses campos obrigatórios no contrato paginado atual, por isso todas as amostras falham estruturalmente antes das condições que a suíte pretende exercitar.

###############

Bug 1413

Sintoma: `npm run typecheck` falha em `employeeAdvanceCorruptRecovery.test.tsx` ao passar `advancePaymentPreview()` para `EmployeeAdvancePaymentConfirmation`, informando que `version: number` não pode ser usado onde o contrato exige o literal `version: 1`.
Provável causa: O helper `employeeAdvancePaymentFixture.ts` retorna um objeto sem anotação `EmployeeAdvancePaymentPreview` nem preservação literal (`as const`); o TypeScript amplia discriminantes como `version: 1` e `cash_created: false`, tornando a própria fixture incompatível com o componente tipado e bloqueando o typecheck do projeto.

###############

Bug 1414

Sintoma: `npm run lint:critical-types` termina com código 1 e impede a checagem agregada do projeto, apesar de o ESLint informar zero erros; são emitidos 21 avisos em páginas incluídas explicitamente nesse gate.
Provável causa: O script executa a lista crítica com `--max-warnings 0`, mas ela contém dependências instáveis de hooks em `BillingEdi`, `CteMonitor`, `Inventory` e `Mdfe`, exports incompatíveis com Fast Refresh em `CteSearch`, `DriverMonitoring` e `NFSe`, além de dois avisos `prefer-const` em `TeamManagement` e `Traceability`. Como o baseline exigido é zero, qualquer execução do gate falha no estado atual.

###############

Bug 1415

Sintoma: `npm run quality:baseline` termina com código 1 e impede a checagem agregada, denunciando seis novos arquivos acima de 500 linhas: `ReceivableAgreementDialog.tsx` (514), `DriverDeliveries.tsx` (502), `DriverHome.tsx` (521), `DriverIssues.tsx` (506), `FiscalDocuments.tsx` (514) e `NFSe.tsx` (511).
Provável causa: Os seis componentes cresceram além do limite estrutural sem serem decompostos nem incluídos no baseline de arquivos legados. Além disso, os três componentes do motorista já possuem tetos críticos explícitos de 499, 497 e 481 linhas em `code-quality-baseline.json`, todos excedidos pelo código atual.

###############

Bug 1416

Sintoma: A auditoria estrutural encontra 131 arquivos TypeScript acima de 300 linhas e 56 acima de 500; componentes manuais como `CteEmissionPreviewDialog.tsx` (2.185), `OperationalEvents.tsx` (2.142), `Ingestion.tsx` (1.719), `BillingPage.tsx` (1.416) e `Traceability.tsx` (1.359) excedem amplamente o tamanho em que uma revisão isolada permanece confiável.
Provável causa: `code-quality-baseline.json` isenta dezenas de arquivos grandes já existentes e só impõe teto individual a uma pequena seleção. Assim, páginas e diálogos continuam concentrando renderização, estado, acesso a dados e regras de negócio no mesmo módulo sem que `quality:baseline` sinalize a dívida estrutural enquanto o arquivo permanecer dentro do valor legado.

###############

Bug 1417

Sintoma: Repetir exportações CSV em Centros de custo ou abandonar um rascunho de entrega com fotos selecionadas pode aumentar continuamente a memória mantida pela aba até seu encerramento.
Provável causa: `LegacyCostCenters.exportReport` cria uma URL com `URL.createObjectURL(blob)` e nunca chama `URL.revokeObjectURL`; `useDriverDeliveryEventDraft` revoga as URLs de prévia somente em `reset`, nova seleção ou remoção individual, mas não possui cleanup de desmontagem para as prévias que ainda estiverem ativas ao sair da tela.

###############

Bug 1418

Sintoma: Filtrar o Resumo de notas importadas por um dia pode omitir notas do início/fim desse dia e incluir registros do dia adjacente quando o navegador estiver em um fuso diferente do calendário operacional da empresa.
Provável causa: `importedNotesFilters.ts` mantém uma implementação própria de `localDayBoundary` baseada em `new Date(day + 'T00:00:00')`, portanto transforma `imported_at`/`created_at` segundo o fuso local do navegador, sem usar o timezone do tenant. Os testes geram os limites e as fixtures no mesmo fuso da máquina, mascarando a divergência entre usuários.

###############

Bug 1419

Sintoma: Uma falha ao avançar o roteamento da ingestão ou o bloqueio do pop-up ao imprimir notas abre um `alert()` nativo e bloqueante, fora do padrão visual e sem a experiência acessível/repetível dos avisos da aplicação.
Provável causa: `RoutingStep.tsx` chama diretamente `alert(\`Erro ao avançar...\`)` no `catch`, e `printLoadNotes.ts` chama `alert('Permita pop-ups...')` quando `window.open` retorna nulo. O contrato automatizado de diálogos procura o uso qualificado de `window.alert`/`window.prompt` e não detecta essas duas chamadas globais sem prefixo.

###############

Bug 1420

Sintoma: `ssxPositionPollRuntime.test.ts` falha em 16 de 17 cenários; respostas que deveriam ser 200, 409 ou 502 viram HTTP 500 com `{"error":"Internal error"}`, impedindo a suíte de validar persistência atômica, quarentena, hashing, rate limit e subdivisão de janelas.
Provável causa: `ssx-poll-positions` passou a paginar `provider_units` com `.order('id').range(from, from + 499)`, mas o builder Supabase criado pelo teste não implementa `order` nem `range`. A exceção ocorre logo na leitura das unidades e é convertida pelo handler no erro genérico antes de todos os cenários válidos.

###############

Bug 1421

Sintoma: Selecionar ou arrastar um lote grande de XML, CSV ou planilhas na etapa inicial de Importação pode congelar ou encerrar a aba por consumo excessivo de memória antes que qualquer validação seja exibida.
Provável causa: `UploadStep` permite múltiplos arquivos sem limite de quantidade ou tamanho, e `Ingestion.handleFiles` chama `Promise.all` sobre toda a seleção, mantendo simultaneamente em `fileBuffers` o texto ou `ArrayBuffer` completo de cada arquivo. O processamento posterior é fatiado em grupos de 50, mas a leitura e a materialização integral já ocorreram sem fila, limite de concorrência ou descarte incremental.

###############

Bug 1422

Sintoma: O seletor “Enviar scan” aceita seis ou mais páginas, ou várias páginas individualmente menores que 3 MB cujo conjunto ultrapassa cerca de 6 MB, converte tudo para base64 e só então a extração de NF-e/ORT é recusada pelo servidor.
Provável causa: `Ingestion.handleOrtFiles` valida apenas o limite binário de 3 MB por arquivo e não reproduz os limites agregados da Edge Function. `extract-ort` aceita no máximo cinco arquivos e no máximo 8 MB de base64 no total, enquanto `UploadStep` mantém `multiple` sem limite e o cliente prepara todos os arquivos em `Promise.all` antes de descobrir a rejeição HTTP 400/413.

###############

Bug 1423

Sintoma: Iniciar outra importação com a mesma quantidade de agrupamentos até quatro horas depois pode restaurar veículos e motoristas escolhidos para um lote diferente; na mesma empresa, as novas cargas podem ser atribuídas silenciosamente aos recursos errados, e após trocar de empresa a execução pode falhar depois de já salvar notas e pedidos.
Provável causa: `GroupingStep` persiste todas as atribuições na chave global `ingestion_grouping_state`, sem tenant, usuário ou identidade do lote. Na montagem, considera o rascunho compatível apenas pela idade e por `suggestionsSnapshot.length === suggestions.length`; não compara regiões, documentos, pedidos nem verifica se os UUIDs restaurados pertencem às listas atuais antes de enviar o mapa por índice a `handleExecute`.

###############

Bug 1424

Sintoma: Na tela de Corredores, a busca promete localizar por “Nome, cerca ou ponto da rota”, mas digitar o nome da cerca vinculada ou o rótulo de um waypoint não retorna a rota; somente o nome do corredor funciona.
Provável causa: A paginação nova removeu o filtro local que chamava `matchesSearch` com `row.name`, `row.geofences?.name` e os labels de `route_waypoints`. A consulta atual envia o texto exclusivamente como `.ilike('name', ...)` em `route_templates`, embora o placeholder da interface continue anunciando os três campos.

###############

Bug 1425

Sintoma: Depois que a criação ou edição de um corredor recebe uma rejeição definitiva do servidor — por exemplo, referência de POI/cerca inválida ou conflito de dados — corrigir o formulário e tentar salvar novamente passa a falhar localmente com `operator_command_pending_conflict`; fechar e reabrir o diálogo não libera a operação.
Provável causa: `RouteDialog` grava o comando com `prepareDurableOperatorCommand`, mas só chama `acknowledgeDurableOperatorCommand` no sucesso. O `catch` trata igualmente falhas incertas e erros determinísticos e não oferece retomada ou descarte; como o slot usa `save_route_template` mais `routeId` (ou o literal `new`), qualquer payload corrigido tem hash diferente e é recusado pelo comando pendente preservado no `localStorage`.

###############

Bug 1426

Sintoma: Em empresas com mais de 200 cercas ou 200 pontos de interesse ativos, o diálogo de criar/editar corredor não oferece os cadastros posteriores ao primeiro corte alfabético; o usuário não consegue vinculá-los como corredor ou waypoint e não recebe aviso de que a lista está incompleta.
Provável causa: `Routes` carrega `geofences` e `pois` somente ao abrir o diálogo, ordena por nome e aplica `.limit(200)` em ambas as consultas. `RouteDialog` e `WaypointEditor` recebem apenas esses arrays, sem busca remota, paginação, total ou indicação de truncamento.

###############

Bug 1427

Sintoma: Em Inventário, o campo “Buscar no inventário” anuncia pesquisa por “Item, cliente ou local”, mas escrever o nome do cliente ou do local não encontra saldos, movimentações nem itens parados; apenas a descrição do item é pesquisada.
Provável causa: A migração dos filtros para paginação no servidor removeu o `matchesSearch` que comparava `item_description`, `clients.company_name` e `inventory_locations.name`. `useInventoryBalances` e `useInventoryMovements` agora aplicam o texto somente em `.ilike('item_description', ...)`, sem busca nas relações, enquanto o placeholder e a descrição das três abas permaneceram inalterados.

###############

Bug 1428

Sintoma: Filtrar o histórico de movimentações do Inventário por uma data pode incluir registros das últimas horas do dia anterior e excluir registros do fim do dia escolhido para usuários no fuso de São Paulo ou em outro fuso diferente do banco.
Provável causa: `useInventoryMovements` transforma os dias em strings sem offset (`T00:00:00` e `T23:59:59.999`) e as envia diretamente contra a coluna `moved_at` do tipo `timestamptz`. Os limites são interpretados no timezone da sessão do Postgres, não no timezone do tenant nem no navegador, e não usam o limite exclusivo do início do dia seguinte.

###############

Bug 1429

Sintoma: Um membro não administrador que consegue consultar o Inventário recebe erro no novo resumo e vê os KPIs como “—”; no Painel de Operações, o mesmo usuário vê paletes em estoque como zero e o gráfico por cliente vazio, apesar de os saldos estarem acessíveis nas tabelas.
Provável causa: As políticas de `inventory_balances`, `inventory_movements` e `inventory_locations` permitem `SELECT` a membros do tenant, e `/inventory` não possui bloqueio de papel, mas `get_inventory_summary_v1` exige `is_tenant_admin`. `Inventory` sinaliza a falha do resumo junto das leituras, enquanto `OperationsDashboard` substitui silenciosamente `inventorySummary` ausente por `0` e `[]`.

###############

Bug 1430

Sintoma: Movimentações históricas do tipo “Transferência” aparecem quando o filtro está em “Todos os tipos”, mas não existe mais a opção “Transferência” para isolá-las no histórico paginado.
Provável causa: `useInventory.tsx` separou `ALL_MOVEMENT_TYPES`, que ainda contém `transfer`, de `MOVEMENT_TYPES`, que omite esse tipo para impedir novas transferências inválidas. Porém `Inventory` reutiliza `MOVEMENT_TYPES` tanto no formulário quanto nas opções do filtro, em vez de usar a lista completa somente para consultar registros históricos.

###############

Bug 1431

Sintoma: Operadores e demais membros não administradores veem normalmente os botões “Novo Movimento” e “Novo Local” no Inventário, conseguem preencher os diálogos e só descobrem no envio que a operação não é permitida.
Provável causa: A rota `/inventory`, a navegação e os controles de criação não verificam o papel atual, embora as policies de `inventory_movements` e `inventory_locations` concedam escrita exclusivamente a `is_tenant_admin`. A tela expõe ações indisponíveis em vez de ocultá-las/desabilitá-las com uma explicação de permissão.

###############

Bug 1432

Sintoma: Se a criação de uma movimentação de inventário for confirmada pelo banco mas a resposta se perder, repetir o envio cria um segundo fato e altera o saldo novamente, duplicando entrada, saída ou ajuste.
Provável causa: `useCreateMovement` faz `INSERT` direto em `inventory_movements`, sem `request_id`, chave idempotente, outbox local ou RPC que reconheça a mesma tentativa. O trigger de saldo executa após cada insert, portanto duas tentativas indistinguíveis produzem dois movimentos válidos e dois efeitos cumulativos.

###############

Bug 1433

Sintoma: Depois de usar “Selecionar todos” em Canhotos e então validar, rejeitar, substituir ou enviar comprovantes, uma nova seleção em massa pode continuar usando a coleção anterior, incluindo itens que deixaram de ser elegíveis ou ignorando itens recém-elegíveis.
Provável causa: A query `allFiltered` fica permanentemente com `enabled: false`. As mutações invalidam a chave `delivery-receipts`, mas a query desabilitada mantém `data` antiga e não refaz a leitura; o checkbox usa `allFiltered.data ?? (await allFiltered.refetch()).data`, portanto a mera existência do cache impede o `refetch` mesmo quando ele está stale.

###############

Bug 1434

Sintoma: Quando os filtros do Monitoramento de Motoristas encontram mais de 50 rotas, os KPIs “Em rota”, “No prazo”, “Atrasados”, “Sem atualização”, “Entregas restantes” e “Retornos atrasados” mudam ao trocar de página e subestimam o total; os relatórios de motoristas em rota, atrasos e produtividade também exportam somente a página aberta, embora os títulos e filtros indiquem o conjunto completo.
Provável causa: `useDriverMonitorsList` passou a retornar uma faixa paginada de 50 registros, mas `DriverMonitoring` ainda calcula `kpis`, `activeRows` e os dados entregues aos `ReportCard` diretamente de `rows`. O total da consulta só alimenta `DataPagination`; não existe agregação no banco nem busca completa dedicada aos indicadores e às exportações.

###############

Bug 1435

Sintoma: Os filtros de status do Monitoramento de Motoristas podem omitir justamente rotas que a própria tela classificaria como “Atrasado” ou “Sem atualização”; inversamente, uma rota recuperada pelo estado persistido pode ser exibida com outro status dentro do resultado filtrado.
Provável causa: `useDriverMonitorsList` aplica `status`, `onlyDelayed` e `onlyNoUpdate` no banco sobre `driver_route_monitors.status` antes de carregar as linhas, mas `toRow` substitui esse valor por `calculateDriverStatus`, dependente da data atual e de 24 horas desde a última atualização. Como a passagem do tempo não atualiza a coluna persistida, o conjunto filtrado e o status apresentado são calculados em momentos e camadas diferentes.

###############

Bug 1436

Sintoma: A aba e o relatório de previsões de chegada podem omitir rotas de outras páginas e previsões antigas; o relatório “Entregas por Motorista” também perde atualizações antigas quando uma rota ultrapassa 200 registros, sem paginação, total ou aviso de truncamento.
Provável causa: `useMonitorForecasts` recebe somente os IDs dos 50 `rows` da página atual e aplica ainda `.limit(200)` ao conjunto de previsões; `useMonitorUpdates` aplica `.limit(200)` ao histórico da rota aberta. `DriverMonitoring` usa diretamente esses arrays nas tabelas e exportações, reintroduzindo o corte silencioso que havia sido registrado como resolvido no Bug 463.

###############

Bug 1437

Sintoma: Uma viagem com mais de 50 cargas, documentos, lacres instalados ou divergências não pode concluir normalmente a conferência e o retorno pelo portal do motorista: os itens posteriores não aparecem nem podem ser confirmados ou resolvidos, enquanto o banco rejeita o comando por ainda existirem registros pendentes.
Provável causa: `getTripCargoControl` passou a carregar somente a página 1, com 50 itens, de cada coleção do dossiê. O painel operacional implementou paginação adicional, mas `DriverCargoCustody` usa apenas os arrays parciais do snapshot, sem consultar `getTripCargoCollectionPage`; `confirm_cargo` exige que a quantidade de cargas enviada seja exatamente a contagem total e que todos os documentos estejam confirmados, e o ciclo de retorno também depende de todos os lacres.

###############

Bug 1438

Sintoma: Em um dossiê retornado com mais de 50 lacres, o painel operacional pode habilitar “Encerrar custódia” mesmo havendo um lacre instalado ou sem resolução completa em páginas posteriores; o usuário só descobre o bloqueio após o envio, quando o banco rejeita a tentativa.
Provável causa: A tabela de lacres possui paginação, mas `hasUnresolvedSeal` é calculado exclusivamente sobre `snapshot.seals`, que contém apenas a primeira página, em vez de consultar todas as páginas ou receber do backend uma contagem de pendências. O botão usa esse booleano parcial, enquanto `close_trip_cargo_v1` valida todos os lacres do controle.

###############

Bug 1439

Sintoma: Depois de registrar ou reverter uma revisão de identificação dentro do detalhe de um extrato, “Histórico da importação” não mostra o novo evento mesmo após as consultas serem atualizadas; ele só aparece ao fechar e reabrir o diálogo.
Provável causa: `StatementHistoryDetail` guarda o `snapshot_at` da primeira leitura em `historySnapshot.current` e o reutiliza em toda nova consulta. As callbacks de revisão invalidam a chave `finance-statement-lines`, mas não limpam esse ref nem retornam o histórico à página 1; o backend, corretamente, exclui qualquer evento criado depois do snapshot antigo.

###############

Bug 1440

Sintoma: Abrir a Rastreabilidade NF fica progressivamente mais lento, consome rede e memória proporcionalmente a todo o histórico da empresa e pode travar o navegador; filtros simples e a tabela só ficam disponíveis depois de baixar e montar todas as relações.
Provável causa: `Traceability` usa `fetchAllPostgrestPages` para materializar todos os `fiscal_documents` do tenant e, em blocos, todos os `proof_of_delivery`, eventos operacionais, viagens e paradas relacionados. Os filtros, KPIs e exportações são calculados no cliente e `sortedFilteredRows.map` renderiza integralmente o resultado, sem paginação, virtualização, período padrão ou consulta remota filtrada.

###############

Bug 1441

Sintoma: A Rastreabilidade NF pode marcar POD como disponível e canhoto como recebido, inclusive nos filtros, detalhes e CSV, quando a única prova ativa está rejeitada, ausente ou ainda pendente, desde que algum caminho de arquivo, URL, assinatura ou data tenha permanecido preenchido.
Provável causa: `evidenceProofs` aceita provas com estado `uploaded`/`validated`, mas também qualquer estado que possua `storage_path`, `photo_url`, `signature_url` ou `received_at`. Assim, `rejected`, `missing` e `pending` voltam ao conjunto por metadados residuais; `hasPod` e `hasCanhoto` são derivados desse conjunto sem exigir um estado operacional válido.

###############

Bug 1442

Sintoma: Perto da virada do dia, o Monitoramento de Motoristas pode mostrar uma rota como “No prazo” para um usuário e “Atrasada” para outro, ou divergir do estado calculado pelo banco, quando o navegador está em um fuso diferente do configurado para a empresa.
Provável causa: O backend passou a avaliar `expected_return_date` com `driver_monitor_tenant_timezone`, mas `detectDelayedRoute` no frontend ainda cria `new Date(expected_return_date + 'T23:59:59')`, interpretada no fuso local do navegador. `toRow` chama esse cálculo e substitui o status recebido, sem conhecer nem aplicar o timezone do tenant.

###############

Bug 1443

Sintoma: Na primeira repetição pós-migração de uma planilha de monitoramento importada antes da criação do hash de payload, um conteúdo reinterpretado ou alterado pode ser aceito como duplicado e receber os totais do lote antigo; repetições seguintes passam a considerar esse novo conteúdo como se fosse o original.
Provável causa: `payload_hash` foi adicionado anulável a `driver_monitoring_import_batches`, sem backfill possível. No replay, `import_driver_monitoring_workbook_v1` só compara o hash quando o valor existente não é nulo; para lote legado, aceita a correspondência por `request_id`/fingerprint e atualiza `payload_hash` com o hash do payload atual, vinculando retroativamente uma intenção não comprovada ao resultado histórico.

###############

Bug 1444

Sintoma: A “Linha do tempo canônica” do Histórico do POD pode exibir eventos fora da ordem entre páginas: uma página inicial mostra ocorrências antigas enquanto tentativas, resultados ou comprovantes mais recentes aparecem apenas na página seguinte, e cada página pode conter até 125 itens apesar do tamanho anunciado de 25.
Provável causa: `get_operator_pod_history_collections_v1` aplica o mesmo `LIMIT 25 OFFSET ...` independentemente a tentativas, resultados, provas, alocações e ocorrências. `PodHistory` combina os cinco lotes e só então ordena a linha do tempo; não existe uma união cronológica global antes da paginação, portanto a posição local em uma coleção não representa a posição temporal no histórico completo.

###############

Bug 1445

Sintoma: Enquanto o Histórico do POD está aberto, uma nova tentativa, ocorrência, alocação, prova ou correção pode fazer eventos já vistos reaparecerem ou outros serem pulados ao avançar de página; os totais também podem mudar sem avisar que a travessia perdeu consistência.
Provável causa: As cinco coleções de `get_operator_pod_history_collections_v1` usam paginação por `LIMIT/OFFSET` sobre tabelas vivas, sem `snapshot_at`, revisão esperada ou cursor. Cada chamada recalcula contagens e fronteiras de forma independente, e `PodHistory` mantém apenas o número da página enquanto novos registros entram no início das ordenações decrescentes.

###############

Bug 1446

Sintoma: Se falhar a consulta da segunda página ou de uma página posterior do Histórico do POD, a tela inteira vira “Histórico indisponível” sem botão para tentar novamente nem controle para voltar à página anterior, deixando o usuário preso até recarregar ou sair da rota.
Provável causa: Quando `pageQuery.data` está ausente, `history` fica `undefined` e o componente retorna antecipadamente um `StateCard` sem callback de repetição. O card específico de `pageQuery.isError`, que contém “Tentar novamente”, e os botões de paginação estão declarados depois desse retorno e portanto são inalcançáveis justamente no estado de erro.

###############

Bug 1447

Sintoma: Um canhoto físico formalmente dispensado ainda aparece como pendente no painel de encerramento da custódia e obriga o operador a preencher uma justificativa de exceção de dez caracteres para habilitar o botão, embora o backend conclua o fechamento como reconciliação normal e descarte essa justificativa.
Provável causa: `private.close_trip_cargo` foi corrigida para excluir `physical_status = 'waived'` das pendências, mas `get_trip_cargo_control_v2` continua calculando `physical_receipts.pending_count` com `physical_status <> 'received'`. `TripCargoCustody` usa essa contagem antiga para mostrar o alerta, renderizar o campo de override e desabilitar o botão, deixando a leitura e o comando com semânticas diferentes.

###############

Bug 1448

Sintoma: Um administrador que abriu uma rota antes de ela ser arquivada consegue salvá-la depois do arquivamento, reativando a rota e substituindo todos os seus pontos com a versão antiga sem receber o conflito “a rota foi alterada”.
Provável causa: `archive_route_template_v1` altera `enabled` para `false` sem incrementar `route_templates.revision`. O editor conserva a mesma `expected_revision`, passa pela comparação de `save_route_template_unsafe_20260917` e então grava novamente o `enabled` do formulário, incrementa a revisão e apaga/reinsere o conjunto completo de `route_waypoints`.

###############

Bug 1449

Sintoma: Os indicadores “itens em estoque” e “paletes em estoque” podem incluir saldos já zerados ou negativos, enquanto o gráfico por cliente considera apenas itens com quantidade positiva; a mesma tela passa a apresentar totais internamente incompatíveis.
Provável causa: `get_inventory_summary_v1` calcula `balance_count` e `total_pallets` sobre todas as linhas persistentes de `inventory_balances`, sem `quantity > 0`, embora o trigger mantenha a linha quando o saldo chega a zero. Somente `stagnant_count` e a subconsulta `stock_by_client` filtram quantidade positiva.

###############

Bug 1450

Sintoma: Com mais de 200 viagens ativas, a Torre de Controle informa no cabeçalho e nos KPIs somente a quantidade do lote recebido, omite as demais do mapa e da lista e faz “Calcular todas” atuar apenas sobre essas 200, sem avisar que o conjunto está truncado.
Provável causa: `get_control_tower_snapshot_v1` devolve `trip_total`, `trip_limit` e `truncated`, mas `OperationsControl` usa exclusivamente `data.trips`: define `tripCount = trips.length`, entrega o mesmo array a `KpiCards` e `ControlTowerMap` e o percorre em `handleCalculateAll`. Nenhum trecho da tela consulta ou apresenta os metadados de truncamento já validados por `readTowerSnapshot`.

###############

Bug 1451

Sintoma: Um alerta aberto de uma viagem que ficou fora das primeiras 200 aparece na Torre de Controle sem placa e não abre os detalhes ao ser clicado, parecendo um alerta órfão embora a viagem continue ativa.
Provável causa: O snapshot limita `get_active_trips_live` a 200 viagens, mas `get_open_trip_alerts` continua devolvendo alertas reconciliados de todas as viagens ativas. `AlertsPanel` procura cada `trip_id` apenas no array truncado, renderiza “—” quando não encontra e condiciona `onSelectTrip` à existência desse objeto local.

###############

Bug 1452

Sintoma: O primeiro reenvio de um registro legado de progresso ou previsão de chegada pode ser aceito com conteúdo diferente do comando original e passar a vincular permanentemente esse conteúdo novo ao `request_id` histórico, embora o resultado devolvido continue sendo o registro antigo.
Provável causa: `payload_hash` foi acrescentado como anulável a `driver_route_progress_updates` e `driver_arrival_forecasts`. Em `add_driver_progress_v1` e `add_driver_forecast_v1`, o replay só compara o hash quando o valor armazenado não é nulo; para linhas legadas, basta coincidir tenant, pedido, monitor e autor, e então o wrapper preenche `payload_hash` com o payload do reenvio sem conseguir provar que ele corresponde à intenção original.

###############

Bug 1453

Sintoma: Para uma empresa cujo fuso civil não seja `America/Sao_Paulo`, o Relatório do Portal continua abrindo e restaurando “Últimos 90 dias” com início ou fim no dia errado, mesmo após o leitor do banco passar a respeitar `tenants.timezone`.
Provável causa: `PortalReports` sempre inicializa `start` e `end` com `localDateInputValue`, que é fixo em `APP_TIME_ZONE = 'America/Sao_Paulo'`, e envia essas datas explicitamente a `get_client_portal_reports_summary_v2`. Assim, os novos defaults calculados no fuso do tenant nunca são usados e o servidor interpreta como datas civis da empresa valores derivados no fuso fixo da interface.

###############

Bug 1454

Sintoma: O atalho “Últimos 90 dias” do Relatório do Portal abrange 91 datas civis — hoje mais os 90 dias anteriores — e inclui uma data mais antiga que o rótulo anuncia.
Provável causa: `PortalReports` define o início como o instante atual menos `90 * 24` horas e mantém hoje como fim; `get_client_portal_reports_summary_raw_20260917` trata ambos os limites como inclusivos (`between v_start and v_end`, ou intervalo até `v_end + 1`). Para cobrir 90 dias incluindo hoje, o início deveria corresponder a hoje menos 89 dias no calendário civil do tenant.

###############

Bug 1455

Sintoma: Se a exclusão de uma Rota Operacional for confirmada no banco mas a resposta se perder por queda de rede, tentar novamente informa que a rota não existe; a interface apresenta falha em uma operação que já foi concluída e não dispõe de confirmação recuperável do resultado.
Provável causa: `delete_operational_route_v1` recebe apenas rota e revisão, executa hard delete e não aceita `request_id` nem mantém um resultado idempotente. O hook também não preserva uma intenção durável; após uma resposta incerta, a repetição encontra zero linhas e o RPC lança `operational_route_not_found` em vez de reconhecer o comando já aplicado.

###############

Bug 1456

Sintoma: Na página de Corredores, rotas da página atual podem mostrar pontos ausentes e contagens menores de execuções “OK” ou com desvio quando, somadas, ultrapassam 1.000 pontos ou 1.000 execuções nos últimos sete dias; a interface não informa que os resumos são parciais.
Provável causa: Embora `route_templates` seja paginado, `Routes` busca os auxiliares de todas as 25 rotas visíveis com `.limit(1000)`. `route_waypoints_all` ordena globalmente por `waypoint_order` e `route_runs_recent` traz no máximo as 1.000 execuções mais antigas da janela; `getRouteWaypoints` e `getRouteStats` tratam ambos os arrays truncados como completos.

###############

Bug 1457

Sintoma: Se falhar a consulta dos pontos ao editar uma rota, o diálogo não mostra erro nem opção de tentar novamente, pode continuar exibindo pontos vazios ou pertencentes à rota editada anteriormente e o botão “Salvar” aparenta estar disponível, mas clicar nele não executa ação alguma.
Provável causa: `RouteDialog` preserva o estado `waypoints` entre fechamentos e só o substitui quando `existingWaypointsQuery.isSuccess`. O componente não renderiza `isLoading`/`isError`, e o botão é desabilitado apenas por `loading`; no submit, a guarda `(editRoute && !existingWaypointsQuery.isSuccess)` retorna silenciosamente sem feedback.

###############

Bug 1458

Sintoma: Uma rota já inativa pode ser “arquivada” repetidas vezes; cada clique informa novo sucesso e grava outro evento de auditoria de arquivamento, embora o estado não tenha mudado.
Provável causa: `Routes` exibe o botão com ícone de lixeira para todas as linhas, inclusive `enabled = false`, e `archive_route_template_v1` não exige que a rota esteja ativa. A função sempre executa `SET enabled = false`, chama `_log_entity_audit` com ação `archive` e retorna `archived: true`, sem detectar operação sem efeito nem oferecer uma ação distinta de reativação.

###############

Bug 1459

Sintoma: Ao carregar “Mais opções” em um filtro de canhotos, motoristas, veículos, fornecedores, clientes, cidades ou estados podem repetir ou nunca aparecer se nomes ou vínculos forem alterados entre páginas; a lista continua parecendo uma sequência completa.
Provável causa: `list_delivery_receipt_filter_options_v1` usa cursor por `(lower(label), value)` sobre um catálogo reconstruído do estado atual, mas não cria snapshot nem devolve/exige revisão nas páginas seguintes. Como `label` e a própria presença de cada opção são mutáveis, uma alteração pode mover a linha para antes ou depois do cursor já consumido, e `ReceiptFilterPicker` apenas concatena as páginas recebidas.

###############

Bug 1460

Sintoma: Empresas com mais locais de estoque que o limite de resposta da API veem o indicador “Locais cadastrados” subestimado e não conseguem selecionar os locais omitidos nos filtros nem ao registrar um movimento, sem qualquer aviso de catálogo incompleto.
Provável causa: `useInventoryLocations` executa um único `select('*')` em `inventory_locations`, ordenado por nome, sem paginação, contagem ou busca remota. `Inventory` usa diretamente `locations.length` como KPI e entrega o mesmo array potencialmente truncado ao `ListFilterBar` e a `MovementForm`.

###############

Bug 1461

Sintoma: O mesmo item de estoque pode gerar saldos separados apenas por espaços antes/depois da descrição — por exemplo, “Caixa” e “ Caixa ” — fragmentando quantidade, paletes, aging e indicadores como se fossem mercadorias distintas.
Provável causa: `MovementForm` usa `item_description.trim()` somente para habilitar o botão, mas envia o texto original. `update_inventory_balance` também não normaliza nem rejeita espaços nas bordas, e a chave lógica de `inventory_balances` compara `item_description` literalmente ao fazer o `ON CONFLICT`.

###############

Bug 1462

Sintoma: A Torre de Controle ainda pode produzir respostas muito grandes e travar a barra lateral quando uma empresa acumula muitos alertas abertos, apesar de o novo snapshot declarar um limite de 200 viagens.
Provável causa: `get_control_tower_snapshot_v1` limita somente `get_active_trips_live`; em seguida agrega sem limite todas as linhas de `get_open_trip_alerts` em `v_alerts`. `AlertsPanel` copia, ordena e renderiza integralmente esse array, sem paginação, virtualização ou indicador de truncamento para alertas.

###############

Bug 1463

Sintoma: Uma única viagem ativa com quantidade anormal de paradas ou cargas ainda pode tornar cada atualização da Torre de Controle muito pesada, mesmo quando o total de viagens respeita o limite de 200.
Provável causa: Para cada linha selecionada, `get_active_trips_live` agrega sem limite todos os `dispatch_stops` terminais, todos os pendentes, todos os `loads` vinculados e executa uma contagem de documentos por carga. O limite externo restringe somente a quantidade de viagens, não o tamanho nem o custo das coleções aninhadas que são recalculadas e transferidas a cada polling.

###############

Bug 1464

Sintoma: Ao abrir a prévia de emissão de CT-e, uma falha ao obter os padrões do grupo deixa motorista, veículo, emitente, natureza, remetente, destinatário e carga sem o preenchimento esperado, mas o diálogo não informa que a consulta falhou e aparenta apenas não possuir dados cadastrados.
Provável causa: O efeito de inicialização de `CteEmissionPreviewDialog` chama `cte_defaults_for_group` para cada grupo e desestrutura somente `data`, ignorando completamente `error`. Uma resposta de permissão, rede ou servidor é enviada a `parseCteDefaults` como valor ausente e convertida silenciosamente no rascunho básico, sem estado de erro nem tentativa explícita.

###############

Bug 1465

Sintoma: Ao tentar cadastrar uma nota fiscal duplicada, a tela de Controle Fiscal pode exibir apenas o código técnico `DUPLICATE_FISCAL_DOCUMENT`, sem a mensagem em português nem os dados da nota existente que ajudariam o operador a localizá-la.
Provável causa: `useCreateFiscalDocument` lança `DuplicateFiscalDocumentError`, cuja mensagem é literalmente esse código e cujo contexto fica em `existingDocument`. Nenhum componente verifica essa classe ou chama `formatDuplicateFiscalDocumentMessage`; `FiscalDocuments.errorMessage` e os demais tratadores exibem apenas `error.message`, tornando o helper de apresentação e os detalhes recuperados efetivamente inutilizados.

###############

Bug 1466

Sintoma: Em empresas com documentos fiscais acima do limite de uma resposta PostgREST, a Ingestão volta a classificar notas existentes como novas, omite notas confirmadas sem carga do agrupamento e pode descobrir a duplicidade somente ao tentar gravar; os mesmos documentos também deixam de participar das opções dependentes desse catálogo em outros diálogos.
Provável causa: O hook legado `useFiscalDocuments` continua fazendo um único `select` de todo o tenant, sem paginação, contagem ou indicador de truncamento. `Ingestion` usa esse array como universo completo em `buildValidationIndexes`, `validateNFe`, `dedupeOrtReviewDocs` e no filtro de documentos pendentes, enquanto `NFSeFormDialog` também o consome como `allDocs`.

###############

Bug 1467

Sintoma: Editar destino, peso ou paletes de um CT-e pode exibir sucesso enquanto o valor do frete permanece antigo, parcialmente atualizado ou sem o registro de cálculo correspondente; o operador não recebe aviso de que o recálculo automático falhou.
Provável causa: `useUpdateFiscalDocument` confirma primeiro o `UPDATE` principal e só depois consulta notas/cliente, calcula o frete, executa um segundo `UPDATE` e registra o cálculo em chamadas separadas. Todo esse bloco posterior está dentro de um `try/catch` que apenas faz `console.warn` e ainda retorna a linha do primeiro update como sucesso, sem transação, compensação ou estado de pendência.

###############

Bug 1468

Sintoma: Duas edições concorrentes de um CT-e podem terminar com o frete calculado para o destino, peso, paletes ou contexto de carga anterior, embora os campos atuais do documento já sejam outros.
Provável causa: Após o primeiro update, `useUpdateFiscalDocument` calcula o frete de forma assíncrona a partir da linha retornada e depois grava `freight_value`, tributos e breakdown filtrando apenas por `id` e `tenant_id`. O segundo update não confronta `updated_at`/revisão nem relê os campos de entrada, portanto uma alteração confirmada enquanto o cálculo estava em curso não impede a gravação do resultado obsoleto.

###############

Bug 1469

Sintoma: Um CT-e pode ser criado ou ter o frete recalculado com sucesso sem que a regra aplicada seja registrada na auditoria; a interface confirma a operação e o histórico depois aparenta simplesmente nunca ter existido.
Provável causa: Tanto `useGenerateCTe` quanto `useRecalculateCTeFreight` persistem primeiro o documento/novo frete e executam `logFreightCalculation` depois, em outra chamada. A falha desse upsert é capturada e reduzida a `console.warn`, sem reverter a gravação principal, sinalizar pendência ou informar o operador.

###############

Bug 1470

Sintoma: Uma NF-e de entrada cancelada que ainda conserve `load_id` continua aumentando a base percentual usada para gerar ou recalcular o frete do CT-e e pode até fornecer o cliente/destino de referência, produzindo cobrança baseada em documento que não deveria compor a carga vigente.
Provável causa: `useGenerateCTe`, `useRecalculateCTeFreight` e o recálculo automático de `useUpdateFiscalDocument` consultam todas as linhas de `fiscal_documents` com o mesmo `load_id` e `document_type = 'inbound'`, sem filtrar `status`, vigência ou a projeção `current_load_items`. Em seguida somam `value` e escolhem o primeiro `client_id` diretamente desse conjunto histórico.

###############

Bug 1471

Sintoma: Em uma carga com mais itens ou NF-es que o limite de resposta da API, a geração do CT-e pode gravar peso, paletes, resumo e frete menores que os reais; o recálculo posterior também pode usar apenas parte do valor das notas sem alertar que a base foi truncada.
Provável causa: `useGenerateCTe` carrega `load_items`, `load_orders` e NF-es em selects únicos sem paginação; quando o subtotal truncado de peso/paletes é maior que zero, ele ainda prevalece sobre os totais já mantidos na carga. `useRecalculateCTeFreight` e `useUpdateFiscalDocument` repetem a soma de NF-es em resposta única, e a consulta de documentos de referência da geração aplica ainda `.limit(50)` sem total ou indicador de continuação.

###############

Bug 1472

Sintoma: Se a consulta inicial das NF-es ou dos grupos pagadores falhar ao recalcular fretes de entrada, o botão apenas para de carregar e nenhuma mensagem explica o erro; a ação pode ainda produzir uma rejeição assíncrona não tratada no navegador.
Provável causa: `useRecalculateInboundFreight` lança os erros dessas consultas antes de produzir os contadores do lote. Tanto o clique de `BillingPage` quanto `NFSeFromInvoicesDialog.handleRecalc` aguardam `mutateAsync` sem `catch` nem `onError`; o segundo possui somente um `finally` para desligar o spinner.

###############

Bug 1473

Sintoma: Um recálculo de fretes em que uma ou várias NF-es falham é apresentado com toast visual de sucesso, podendo levar o operador a deixar documentos sem frete por acreditar que o lote terminou corretamente.
Provável causa: Os dois consumidores de `useRecalculateInboundFreight` chamam incondicionalmente `toast.success` quando a mutation retorna, inclusive quando `result.failed > 0`; a quantidade de falhas aparece apenas misturada no texto e não altera a severidade nem oferece os IDs afetados.

###############

Bug 1474

Sintoma: Depois que o CT-e interno de uma carga é removido logicamente, o detalhe da carga continua recusando uma nova geração com “CT-e já existe para esta carga”, embora o banco já tenha liberado a unicidade para o substituto.
Provável causa: A verificação inicial de `useGenerateCTe` procura qualquer `fiscal_documents` de saída associado à carga sem exigir `deleted_at IS NULL`. O índice `fiscal_documents_one_outbound_per_load_uidx`, por outro lado, considera somente linhas não removidas; assim, o bloqueio remanescente existe apenas no hook e contradiz a regra atual do banco.

###############

Bug 1475

Sintoma: A coluna “Notas” do resumo por motorista no XLSX de Ocorrências Operacionais mostra sempre a mesma quantidade de “Cargas”, subestimando motoristas cujas cargas transportam várias NF-es e apresentando esse número como contagem documental real.
Provável causa: `exportReport` consulta apenas `loads` e, para cada linha, incrementa tanto `entregas` quanto `notas` em exatamente uma unidade. A rotina não consulta `load_documents`, `load_items` ou `fiscal_documents` para contar as notas efetivamente vinculadas a cada carga.

###############

Bug 1476

Sintoma: O XLSX de Ocorrências Operacionais contabiliza cargas ainda planejadas, carregando, canceladas ou falhas nas colunas “Cargas” e “Valor Entregue”, inflando o desempenho atribuído aos motoristas como se todas já tivessem sido entregues.
Provável causa: A consulta auxiliar de `exportReport` seleciona `status`, mas não aplica filtro por situação e o laço soma todas as linhas retornadas em `entregas` e `valor`. O campo `status` carregado nunca é lido antes de compor o resumo rotulado como valor entregue.

###############

Bug 1477

Sintoma: Dois motoristas diferentes com o mesmo nome aparecem como uma única pessoa no painel “Ocorrências por Motorista”; seus indicadores e eventos são somados, as exportações individuais misturam ambos e o botão de chat abre arbitrariamente a conversa do primeiro registro encontrado.
Provável causa: `driverStats`, `eventsByDriver` e o filtro de `exportReport` usam exclusivamente `drivers.name` como chave de identidade. O `driver_id` é descartado no agrupamento e só volta a ser obtido de `driverEvents[0]` ao abrir o chat, portanto homônimos não podem ser distinguidos pela interface.

###############

Bug 1478

Sintoma: No gráfico de “últimos 12 meses” de Ocorrências Operacionais, o total e os percentuais por tipo podem incluir ocorrências que não aparecem em nenhum dos 12 meses desenhados, fazendo a soma visual divergir da legenda e dos indicadores.
Provável causa: As séries criam chaves somente para o mês atual e os 11 anteriores, mas `recent` aceita eventos posteriores ao instante exato de `subMonths(now, 12)`. Isso inclui boa parte de um décimo terceiro mês; essas linhas entram em `totals` e `totalCount`, porém nenhuma linha de `chartData` possui a chave mensal correspondente para representá-las.

###############

Bug 1479

Sintoma: Ao salvar documentos pela Ingestão, uma NF-e de destinatário ainda não cadastrado pode ser confirmada sem `client_id` e sem qualquer aviso de que o cadastro automático do cliente falhou, deixando a nota sem identidade comercial para cálculo e emissão posteriores.
Provável causa: `ensureClient` transforma tanto o `error`/ausência de retorno do `insert` em `clients` quanto qualquer exceção em `null`. `handleSaveDocsOnly` interpreta esse retorno apenas como “não houve novo ID” e continua criando `fiscal_documents` com `client_id: null`; a falha não entra em `executionResults`, no relatório nem em toast.

###############

Bug 1480

Sintoma: Uma NF-e pode ser gravada com sucesso pela Ingestão e, ainda assim, aparecer como falha se o log do cálculo de frete ou a auditoria ORT falhar depois; em outros ramos ela pode até ser vinculada a uma carga apesar de a lista final marcar sua importação com ❌.
Provável causa: Os fluxos aguardam `logFreightCalculation` e `recordOrtAudit` dentro do mesmo `try` que envolve `createDoc.mutateAsync`. Essas gravações posteriores não são atômicas com a criação: sua exceção cai no `catch` de “falha da NF”, embora o documento já exista; no fallback de execução, o ID já foi incluído em `createdDocIds` antes desse erro.

###############

Bug 1481

Sintoma: O relatório persistido após “Execução completa de cargas” pode informar mais documentos salvos ou com erro do que o total de NF-es do lote, misturando criação de pedidos e cargas nas métricas rotuladas como `savedDocs` e `errorDocs`.
Provável causa: `handleExecute` calcula `successCount` e `errorCount` sobre todas as strings de `results`, que incluem NF-es, pedidos e cargas. Em seguida passa esses totais agregados diretamente como `savedCount` e `errorCount` a `buildIngestionReport`, embora essa função grave ambos como contagens exclusivas de documentos.

###############

Bug 1482

Sintoma: O relatório de Ingestão pode mostrar zero clientes não resolvidos mesmo quando algumas NF-es continuam sem cliente, bastando que outras notas do mesmo lote tenham criado clientes automaticamente.
Provável causa: Quando `ensureClient` funciona, o fluxo já atribui o novo ID a `doc.matchedClientId`; por isso `buildIngestionReport` naturalmente não inclui essa nota em `unresolved`. Mesmo assim, a função subtrai novamente `autoCreatedCount` do número de documentos ainda sem `matchedClientId`, ocultando a mesma quantidade de pendências reais e truncando o resultado em zero.

###############

Bug 1483

Sintoma: “Documentos para revisão” no relatório de Ingestão pode ultrapassar o total de documentos e divergir da quantidade de itens realmente listados para conferência, gerando inclusive percentuais acima de 100% nos CSVs e PDFs.
Provável causa: `buildIngestionReport` soma separadamente os ORTs marcados em `ortReviewDocs` e as NF-es de `docs` com baixa confiança/IE desconhecida, embora as duas coleções possam representar o mesmo documento. Apenas `reviewItems` tenta deduplicar pelo número da nota; `needsReviewDocs` conserva a soma dupla e é usado diretamente como numerador dos percentuais.

###############

Bug 1484

Sintoma: Uma NF-e extraída com confiança alta, mas sem CNPJ, endereço ou cliente resolvido, pode não aparecer na lista “Documentos para revisão”, apesar de faltar contexto obrigatório para cadastro, cálculo e faturamento.
Provável causa: Ao montar `reviewItems`, `buildIngestionReport` detecta os campos ausentes, porém só acrescenta “Mapeamento incompleto” quando `confidence < reviewThreshold`. `needsReviewDocs` também considera apenas baixa confiança ou IE explicitamente desconhecida, portanto a ausência objetiva desses campos é ignorada quando o score de OCR é alto.

###############

Bug 1485

Sintoma: Em um lote que contenha notas de fornecedores diferentes com o mesmo número, a pendência de revisão de uma delas pode ocultar a outra na lista detalhada, impossibilitando saber qual identidade fiscal e qual arquivo precisam ser corrigidos.
Provável causa: A deduplicação de `reviewItems` usa apenas `invoiceNumber` em `seenInvoices`. Não entram na chave CNPJ do emitente, série, modelo, chave de acesso nem nome do arquivo; depois que um ORT adiciona esse número, toda NF de `docs` com o mesmo número é descartada como se fosse o mesmo documento.

###############

Bug 1486

Sintoma: Usuários em fusos diferentes podem obter conjuntos diferentes para as mesmas datas no Histórico de Importações e nas listas de Coletas e Comprovantes do portal, incluindo registros do dia vizinho ou omitindo as primeiras/últimas horas do período civil da empresa.
Provável causa: `IngestionReports`, `usePortalPickups` e `usePortalPods` convertem os campos de data com `localDayBoundary`/`localDayEnd`. Esses helpers criam meia-noite no timezone local do navegador e enviam o instante UTC resultante para filtrar colunas `timestamptz`, sem considerar `tenants.timezone` nem um calendário operacional comum.

###############

Bug 1487

Sintoma: Duas pessoas que digitam a mesma data e hora em “Nova solicitação de coleta”, mas usam dispositivos em fusos diferentes, agendam instantes diferentes; ao consultar a coleta, cada usuário ainda a vê convertida novamente para seu próprio fuso, sem indicação do timezone contratual.
Provável causa: `PortalPickups` usa um `input type="datetime-local"` sem coletar timezone e transforma o texto com `new Date(form.pickup_at).toISOString()`, interpretando-o no fuso do navegador. A listagem formata `pickup_at` novamente no fuso local, e nenhum dos lados aplica ou exibe o timezone do tenant/cliente.

###############

Bug 1488

Sintoma: Uma tabela de frete pode ser considerada compatível e até escolhida apesar de possuir um critério explicitamente diferente do documento — por exemplo, outro cliente, grupo pagador, rota ou município — quando ela também coincide em muitos outros campos.
Provável causa: `computeSpecificity` representa cada incompatibilidade “dura” subtraindo 100 pontos, mas cada correspondência exata soma 10 e `calculateFreight` aceita qualquer score maior ou igual a zero. Assim, dez critérios coincidentes anulam uma divergência e onze a tornam positiva; não existe um booleano separado que desqualifique definitivamente a tabela como o comentário do algoritmo promete.

###############

Bug 1489

Sintoma: Um usuário que participa de mais de uma empresa pode emitir, após trocar o tenant ativo ou manter uma prévia antiga aberta, uma NFS-e pertencente à empresa anterior; a operação fiscal ocorre no outro tenant mesmo que a interface já indique a empresa atual.
Provável causa: `useIssueNFSe` e `useIssueNFSeBatch` não leem nem validam `currentTenant`. As consultas de `nfse_documents` usam somente os IDs recebidos, e emitente/credencial são derivados do próprio documento; a RLS permite a leitura se o usuário também for membro do tenant antigo, mas não confronta esse tenant com o contexto atualmente selecionado no frontend.

###############

Bug 1490

Sintoma: Uma falha de rede ou permissão ao carregar o emitente durante a emissão individual de NFS-e é apresentada como se o emitente não tivesse credencial Hub configurada, direcionando o operador a alterar uma configuração que pode estar correta.
Provável causa: `useIssueNFSe` desestrutura apenas `data: em` da consulta a `tenant_emitters` e ignora `error`. Qualquer falha vira `emitter = null`; o fluxo então cai na mensagem fixa “configure uma credencial Hub Fiscal”, sem chegar à consulta real das credenciais nem preservar a causa original.

###############

Bug 1491

Sintoma: Ao navegar pelas páginas de “Títulos” do portal enquanto novas cobranças são criadas ou vencimento/status é alterado, um título pode aparecer duas vezes ou ser pulado completamente entre as páginas, sem aviso de que o conjunto mudou.
Provável causa: `PortalTitles` pagina por `offset`, e `portal_read_financial_titles` refaz a cada clique o conjunto filtrado ordenado por `due_date, id`. A consulta não fixa snapshot/revisão; inserções, mudanças de vencimento e mudanças de status deslocam os offsets já percorridos e invalidam as fronteiras da paginação.

###############

Bug 1492

Sintoma: A Central de Operações pode exibir uma quantidade de “viagens ativas” menor que a real, inclusive mostrar zero enquanto existem viagens carregando, despachadas ou em trânsito.
Provável causa: A query `ops_trips` conta somente `dispatch_trips.status IN ('planned', 'in_progress')`, enquanto a definição canônica `TRIP_ACTIVE_STATUSES` também inclui `loading`, `dispatched` e `in_transit`. O total exato da consulta é, portanto, exato apenas para um subconjunto incompatível com o rótulo apresentado.

###############

Bug 1493

Sintoma: Na aba de importação de Faltas de Mercadoria, uma falha ao consultar as últimas importações deixa a tabela do histórico vazia, sem mensagem, nova tentativa ou indicação de indisponibilidade.
Provável causa: `MerchandiseShortages` consome apenas `imports.data ?? []` de `useImportBatches` e não observa `isLoading`, `isError` nem `error`. O mesmo array vazio alimenta a tabela tanto quando não existem lotes quanto quando a query de `merchandise_shortage_import_batches` falha.

###############

Bug 1494

Sintoma: Na aba “Importar XML/Planilha” do Controle de Cargas, uma falha ao consultar os lotes anteriores deixa “Últimas importações” como uma tabela vazia, sem revelar o erro nem permitir tentar novamente.
Provável causa: `LoadControl` desestrutura de `useImportBatches` somente `data: batches = []` e ignora os estados de carregamento e erro. Falha e ausência real de `load_import_batches` produzem exatamente a mesma renderização vazia.

###############

Bug 1495

Sintoma: Para um usuário membro de mais de uma empresa, uma NF do Resumo de Notas Importadas pode ser enriquecida com número, chave, status ou valor de CT-e/NFS-e pertencente a outro tenant caso o vínculo direto esteja legado ou corrompido.
Provável causa: Em `useImportedNotes`, as consultas de fallback por `cte_emitted_outbound_id` e `nfse_emitted_document_id` aplicam apenas `.in('id', outboundIds/missingNfseIds)`, sem `tenant_id = currentTenant.id`. As colunas de referência também não possuem FK composta que imponha igualdade de tenant; a RLS permite ler o documento estrangeiro quando o mesmo usuário participa das duas empresas.

###############

Bug 1496

Sintoma: `npm run typecheck` falha duas vezes em `Payroll.tsx:87`, impedindo o gate do projeto com “Type 'string | undefined' is not assignable to type 'string'” na navegação para a próxima página de períodos.
Provável causa: `payrollPeriodsProjectionSchema` declara `snapshot_at` e `collection_revision` como opcionais. `readPayrollPeriodPage` verifica esses campos em runtime, mas devolve o objeto sem estreitar seu tipo; por isso `periodResult` ainda expõe ambos como `string | undefined`, enquanto `setPeriodPaging` exige strings.

###############

Bug 1497

Sintoma: `npm run typecheck` falha em `payrollContractSegmentsReportedBug.test.ts:21` com “Object is possibly 'null'”, bloqueando a checagem mesmo quando a migration contém as chamadas esperadas.
Provável causa: O teste executa `migration.match(/payroll_employee_in_scope_v1\(/g).length` diretamente. Pela assinatura de `String.match`, uma expressão sem ocorrências devolve `null`; a asserção não usa fallback (`?.length ?? 0`) nem uma forma de contagem cujo tipo seja sempre array.

###############

Bug 1498

Sintoma: Um administrador que deixa “Editar Item” aberto, troca para outra empresa e salva pode alterar o item de estoque da empresa anterior, apesar de a interface já exibir o novo tenant.
Provável causa: `Stock` não fecha o diálogo nem limpa `editingItem`/`itemForm` quando o tenant muda, e `useUpdateStockItem` não lê `currentTenant`: o `UPDATE stock_items` é condicionado somente ao `id`. Se o usuário também administra o tenant antigo, a RLS continua autorizando a gravação da linha capturada.

###############

Bug 1499

Sintoma: Dois administradores podem editar simultaneamente o mesmo item de estoque, ambos receberem sucesso e o último salvamento apagar silenciosamente nome, categoria, unidade, estoque mínimo, localização, fornecedor ou observações alterados pelo primeiro.
Provável causa: `Stock` envia novamente o snapshot completo do formulário e `useUpdateStockItem` filtra a atualização somente por `id`. Embora grave um novo `updated_at`, não compara o valor previamente lido, não usa revisão/CAS e não detecta conflito concorrente.

###############

Bug 1500

Sintoma: Depois que uma movimentação de estoque é rejeitada pelo servidor, corrigir quantidade, custo, tipo ou responsável pode falhar localmente com `operator_command_pending_conflict`; após recarregar a página, qualquer nova movimentação do mesmo usuário/empresa pode permanecer bloqueada sem opção de recuperar ou descartar o pedido anterior.
Provável causa: `useCreateStockMovement` chama `prepareDurableOperatorCommand` sempre com `action: 'create_stock_movement'` e `entityId: 'new'`, mas só executa `acknowledgeDurableOperatorCommand` no sucesso. Todo erro preserva o slot no `localStorage`; um payload corrigido possui outro hash e entra em conflito, enquanto `Stock` não lê, reenvia nem remove o comando pendente.

###############

Bug 1501

Sintoma: Uma rejeição ou resposta incerta pode bloquear indefinidamente novas coletas, abastecimentos, contratos de funcionário ou importações de ocorrências para o mesmo usuário/empresa; corrigir o formulário passa a gerar `operator_command_pending_conflict`, e recarregar perde a única cópia visível do payload que poderia ser reenviado.
Provável causa: `useCreatePickupOrder`, `useCreateFueling`, `useCreateEmployeeContract` e `useImportLegacyBatch` usam comandos duráveis com `entityId: 'new'`, reconhecem o slot apenas no sucesso e não distinguem rejeição definitiva de resultado incerto. Nenhum fluxo de produção chama `readDurableOperatorCommand` para recuperar ou descartar o comando preservado; qualquer novo payload no mesmo slot entra em conflito com o hash anterior.

###############

Bug 1502

Sintoma: Depois que uma tentativa de cancelar ou reabrir um período de folha é rejeitada, alterar o motivo ou repetir a ação após recarregar pode ficar preso em `operator_command_pending_conflict`, sem botão para recuperar ou descartar a solicitação preservada daquele período.
Provável causa: `useChangePayrollPeriodState` usa `entityId: periodId`, grava o comando antes do RPC e só chama `acknowledgeDurableOperatorCommand` no sucesso. Qualquer erro mantém o slot; como o payload inclui ação e motivo, uma correção muda o hash, mas a interface não usa `readDurableOperatorCommand` nem oferece descarte/reenvio do pedido anterior.

###############

Bug 1503

Sintoma: Se a aprovação ou o fechamento da folha for confirmado no banco mas a resposta se perder, a tela informa falha; uma nova tentativa é rejeitada como período protegido embora a operação original tenha sido concluída, e a interface pode continuar exibindo o estado anterior e esconder títulos já gerados.
Provável causa: `useApprovePayrollPeriod` e `useClosePayrollPeriod` chamam os RPCs legados sem `request_id` nem resultado de replay e invalidam as consultas somente em `onSuccess`. Os guards transacionais corretamente impedem repetir a transição, mas não existe caminho para reconciliar uma resposta incerta com o estado e os efeitos que já foram gravados.

###############

Bug 1504

Sintoma: Abrir “Estoque e Almoxarifado” pode gerar centenas de requisições, consumir memória excessiva e travar o navegador conforme cresce o histórico, mesmo que o usuário queira apenas consultar os itens e nunca abra a aba de movimentações.
Provável causa: `Stock` monta imediatamente `useStockItems`, `useStockMovements` e `useEmployees`. Os três hooks percorrem todas as páginas do tenant com `fetchAllPostgrestPages`; filtros, indicadores e `usePagination(..., pageSize: 50)` só atuam no cliente depois que itens, todo o histórico de movimentos e funcionários já foram transferidos e mantidos em memória.

###############

Bug 1505

Sintoma: Movimentações históricas de estoque dos tipos `transfer` e `return` aparecem em “Todos os tipos”, mas não podem ser isoladas pelo filtro; devoluções ainda exibem o texto técnico `return` em vez de um rótulo traduzido.
Provável causa: `Stock` reutiliza `MOVEMENT_TYPES` tanto no formulário quanto no filtro, e essa constante omite `transfer` e `return` embora o RPC/tabela aceitem ambos. `MOVEMENT_TYPE_LABELS` conserva `transfer`, mas não define `return`, portanto o fallback renderiza o valor cru.

###############

Bug 1506

Sintoma: Uma devolução ao estoque ou um ajuste que aumentou o saldo aparece no histórico com seta para cima/saída e cor laranja, levando o operador a interpretar uma entrada como baixa de material.
Provável causa: Na tabela de `Stock`, somente `movement_type === 'inbound'` recebe `ArrowDown` e tom verde; todo tipo restante cai no mesmo ramo visual de saída. A renderização ignora que `return` incrementa o saldo e que `adjustment` precisa consultar `adjustment_direction` para decidir o sentido.

###############

Bug 1507

Sintoma: O KPI “Movimentações recentes” do Estoque cresce indefinidamente e mostra a quantidade de todo o histórico, não um período recente; empresas com anos de dados recebem um número sem relação com atividade atual.
Provável causa: O cartão renderiza diretamente `movements.length`. `useStockMovements()` não recebe data inicial nem aplica janela temporal: ele pagina e concatena todas as linhas do tenant, de modo que o rótulo “recentes” não corresponde ao conjunto contado.

###############

Bug 1508

Sintoma: Duas pessoas podem obter resultados diferentes ao filtrar as mesmas datas no histórico do Estoque; uma movimentação perto da meia-noite pode aparecer no dia anterior ou seguinte para quem usa fuso diferente do calendário operacional da empresa.
Provável causa: `Stock` filtra `moved_at` no navegador por `matchesDateRange`, cuja `calendarDay` converte timestamps com `new Date(...)` e `getFullYear/getMonth/getDate` do fuso local do dispositivo. O tenant e seu timezone não participam da conversão nem da chave do filtro.

###############

Bug 1509

Sintoma: É possível cadastrar ou editar um item de estoque com a unidade vazia ou composta apenas por espaços; o item passa a aparecer e ser selecionado em movimentações sem qualquer unidade de medida, tornando quantidades como peças, litros e quilos indistinguíveis.
Provável causa: `handleSaveItem` valida somente nome e quantidade mínima e envia `itemForm.unit` sem `trim` nem exigência de conteúdo. No banco, `stock_items.unit` é apenas `NOT NULL`, sem `CHECK` para rejeitar texto vazio, portanto tanto a criação quanto a atualização aceitam o valor inválido.

###############

Bug 1510

Sintoma: A tela de Estoque não permite informar nem alterar fornecedor e observações de um item, embora esses dados sejam usados pela busca e façam parte do cadastro; itens criados pela interface ficam sempre sem essas informações.
Provável causa: O estado `itemForm` e o payload de `handleSaveItem` incluem `supplier` e `notes`, porém o diálogo “Novo/Editar Item” renderiza campos apenas para código, nome, categoria, unidade, quantidade mínima e local. Não existe `Input`/`Textarea` ligado aos dois valores, então na criação eles permanecem vazios e na edição apenas repetem silenciosamente o valor previamente carregado.

###############

Bug 1511

Sintoma: Um item de estoque marcado como inativo continua aparecendo como item normal na listagem e pode receber novas entradas, saídas, reservas e consumos, tornando a inativação incapaz de impedir operação sobre um cadastro descontinuado.
Provável causa: `useStockItems` busca todas as linhas do tenant sem filtrar nem expor `active`, e o seletor de movimentação reutiliza integralmente esse array. `create_stock_movement_v1` também localiza o item apenas por `id` e `tenant_id`, sem exigir `active = true`, portanto a ausência de bloqueio existe tanto na interface quanto no banco.

###############

Bug 1512

Sintoma: Usuários com papel `operator` conseguem abrir Estoque e veem normalmente “Novo Item”, “Movimentar” e os botões de edição, mas todas essas ações terminam em erro de permissão depois de preencher o formulário.
Provável causa: A rota `/stock` aceita qualquer papel interno (`owner`, `admin` ou `operator`) e `Stock` não consulta o papel para ocultar ou desabilitar comandos. Em contraste, as policies de escrita de `stock_items` e o RPC `create_stock_movement_v1` exigem `is_tenant_admin`, deixando a autorização do servidor incompatível com as ações oferecidas pela interface ao operador.

###############

Bug 1513

Sintoma: A coluna “Motivo” do histórico de estoque exibe códigos internos em inglês como `purchase`, `vehicle_use` e `return`, apesar de o formulário apresentar as opções traduzidas como Compra, Uso Veículo e Devolução.
Provável causa: O formulário mantém rótulos em português somente dentro dos `SelectItem`, mas persiste o valor técnico em `reason`. A tabela renderiza diretamente `m.reason` e não possui um mapa de rótulos para os motivos, ao contrário do tratamento aplicado às categorias e aos tipos de movimentação.

###############

Bug 1514

Sintoma: Ao movimentar estoque, dois itens com o mesmo nome, unidade e saldo aparecem como opções indistinguíveis; o operador pode selecionar o cadastro errado mesmo quando eles possuem códigos, categorias ou locais diferentes.
Provável causa: O banco não exige unicidade de `stock_items.name` e o seletor de `Stock` monta cada rótulo somente como `nome (quantidade unidade)`. Código, categoria e localização — justamente os campos capazes de diferenciar cadastros homônimos — não são exibidos na opção.

###############

Bug 1515

Sintoma: O histórico de estoque mostra quantidades sem unidade de medida, de modo que valores como “10” não dizem se representam unidades, litros ou quilos; se a unidade do item for alterada depois, também não há como saber qual unidade valia na movimentação original.
Provável causa: A tabela de histórico possui apenas a coluna “Qtd” e `useStockMovements` relaciona `stock_items(name)` sem buscar a unidade atual. Mais profundamente, `stock_movements` não preserva um snapshot de `unit`, enquanto a edição de `stock_items.unit` continua permitida, tornando a interpretação histórica dependente de um cadastro mutável que nem sequer é renderizado.

###############

Bug 1516

Sintoma: O cartão “Docs Vencendo” do Painel Operacional pode continuar em alerta por CNHs ou exames de funcionários inativos e desligados, embora essas pessoas não façam mais parte da equipe operacional que precisa renovar documentos.
Provável causa: `OperationsDashboard` recebe todo o cadastro de `useEmployees` e `expiringDocs` verifica somente as datas `cnh_expiry` e `medical_exam_expiry`. O cálculo não restringe `employee.status` a `active`/`on_leave`, portanto estados `inactive` e `terminated` entram na mesma contagem.

###############

Bug 1517

Sintoma: Não há como registrar na interface o custo real de uma ocorrência encerrada; os cartões de custo continuam exibindo a estimativa inicial como se fosse o valor realizado, mesmo quando o prejuízo final foi diferente ou inexistente.
Provável causa: O formulário de `Incidents` expõe e envia apenas `estimated_cost`; `actual_cost` existe na tabela com padrão zero, mas não é lido nem editado por nenhum fluxo da aplicação. Tanto `Incidents` quanto `OperationsDashboard` agregam `actual_cost || estimated_cost || 0`, fazendo o zero padrão cair sempre na estimativa e tornando impossível distinguir “real ainda não informado” de “real confirmado em zero”.

###############

Bug 1518

Sintoma: Abrir o Painel Operacional fica progressivamente mais lento e pode disparar milhares de linhas e muitas requisições conforme a empresa acumula pedidos, cargas, ocorrências e cadastros, embora a tela mostre apenas indicadores, gráficos resumidos e no máximo oito linhas por tabela.
Provável causa: `OperationsDashboard` monta simultaneamente oito hooks. `useOrders`, `useLoads`, `useVehicles`, `useIncidents`, `useEmployees` e `useStockItems` materializam catálogos ou históricos completos no navegador, enquanto `useMaintenanceOrders` faz uma leitura ampla sujeita ao limite implícito. Só depois a página agrega, filtra e aplica `slice(0, 8/10)`, em vez de consultar totais e amostras limitadas no servidor.

###############

Bug 1519

Sintoma: O mesmo pedido pode aparecer como atrasado para uma pessoa e ainda dentro do prazo para outra, especialmente perto da meia-noite, quando os dispositivos estão em fusos diferentes do calendário operacional da empresa.
Provável causa: `OperationsDashboard` transforma `promised_date` em `new Date(promised_date + 'T23:59:59')` e compara com o relógio do navegador. A data civil não é interpretada no timezone do tenant, e o mesmo objeto local também alimenta `formatDistanceToNow`, deixando contagem e texto relativo dependentes do fuso do usuário.

###############

Bug 1520

Sintoma: O cartão “Críticas Ativas” da página de Ocorrências continua contando casos críticos já resolvidos ou cancelados, mantendo o painel em alerta mesmo sem uma ocorrência crítica em andamento.
Provável causa: O KPI filtra `severity === 'critical' && status !== 'closed'`. Diferentemente da regra de ocorrências abertas usada no Painel Operacional, ele não exclui os estados terminais `resolved` e `cancelled`; apenas `closed` deixa de ser considerado ativo.

###############

Bug 1521

Sintoma: Depois de vincular funcionário, veículo ou cliente a uma ocorrência, não é possível remover esse vínculo pela tela; os campos opcionais só permitem trocar por outro cadastro. Ao mudar uma ocorrência de RH para outra categoria, o funcionário antigo também permanece preso ao registro.
Provável causa: Os três `Select` do diálogo renderizam somente as opções carregadas e não oferecem “Nenhum” nem controle de limpeza. Embora `handleSave` converta string vazia em `null`, a interface não fornece caminho para restaurar esse valor após uma seleção existente.

###############

Bug 1522

Sintoma: Trocar a empresa ativa com uma ocorrência aberta para edição mantém no diálogo os dados e as ações de RH da empresa anterior enquanto os seletores já passam a listar funcionários, veículos e clientes da empresa nova; salvar termina com uma mensagem enganosa de edição concorrente ou tenta combinar referências dos dois contextos.
Provável causa: `Incidents` não fecha o diálogo nem limpa `editing`/`form` na troca de tenant. Além disso, `useIncidentActions` usa a chave `['employee_incident_actions', incidentId]` sem `currentTenant.id`; o ID antigo permanece no componente e o cache das ações não acompanha a mudança de empresa, embora o `UPDATE` principal já seja corretamente restringido ao tenant atual.

###############

Bug 1523

Sintoma: Ocorrências altas ou críticas podem ser resolvidas e encerradas sem nenhum responsável formal, tipo de responsabilidade, aceite ou parecer associado; a própria interface não oferece forma de cadastrar ou consultar essa responsabilização.
Provável causa: O comentário de `handleSave` afirma que ocorrências críticas exigem “responsible + conclusion”, mas a validação verifica apenas `conclusion`. A tabela `incident_responsible` e os hooks `useIncidentResponsibles`/`useAddIncidentResponsible` existem, porém não são usados por componente algum, e não há constraint/trigger no banco que bloqueie os estados terminais quando a responsabilização exigida está ausente.

###############

Bug 1524

Sintoma: Editar uma ocorrência formal substitui silenciosamente título, gravidade, vínculos, estimativa, plano, conclusão e status anteriores; depois não é possível reconstruir quem mudou cada dado, quando ocorreu a transição nem qual era o conteúdo usado numa decisão de RH.
Provável causa: `useUpdateIncident` executa um `UPDATE` direto sobre a única linha de `incidents`. O CAS evita sobrescrita concorrente e `updated_by/updated_at` guardam apenas o último editor, mas não existe tabela de versões, evento de transição ou trigger de auditoria para preservar o estado anterior; os únicos históricos separados cobrem ações de RH e responsáveis, não as alterações da ocorrência.

###############

Bug 1525

Sintoma: O botão “Adicionar ação” de uma ocorrência de RH sempre falha para usuários autenticados, inclusive administradores e operadores válidos, impedindo registrar anotação, advertência, suspensão, treinamento, desconto ou recomendação de desligamento pela tela.
Provável causa: `useAddEmployeeIncidentAction` chama diretamente o RPC `add_employee_incident_action`, mas a baseline revoga `EXECUTE` dessa função de `public`, `anon`, `authenticated` e `service_role` e depois concede apenas a `service_role`. Nenhuma migração posterior devolve permissão a `authenticated`, apesar de o corpo do próprio RPC verificar `is_tenant_operator_or_admin`, tornando essa autorização interna inalcançável pelo frontend.

###############

Bug 1526

Sintoma: Um usuário com papel `operator` acessa normalmente Ocorrências Formais e vê “Nova Ocorrência” e todos os botões de edição, mas criar ou salvar uma ocorrência termina em erro de permissão somente após o formulário ser preenchido.
Provável causa: `/incidents` é protegida pelo gate interno que aceita `owner`, `admin` e `operator`, e o componente não condiciona os comandos ao papel. Entretanto, as policies `Admins can manage incidents` autorizam `INSERT`/`UPDATE` somente quando `is_tenant_admin(tenant_id)`, em desacordo com as ações oferecidas ao operador e até com a função de ações de RH, cujo corpo admite operadores.

###############

Bug 1527

Sintoma: Se falhar a consulta de funcionários, veículos ou clientes ao abrir uma ocorrência, os respectivos seletores aparecem simplesmente vazios; no caso de RH, o usuário fica impedido de salvar porque o funcionário é obrigatório, sem nenhuma indicação de indisponibilidade ou opção de tentar novamente.
Provável causa: `Incidents` extrai apenas `data` de `useEmployees`, `useVehicles` e `useClients`, usando `[]` como fallback. Os estados de carregamento e erro dessas três consultas nunca são lidos nem renderizados, então falha de rede, falta real de cadastros e carregamento pendente compartilham a mesma lista vazia.

###############

Bug 1528

Sintoma: É possível registrar uma ação de RH como advertência, suspensão, treinamento ou recomendação de desligamento sem descrição e sem data efetiva, criando um registro disciplinar aberto que não informa fato, duração, providência nem quando deveria produzir efeito.
Provável causa: `HrActionsSection.handleAdd` exige valor e data somente para `payroll_discount`; para todos os outros tipos envia `description: null`, `effective_date: null` e valor zero normalmente. `add_employee_incident_action` valida apenas o enum do tipo e os dados do desconto, sem requisitos mínimos específicos para as demais ações formais.

###############

Bug 1529

Sintoma: Anotações, advertências, suspensões, treinamentos e solicitações de documento criadas numa ocorrência de RH permanecem para sempre com o selo “Aberta”; não existe ação na interface para concluí-las ou cancelá-las.
Provável causa: `add_employee_incident_action` grava todo tipo diferente de `payroll_discount` com `status = 'open'`. `HrActionsSection` apenas lista esse estado, e o projeto não possui hook, botão ou RPC de produção usado pelo frontend para transicionar `employee_incident_actions` a `completed` ou `cancelled` e preencher sua autoria/data de conclusão.

###############

Bug 1530

Sintoma: Um usuário `operator` pode contornar a tela e inserir ou alterar diretamente pela Data API um desconto de ocorrência já “concluído” para qualquer funcionário do tenant; numa geração/regeração posterior, o valor forjado é descontado da folha como fonte válida.
Provável causa: As policies `eia_insert` e `eia_update` concedem escrita ampla em `employee_incident_actions` a `is_tenant_operator_or_admin`. As constraints verificam apenas enums, referências do tenant e `amount > 0` para descontos; não obrigam o RPC, autoria coerente, data efetiva, transição ou imutabilidade. `generate_payroll_period` confia em toda linha `payroll_discount` com `status = 'completed'`, sem exigir aprovação administrativa adicional.

###############

Bug 1531

Sintoma: Criar um pedido sem preencher “Data Prometida” — condição permitida pela interface — falha no salvamento com erro de data inválida; também não é possível apagar uma data prometida já existente durante a edição.
Provável causa: `OrderForm.handleSubmit` converte `issue_date` vazia em `null`, mas omite `promised_date` da mesma normalização. O payload envia `promised_date: ''` para a coluna PostgreSQL do tipo `date`, e o PostgREST não consegue converter a string vazia.

###############

Bug 1532

Sintoma: Um usuário com papel `operator` vê “Pedidos” na navegação e todos os comandos de “Novo Pedido” e edição, mas só descobre depois de preencher e salvar o formulário que não possui permissão para criar ou alterar o registro.
Provável causa: O item `/orders`, sua rota e os botões não possuem restrição de papel, enquanto a RLS concede `SELECT` a papéis internos, mas reserva todo `INSERT`/`UPDATE` de `orders` à policy `Admins can manage orders`, baseada em `is_tenant_admin(tenant_id)`.

###############

Bug 1533

Sintoma: Depois que um pedido é associado a um cliente, a tela não permite remover esse vínculo para voltar ao estado “sem cliente”, embora `client_id` seja opcional e o cadastro de pedido aceite nascer sem cliente.
Provável causa: O `Select` de cliente contém somente os clientes carregados e não oferece item “Nenhum” nem outra ação que defina `client_id` como vazio. A conversão de string vazia para `null` existe no submit, mas torna-se inalcançável para um pedido que já possui valor selecionado.

###############

Bug 1534

Sintoma: Um administrador ou integração que grave diretamente a Data API consegue atribuir ao pedido qualquer texto de status, inclusive erros de digitação; a linha passa a exibir o código cru, não aparece em nenhum filtro de situação específico e pode ser contabilizada como pendente indefinidamente.
Provável causa: `OrderStatus` e `getNextStatuses` existem apenas no TypeScript/frontend. A tabela `orders` não possui `CHECK` para o vocabulário de status nem trigger/comando canônico que rejeite valores fora de `ORDER_STATUSES`; a RLS administrativa autoriza o `UPDATE` direto.

###############

Bug 1535

Sintoma: Alterações de status, cliente, destino, quantidades, frete, desconto e tributos de um pedido substituem o estado anterior sem permitir reconstruir quem mudou cada valor, quando ocorreu a transição ou qual era o conteúdo antes da edição.
Provável causa: `useUpdateOrder` executa um `UPDATE` direto da linha e grava apenas `updated_by`/`updated_at`. Não existe tabela de versões, evento em `entity_audit_log` nem trigger de auditoria para `orders`, de modo que o único snapshot anterior é perdido a cada salvamento.

###############

Bug 1536

Sintoma: Informar explicitamente zero paletes em um pedido aparenta salvar o valor, mas o banco recebe `null`; ao reabrir, a tela volta a mostrar zero e impede distinguir carga realmente não paletizada de quantidade de paletes desconhecida.
Provável causa: O formulário mantém `pallet_count` como número zero, porém a conversão genérica usa `out[k] = out[k] ? Number(out[k]) : null`. Como `0` é falso em JavaScript, ele vira `null`; na leitura, `order?.pallet_count || 0` mascara novamente essa perda de informação.

###############

Bug 1537

Sintoma: Trocar a empresa ativa com um convite de membro, edição de membro ou acesso do portal aberto conserva usuário, papel, cliente e permissões da empresa anterior; a confirmação passa a operar no tenant novo, podendo criar um convite no contexto errado ou até exibir sucesso para uma alteração que não atingiu linha alguma.
Provável causa: `TeamManagement`, `InviteDialog`, `EditMemberDialog` e `PortalAccessTab` não fecham nem limpam seus estados quando `currentTenant.id` muda. Os handlers recebem o `tenantId` atualizado, mas continuam usando `member`/`editing` e campos locais capturados antes da troca; updates ainda não verificam quantidade de linhas afetadas.

###############

Bug 1538

Sintoma: Se o catálogo de clientes falhar na aba “Acessos do Portal”, o seletor de cliente aparece vazio como se não existissem cadastros, sem erro nem opção de nova tentativa; acessos já existentes ainda aparecem, tornando a inconsistência especialmente enganosa.
Provável causa: `PortalAccessTab` consome somente `data` de `useClients`, aplica `[]` como fallback e filtra clientes ativos. Os estados `isLoading`, `isError` e `error` desse hook não são lidos nem propagados ao diálogo, embora o estado da consulta principal de acessos seja tratado separadamente.

###############

Bug 1539

Sintoma: Ao editar um acesso do portal, clicar em “Trocar”, informar o e-mail de uma pessoa que ainda não possui conta e salvar mostra a mensagem de que um convite será enviado, mas a operação falha em vez de convidar e transferir a concessão.
Provável causa: A busca renderiza o mesmo aviso de convite e habilita o botão para qualquer e-mail válido. Entretanto, `save` prioriza incondicionalmente o ramo `if (editing)` e tenta atualizar a linha com `user_id: ''`; somente o ramo de criação chama `create-team-member` para um e-mail ainda não cadastrado.

###############

Bug 1540

Sintoma: Dois administradores podem trocar simultaneamente o papel de um membro e ambos receberem “Papel atualizado”, embora a última resposta sobrescreva silenciosamente a decisão anterior sem avisar que a equipe mudou desde a leitura.
Provável causa: `updateRoleMutation` atualiza `tenant_memberships` somente por `id` e `tenant_id`, envia um novo `updated_at` produzido no navegador e não compara a revisão originalmente carregada. A tabela não possui comando de compare-and-swap para mudanças de papel.

###############

Bug 1541

Sintoma: Um administrador pode desativar, reativar ou remover um acesso do portal a partir de uma lista antiga depois que outro administrador acabou de alterar suas permissões; a mudança mais recente é revertida ou apagada sem conflito nem revisão.
Provável causa: `toggleActive` e `remove` filtram `client_portal_access` apenas por `id` e `tenant_id`. Embora a tabela mantenha `updated_at`, esses comandos não recebem a revisão vista, não usam RPC transacional e não exigem confirmação de que a linha continua no estado apresentado ao usuário.

###############

Bug 1542

Sintoma: Não é possível apurar quem promoveu, rebaixou, desativou ou reativou um membro interno, nem reconstruir os papéis e estados anteriores após uma alteração de acesso administrativo.
Provável causa: `TeamManagement` grava `role`, `active` e `updated_at` diretamente em `tenant_memberships`. A tabela não registra `updated_by`, não possui journal de versões ou trigger de auditoria, e o fluxo não insere eventos em `entity_audit_log`.

###############

Bug 1543

Sintoma: Ao filtrar a Rastreabilidade de Produto por fornecedor, número da NF ou período de emissão, itens ligados a uma nota excluída logicamente ainda podem entrar no resultado; a linha aparece sem fornecedor, NF e data mesmo tendo sido selecionada justamente pelos dados apagados.
Provável causa: Quando existe filtro documental, a consulta usa `fiscal_documents!inner` e aplica as condições sem `deleted_at IS NULL`. Somente depois de receber todas as linhas o frontend transforma documentos apagados em `null`, mas não remove o `load_item` que já passou pelo filtro no servidor.

###############

Bug 1544

Sintoma: Duas pessoas em fusos diferentes podem ver horários — e até dias — distintos para a mesma carga, coleta, parada ou evento na linha do tempo do Histórico do Produto, divergindo do período civil pelo qual o evento foi selecionado.
Provável causa: O RPC calcula `event_day` no fuso fixo de São Paulo, mas devolve os instantes em UTC; `fmtDateTime` os converte com `new Date` e `date-fns` no timezone local do navegador. O frontend não recebe nem aplica o timezone do tenant ao apresentar esses eventos.

###############

Bug 1545

Sintoma: Pesquisar literalmente `%` ou `_` em produto, fornecedor ou número de NF na Rastreabilidade de Produto retorna um conjunto amplo de linhas sem esses caracteres; uma placa com esses símbolos também pode produzir correspondências inesperadas.
Provável causa: Os textos digitados são interpolados diretamente em padrões `.ilike(..., `%${valor}%`)` sem escapar os curingas SQL `%` e `_`. A busca, portanto, interpreta caracteres do usuário como metacaracteres de padrão em vez de texto literal.

###############

Bug 1546

Sintoma: No Arquivo de Cobrança, informar uma data inicial posterior à final nos filtros de emissão ou vencimento simplesmente mostra nenhuma fatura elegível, sem avisar que o intervalo é inválido.
Provável causa: `BillingEdi` não relaciona os inputs com `min`/`max`, não calcula estado de período inválido e mantém “Buscar” e a query habilitados. `useEligibleInvoicesForEdi` apenas combina `gte` e `lte`; um intervalo invertido naturalmente retorna conjunto vazio.

###############

Bug 1547

Sintoma: Apagar “Data do arquivo” no diálogo DOCCOB pode produzir um nome contendo `NaN` e só descobrir a data inválida depois de montar o conteúdo e chamar o servidor, em vez de bloquear a geração no formulário.
Provável causa: `GenerateDialog` executa `new Date(fileDate + 'T00:00:00')` mesmo quando `fileDate` está vazio. `resolveFileName` formata o objeto inválido sem validar `isNaN`, `validateFileName` aceita o texto resultante e `handleGenerate` não exige `fileDate` antes de enviá-lo ao argumento SQL do tipo `date`.

###############

Bug 1548

Sintoma: Trocar a empresa ativa com a geração ou edição de perfil DOCCOB aberta conserva CNPJ, razão social, padrão, banco, destino e o perfil da empresa anterior; a confirmação passa a combinar esse estado com as faturas e o tenant recém-selecionados.
Provável causa: `BillingEdi` não fecha `genOpen`/`profileDlgOpen` na mudança de tenant. `GenerateDialog` e `ProfileDialog` inicializam seus estados locais apenas na montagem e permanecem montados enquanto abertos, embora `currentTenant`, perfis, clientes e faturas sejam substituídos pelas queries do novo contexto.

###############

Bug 1549

Sintoma: Dois operadores podem editar simultaneamente o mesmo perfil DOCCOB e ambos receber “Perfil salvo”, mas o último salvamento restaura silenciosamente banco, agência, conta, padrão de arquivo, códigos ou cliente que o primeiro acabou de alterar.
Provável causa: `useSaveEdiProfile` espalha o snapshot inteiro em um `upsert` identificado pelo `id`, sem comparar o `updated_at` originalmente carregado. Embora `trg_edi_profiles_touch` atualize a revisão, nenhum compare-and-swap ou RPC de edição a utiliza.

###############

Bug 1550

Sintoma: Abrir “Arquivo de Cobrança” fica progressivamente mais lento e pode transferir grande volume de dados conforme o histórico cresce, mesmo que o usuário permaneça na aba de geração; cada TXT antigo completo é carregado antecipadamente e todas as linhas são renderizadas de uma vez ao abrir o histórico.
Provável causa: `useEdiExports` percorre todas as páginas de `billing_edi_exports` com `select('*')`, incluindo `generated_content`, e é montado imediatamente pela página. `HistoryTab` não possui paginação, virtualização nem consulta separada para baixar o conteúdo de apenas um arquivo.

###############

Bug 1551

Sintoma: Selecionar todas as faturas elegíveis em uma empresa com histórico grande pode congelar a página ou falhar ao gerar o DOCCOB com uma requisição/URL excessiva, sem opção de gerar o conjunto em lotes controlados.
Provável causa: `useEligibleInvoicesForEdi` materializa e renderiza todas as páginas no navegador, e “Selecionar todas” cria um `Set` com todos os IDs. `fetchInvoicesBundle` repassa o array inteiro de UUIDs a três filtros PostgREST `.in(...)` sem particionamento, enquanto a interface não impõe tamanho máximo nem oferece paginação ou geração em lotes.

###############

Bug 1552

Sintoma: Em uma empresa com muitos perfis DOCCOB, parte dos perfis pode desaparecer da lista e da escolha automática; a geração usa então um perfil global ou valores padrão mesmo existindo uma configuração específica para o cliente.
Provável causa: `useEdiProfiles` faz um único `select('*')` ordenado, sem paginação, total ou detecção de saturação. `clientProfile` trata o array retornado como catálogo completo e não sinaliza que perfis posteriores ao limite do PostgREST foram omitidos.

###############

Bug 1553

Sintoma: Um cliente autenticado que chame diretamente `register_doccob_export` pode registrar qualquer TXT arbitrário e qualquer quantidade de registros como se fosse um DOCCOB válido, marcando as faturas como exportadas mesmo que o arquivo não represente suas cobranças e detalhes.
Provável causa: A validação adicionada ao RPC confere que o hash corresponde ao próprio `_generated_content` recebido e compara somente total e contagens de cobranças/detalhes com o banco. O servidor não recompõe nem interpreta o arquivo, não valida `_record_count` e não relaciona suas linhas ao conteúdo autoritativo; conteúdo e hash coerentes entre si continuam inteiramente controlados pelo chamador.

###############

Bug 1554

Sintoma: Dois administradores alterando ao mesmo tempo opções diferentes do agendamento SSX — por exemplo, um pausando a agenda e outro mudando o intervalo de sincronização — podem apagar silenciosamente a decisão um do outro; ambos recebem confirmação de atualização.
Provável causa: Cada controle envia uma cópia completa de `observability.schedule` para `update_tracking_schedule_v1`. O RPC faz `UPSERT` de `enabled`, `poll_interval_minutes` e `full_sync_interval_hours` sem revisão esperada, apesar de `tenant_tracking_schedules.updated_at` existir; o último snapshot grava novamente todos os campos.

###############

Bug 1555

Sintoma: Não existe histórico consultável de quem ativou ou pausou a agenda SSX nem dos intervalos anteriores; após uma alteração, só permanecem o estado atual e o último editor, impedindo reconstruir mudanças que afetaram a frequência operacional do tracking.
Provável causa: `update_tracking_schedule_v1` sobrescreve a única linha de `tenant_tracking_schedules`, mantendo somente `updated_at` e `updated_by`. O comando não insere evento em `entity_audit_log`, e a tabela não possui trigger ou journal de versões das configurações.

###############

Bug 1556

Sintoma: Um administrador pode ativar, desativar ou excluir um centro de custo usando uma lista antiga depois que outra pessoa acabou de alterar o mesmo cadastro; a mudança mais recente é revertida ou apagada sem aviso de conflito.
Provável causa: `toggleMutation` e `deleteMutation` filtram `cost_centers` apenas por `tenant_id` e `id`. Embora a linha possua `updated_at`, os comandos não recebem a revisão vista, não conferem o estado anterior e não usam compare-and-swap antes de confirmar a operação destrutiva.

###############

Bug 1557

Sintoma: Uma nota fiscal removida logicamente continua aparecendo como pendência na Auditoria de Extração de Carga e pode seguir no total, na tabela e no CSV mesmo depois de ter sido excluída das telas fiscais normais.
Provável causa: A consulta de `LoadExtractionAudit` lê `fiscal_documents` sem aplicar `deleted_at IS NULL` e nem seleciona o campo para descartá-lo no cliente. Assim, linhas soft-deleted que ainda possuem `client_load_number` nulo são tratadas como documentos ativos.

###############

Bug 1558

Sintoma: CT-es, documentos de saída ou outros registros fiscais que não deveriam receber o número de carga extraído da NF-e podem aparecer como “NFs sem número de carga extraído”, inflando as pendências e o CSV com falsos positivos.
Provável causa: Embora a tela descreva uma auditoria de NFs e `client_load_number` seja preenchido no fluxo de importação de NF-e, a query não seleciona nem filtra `fiscal_documents.document_type`; qualquer tipo de documento com o campo nulo entra no resultado.

###############

Bug 1559

Sintoma: Abrir no Excel o CSV da Auditoria de Extração pode executar uma fórmula originada do número da NF, chave, nome do cliente, destinatário, cidade ou observação importada do XML.
Provável causa: `exportCsv` apenas coloca cada valor entre aspas e duplica aspas internas. Prefixos interpretados por planilhas como `=`, `+`, `-`, `@`, tabulação ou retorno de carro não são neutralizados com `csvSafeCell` antes de gerar o arquivo.

###############

Bug 1560

Sintoma: Trocar a empresa ativa com uma observação aberta mantém no modal a chave, o destinatário e o trecho da NF da empresa anterior; o filtro de cliente anterior também permanece selecionado e pode deixar a nova empresa aparentemente sem resultados.
Provável causa: `LoadExtractionAudit` troca as queries pela chave do novo tenant, mas não redefine `openDoc`, `clientFilter` nem `copied` quando `currentTenant.id` muda. O diálogo renderiza o snapshot já guardado em estado local, e o seletor conserva um ID que pode nem existir no novo catálogo.

###############

Bug 1561

Sintoma: Ao inativar um veículo, todas as viagens históricas dele desaparecem da tabela “Eficiência de Veículos” e deixam de poder ser isoladas pelo filtro, embora as cargas do período continuem existindo e ainda influenciem outros indicadores do relatório.
Provável causa: `ProductivityReports` obtém motoristas com `includeInactive: true`, mas chama `useVehicles()` sem opção equivalente. O catálogo de veículos envia `_include_inactive = false`, e `vehicleEfficiency` só percorre esse catálogo ativo, descartando implicitamente cargas vinculadas a veículos inativados.

###############

Bug 1562

Sintoma: Trocar a empresa ativa depois de filtrar por motorista ou veículo pode deixar o Relatório de Produtividade inteiro vazio, com o seletor sem rótulo válido, mesmo quando a nova empresa possui cargas e ocorrências no período.
Provável causa: `useListFilters` persiste `driver` e `vehicle` nos parâmetros da URL e `ProductivityReports` não os redefine quando o tenant muda. Os novos arrays são então comparados aos UUIDs da empresa anterior, que normalmente não pertencem a nenhuma linha nem opção do tenant atual.

###############

Bug 1563

Sintoma: Abrir o Relatório de Produtividade fica progressivamente lento, consome muita rede e memória e pode travar a aba em empresas com histórico grande, mesmo quando o usuário pretende analisar somente um período curto.
Provável causa: A página carrega todas as páginas de cargas e ocorrências antes de aplicar datas, motorista e veículo no navegador, além de materializar catálogos completos. Depois executa buscas lineares de motorista para cada carga, de cliente para cada ocorrência e uma nova varredura de cargas para cada veículo, e renderiza as três tabelas sem paginação ou virtualização.

###############

Bug 1564

Sintoma: Dois ou mais motoristas com o mesmo primeiro nome aparecem no gráfico de desempenho com rótulos idênticos, impedindo saber qual barra pertence a cada pessoa e podendo levar à comparação do profissional errado.
Provável causa: `driverChartData` conserva os indicadores por ID, mas transforma todo rótulo em `d.name.split(' ')[0]`. O gráfico e seu tooltip recebem apenas esse primeiro token, sem sobrenome, matrícula ou outro identificador que desambigue homônimos.

###############

Bug 1565

Sintoma: Em uma empresa com muitos planejamentos não despachados, rascunhos antigos podem deixar de ser restaurados e aparentar ter desaparecido, embora continuem gravados no banco.
Provável causa: `useRoutePlanningDrafts` executa um único `select('*')` de `route_planning_drafts`, sem paginação, total ou detecção de saturação. A hidratação trata o lote retornado pelo limite padrão do PostgREST como a lista completa de rascunhos ativos.

###############

Bug 1566

Sintoma: Um único rascunho de rota com configuração incompleta ou incompatível pode quebrar toda a tela de Planejamento de Rotas durante a restauração, impedindo acessar inclusive os demais rascunhos válidos.
Provável causa: `routeSnapshot` aceita qualquer objeto JSON como `RoutePlanSnapshot`, e a hidratação verifica apenas se `stops` é um array. Objetos de parada não passam por schema; renderização e simulação acessam diretamente propriedades como `invoice_numbers.length`, `fiscal_document_ids.length` e campos numéricos, podendo lançar uma exceção ao encontrar estrutura malformada.

###############

Bug 1567

Sintoma: Informar um número extremamente grande, como `1e309`, no deslocamento até a primeira parada ou no tempo de serviço pode derrubar a simulação e a página em vez de rejeitar o valor no campo.
Provável causa: Os inputs possuem apenas `min={0}`, sem máximo nem validação `Number.isFinite`. Os handlers preservam `Infinity`, `simulateStopTimeline` soma esse valor ao timestamp e chama `toISOString()` sobre uma data inválida, o que lança `RangeError` durante a atualização do estado.

###############

Bug 1568

Sintoma: Uma rota manual pode ser salva e despachada com nome visualmente vazio ao digitar somente espaços, deixando rascunho, viagem, recuperação de despacho e relatórios sem identificação útil.
Provável causa: `_createRouteFromSelected` usa `newRouteName || nomePadrão`; uma string de espaços é truthy e não é aparada. Nem o autosave de `route_planning_drafts` nem a cadeia `dispatch_planned_route_v3`/`v2`/`dispatch_planned_route` valida `btrim(route_name)` antes de persistir o texto.

###############

Bug 1569

Sintoma: Dois usuários podem editar simultaneamente a mesma conta a pagar e ambos receber confirmação, mas o último salvamento restaura silenciosamente fornecedor, valor, vencimento, categoria, documento, situação ou observações que o primeiro acabou de alterar.
Provável causa: `openAccount` guarda um snapshot, porém `useUpdatePayable` atualiza por `tenant_id` e `id` sem enviar ou comparar o `updated_at` lido. O trigger apenas gera um novo timestamp; ele não transforma a gravação em compare-and-swap nem detecta revisão obsoleta.

###############

Bug 1570

Sintoma: Informar um valor positivo menor que meio centavo, como `0,001`, pode criar uma conta a pagar de `R$ 0,00`, que depois não pode ser aprovada e passa a invalidar provas e totais financeiros.
Provável causa: O campo aceita qualquer passo digitado e `handleSave` verifica somente `Number(form.amount) > 0`, sem exigir centavos inteiros. A coluna `payables.amount` é `numeric(14,2)` e arredonda a entrada para duas casas, enquanto a tabela não possui `CHECK (amount > 0)` que rejeite o zero resultante.

###############

Bug 1571

Sintoma: A carteira permite abrir e alterar diretamente fornecedor, valor, vencimento, categoria, documento ou observações de uma conta gerada por folha, manutenção, estoque, adiantamento ou outra origem operacional, deixando o título divergente do processo que o criou.
Provável causa: `PayablePortfolioPanel` oferece “Abrir conta” para todas as origens, e `Payables` envia os mesmos campos por `useUpdatePayable` sem restringir `source`/`source_table`. As guardas atuais protegem pagamento, cancelamento e aprovação, mas não exigem que títulos derivados sejam corrigidos pelo comando canônico da entidade de origem.

###############

Bug 1572

Sintoma: Depois de uma alteração manual em uma conta a pagar pendente ou vencida, não é possível reconstruir quem mudou fornecedor, valor, data, categoria, documento ou observações nem quais eram os valores anteriores.
Provável causa: A atualização direta de `payables` grava apenas o estado corrente e aciona `trg_payables_updated_at`; a tabela não possui `updated_by`, journal de versões ou trigger que registre essas edições em `finance_events`. Eventos auditáveis existem para aprovação e comandos financeiros específicos, não para o editor material genérico.

###############

Bug 1573

Sintoma: Um administrador que chame diretamente o RPC pode marcar qualquer coordenada como “endereço selecionado entre as opções assistidas”, gravando provedor, precisão, confiança e rótulo inventados como se viessem do geocodificador.
Provável causa: `resolve_address_queue_item_v2` valida faixas da latitude/longitude e o texto de `selection_kind`, mas, quando o tipo é `assisted_candidate`, não compara os dados recebidos com nenhum objeto de `address_resolution_queue.candidates`. Todo o payload continua controlado pelo cliente e é promovido a endereço canônico verificado e auditoria.

###############

Bug 1574

Sintoma: Ao arrastar ou clicar no mapa mais de uma vez antes de confirmar um endereço, a auditoria registra como posição anterior apenas o último ponto intermediário, perdendo a coordenada originalmente sugerida pelo geocodificador e a distância total do ajuste humano.
Provável causa: A função `adjust` sobrescreve `previous_lat` e `previous_lng` com `current.latitude/longitude` em cada movimento. Depois do primeiro ajuste, `current` já representa outro ponto manual; não existe campo separado e imutável para conservar a seleção assistida inicial até o envio.

###############

Bug 1575

Sintoma: Quando dois provedores ou resultados distintos devolvem exatamente a mesma latitude e longitude, a lista de opções pode reutilizar o botão errado, trocar rótulos de forma instável ou ocultar visualmente uma das alternativas durante atualizações.
Provável causa: `AddressResolutionPicker` usa somente `${candidate.latitude}:${candidate.longitude}` como `key` do React. Provedor e identidade/posição do resultado não participam da chave, portanto candidatos diferentes no mesmo ponto produzem chaves duplicadas e reconciliação ambígua.

###############

Bug 1576

Sintoma: Um clique duplo em “Salvar rascunho”, “Marcar como devolvido” ou “Salvar e gerar protocolo” pode criar dois protocolos distintos para a mesma devolução, cada um com numeração própria e itens duplicados.
Provável causa: Os três botões continuam habilitados durante `createMut.isPending`, `submitProtocol` não possui trava local e `create_pallet_return_protocol` não recebe `request_id` nem aplica uma chave idempotente de criação. Duas mutations concorrentes consomem números e inserem transações válidas independentes.

RESOLVIDO

###############

Bug 1577

Sintoma: Abrir no Excel um CSV de protocolos ou relatórios de paletes pode executar uma fórmula originada do fornecedor, motorista, placa, recebedor, tipo ou outro texto cadastrado/importado.
Provável causa: `protocolsToCsv` e `rowsToCsv` usam `esc`, que apenas trata aspas, ponto e vírgula e quebra de linha. Valores iniciados por `=`, `+`, `-`, `@`, tabulação ou retorno de carro não são neutralizados antes de serem entregues a uma planilha.

###############

Bug 1578

Sintoma: O CSV de protocolos pode mostrar a data de lançamento ou devolução um dia antes da registrada para usuários em fusos a oeste de UTC, incluindo o fuso de São Paulo.
Provável causa: `palletReturnCsv.fmtDate` passa colunas civis `YYYY-MM-DD` diretamente a `new Date`, que interpreta a string como meia-noite UTC, e depois usa `toLocaleDateString` no fuso local. A conversão desloca a data para o dia anterior em vez de preservar o valor civil.

###############

Bug 1579

Sintoma: Ao importar um arquivo com algumas abas válidas e outras sem fornecedor, data ou itens, a operação informa sucesso apenas para as válidas e descarta silenciosamente as demais, sem incluí-las na contagem de erros do lote.
Provável causa: `commitImport` monta `valid` com um `filter` local e envia somente esse subconjunto a `useImportPalletReturns`. As abas rejeitadas antes da mutation não geram objeto em `errors`, não entram em `row_count` e desaparecem quando `previewList` é limpo após o sucesso.

###############

Bug 1580

Sintoma: É possível cadastrar dois tipos de palete com o mesmo código no mesmo tenant, criando opções visualmente ambíguas e fazendo relatórios somarem tipos conceitualmente distintos no mesmo grupo.
Provável causa: `PalletTypesEditor` e `useUpsertPalletType` não verificam duplicidade normalizada, e `pallet_types` possui apenas chave primária por `id`, sem índice único por tenant/código. Relatórios posteriores usam `pallet_type_code` como chave de agregação.

###############

Bug 1581

Sintoma: Clicar em “Abrir comprovante assinado” pode não abrir nada em navegadores com bloqueio de pop-up, sem qualquer aviso, mensagem de erro ou alternativa de download.
Provável causa: O handler aguarda `getPalletProofSignedUrl` e só depois chama `window.open`, já fora da ativação direta do clique. Tanto uma URL nula quanto o retorno nulo de `window.open` são ignorados, de modo que a interface não distingue falha de assinatura, bloqueio do navegador e abertura bem-sucedida.

###############

Bug 1582

Sintoma: Editar itens com quantidades fracionárias pode arredondar cada linha e o total de maneiras diferentes; por exemplo, duas linhas de `1,4` podem terminar com itens somando 2 e cabeçalho informando total 3.
Provável causa: O editor aceita qualquer `Number` positivo e `edit_pallet_return_protocol_v1` lê as quantidades como `numeric`, somando-as antes de gravar. `pallet_return_items.quantity` e `pallet_return_protocols.total_quantity` são inteiros, então o PostgreSQL arredonda separadamente o total agregado e cada item, sem exigir `quantity = trunc(quantity)` nem conferir a soma persistida.

###############

Bug 1583

Sintoma: Dois usuários — ou dois cliques rápidos em “Importar” — podem importar ao mesmo tempo a mesma devolução e ambos criarem protocolos duplicados, apesar da verificação de duplicidade existente.
Provável causa: O botão não é desabilitado por `importMut.isPending`, e cada execução faz um `select` de protocolos da data antes de chamar a criação. Não existe lock, chave de conteúdo única ou comando idempotente que torne atômica a sequência “verificar e inserir”; duas transações podem observar ausência e gravar em seguida.

###############

Bug 1584

Sintoma: Trocar a empresa ativa com detalhe, cancelamento, comprovante ou edição de protocolo aberto mantém os dados do tenant anterior; no detalhe, baixar o PDF pode combinar o protocolo antigo com razão social, CNPJ, endereço e logotipo da empresa nova.
Provável causa: O efeito de mudança de tenant limpa apenas o formulário novo e a prévia de importação. `detail`, `cancelTarget`, `attachTarget`, `editTarget` e seus campos permanecem em memória, enquanto `printProtocol` passa a usar imediatamente `useCompanyProfile` e `currentTenant` do contexto recém-selecionado.

###############

Bug 1585

Sintoma: A mesma cidade pode ser adicionada duas ou mais vezes aos destinos de uma única Rota Operacional, aparecendo repetida no cadastro sem receber o aviso “Duplicada” e tornando regras individuais de periodicidade/dias ambíguas.
Provável causa: `addDest` apenas aplica `trim` e concatena um novo objeto; não compara o nome normalizado com os destinos já existentes. O detector `duplicateCities` usa um `Set` por rota e alerta somente quando a cidade aparece em rotas ativas diferentes, ocultando duplicidades internas.

###############

Bug 1586

Sintoma: Não é possível reconstruir quem alterou classificação, região, descrição, status ativo, periodicidade ou destinos de uma Rota Operacional, nem recuperar a configuração anterior depois de uma edição indevida.
Provável causa: `useUpdateOperationalRoute` sobrescreve a linha e conserva apenas `updated_at`/`updated_by`. O trigger `trg_operational_routes_audit_name` insere evento exclusivamente quando o nome muda, e o comando auditável existente cobre somente exclusão; os demais campos materiais não geram versão ou `entity_audit_log`.

###############

Bug 1587

Sintoma: Depois de cancelar a versão mais recente de uma Folha de Devolução, a tela pode ocultar justamente essa versão cancelada e exibir uma versão substituída como “anterior”; quando existe apenas uma versão cancelada, nenhuma folha aparece para consulta ou download.
Provável causa: `OccurrenceReturnSheetPage` considera ativa apenas uma folha `generated`, `printed` ou `signed`, mas monta “Versões anteriores” com `sheetsQuery.data.slice(1)`, supondo que o primeiro item ordenado por versão seja sempre a ativa. Se a versão mais nova estiver cancelada, ela é descartada pelo `slice`; a seção ainda só existe quando há mais de uma linha.

###############

Bug 1588

Sintoma: Baixar novamente uma Folha de Devolução histórica depois de alterar nome, CNPJ, endereço, telefone ou logotipo da empresa gera um PDF diferente do documento original, embora a folha possua um snapshot destinado a preservar o cabeçalho da época.
Provável causa: A página passa simultaneamente `sheet.company_snapshot` e o `companyInfo` vivo para `buildReturnSheetPdf`, mas `drawHeader` prioriza todos os campos de `companyInfo` atual antes de `companyName`/`company.name` do snapshot. Além disso, a geração persiste no snapshot somente o nome do tenant, sem os demais dados cadastrais usados no PDF.

###############

Bug 1589

Sintoma: Após assinar uma Folha de Devolução e regerar outra versão — ou navegar para outra ocorrência/empresa sem remontar a página — o nome e o documento do recebedor anterior continuam preenchidos e podem ser anexados ao comprovante errado.
Provável causa: `receiverName` e `receiverDoc` são estados únicos do componente, inicializados somente na montagem. `handleUpload` não os limpa após sucesso e não existe efeito vinculado a `activeSheet.id`, `occurrenceId` ou ao tenant para reinicializá-los quando muda a folha que receberá o arquivo.

###############

Bug 1590

Sintoma: Os campos “Conferente” e “Ajudante” saem sempre vazios no PDF da Folha de Devolução, mesmo quando a operação dispõe dessas informações.
Provável causa: `occurrenceReturnSheetPdf` lê `company_snapshot.load.conferente` e `.helper`, mas `generate_occurrence_return_sheet` nunca inclui essas chaves ao construir `_load_row`; a própria tabela `loads` usada pela função tampouco possui essas colunas, deixando os dois rótulos sem fonte de dados em todo documento gerado.

###############

Bug 1591

Sintoma: Clicar em “Ver folha assinada” pode não abrir nada em navegadores que bloqueiam popups iniciados após uma operação assíncrona, sem qualquer mensagem explicando ao usuário como acessar o comprovante.
Provável causa: O clique primeiro aguarda `getSignedProofUrl` e só depois chama `window.open`, já fora da ativação direta do usuário em vários navegadores. O retorno nulo de `window.open` não é verificado; o toast cobre apenas falha ao criar a URL assinada.

###############

Bug 1592

Sintoma: Na noite de 31 de dezembro no Brasil, uma Folha de Devolução pode receber antecipadamente número e sequência do ano seguinte, por exemplo `SAC-2027-...` ainda em 31/12/2026 no calendário da empresa.
Provável causa: `generate_occurrence_return_sheet` chama `next_occurrence_return_sheet_number(_tenant, current_date)`. `current_date` segue o timezone da sessão do banco, normalmente UTC, e a função não consulta o fuso do tenant; em São Paulo a data UTC vira 1º de janeiro três horas antes da virada local.

###############

Bug 1593

Sintoma: Dois cliques rápidos em “Salvar em apuração” ou “Salvar e confirmar” podem criar duas faltas de mercadoria idênticas, com números diferentes, duplicando itens e valores mensais.
Provável causa: Os dois botões continuam habilitados durante `createCase.isPending`, e `submitNew` pode disparar chamadas concorrentes. `create_merchandise_shortage_case` sempre consome um novo número e insere caso/itens sem chave de requisição, fingerprint, restrição natural ou outra proteção idempotente.

RESOLVIDO

###############

Bug 1594

Sintoma: Casos de falta cancelados ou classificados como “não é falta” continuam somando nos indicadores “A cobrar”, “Assumido” e “Ressarcido” e nas tabelas de Responsabilidades, fazendo os totais gerenciais divergirem do “Valor total” e do relatório mensal.
Provável causa: `totalMonth` e `useShortageReportRows` excluem `cancelled`/`not_shortage`, mas `totalToCharge`, `totalWrittenOff`, `totalReimbursed` e cada agrupamento de Responsabilidades reduzem `casesData` integral. O cancelamento e a descaracterização também não zeram os valores já lançados.

###############

Bug 1595

Sintoma: Abrir no Excel um CSV do relatório de Faltas de Mercadoria pode executar uma fórmula originada de empresa, motorista, nota, cidade, cliente, produto, observação ou outro texto importado/cadastrado.
Provável causa: `shortageReportCsv.esc` trata apenas aspas, ponto e vírgula e quebra de linha; valores iniciados por `=`, `+`, `-` ou `@` são gravados sem neutralização, permitindo CSV/Formula Injection quando a planilha é aberta.

###############

Bug 1596

Sintoma: Depois de pré-visualizar uma planilha válida de faltas, selecionar um segundo arquivo inválido pode manter na tela os casos do primeiro arquivo, mas associá-los ao hash do segundo; confirmar nesse estado importa dados antigos com uma identidade de arquivo incorreta e prejudica a deduplicação futura.
Provável causa: `handleFile` atualiza `previewFingerprint` logo após calcular o SHA-256 e somente depois chama `parseShortageWorkbook`. A função não usa `try/catch` nem limpa a prévia anterior no início; se o parser lançar, `preview` permanece antigo enquanto o fingerprint já foi substituído, e o erro assíncrono não recebe feedback na interface.

###############

Bug 1597

Sintoma: Trocar a empresa ativa com o detalhe ou o cadastro de uma Ocorrência Operacional aberto mantém na tela o evento e o chat da empresa anterior; o formulário novo também conserva carga, cliente e motorista antigos enquanto os seletores já exibem opções do tenant novo.
Provável causa: `OperationalEvents` não reinicializa `selectedEvent`, `dialogOpen`, `form`, `chatDriver` nem os filtros quando `currentTenant.id` muda. As queries e catálogos trocam de escopo, mas esses estados locais continuam guardando objetos e UUIDs do contexto anterior.

###############

Bug 1598

Sintoma: O preset “Resolvidas últimos 7 dias” omite ocorrências antigas que foram efetivamente resolvidas nessa semana e inclui ocorrências criadas na semana cujo instante de resolução não corresponde ao período prometido.
Provável causa: O preset define `status = resolved` e `dateFromISO`, porém o filtro paginado aplica `date_from` ao campo de criação dos eventos. Não existe opção de filtrar `resolved_at`, embora o rótulo descreva a data da resolução, não a data em que a ocorrência foi aberta.

###############

Bug 1599

Sintoma: Todas as ocorrências encerradas pela página ficam com a mesma resolução “Resolvido pela operação”, impedindo registrar o que foi feito, quem/qual área assumiu o custo ou qual evidência justificou o encerramento.
Provável causa: Tanto o ícone da tabela quanto o botão do detalhe chamam `handleResolve`, que envia diretamente a constante `resolution: 'Resolvido pela operação'`. Não há diálogo ou campo de resolução antes de executar o comando auditável.

###############

Bug 1600

Sintoma: Uma falha ao consultar fornecedores, regiões ou documentos no Simulador de Frete aparece como catálogos vazios e “0 documento(s) listado(s)”, levando o usuário a acreditar que não há dados e a simular com contexto incompleto.
Provável causa: As três chamadas `useQuery` são consumidas somente pelos fallbacks `data = []`. A página não observa `isLoading`, `isError` ou `error` dessas queries e mantém seletores, busca e cálculo habilitados durante indisponibilidade.

###############

Bug 1601

Sintoma: Com “Excluir cancelados/duplicados” ativo e o filtro em CT-e ou NF-e, a busca rápida ainda pode carregar um documento cancelado, rejeitado, duplicado ou do tipo oposto que esteja fora da lista visível.
Provável causa: Quando não encontra correspondência local, `handleQuickSearch` consulta `fiscal_documents` ignorando deliberadamente o período, mas também deixa de reaplicar `onlyValid`, `docTypeFilter`, `is_duplicate` e a lógica de deduplicação usada na query principal.

###############

Bug 1602

Sintoma: Digitar apenas os últimos dígitos de uma nota ou chave na busca rápida pode carregar silenciosamente o documento errado quando mais de uma linha visível termina com o mesmo trecho.
Provável causa: A busca local usa `filteredDocs.find` com `num.endsWith(term)`/`key.endsWith(term)` e aceita a primeira coincidência sem medir ambiguidade. A verificação de múltiplos resultados existe apenas no fallback ao banco, que nem é executado quando qualquer correspondência local é encontrada.

###############

Bug 1603

Sintoma: Ao filtrar somente documentos válidos, vários documentos sem chave, número ou emitente podem desaparecer do seletor do Simulador de Frete, restando arbitrariamente apenas um deles.
Provável causa: A deduplicação cria a chave fallback ``${invoice_number || ''}|${remitter || ''}|${document_type || ''}``. Mesmo quando os identificadores úteis estão vazios, a string contém separadores e é truthy; todos os registros incompletos do mesmo tipo colidem no `Map`, tornando inalcançável o `if (!key) continue` que aparenta tratar ausência de identidade.

###############

Bug 1604

Sintoma: O Simulador pode continuar exibindo como atual um valor de frete calculado para parâmetros anteriores depois que o usuário muda fornecedor, região, grupo, valores ou destino com o recálculo automático desligado; se uma nova tentativa lançar erro, o resultado antigo também permanece abaixo do formulário.
Provável causa: Apenas `loadFromDoc` e a busca rápida executam `setResult(null)`. Os demais setters não invalidam o resultado, e o `catch` de `handleSimulate` mostra no máximo um toast sem limpar `result`; em modo automático, a exceção é ainda silenciosa.

###############

Bug 1605

Sintoma: É possível simular frete com valor da NF, peso ou quantidade de paletes negativos, reduzindo artificialmente os componentes percentual, por quilo e por palete e produzindo uma prévia economicamente inválida.
Provável causa: Os inputs numéricos não possuem `min` nem validação e `handleSimulate` envia os números negativos diretamente. `calculateFreight` multiplica essas grandezas pelas tarifas e aplica somente `Math.max(baseValue, minValue)`, sem rejeitar métricas abaixo de zero.

###############

Bug 1606

Sintoma: Usuários operadores veem botões para criar, importar, editar e excluir Regiões por Cliente e Tabelas de Frete, preenchem formulários e confirmações normalmente, mas todas essas ações terminam em erro de permissão.
Provável causa: `ClientRegions` e `FreightTables` não verificam perfil administrativo para renderizar ou habilitar ações. No banco, as policies `Admins can manage client_regions` e `Admins can manage freight_tables` autorizam escrita somente a `is_tenant_admin`, enquanto membros possuem apenas leitura.

###############

Bug 1607

Sintoma: Se o sistema permanecer aberto durante a virada do dia, uma nova Tabela de Frete continua preenchendo “Data Limite Início” com a data do dia anterior até a página ser recarregada.
Provável causa: `emptyForm.valid_from` chama `localDateInputValue()` uma única vez, na avaliação do módulo. Novos cadastros e `resetForm` reutilizam o mesmo objeto constante em vez de calcular a data no momento em que o diálogo é aberto.

###############

Bug 1608

Sintoma: É possível cadastrar uma Tabela de Frete cujo nome contém somente espaços, fazendo a listagem exibir uma identificação visualmente vazia e dificultando distinguir qual regra foi aplicada no detalhamento do cálculo.
Provável causa: O botão testa apenas `!form.table_name`, portanto uma string de espaços é considerada válida. A mutation grava `values.table_name` sem `trim`, e `freight_tables.table_name` possui somente `NOT NULL`, sem `CHECK` que rejeite texto vazio após normalização.

###############

Bug 1609

Sintoma: Depois de escolher um cliente em uma Região por Cliente, não é possível limpar a seleção para tornar o mapeamento genérico para todos os clientes; uma região específica existente também não pode ser convertida em genérica pela edição.
Provável causa: O formulário suporta `client_id = null` e a tabela exibe esse caso como `*`, mas o `Select` de cliente contém somente clientes reais, sem item “Nenhum/Todos”. O estado vazio existe apenas antes da primeira seleção ou via importação e não pode ser restaurado pela interface.

###############

Bug 1639

Sintoma: Na tela Clientes e Fornecedores, pesquisar literalmente `%` retorna todos os cadastros; `_` também funciona como curinga de um caractere e a barra invertida pode alterar o padrão, tornando impossível buscar esses símbolos de forma confiável.
Provável causa: O frontend remove `%` e barra invertida antes de chamar `list_operator_clients_page_v1`, convertendo uma busca composta só por esses caracteres em busca vazia. O RPC aplica o texto recebido diretamente em `ILIKE`, no qual `%`, `_` e barra invertida possuem significado especial. A correção preserva o texto digitado e escapa os metacaracteres antes de enviá-lo ao leitor paginado.

RESOLVIDO

###############

Bug 1640

Sintoma: Na tela Ordens de Manutenção, clicar em “Salvar” com o formulário totalmente vazio cria uma OS aberta sem veículo, ativo ou problema relatado, contaminando indicadores, histórico operacional e inventários financeiros derivados.
Provável causa: `MaintenanceOrders` validava apenas números negativos; veículo e problema relatado eram enviados como `null`. A tabela `maintenance_orders` também não exigia um objeto de manutenção nem uma descrição não vazia. A correção bloqueia o formulário, normaliza a descrição e adiciona restrições no banco para qualquer cliente ou integração.

RESOLVIDO

###############

Bug 1641

Sintoma: Abrir “Ativos e patrimônio” por link direto, favorito ou recarregar a página em `/assets` exibe o conteúdo JavaScript minificado de um chunk no lugar do sistema. A navegação interna pode mascarar a falha enquanto a sessão já está carregada.
Provável causa: A rota funcional `/assets` usa o mesmo namespace da pasta de artefatos estáticos gerada pelo Vite e copiada de `public/assets`. Na hospedagem, o arquivo estático tem precedência sobre o fallback da SPA. A correção move a tela para `/asset-management`, atualiza a navegação e redireciona permanentemente o endereço antigo antes da resolução dos arquivos estáticos.

RESOLVIDO

###############

Bug 1642

Sintoma: Depois de a página “Ativos e patrimônio” abrir, a listagem termina em “Não foi possível carregar os patrimônios: erro desconhecido”, mesmo quando a empresa ainda não possui nenhum ativo.
Provável causa: A consulta embutia `employees(name)` sem identificar a relação. A tabela `assets` possui duas chaves estrangeiras válidas para `employees` — a histórica por `responsible_employee_id` e a composta por empresa —, então o PostgREST rejeita o embed como ambíguo. Além disso, o erro retornado é um objeto com `message`, mas a interface aceitava apenas instâncias de `Error`, ocultando o diagnóstico. A correção escolhe explicitamente `assets_responsible_employee_id_fkey` e passa a extrair mensagens estruturadas com segurança.

RESOLVIDO

###############

Bug 1643

Sintoma: Um administrador com acesso a AGV e LIRA seleciona a outra empresa e recebe apenas “Não foi possível trocar a empresa ativa”; a tela não muda e, após entrar novamente, pode abrir inesperadamente na empresa cuja troca havia falhado.
Provável causa: `activateTenantId` persistia `set_active_tenant_context_v1` antes de descobrir que o refresh token do navegador havia expirado. A rotação do JWT falhava, a interface voltava para a empresa anterior, mas o contexto durável no banco permanecia alterado. A correção valida a sessão antes de persistir, restaura o contexto anterior se a rotação final falhar e informa explicitamente quando é necessário entrar novamente.

RESOLVIDO

###############

Bug 1644

Sintoma: Quando a troca de empresa detecta uma sessão expirada, a tela informa que o usuário deve sair e entrar novamente, mas oculta toda a aplicação — inclusive o botão “Sair” — e oferece somente “Tentar novamente”, que repete a mesma falha indefinidamente.
Provável causa: `TenantProvider` substituía seus filhos pelo alerta genérico em qualquer erro de contexto e não tinha uma ação de reautenticação. Além disso, o logout global pode ser recusado pelo próprio refresh token inválido. A correção mostra “Entrar novamente” nesse caso e, se o servidor recusar o logout por sessão expirada, limpa a sessão irrecuperável localmente para retornar com segurança à autenticação.

RESOLVIDO

###############

Bug 1645

Sintoma: Ao abrir o formulário “Nova Carga”, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela não recebem uma descrição do objetivo do diálogo.
Provável causa: `NewLoadDialog` renderiza `DialogContent` e `DialogTitle`, mas não inclui o `DialogDescription` exigido pelo contrato acessível do componente Radix.

RESOLVIDO

###############

Bug 1646

Sintoma: Ao abrir “Novo Pedido” ou editar um pedido, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem apenas o título, sem contexto sobre o formulário.
Provável causa: O diálogo de pedidos em `Orders` renderiza `DialogContent` e `DialogTitle`, mas omite o `DialogDescription` exigido pelo contrato acessível do componente Radix.

RESOLVIDO

###############

Bug 1647

Sintoma: Ao abrir os formulários “Novo veículo”, “Novo motorista” ou “Novo funcionário”, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem apenas o título, sem contexto sobre cada cadastro.
Provável causa: Os três diálogos de Frota e Pessoas renderizavam `DialogContent` e `DialogTitle`, mas omitiam o `DialogDescription` exigido pelo contrato acessível do componente Radix. A correção inclui descrições específicas para criação e edição em todos os três formulários.

RESOLVIDO

###############

Bug 1648

Sintoma: Clicar em “Novo Fornecedor” abre um formulário intitulado “Novo Cliente”, embora os controles internos estejam corretamente configurados como fornecedor. O título contraditório pode fazer o operador cancelar o cadastro ou duvidar de qual categoria será salva.
Provável causa: `ClientFormDialog` usava textos fixos “Novo Cliente” e “Editar Cliente” sem considerar `defaultKind` nem os marcadores `is_client` e `is_supplier` do cadastro. A correção deriva o rótulo da entidade para criação e edição.

RESOLVIDO

###############

Bug 1649

Sintoma: Ao abrir o cadastro de cliente ou fornecedor, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem somente o título, sem contexto sobre os dados do formulário.
Provável causa: `ClientFormDialog` renderizava `DialogContent` e `DialogTitle`, mas omitia o `DialogDescription` exigido pelo contrato acessível do componente Radix. A correção inclui uma descrição dinâmica para criação e edição de clientes e fornecedores.

RESOLVIDO

###############

Bug 1650

Sintoma: Ao abrir “Novo Item” ou “Nova Movimentação” em Estoque e Almoxarifado, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem apenas o título, sem explicar o objetivo do formulário.
Provável causa: Os dois diálogos de `Stock` renderizavam `DialogContent` e `DialogTitle`, mas omitiam o `DialogDescription` exigido pelo contrato acessível do componente Radix. A correção inclui descrições específicas para o cadastro de item e para a movimentação de saldo.

RESOLVIDO

###############

Bug 1651

Sintoma: Ao abrir “Novo Local” ou “Novo Movimento” no Inventário Logístico, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem somente o título, sem contexto sobre o cadastro ou a movimentação.
Provável causa: Os dois diálogos de `Inventory` renderizavam `DialogContent` e `DialogTitle`, mas omitiam o `DialogDescription` exigido pelo contrato acessível do componente Radix. A correção inclui descrições específicas para o cadastro de local e para a movimentação do inventário.

RESOLVIDO

###############

Bug 1652

Sintoma: A tela “Eventos operacionais” permanece em consulta e termina com todos os indicadores, gráficos e a listagem indisponíveis, exibindo `Cannot read properties of undefined (reading 'rest')`; nenhuma ocorrência pode ser consultada.
Provável causa: O leitor paginado guardava `supabase.rpc` em uma constante sem vinculá-la ao cliente Supabase. Ao executar a função destacada, o SDK perdia o receptor `this` usado para acessar seu transporte REST. A correção vincula explicitamente o método ao cliente e adiciona um teste que falha se o receptor do SDK for perdido novamente.

RESOLVIDO

###############

Bug 1653

Sintoma: Ao abrir “Nova Ocorrência” ou “Salvar preset de filtros” em Eventos Operacionais, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem somente o título, sem contexto sobre cada formulário.
Provável causa: Os dois diálogos de `OperationalEvents` renderizavam `DialogContent` e `DialogTitle`, mas omitiam o `DialogDescription` exigido pelo contrato acessível do componente Radix. A correção inclui descrições específicas para o registro de ocorrência e para o preset de filtros.

RESOLVIDO

###############

Bug 1654

Sintoma: O formulário “Nova Ocorrência” mantém “Registrar” habilitado com a descrição vazia ou curta demais e permite informar impacto financeiro negativo, embora o contrato do comando recuse esses valores depois de iniciar a operação.
Provável causa: A interface não espelhava as restrições já existentes no schema do comando — descrição normalizada com pelo menos 5 caracteres e impacto maior ou igual a zero. A correção valida antes da mutation, normaliza a descrição, limita o campo numérico e desabilita o envio enquanto os valores forem inválidos.

RESOLVIDO

###############

Bug 1655

Sintoma: A tela “Checklists” fica totalmente indisponível e exibe “Não foi possível carregar os checklists”, impedindo consultar templates, execuções e iniciar uma nova conferência.
Provável causa: A consulta de `checklist_executions` embutia `operational_checklists` e `employees` sem identificar a relação. Depois da criação das chaves compostas por empresa, essas tabelas passaram a ter mais de uma relação válida e o PostgREST rejeita o embed como ambíguo. A correção seleciona explicitamente as relações compostas e seguras por `tenant_id` para template, veículo e funcionário.

RESOLVIDO

###############

Bug 1656

Sintoma: Quando uma das fontes da tela “Checklists” falha, a interface mostra somente “Falha na consulta dos dados necessários”, ocultando a mensagem estruturada enviada pelo PostgREST e dificultando identificar a consulta quebrada.
Provável causa: A tela aceitava apenas instâncias nativas de `Error`, mas o cliente Supabase retorna erros estruturados com a propriedade `message`. A correção usa o extrator compartilhado que reconhece os dois formatos.

RESOLVIDO

###############

Bug 1657

Sintoma: Ao abrir “Novo Template” ou o formulário de execução de checklist, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem apenas o título, sem contexto sobre a criação ou a conferência.
Provável causa: Os dois diálogos de `Checklists` renderizavam `DialogContent` e `DialogTitle`, mas omitiam o `DialogDescription` exigido pelo contrato acessível do componente Radix. A correção inclui descrições específicas para criação do modelo e execução da conferência.

RESOLVIDO

###############

Bug 1658

Sintoma: “Novo Template” mantém o botão “Criar” habilitado com o nome vazio e, para nomes válidos com espaços nas extremidades, grava o texto sem normalização.
Provável causa: A validação de nome existia apenas dentro do manipulador, depois do clique, e o payload reutilizava o valor bruto. A correção desabilita o envio enquanto o nome normalizado estiver vazio e persiste o valor após `trim`.

RESOLVIDO

###############

Bug 1659

Sintoma: Ao abrir “Nova Ocorrência” em Ocorrências Formais, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem somente o título, sem contexto sobre o formulário.
Provável causa: O diálogo de `Incidents` renderizava `DialogContent` e `DialogTitle`, mas omitia o `DialogDescription` exigido pelo contrato acessível do componente Radix. A correção inclui uma descrição do cadastro e da edição da ocorrência formal.

RESOLVIDO

###############

Bug 1660

Sintoma: O formulário de ocorrência formal mantém “Salvar” habilitado sem título e em outras combinações já conhecidas como inválidas; títulos válidos com espaços nas extremidades também são enviados sem normalização.
Provável causa: As regras de título, custo, vínculo obrigatório de RH e conclusão de ocorrências graves encerradas eram verificadas somente depois do clique, enquanto o payload reutilizava o título bruto. A correção reflete todas essas regras no estado do botão e persiste o título após `trim`.

RESOLVIDO

###############

Bug 1661

Sintoma: Ao abrir “Nova OS” em Ordens de Manutenção, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem somente o título do diálogo.
Provável causa: O diálogo renderizava `DialogContent` e `DialogTitle`, mas não fornecia o `DialogDescription` exigido pelo contrato acessível do componente Radix. A correção adiciona uma descrição objetiva do formulário de criação e edição.

RESOLVIDO

###############

Bug 1662

Sintoma: “Salvar” permanece habilitado em uma nova ordem de manutenção sem veículo, sem problema relatado ou com odômetro/custos negativos, embora esses dados sejam rejeitados somente depois do clique.
Provável causa: As validações já protegiam o manipulador e o banco, mas não eram refletidas no estado do botão. A correção reutiliza as regras obrigatórias e numéricas para impedir a tentativa inválida antes do envio.

RESOLVIDO

###############

Bug 1663

Sintoma: Ao abrir “Nova Rota Operacional”, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e o objetivo do formulário não é anunciado por leitores de tela.
Provável causa: O diálogo de rotas utilizava `DialogContent` e `DialogTitle`, mas não fornecia `DialogDescription`. A correção associa uma descrição que resume identificação, classificação e destinos da rota.

RESOLVIDO

###############

Bug 1664

Sintoma: Depois de preencher somente o nome, “Salvar” fica habilitado para uma rota ativa sem destinos; o envio alcança o banco e falha na restrição que exige destino, em vez de orientar e bloquear o usuário no formulário. O nome também era persistido com espaços nas extremidades.
Provável causa: O estado do botão validava apenas o nome, enquanto a regra de destino existia somente no banco. A correção replica a regra no manipulador e no botão, considera mutações em andamento e normaliza o nome antes de persistir.

RESOLVIDO

###############

Bug 1665

Sintoma: Ao abrir “Nova Rota” em Corredores monitorados, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela não recebem contexto sobre pontos e limites do monitoramento.
Provável causa: `RouteDialog` renderizava `DialogContent` e `DialogTitle`, mas não associava um `DialogDescription`. A correção inclui uma descrição do propósito do formulário.

RESOLVIDO

###############

Bug 1666

Sintoma: O diálogo de corredor mantém “Salvar” habilitado sem nome e com limites inválidos; limiar vazio ou fora de 50–100, tempo fora negativo, velocidade negativa e duração negativa de ponto podem alcançar o manipulador, que em parte retorna silenciosamente e em parte envia um limiar inválido.
Provável causa: O botão considerava somente a mutação em andamento, o limiar não era validado no manipulador e as demais rejeições numéricas não davam retorno ao usuário. A correção valida e explica todos esses estados antes do envio e os reflete no botão.

RESOLVIDO

###############

Bug 1667

Sintoma: Ao abrir “Nova Regra de Alerta”, o navegador registra o aviso de acessibilidade `Missing Description or aria-describedby` e leitores de tela recebem somente o título do diálogo.
Provável causa: O formulário de regras utilizava `DialogContent` e `DialogTitle` sem um `DialogDescription`. A correção associa uma explicação curta sobre evento monitorado e limite.

RESOLVIDO

###############

Bug 1668

Sintoma: “Criar” permanece habilitado com limite vazio, zero ou negativo e também para uma regra de geofence ainda sem cerca selecionada; essas combinações só são rejeitadas depois do clique.
Provável causa: As validações existiam no manipulador, mas o botão considerava apenas carregamento e falha da consulta de geofences. A correção reflete os requisitos numéricos e de vínculo diretamente no estado do botão.

RESOLVIDO

###############

Bug 1669

Sintoma: Em “Nova Falta”, “Salvar em apuração” e “Salvar e confirmar” permanecem habilitados com NF e item obrigatórios vazios (ou com NF composta apenas por espaços), permitindo iniciar uma tentativa que só é rejeitada depois do clique.
Provável causa: A tela chamava `validateCase` apenas dentro de `submitNew`, não refletia o resultado no estado dos botões e a validação tratava qualquer string não vazia como NF válida. A correção reutiliza a validação durante a edição, normaliza a NF e bloqueia os botões enquanto o formulário for inválido ou a criação estiver em andamento.

RESOLVIDO

###############

Bug 1670

Sintoma: Em “Novo Lançamento” de devolução de paletes, os três comandos de gravação ficam habilitados sem fornecedor e sem item válido; além disso, cliques repetidos podem iniciar criações concorrentes do mesmo protocolo.
Provável causa: As regras obrigatórias existiam somente dentro de `submitProtocol`, os botões ignoravam `createMut.isPending` e não havia trava síncrona local. A correção reflete fornecedor, data e itens no estado dos botões, normaliza o fornecedor e impede reentrada até a mutation terminar.

RESOLVIDO

###############

Bug 1671

Sintoma: Abrir a edição de um protocolo de paletes registra `Missing Description or aria-describedby` no navegador, e os diálogos de detalhe, cancelamento e comprovante usam a mesma estrutura inacessível.
Provável causa: Os quatro `DialogContent` de `PalletReturns` possuíam título, mas nenhum `DialogDescription`. A correção associa a cada diálogo uma descrição específica de sua finalidade.

RESOLVIDO

###############

Bug 1672

Sintoma: “Criar monitoramento” fica habilitado com total de entregas ou prazo de retorno negativos; o total inválido só recebe mensagem depois do clique e o prazo negativo chega ao comando como dado aparentemente válido.
Provável causa: O estado do botão verificava apenas o nome do motorista, enquanto o manipulador validava somente o total positivo e não restringia `deadline` ao intervalo de 0 a 3650 exibido pelo campo. A correção centraliza as regras numéricas e as aplica tanto antes do comando quanto no estado do botão.

RESOLVIDO

###############

Bug 1673

Sintoma: Os diálogos de progresso diário, previsão de chegada e detalhe do monitoramento não oferecem descrição acessível e podem registrar `Missing Description or aria-describedby` ao serem abertos.
Provável causa: Esses três `DialogContent` de `DriverMonitoring` possuíam somente `DialogTitle`; apenas o diálogo de criação/edição já fornecia `DialogDescription`. A correção associa uma descrição específica a cada fluxo.

RESOLVIDO

###############

Bug 1674

Sintoma: No detalhe da Rastreabilidade, “Registrar” permanece habilitado com a descrição da ocorrência vazia ou curta demais; a tentativa só é rejeitada depois do clique, e descrições válidas são enviadas com espaços nas extremidades.
Provável causa: A regra mínima de cinco caracteres existia apenas dentro do manipulador e o payload reutilizava o texto bruto. A correção reflete a regra no estado do botão e persiste a descrição normalizada.

RESOLVIDO

###############

Bug 1675

Sintoma: Os diálogos de detalhe e de análise de padrões da Rastreabilidade não oferecem descrição acessível e podem registrar `Missing Description or aria-describedby` ao serem abertos.
Provável causa: Os dois `DialogContent` possuíam título, mas nenhum `DialogDescription`. A correção associa uma descrição específica ao objetivo de cada diálogo.

RESOLVIDO

###############

Bug 1676

Sintoma: Em “Nova Coleta”, “Criar Coleta” permanece habilitado sem motorista, veículo ou destinatário; uma data/hora inválida também pode gerar uma exceção de conversão antes do tratamento que apresenta o erro ao operador.
Provável causa: As regras obrigatórias existiam somente no manipulador, o botão considerava apenas mutações em andamento e o horário era convertido com `toISOString` antes do bloco protegido. A correção reflete todos os requisitos no estado do botão e valida o timestamp antes da conversão.

RESOLVIDO

###############

Bug 1677

Sintoma: Em “Novo Ativo”, “Salvar” permanece habilitado sem código ou nome e com custo de aquisição inválido; o diálogo também não oferece descrição acessível.
Provável causa: As validações existiam somente dentro do manipulador, o botão considerava apenas as mutações em andamento e o `DialogContent` possuía título sem `DialogDescription`. A correção reflete as regras obrigatórias e numéricas no botão e descreve o objetivo do formulário.

RESOLVIDO

###############

Bug 1678

Sintoma: A tela “Canhotos” fica operacionalmente indisponível e exibe `Cannot read properties of undefined (reading 'rest')` nas regras de qualidade, observabilidade, filas, filtros, histórico de e-mails e canais por fornecedor.
Provável causa: Quatro clientes do fluxo guardavam `supabase.rpc` em constantes sem vinculá-lo ao cliente Supabase. Ao executar o método destacado, o SDK perdia o receptor `this` necessário para acessar o transporte REST. A correção vincula explicitamente o método em operações, painel, canais e políticas de qualidade e adiciona regressão que cobre os quatro chamadores.

RESOLVIDO

###############

Bug 1679

Sintoma: “Custódia de cargas” termina em “Não foi possível consultar as custódias”, e o mesmo defeito pode interromper comandos de ocorrência, exclusão de rascunho de rota, sincronização offline e consulta fiscal do aplicativo do motorista.
Provável causa: Cinco clientes operacionais ainda destacavam `supabase.rpc` do objeto do SDK sem preservar seu receptor. A chamada perdia o `this` usado pelo transporte REST, repetindo a falha confirmada em Canhotos e Eventos Operacionais. A correção vincula o método ao cliente em todos os chamadores restantes e adiciona uma regressão abrangente.

RESOLVIDO

###############

Bug 1680

Sintoma: A tela “Controle de cargas” não carregava nenhuma carga e exibia “Não foi possível consultar o controle de cargas”, impedindo a consolidação operacional e financeira.
Provável causa: O frontend em produção já dependia da RPC `list_load_control_page_v2`, porém a migration que cria e autoriza essa função havia permanecido somente no repositório e não constava no banco de produção. A migration versionada foi aplicada ao projeto Supabase, mantendo a função como `SECURITY INVOKER`, execução exclusiva de `authenticated` e validação explícita do tenant/operador. O reteste autenticado carregou 19 cargas, totais e paginação sem erros no navegador.

RESOLVIDO

###############

Bug 1681

Sintoma: A tela “Folha de pagamento” ficava totalmente bloqueada em “Não foi possível conferir os períodos da folha”; outras consultas e comandos financeiros podiam falhar pelo mesmo motivo.
Provável causa: Havia duas falhas encadeadas. Primeiro, 63 clientes ainda convertiam `supabase.rpc` para tipos locais e chamavam o método sem preservar o receptor do SDK, perdendo o transporte REST interno. Depois de restaurar o transporte, o contrato da paginação rejeitava o `snapshot_at` válido devolvido pelo PostgreSQL com deslocamento `+00:00`. Todas essas chamadas foram vinculadas ao cliente Supabase e o contrato passou a aceitar timestamps ISO com offset explícito. A correção inclui folha, conciliação, contas, despesas, custos, fechamentos e alguns leitores/comandos operacionais que usavam o mesmo padrão. Testes de regressão impedem o retorno das duas falhas.

RESOLVIDO

###############
