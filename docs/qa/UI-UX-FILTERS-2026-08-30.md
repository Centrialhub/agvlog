# Revisão de UI, UX, navegação e filtros — 30/08/2026

## Escopo e método

Revisão das rotas de `AppRoutes`, das páginas e dos componentes de filtros associados. A tabela abaixo distingue alterações de filtros de páginas em que os critérios existentes foram mantidos. Nas páginas internas, a nova navegação, os caminhos de página, os títulos e o contraste dos textos secundários são melhorias compartilhadas.

Foram preservados os fluxos de emissão, pagamento, aprovação, entrega, recuperação de operações, troca de empresa e autorização. Esta entrega não publica o sistema, não altera schema/RLS e não executa operações reais de transporte ou financeiras. O repositório já continha alterações em andamento; elas foram preservadas.

**Revisão de código não equivale a validação autenticada de todas as telas.** O motorista foi acessado com autorização do usuário. A conta fornecida como operador exige MFA; essa proteção não foi desativada nem contornada. O portal foi validado com testes e revisão de código, sem sessão de cliente.

## Mudanças compartilhadas

- Barra lateral em nove áreas: visão geral; planejamento e cargas; rastreamento e ocorrências; documentos fiscais; financeiro; frota e pessoas; cadastros e estoque; relatórios e auditoria; sistema.
- Ícones por finalidade, seção e página ativas, busca por páginas e termos de negócio, atalho Ctrl/Cmd+K, grupos acessíveis com a barra recolhida e navegação móvel.
- Caminho da página, identificação das telas de detalhe, título do navegador e atalho para pular ao conteúdo.
- Barra de filtros com rótulos associados, contagem, indicação de critérios ativos, limpeza e feedback para intervalos invertidos.
- Persistência dos novos filtros de listas internas na URL sem apagar parâmetros de abas ou contexto. Filtros locais do motorista e algumas páginas especializadas mantêm seu escopo próprio.
- Busca local insensível a acentos, caixa e separadores em siglas/placas. Isso não transforma automaticamente a busca SQL de todas as páginas em busca sem acentos.
- Datas inclusivas no calendário local. As consultas de canhotos/coletas do portal passam o último instante do dia final; datas fiscais sem horário permanecem datas de calendário.
- O menu “Mais” do motorista expõe Jornada, Despesas, Checklist, Eventos e Ocorrências.

## Cobertura por página

“Mantidos” significa revisão da implementação e preservação dos filtros/recorte próprios; não significa teste manual de todas as combinações com dados reais.

| Página / rota | Critérios e decisão |
| --- | --- |
| Centro de operações `/` | Painel de situação atual e atalhos; mantido sem período global que mudaria o sentido dos indicadores. Nova orientação e acesso por áreas. |
| Dashboard `/dashboard` | Indicadores de frota atual; mantido o recorte operacional existente. |
| Operações `/operations` | Painel operacional agregado; mantidos os recortes próprios dos componentes. |
| Controle de operações `/operations-control` | Mantidos os componentes de controle e seus vínculos; rota ativa não se confunde com `/operations`. |
| Veículos `/vehicles` | Busca por placa, identificação, motorista e carroceria; situação, tipo e vínculo de motorista. Link explícito para detalhes. |
| Detalhe do veículo `/vehicles/:vehicleId` | Mantido histórico por data e contexto de um veículo; caminho de retorno para Veículos. |
| Motoristas `/drivers` | Busca por nome/documento/telefone/placa; ativo/inativo, veículo vinculado e acesso ao aplicativo. |
| Mapa da frota `/fleet-map` | Mantidos busca por placa/identificação e situação. |
| Alertas `/alerts` | Busca por veículo/tipo, situação e tipo; contagem e limpeza. Rótulos traduzidos. Recorte explícito de até 100 alertas da situação escolhida. Abas de notas paradas e regras preservadas. |
| Cercas virtuais `/geofences` | Busca por nome/categoria, categoria e monitoramento ativo/pausado. Escopo da lista separado do mapa/eventos. |
| Relatórios da frota `/reports` | Período e busca por veículo; gráficos, indicadores e CSV usam o mesmo conjunto filtrado. Limpeza restaura sete dias. |
| Corredores `/corridors` | Busca por nome/cerca/pontos; ativo/inativo e presença de cerca vinculada. |
| Alias `/routes` | Redirecionamento existente para corredores preservado. |
| Clientes `/clients` | Mantidos busca ampla, tipo e paginação na URL. |
| Pedidos `/orders` | Busca por pedido/cliente/participantes/destino; situação, cliente e intervalo de emissão. |
| Documentos fiscais `/fiscal-documents` | Mantidos busca, tipo, situação, vínculo com carga e paginação. Destino do atalho “Ver notas sem carga”. |
| Inventário `/inventory` | Busca, cliente e local passam a afetar saldo, movimentos e itens parados; movimentos também têm tipo/período. Contagens por aba e limite informado. |
| Cargas `/loads` | Mantidos filtros básicos/avançados, período e paginação. Nova localização na navegação. |
| Detalhe da carga `/loads/:id` | Contexto de uma carga e abas operacionais; sem filtro global adicional. Vínculos de rastreabilidade passam a abrir este detalhe. |
| Rastreabilidade `/traceability` | Mantidos os critérios existentes de documento/carga/cliente/fornecedor/motorista/placa, períodos, situação, POD/canhoto, ocorrência, pagamento e lote. |
| Histórico de POD `/traceability/:docId/pod` | Histórico de um documento; mantido o contexto, com caminho da página. |
| Auditoria de cargas `/load-extraction-audit` | Mantidos busca, cliente, evidência do documento e exportação filtrada. |
| Eventos `/events` | Mantidos situação, tipo, gravidade, veículo, motorista, cliente, carga, impacto e período. |
| Importação `/ingestion` | Fluxo de seleção/revisão/importação; não acrescentado filtro global a um assistente de etapas. |
| Histórico de importações `/ingestion-reports` | Lote e período com URL e limpeza; corrigido fim do dia no fuso local. Erro de consulta distinto de lista vazia. |
| Produtividade `/productivity` | Motorista, veículo e período de cadastro, aplicados a cargas e eventos por seus próprios vínculos. Escopo dos indicadores explicitado. |
| Configurações `/settings` | Mantidas abas e configurações; organização, busca de página e contraste compartilhados. |
| Aprovação de despesas `/expense-approval` | Mantidos situação, paginação, permissões e recuperação da revisão; preservadas as alterações paralelas desse fluxo. |
| Integrações `/integration-health` | Diagnóstico de capacidades e saúde atual; mantido sem filtro temporal global. |
| Equipe `/team` | Busca por nome/e-mail, papel e ativo/inativo; opção Cliente incluída entre os papéis. Administração e acessos do portal preservados. |
| Auditoria de dados `/data-audit` | Mantido filtro por domínio e diagnóstico existente. |
| Frete `/freight` e `/regions` | Mantido hub com abas; navegação consolida o acesso em Frete automático. |
| Regiões (aba do frete) | Mantidos região, cliente, pagador, município e UF. |
| Tabelas de frete (aba) | Mantidos filtros de tabelas e faixas, sem alterar cálculo. |
| Simulador de frete (aba) | Mantidos tipo de documento, período e busca; cálculo preservado. |
| Planejamento `/route-planning` | Mantido recorte de destino, seleção de carga/veículo/motorista e restauração do planejamento. |
| Recebíveis `/receivables` | Busca, situação, cliente e vencimento. Incluída opção vencidos sem classificar recebidos/cancelados como vencidos. |
| Financeiro `/financial` | Mantidos período e filtros avançados do painel. |
| Acerto de motoristas `/driver-settlements` | Mantidos busca, situação, motorista, veículo, datas e pendências de km/despesas. |
| Centros de custo `/cost-centers` | Mantidos centro, período e exportação correspondente. |
| Conciliação bancária `/bank-reconciliation` | Mantidos conta/período; extrato ganha busca, situação da conciliação e entradas/saídas. Indicadores gerais não são silenciosamente filtrados. Ações de vínculo preservadas. |
| Contas a pagar `/payables` | Busca, situação, categoria, origem e vencimento; removida opção duplicada de vencidos e incluído pagamento parcial. |
| Faturas `/client-invoices` | Mantidos busca, cliente e situação; comandos financeiros preservados. |
| EDI `/billing-edi` | Mantidos cliente, situação EDI e períodos de emissão/vencimento. |
| Rotas operacionais `/operational-routes` | Busca agora encontra cidades atendidas, além de nome/região/descrição; situação e classificação. |
| Funcionários `/employees` | Busca, situação, departamento e filial. |
| Ocorrências formais `/incidents` | Mantidos busca, situação, gravidade e categoria. |
| Folha `/payroll` | Períodos ganham busca, situação e pagamento. “Abrir” leva às entradas do período escolhido. Cálculo, aprovação e adiantamentos preservados. |
| Ativos `/assets` | Busca por código/nome/série/placa/local; categoria, situação e localização. |
| Manutenção `/maintenance-orders` | Busca por ordem/problema/placa/fornecedor; situação, tipo e prioridade compatíveis com o cadastro. |
| Estoque `/stock` | Itens: busca/categoria/nível de estoque. Movimentos: busca/tipo/período. Paginação após filtrar, sem o corte silencioso em 100 linhas; limite carregado de 500 movimentos informado. |
| Checklists `/checklists` | Modelos: busca/tipo. Execuções: busca por checklist/placa/executante, resultado, bloqueio e período. A execução não foi alterada. |
| Realocação `/reallocation` | Mantidos busca, recorte e histórico de realocação; comandos preservados. |
| Faturamento `/billing` | Mantidos critérios avançados e proteção por capacidade fiscal. |
| Monitor CT-e `/cte-monitor` | Mesmos critérios finais para fontes locais e Hub: referências, protocolo, motorista, grupos, filial, séries, situação, carta e datas. Situação canônica é reaplicada depois do merge. |
| Consulta CT-e `/cte-search` | Corrigidos critérios booleanos e situação após merge; nenhuma seleção de tipos retorna zero tipos. Metadado ausente não é tratado como Sim/Não confirmado. Por padrão, “Todos” inclui documentos sem esses metadados. Rótulos e grupos de rádio acessíveis. |
| Central CT-e `/cte-hub` | Hub e abas mantidos; acesso centralizado na barra lateral, com gates fiscais preservados. |
| NFS-e `/nfse` | Mantidos busca, situação, série e período. |
| Consistência CT-e `/cte-consistency` | Mantida busca por número/emitente e diagnóstico de consistência. |
| Coletas `/pickup-orders` | Mantidos busca por número/motorista/fornecedor/placa e situação; corrigida a busca de um caractere, que era ignorada. |
| ORT `/ort-management` | Mantidas abas de trabalho, busca e critérios dos componentes associados. |
| Rastreabilidade de produto `/product-traceability` | “Aplicar” passa a aplicar de fato; filtros de campos relacionados são enviados antes do limite. Situação da carga substitui “sem carga”, impossível na fonte `load_items`. Atalho para notas sem carga, links de carga, datas, totais de NF sem duplicação por item e erro explícito. |
| Histórico de produto `/product-history` | Mantidos seleção/busca do produto e intervalo de datas. |
| MDF-e `/mdfe-provisional` | CT-e autorizados ganham busca, UF e emissão. Alterar filtros limpa seleção; selecionar todos considera somente o resultado filtrado. Limite de 100 CT-e recentes informado. Emissão não foi executada. |
| Notas importadas `/imported-notes-summary` | Mantidos filtros especializados e exportação do resumo. |
| Controle de cargas `/load-control` | Mantidos critérios especializados de controle e filtros aplicados. |
| Fechamentos `/closing-reports` | Mantidos filtros com rascunho/aplicação explícita e comandos de fechamento. |
| Clientes rurais `/rural-clients` | Rótulos e filtros padronizados; busca, cidade, acesso, táxi, contato prévio e ativo/inativo. Limpeza restaura ativos. |
| Monitoramento de motoristas `/driver-monitoring` | Mantidos filtros com aplicação explícita e detalhamento. |
| Relatórios de ocorrências `/occurrence-reports` | Mantidos período, cliente, fornecedor, situação e recortes por resolução. |
| Folha de devolução `/occurrences/:id/return-sheet` | Documento de uma ocorrência; mantido contexto, sem filtro global. |
| Devoluções de paletes `/pallet-returns` | Mantidos filtros especializados por cliente, documento, situação e datas. |
| Faltas `/merchandise-shortages` | Mantidos competência mensal/anual e filtros especializados. |
| Motorista — Início `/driver` | Viagem e tarefas atuais; sem filtro que oculte orientação operacional. |
| Motorista — Cargas `/driver/loads` | Busca por número/origem/destino/placa e situação real da carga. Estados de revisão e proteção contra partida duplicada preservados. |
| Motorista — Paradas `/driver/stops` | Sequência da viagem e controles de chegada/saída mantidos; não renumerados por filtros de apresentação. |
| Motorista — Entregas `/driver/deliveries` | Mantidos busca e abas de situação; contexto `trip` e provas de entrega preservados. |
| Motorista — Ocorrências `/driver/issues` | Contexto operacional, formulário e histórico recente preservados; acesso direto pelo menu Mais. |
| Motorista — Jornada `/driver/journey` | Eventos da jornada atual preservados; acesso direto pelo menu Mais. |
| Motorista — Despesas `/driver/expenses` | Busca, aprovação e categoria integradas à versão atual da página; explicitado que filtros atuam na página de 50 registros. Nova criação/recuperação e paginação paralelas preservadas. |
| Motorista — Checklist `/driver/checklist` | Pré/pós-viagem no contexto atual; sem filtro global. |
| Motorista — Eventos `/driver/events` | Mantidos busca e tipos finalizador/informativo; acesso direto pelo menu Mais. |
| Motorista — Detalhe `/driver/events/:id` | Evento específico; sem filtro adicional. |
| Motorista — Chat `/driver/chat` | Conversa da operação com título e nomes acessíveis para escrever/enviar. Fluxo preservado; nenhuma mensagem foi enviada na validação. |
| Portal — Início `/portal` | Indicadores do cliente selecionado; permissões preservadas. |
| Portal — Mercadorias `/portal/shipments` | Mantidos busca, cidade/UF, períodos, situação, POD e ocorrência. Mudança de cliente reinicia paginação; campos e filtros rápidos recebem nomes/estado acessíveis. |
| Portal — Detalhe `/portal/shipments/:documentId` | Documento específico e seus vínculos; sem filtro global. |
| Portal — Coletas `/portal/pickups` | Situação, busca por participantes/número e período; fim do dia corrigido no RPC de leitura. Busca textual restrita às até 200 coletas carregadas e identificada na UI. |
| Portal — Documentos `/portal/documents` | Tipo, busca e emissão com rótulos e limpeza; busca de um caractere enviada; botão Anterior permanece na última página; mudança de cliente reinicia paginação. |
| Portal — Canhotos `/portal/pods` | Busca, situação e período padronizados; data final inclui o dia inteiro. Limite de 200 informado. |
| Portal — Ocorrências `/portal/occurrences` | Mantidos gravidade e aberto/resolvido. Comunicação e autorizações preservadas. |
| Portal — Tracking `/portal/tracking` | Busca por carga/placa/nota/destinatário/cidade e situação; mapa e cartões usam o mesmo resultado, sem ampliar o escopo de cliente. |
| Portal — Relatórios `/portal/reports` | Mantidos período e atalho de 90 dias; exportações por seção. |
| Portal — Configurações `/portal/settings` | Preferências/contexto do cliente; sem filtro global. |
| Login `/auth`, senha `/set-password`, página não encontrada | Fluxos de acesso e recuperação preservados. Não incluídos filtros de listagem. |

## Validação

- Testes direcionados cobrem combinação/limpeza/restauração na URL, datas, fontes do CT-e, navegação e gates, paginação do portal, aplicação de filtros relacionados e proteção das ações de motorista.
- Navegação e filtros inspecionados no navegador com dados fictícios em uma prévia isolada, sem backend. Busca, situação e acesso às páginas com a barra recolhida exercitados. Auditoria axe: zero violações na prévia expandida e recolhida após correções.
- Dez telas principais do motorista visitadas em sessão autorizada; busca de carga e limpeza exercitadas com dados reais, menu Mais inspecionado. Isso não valida mutações operacionais, emissão ou pagamentos.
- Após os últimos ajustes de paginação e rótulos: TypeScript, lint sem erros e lint de tipos críticos aprovados. Suíte completa: 2.173 testes aprovados em 182 arquivos. Build de produção e verificações de bundle/artefato público aprovados.

## Limitações e próximos passos de validação

- Falta a sessão de operador com MFA concluído para percorrer visualmente as páginas internas com dados reais. Não se deve reduzir a proteção da conta para realizar QA.
- Não foi fornecida sessão de cliente para validar o portal autenticado. Testes usam dados fictícios e não ampliam permissões.
- Limites de leitura existentes não foram removidos indiscriminadamente. Filtros locais atuam no conjunto carregado; as páginas alteradas com limites explícitos informam esse escopo. Monitor/consulta CT-e ainda dependem dos limites de retorno das consultas existentes do projeto.
- Alterações paralelas em despesas, financeiro e banco podem exigir implantação própria para seus novos RPCs. Esta entrega não publica essas mudanças nem valida operações financeiras reais.
- Credenciais e códigos de autenticação não foram incluídos neste documento ou em fixtures persistidas.
