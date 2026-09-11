# Planejamento do financeiro — diagnóstico e proposta para validação

Data: 09/09/2026. Status: proposta de produto; regras do cliente ainda a confirmar.

Revisão integral de 09/09/2026: o núcleo de produto está consistente, mas a especificação ainda não é definitiva para implementação. A seção 11 registra os gaps encontrados no confronto com o sistema, os controles adicionais e as decisões pendentes. A sequência da seção 8 foi revisada para incluir recebíveis fiscais, despesas gerais e integrações existentes na primeira entrega completa.

Decisões confirmadas pelo usuário: descarga reembolsada pelo fornecedor responsável; sistema exclusivamente de registro e conciliação, sem execução de PIX, pagamentos ou outras transações financeiras. Programação significa agenda interna. Integrações futuras, se consideradas, limitam-se à consulta/importação de dados e documentos dentro desse escopo.

Confirmações adicionais: folha de pagamento obrigatoriamente incluída; cada descarga gera conta a receber identificada pelo fornecedor devedor específico; motoristas não podem acessar o módulo financeiro nem seus dados. Permissões dos demais perfis internos e alçadas continuam a definir, sem presumir acesso irrestrito.

## 1. Objetivo e alcance da análise

Permitir que o financeiro registre, confira, programe, baixe e concilie grande volume de operações com poucas ações, mantendo a origem e a composição de cada valor acessíveis.

Fontes: briefing financeiro.txt, páginas, hooks, componentes, testes existentes e migrations do repositório local. O briefing foi tratado como relato de necessidades, não como autorização para executar movimentações ou alterar o sistema. Não houve consulta ao banco de produção, execução da interface ou validação dos testes nesta análise. Recursos encontrados no código não equivalem a funcionalidades homologadas em produção.

## 2. O que existe e onde estão os gaps

| Área | Evidência local | Gap ou consequência |
|---|---|---|
| Contas a pagar | Payables.tsx, usePayables.tsx: categorias, origem, vencimento, competência, cadastro e filtros | Fluxo centrado em um título por vez; falta uma operação de lote que preserve composição, beneficiário e pagamento único |
| Baixas de contas a pagar | useFinancialPayments.tsx: conta, método, data, valor, anexo e estorno | Padronizar pagamentos parciais, auditoria e recuperação de operações com a camada mais recente de recebíveis |
| Contas a receber | Receivables.tsx, useReceivables.tsx, useReceivableFinancial.ts e src/lib/financial/receivable* | Já há recebimento parcial e comandos recuperáveis; falta demonstrar o fluxo completo de descarga, pagador e agrupamento de cobranças |
| Gastos de motorista | ExpenseCreationForm.tsx, ExpenseApproval.tsx: origem do pagamento, reembolso, comprovante ou justificativa, revisão paginada | Entrada individual e revisão por cartões; não encontrei uma estação de lançamento de várias despesas com um PIX associado |
| Acertos | DriverSettlementDrawer.tsx: composição, pagamentos e histórico | Reaproveitar acertos e evitar que uma despesa seja paga novamente pelo contas a pagar; unificar referência a contas reais |
| Descarga | load_unloading_charges e importação de cargas | Registro operacional existe; geração automática e idempotente do recebível a partir de toda descarga elegível não foi demonstrada nos caminhos examinados |
| Conciliação | BankReconciliation.tsx, useBankReconciliation.tsx: importação, sugestões, associação manual, auditoria e estorno | Associação manual recebe um par movimento/obrigação por ação; algoritmo examinado pontua obrigações individuais. Não basta para a experiência de um PIX com várias despesas |
| Caixa | Contas bancárias com tipo cash e saldo inicial; painel Financial.tsx | Painel mistura informações fiscais e operacionais; não demonstra um livro único de caixa realizado com ponte verificável para saldo bancário |
| Volume | Listas de títulos consultam registros e filtram no navegador; consultas financeiras têm limites de 500/1.000 | Paginar, filtrar e agregar no servidor; total de uma página não pode aparecer como total da empresa |

### Problemas estruturais concretos a validar antes da evolução visual

Na migration baseline, register_payable_payment cria um bank_transaction já como matched. sync_financial_obligations também deriva conciliação do estado pago/recebido. Isso mistura baixa declarada com confirmação pelo extrato.

Na mesma função, o débito é gravado com valor positivo e transaction_type debit; BankReconciliation.tsx calcula saídas pelo sinal negativo. Há uma incompatibilidade de convenções nos caminhos examinados que precisa de reprodução e correção.

reverse_payable_payment na baseline apaga o pagamento e o movimento associado. A proposta exige reversão rastreável e preservação da evidência bancária. É necessário verificar também os gatilhos de auditoria e dependências antes de migrar.

_apply_match_amounts atualiza obrigações e situação da transação; o encadeamento até a baixa do título de origem precisa ser validado ponta a ponta. Não assumir que conciliar uma obrigação atualiza todos os demais módulos.

Esses achados referem-se ao código versionado examinado, não à comprovação de erros nos dados de produção.

## 3. Modelo de produto recomendado

Separar quatro coisas que aparecem juntas para o operador, mas têm significados diferentes:

1. **Origem:** viagem, despesa, descarga, manutenção, fatura, imposto ou lançamento manual.
2. **Título:** compromisso a pagar ou direito a receber, com vencimento e saldo.
3. **Movimentação realizada:** pagamento, recebimento, transferência ou entrega de adiantamento; pode distribuir seu valor entre vários itens.
4. **Evidência bancária:** linha importada do extrato que confirma uma movimentação já registrada ou permite registrar uma movimentação ainda ausente.

Importar o extrato não deve criar uma segunda saída para um pagamento já baixado. Confirmar uma conciliação também não pode baixar duas vezes um título.

Uma despesa já é um fato de custo mesmo quando ainda não foi paga. Um pagamento é uma movimentação de dinheiro. Uma transferência entre contas próprias movimenta saldos sem criar nova despesa. No produto, essas naturezas devem ser explícitas.

### Informação mínima visível

| Pergunta | Resposta na linha ou no detalhe imediato |
|---|---|
| Quem? | Contraparte, beneficiário efetivo e responsável interno; motorista e cliente quando aplicável |
| Por quê? | Descrição objetiva, categoria e origem vinculada |
| Quanto? | Valor original, ajustes, pago/recebido e saldo restante |
| Quando? | Ocorrência/competência, vencimento, programação e realização identificados separadamente |
| Entrada ou saída? | Direção, natureza e conta de origem/destino |
| Comprovado? | Documento da despesa, comprovante do pagamento e confirmação no extrato em indicadores separados |

Não reduzir tudo a um status. Mostrar situação do título, aprovação, comprovação e conciliação separadamente. Exemplo válido: pago, documento pendente, extrato conciliado.

## 4. Fluxos que precisam fechar

### A. Fluxo principal confirmado: conferência no retorno e vínculo ao PIX existente

O usuário confirmou que os gastos são registrados em conjunto quando a viagem termina e o motorista retorna. O financeiro confere os recibos e lança tudo de uma vez. Os envios ao motorista normalmente cobrem várias despesas, e deve existir um registro do PIX para posterior associação. Não exigir lançamento individual durante a viagem.

Exemplo ilustrativo da composição dos R$ 500 citados pelo usuário: combustível R$ 300, lanche R$ 50 e descarga R$ 150. Abrir um único modal de conferência da viagem e inserir as três linhas com categoria, data real do gasto, valor e recibo. Selecionar as linhas e associá-las ao registro existente do PIX de R$ 500 para o motorista. O total da viagem pode conter vários grupos, cada um relacionado a um envio distinto.

Conferência em três pontas: **itens conferidos somando R$ 500 ↔ registro do PIX de R$ 500 ao motorista ↔ débito de R$ 500 no extrato da conta correta**. Além do valor, conferir destinatário, conta, data e identificador bancário quando disponível. O vínculo bancário pode ocorrer antes ou depois da conferência de despesas; cada verificação mantém seu estado próprio.

O registro do PIX deve capturar motorista/beneficiário, valor, data, conta de saída e comprovante/referência, mesmo sem conhecer a composição final. Até a conferência dos recibos, mostrar valor enviado a prestar contas, sem inventar categorias de despesa. Se o PIX não estiver registrado, permitir registrar o envio já realizado dentro do mesmo modal, verificando duplicidade e aproveitando a linha de extrato existente quando houver. Nunca executar transferência nem criar automaticamente uma nova saída ao salvar os gastos.

Para a descarga do exemplo, nasce uma cobrança vinculada de R$ 150 contra o fornecedor responsável, conforme a regra de elegibilidade e o gatilho a validar. Ela não aumenta o caixa antes do recebimento. A existência dessa cobrança não deve apagar o custo nem permitir novo pagamento ao motorista.

Os indicadores de despesa usam as linhas: combustível R$ 300, alimentação R$ 50, descarga R$ 150. O fluxo de caixa usa o PIX: saída única de R$ 500. O grupo não substitui categorias e não é uma quarta despesa. Preservar data real do gasto e data de digitação; enquanto o motorista não retornar, indicadores de custos devem sinalizar viagens ainda sem prestação de contas. Recebimento do fornecedor é um evento separado, vinculado ao gasto, com custo bruto e recuperação apresentados explicitamente.

No modal: cabeçalho fixo com viagem/motorista, grade de despesas, agrupamento por PIX, painel de envios existentes e resumo por grupo com total de itens, valor enviado, diferença, recibos e situação bancária. Adicionar/duplicar linhas por teclado, anexar recibos e atribuir o mesmo PIX a várias linhas selecionadas. A categoria não precisa coincidir entre itens do grupo. Salvar rascunho mesmo com pendências; impedir marcar conferência integral se houver diferença sem tratamento.

Despesas pagas diretamente pela empresa, em dinheiro ou com cartão mantêm sua origem e não são forçadas a um PIX do motorista. Para valores já cobertos pelo envio, o contas a pagar mostra o vínculo de cobertura/prestação de contas, sem gerar nova obrigação de pagamento. A aprovação e o fechamento não devem alterar silenciosamente a composição de grupos já conferidos; correções têm histórico e reabrem as verificações afetadas.

### B. Adiantamento e prestação de contas

PIX antecipado de R$ 500; despesas aceitas de R$ 450; saldo de R$ 50 a devolver ou carregar com autorização. O PIX deve bater exatamente com o extrato em R$ 500. A prestação de contas deve explicar os R$ 500 como R$ 450 utilizados mais R$ 50 ainda sob responsabilidade do motorista.

Se os gastos forem R$ 530, existe complemento de R$ 30 a reembolsar. Gastos rejeitados permanecem como pendência de acerto até decisão. A mesma despesa não pode consumir adiantamento e gerar reembolso integral simultaneamente.

No fluxo principal, o PIX precede o registro detalhado dos gastos no sistema. Não foi estabelecido se todo envio ocorre antes do gasto real. Quando soma conferida e envio diferirem, manter saldo explícito a prestar contas, devolver ou complementar; não alterar recibos para forçar igualdade. Essa exceção não deve complicar o caso comum de soma exata.

### C. Saque e dinheiro físico

Saque de R$ 1.000: saída da conta bancária e entrada no caixa físico vinculadas. O gasto posterior sai do caixa físico uma única vez. Registrar custodiante, destino, motivo, data e documento. Entrega de dinheiro ao motorista deve alimentar a prestação de contas correspondente.

Retirada de sócio, transferência própria e adiantamento não devem compartilhar uma categoria genérica que esconda sua finalidade. A classificação contábil/fiscal será definida com o responsável do cliente.

### D. Descarga a receber

Regra confirmada: a cobrança deve estar no nome do fornecedor devedor daquela descarga, com ID cadastral e identificação fiscal, e não num fornecedor genérico, no cliente da viagem ou no motorista. O fornecedor não precisa ser artificialmente cadastrado como cliente para receber um título a receber.

Determinação automática proposta: **gasto/evento de descarga → entrega/documento(s) atendido(s) → vínculo operacional de fornecedor responsável → fornecedor cadastrado → recebível**. Validar a cadeia real dos dados antes da implementação. A interface UnloadingChargeRow examinada expõe supplier_name, invoice_number, carga e metadata; nome textual isolado não prova vínculo único. Completar os relacionamentos estáveis necessários, preservando os identificadores da origem/importação.

Priorizar fornecedor responsável explicitamente vinculado ao evento; na ausência, usar vínculo de documento/entrega e regra de responsabilidade validada. CNPJ/identidade fiscal pode resolver o cadastro exato dentro da empresa, mas não prova sozinho quem deve pagar a descarga. Não presumir que todo emitente da NF seja o devedor. Se houver conflito entre origem explícita e regra derivada, tratar como pendência, sem escolher silenciosamente uma delas.

Quando houver um responsável inequívoco, preparar automaticamente o recebível com fornecedor, valor, descarga, documentos, viagem e comprovante. Registrar evidência/regra usada para identificar o devedor. Se faltar vínculo, cadastro ou houver mais de um candidato, salvar a despesa e mostrar "Fornecedor da descarga a definir"; não criar cobrança cobrável contra um nome presumido. O financeiro resolve no próprio modal com histórico da intervenção.

Regra confirmada: uma viagem contém várias entregas; cada entrega tem zero ou uma descarga e suas NFs pertencem ao mesmo fornecedor e destino. Portanto, não há rateio de descarga entre fornecedores. Determinar o devedor consultando todas as NFs da entrega: todas precisam ter fornecedor resolvido e o conjunto deve conter exatamente um fornecedor. Mais de um fornecedor ou alguma NF sem vínculo é inconsistência de composição/cadastro, não oportunidade de escolher o primeiro ou ratear.

Evidência local: dispatch_stops vincula entrega à viagem; dispatch_stop_documents liga a parada às NFs; fiscal_documents tem supplier_id e gatilho de associação de fornecedor. A criação de viagem examinada em 20260830062933_harden_dispatch_planned_route.sql grava paradas/documentos e valida cobertura e cliente, mas não demonstra validação de fornecedor único. load_unloading_charges na baseline possui carga/documento/nome de fornecedor, sem vínculo explícito à entrega nem unicidade por entrega. Essa estrutura precisa ser completada, não recriada do zero.

Preparar fornecedor e referências da entrega na criação da viagem, sem gerar despesa ou recebível apenas porque uma entrega foi planejada. No retorno, o financeiro informa ocorrência, valor e recibo da descarga e confirma o registro; proposta de gatilho é essa confirmação. A identidade da entrega deve garantir no banco no máximo uma descarga, inclusive contra requisições concorrentes/repetidas e importações antigas. Correção e estorno versionam o mesmo fato sem permitir dupla cobrança. Revalidar composição quando NFs forem realocadas; fornecedor histórico de descarga já confirmada não muda silenciosamente. Mapear identidade de entrega versus parada/tentativa de reentrega antes de definir a chave, para uma nova tentativa não duplicar automaticamente a descarga da mesma entrega.

Agrupar recebíveis depois mantém a composição por descarga/fornecedor. Alterar o fornecedor após geração exige correção auditada; após recebimento, exige regularizar a alocação/crédito sem reescrever o pagador histórico.

Aceite: entregas de dois fornecedores na mesma viagem geram cobranças nos cadastros corretos; várias NFs de uma entrega geram no máximo uma descarga; fornecedor misto/ausente impede cobrança automática; criação de viagem só prepara referências; importação e lançamento do recibo vinculam-se à mesma origem sem duplicar; homônimos não são associados por nome; correção mantém devedor anterior e autor no histórico.

Registrar o fornecedor responsável pelo reembolso, cliente relacionado quando houver, viagem, documento, valor e regra de repasse. Separar quem prestou o serviço, quem recebeu o dinheiro e o fornecedor que deve reembolsar a transportadora. O cadastro de contraparte deve permitir um recebível contra fornecedor, independentemente de ele também ter o papel de cliente.

Gerar uma única cobrança por evento elegível, no gatilho a combinar com o cliente. Se faltar pagador ou regra, abrir pendência visível. Permitir agrupar várias descargas em cobrança/fatura mantendo sua composição e evitando duplicação do recebível ao faturar. Alterações após recebimento exigem ajuste rastreável.

### E. Baixa parcial, diferenças e estorno

Uma conta de R$ 1.000 pode receber duas baixas de R$ 600 e R$ 400. Juros, desconto, tarifa e retenção são componentes explícitos; não ajustar silenciosamente o valor original para coincidir com o extrato. Suportar um pagamento para vários títulos e vários pagamentos para um título com limites de alocação.

Distinguir desfazer vínculo de conciliação, corrigir baixa registrada por engano e registrar devolução real de dinheiro. Desconciliar não é presumir que o pagamento não aconteceu.

### F. Entradas, expectativa de recebimento e contas a receber

Diretriz do usuário: principal entrada vem dos fretes relacionados a NF faturadas por CT-e/NFS-e; separar frete ainda não faturado, faturado a receber, descarga a receber e outras entradas. Automatizar preparação e acompanhamento, reservando a baixa final à confirmação manual conforme a proposta apresentada. Conciliação bancária automática e baixa de recebível são decisões distintas.

#### Carteira em estágios sem duplicação

| Estágio | Base e regra | Efeito no caixa |
|---|---|---|
| Frete a faturar | Valor do serviço/frete ainda elegível para faturamento, identificado por origem; nunca o valor da mercadoria da NF | Nenhum; expectativa separada |
| Faturado a receber | Saldo aberto dos títulos originados do faturamento validado, por pagador e vencimento | Nenhum até entrada realizada |
| Descarga a receber | Saldo aberto de cobranças de descarga ao fornecedor responsável | Nenhum até entrada realizada |
| Outros a receber | Direitos de cobrança identificados, com contraparte, natureza, origem, valor e vencimento | Nenhum até entrada realizada |
| Recebimento registrado | Entrada declarada/registrada, distribuída entre títulos e ainda sujeita à conferência bancária quando faltar extrato | Caixa operacional provisório |
| Entrada bancária confirmada | Crédito comprovado pelo extrato validado, identificado ou ainda em investigação | Caixa bancário confirmado, uma única vez |

Não usar presença de uma NF como prova de frete a faturar: verificar valor do serviço, elegibilidade e estado da operação. Orçamentos, cancelamentos, documentos rejeitados, duplicados ou substituídos não podem compor indiscriminadamente essa carteira. Se houver faturamento parcial, apenas a parcela ainda não faturada permanece na expectativa; a parcela faturada passa para o título.

Uma NF pode compor documentos/agrupamentos de faturamento, e uma cobrança pode reunir várias origens. Manter vínculo de alocação entre serviço, documento fiscal e título; o CT-e/NFS-e e a fatura não são receitas adicionais somáveis. Se já existir título do documento fiscal, faturar/agrupá-lo não deve criar outro direito de cobrança pelo mesmo serviço. Descarga incluída numa cobrança conjunta mantém sua classificação e saldo próprios, sem permanecer também como recebível independente duplicado.

Gatilho confirmado pelo usuário: "faturada" significa CT-e/NFS-e autorizado. A confirmação de autorização pela fonte fiscal gera/ativa o recebível correspondente e transfere o valor de frete elegível da expectativa para faturado a receber, uma única vez. Fatura comercial/fechamento posterior organiza cobranças existentes, sem novo faturamento financeiro. No código examinado há geração de CT-e em useBilling.tsx, comandos próprios de fatura e vínculos com recebíveis; receivableTotals.ts distingue títulos com client_invoice_id/status invoiced dos demais. Portanto, adaptar os KPIs e os vínculos de origem a essa regra, sem apenas renomear o total atual de pendentes.

#### Ciclo fiscal e reversão financeira segura

Requisito crítico confirmado: rejeição e cancelamento não podem deixar recebíveis indevidos, duplicar valores ou quebrar pagamentos, conciliação e indicadores. Separar status fiscal, vigência da cobrança, recebimentos e conciliação. O significado de cada retorno deve ser normalizado por integração, distinguindo rejeição de emissão, rejeição de pedido de cancelamento, falha de transporte e status desconhecido.

| Evento confirmado | Efeito na carteira | Efeito no dinheiro |
|---|---|---|
| Rascunho, envio ou processamento | Sem recebível ativo por autorização; expectativa permanece se serviço elegível | Nenhum |
| Emissão rejeitada sem autorização anterior | Não gera faturado/recebível; pendência de correção fiscal e expectativa do serviço ainda elegível | Nenhum |
| Autorização confirmada | Gera/ativa o recebível e retira a mesma parcela da expectativa uma única vez | Nenhum antes do recebimento |
| Cancelamento solicitado, ainda sem confirmação | Não tratar como documento cancelado; sinalizar cancelamento em análise e impedir nova baixa contra esse documento enquanto a solicitação estiver pendente, conforme política proposta | Preservar entradas existentes; crédito novo ainda pode ser registrado como não alocado |
| Pedido de cancelamento rejeitado | Documento continua autorizado, preservando sua cobrança e removendo a pendência correspondente | Nenhum estorno automático |
| Cancelamento confirmado, sem recebimento | Desativar cobrança/saldo aberto da origem cancelada, ajustar carteira/previsão e invalidar sugestões/reservas ainda pendentes | Nenhum |
| Cancelamento confirmado, com recebimento parcial ou integral | Desativar cobrança da origem e abrir regularização do valor recebido; desfazer alocação por evento compensatório e manter crédito identificado do pagador até decisão | Preservar entrada real e vínculo bancário; não apagar nem simular devolução |
| Timeout, retorno desconhecido ou contraditório | Manter último estado confirmado, sinalizar verificação pendente e consultar fonte fiscal antes de mudar carteira | Nenhuma reversão baseada apenas na falha técnica |

Ao cancelar, retorno para "a faturar" depende do serviço: se continua devido e será reemitido, reabrir somente o valor elegível sem outra cobertura fiscal válida; se a operação foi desfeita, não recriar expectativa. Serviço cancelado e documento cancelado são fatos distintos. Preservar origem, vínculo de substituição/reemissão e valores cobertos, inclusive nos casos parciais.

Exemplo: documento de R$ 1.000 recebeu R$ 600 e foi cancelado. O saldo de R$ 400 não permanece como cobrança válida daquele documento; os R$ 600 continuam no caixa e viram crédito a regularizar do pagador, com histórico da alocação anterior. Podem ser aplicados a novo título válido mediante decisão registrada ou devolvidos fora do sistema; devolução real gera nova saída, conciliada com o extrato. Se o serviço continuar e houver previsão de reemissão, a projeção deve considerar o crédito disponível sem prever novamente R$ 1.000 de entrada em dinheiro.

Documento substituto só gera efeito após sua própria autorização confirmada. Não apagar documento anterior nem copiar baixa sem rastreabilidade. Controlar cobertura por origem para que documento original e substituto não contem o mesmo serviço duas vezes, mesmo se eventos chegarem em ordem diferente; situações sobrepostas ou contraditórias ficam pendentes de verificação. Em cobrança agrupada, ajustar apenas a parcela da origem afetada, preservando demais documentos e avisando que a composição da cobrança mudou. Descarga é origem independente: cancelamento do documento de frete não cancela seu recebível por associação de viagem sem regra de negócio específica.

Implementar aplicação de eventos com idempotência, controle de versão e transação atômica dos efeitos financeiros, ou fila durável com recuperação quando a integração exigir processamento assíncrono. Confirmação externa já ocorrida não pode ser perdida por falha interna: registrar pendência de sincronização, retomar com a mesma identidade e impedir apresentação de consistência inexistente. Revalidar status e versão dentro da confirmação de baixa para resolver corrida entre cancelamento e recebimento.

Não confiar em ordem de chegada de callbacks nem usar simplesmente "última mensagem vence". Correlacionar documento, tentativa/operação, protocolo e estado confirmado; um retorno antigo de autorização não pode ressuscitar cobrança cancelada, e rejeição de outra tentativa não cancela documento autorizado. Verificação periódica/acionável de consistência deve detectar documento autorizado sem recebível, cancelado com saldo cobrável, duplicação de cobertura e crédito recebido sem destinação após cancelamento.

Auditar protocolo/evidência fiscal, data do evento, data de processamento, transição anterior/nova e efeitos em títulos/alocações/KPIs. Indicadores de posição atual excluem cobrança cancelada; relatórios de movimentos distinguem faturamento autorizado, cancelamentos e faturamento líquido. Preservar fechamento histórico e registrar correção ou reabertura autorizada quando aplicável; não reescrever silenciosamente períodos encerrados.

Homologação obrigatória: autorização repetida cria um recebível; emissão rejeitada não cria cobrança; pedido de cancelamento rejeitado preserva autorizado; cancelamento sem/parcial/com recebimento integral; cancelamento concorrente com baixa; reemissão sem duplicação; callback atrasado não reativa cancelado; timeout seguido de autorização recuperada; falha interna após confirmação fiscal e retomada; cancelamento de um item em cobrança agrupada; descarga independente preservada; créditos realocados/devolvidos sem duplicar caixa; períodos fechados mantêm histórico e correções identificáveis.

#### Outros: distinguir cobrança, recuperação e entrada que não é frete

Catálogo inicial proposto, a validar com operações reais:

- Serviços adicionais cobrados: armazenagem, estadia, reentrega, coleta extra ou outros serviços efetivamente prestados/contratados. Se já incluídos no frete/fatura, preservar composição sem novo título duplicado.
- Ressarcimentos e devoluções: recuperação de despesa, devolução por fornecedor ou restituição de pagamento; vincular ao fato original e não classificar automaticamente como receita de frete.
- Sobras devolvidas por motorista/funcionário: entrada que encerra saldo a prestar contas, sem gerar faturamento fictício.
- Adiantamento de cliente: crédito recebido antes do faturamento, disponível para alocação posterior; ao faturar, aplicar o crédito sem nova entrada bancária.
- Créditos não identificados: entram no caixa confirmado e ficam na fila de identificação, sem baixar títulos por mera igualdade de valor.
- Transferências próprias, aportes e empréstimos, caso ocorram: entradas de caixa com natureza própria; não compõem KPI de receita operacional de frete. Transferência própria não aumenta o caixa consolidado das contas envolvidas.

"Outros" é agrupamento de navegação, não classificação suficiente para fechamento. Exigir subtipo/finalidade e origem conforme a operação; definição contábil e eventuais obrigações fiscais ficam com o responsável do cliente. Não criar título a receber artificial para toda entrada: crédito antecipado, transferência e devolução têm vínculos e naturezas diferentes.

#### Automação e baixa final manual

Proposta alinhada ao pedido: geração/atualização idempotente da carteira a partir de eventos válidos, aplicação de prazos de cobrança cadastrados, identificação de vencidos, cálculo de saldos, preparação das sugestões e conciliação bancária nos critérios já definidos. Confirmação da baixa de títulos fica com o financeiro, individualmente ou em lote revisável. Automação não envia mensagens externas de cobrança sem configuração e autorização próprias.

Na baixa, exibir pagador, conta, data, crédito bancário/registro de recebimento, títulos selecionados, valores alocados e saldo remanescente. Recebimento parcial deixa saldo aberto. Um crédito pode quitar vários títulos; vários créditos podem quitar um título. Excesso vira crédito não alocado do pagador após identificação; desconto, retenção ou juros exigem componentes e evidência, sem forçar valor da NF ou do extrato.

Para pagamento já registrado, associar ao crédito sem criar outra entrada. Se o extrato chegar primeiro, o dinheiro já integra caixa confirmado; mostrar "entrada identificada, baixa pendente" e sua alocação proposta. Até confirmar, os títulos permanecem formalmente abertos, mas a projeção deve reservar o crédito identificado para não prever a mesma entrada uma segunda vez. Essa reserva é rastreável e reversível, não é baixa nem confirmação de candidato fraco. Créditos ambíguos permanecem não alocados; a projeção explicita essa incerteza.

Guardar autoria da baixa separada da origem da conciliação: "conciliação automática; baixa confirmada por Maria" é válido. Se Maria escolhe/altera o vínculo bancário ou aceita uma sugestão ainda não confirmada, a conciliação é manual e mantém o selo/histórico já definido. Baixa não altera automaticamente a proveniência da conciliação nem apaga verificações anteriores.

#### KPIs e datas

- Frete a faturar: saldo elegível ainda não faturado, com quantidade de origens e tempo nessa condição; indicar valores estimados/não validados.
- A receber: saldo aberto de fretes faturados, descargas e demais cobranças, por natureza; desdobrar a vencer, vencido e contestado.
- Entradas registradas aguardando banco; entradas bancárias identificadas aguardando baixa; créditos bancários não identificados: filas independentes com quantidade e valor.
- Recebido no período: pagamentos efetivamente recebidos nas datas correspondentes, com status de confirmação; não somar valor integral de título parcialmente recebido.
- Recuperação de descarga: a receber, recebida e vencida por fornecedor, mantendo origem e separação do faturamento de frete.
- Previsão de recebimento: títulos por data esperada e cenário separado para fretes ainda a faturar; expectativa sem data não deve cair automaticamente no mês atual.

Cada indicador declara a data usada: operação/serviço para produção, emissão/faturamento para faturado, vencimento para carteira, recebimento/postagem para caixa. Carteira em aberto é uma posição numa data e inclui títulos de meses anteriores. Um título antigo recebido neste mês integra as entradas deste mês. Relatórios históricos precisam reconstruir posição no corte, sem usar apenas o status atual.

#### Projeção e fechamento do período

Apresentar três visões distintas: **carteira**, **caixa previsto** e **caixa realizado conciliado**. "Balanço esperado" aqui significa projeção de caixa gerencial, não demonstração contábil de lucro.

Caixa previsto no fim do período = saldo-base na data de corte + entradas futuras esperadas − saídas futuras esperadas. Mostrar fonte/data do saldo-base e confirmação bancária disponível. Contar somente eventos posteriores ao corte e excluir valores já recebidos/pagos, adiantamentos aplicados e créditos identificados reservados; não somar novamente títulos ao dinheiro já disponível. Manter cenário de títulos confirmados separado do cenário ampliado com fretes a faturar. Vencidos exigem nova previsão ou aparecem como sem previsão confiável; vencimento passado não garante recebimento futuro.

Caixa realizado bancário = saldo inicial confirmado + créditos efetivos − débitos efetivos, por conta e período, igual ao extrato validado. Comparar previsão congelada/versionada com realizado e explicar diferenças por atraso, antecipação, valor alterado, nova movimentação e entrada não identificada. Não recalcular retroativamente a previsão original usando o realizado para aparentar acerto. Projeção não é alterada para forçar igualdade com extrato; o realizado deve coincidir, e a diferença contra o previsto deve ser explicada.

Critérios de aceite: NF/CT-e/NFS-e/fatura não multiplicam o mesmo frete; faturamento parcial move só a parcela correspondente; descarga em cobrança conjunta não duplica; recebimento parcial preserva saldo; crédito recebido antes da baixa não duplica caixa nem previsão; adiantamento de cliente aplicado depois não gera nova entrada; título de mês anterior entra no caixa do mês de recebimento; crédito desconhecido fica visível; baixa manual e conciliação automática preservam autorias distintas; previsto original é preservado ao comparar com realizado.

## 5. Experiência para trabalho em volume

### Despesas da empresa fora de viagens

Escopo confirmado pelo usuário: registrar também compras para a sede, lanches, folha e demais despesas sem vínculo com viagem. A viagem é um contexto opcional do financeiro, não um requisito de lançamento. Essas despesas usam o mesmo núcleo de títulos, pagamentos registrados, alocações, comprovantes, extrato e auditoria.

Separar três dimensões: **origem/contexto** (viagem, sede, manutenção, pessoal etc.), **categoria** (combustível, alimentação, materiais, salários etc.) e **centro de custo/unidade**. Alimentação da sede e alimentação de motorista podem compartilhar uma categoria geral, mantendo contexto e centro de custo para análises separadas. Quem vendeu, quem recebeu o pagamento e quem foi reembolsado são papéis distintos.

| Caso | Lançamento e vínculo financeiro |
|---|---|
| Materiais de limpeza, escritório ou equipamentos para a sede | Compra com fornecedor, documento, categoria, unidade e itens/rateios quando necessários; pagamento imediato já realizado ou título a vencer |
| Lanches e alimentação da equipe | Lançamento simples ou lote, com finalidade e centro de custo; distinguir pagamento direto de reembolso ao funcionário |
| Aluguel, energia, água, internet e serviços | Títulos com competência, vencimento e fornecedor; modelos recorrentes geram previsões/títulos, nunca pagamentos realizados automaticamente |
| Folha e pagamentos de pessoal | Competência, tipo do pagamento, beneficiários e valores provenientes da folha validada; registrar pagamentos individuais ou lote, conforme a movimentação real |
| Impostos e encargos | Títulos separados por guia/natureza e competência, com vencimento e documento; evitar misturar encargos com os valores líquidos pagos aos funcionários |
| Compras feitas por funcionário | Registrar despesas e reembolso vinculado ao funcionário; uma saída pode cobrir várias compras, sem somar o reembolso novamente como despesa |
| Compra parcelada | Uma origem/documento e parcelas identificadas com seus vencimentos, saldo e pagamentos; impedir duplicação entre valor da compra e parcelas nos indicadores |
| Cartão corporativo | Itens explicam a composição da fatura; pagamento da fatura é a saída bancária, sem contar compra e quitação novamente como o mesmo custo |

#### Lançamento rápido unificado

Entrada "Novo lançamento", com escolha de contexto e opção de uma linha ou várias. Para despesas fora de viagem, não pedir motorista nem viagem. Campos comuns: contraparte, descrição, categoria, centro de custo, valor, data do fato/competência, documento/anexo e situação financeira. Campos adicionais aparecem conforme o caso: vencimento, parcelas, funcionário reembolsado ou rateio.

Oferecer "A pagar", "Pagamento já realizado" e "Vincular a saída existente". No segundo caso, solicitar conta, data real, método, beneficiário e comprovante; no terceiro, reaproveitar o movimento sem nova saída. Registrar gasto já pago não pode deixar um título aberto cobrando novamente o mesmo valor. Agenda de pagamento é interna, sem execução de transação.

No lote, compartilhar fornecedor/data/contexto quando fizer sentido, permitindo exceções por linha. Agrupamento de digitação é distinto de agrupamento de pagamento: vinte despesas registradas juntas podem ter vinte pagamentos; um pagamento pode cobrir vários itens. Não presumir que todo lote corresponde a uma única linha de extrato.

Exemplo: compra na sede de R$ 500, sendo R$ 300 de material de escritório e R$ 200 de limpeza, paga por um único PIX. Registrar uma saída de R$ 500, duas alocações classificadas e um vínculo bancário. Se o funcionário pagou e foi reembolsado, guardar fornecedor da compra e funcionário beneficiário do reembolso separadamente.

#### Folha: registro financeiro e acesso restrito

Inclusão confirmada pelo usuário: folha faz parte obrigatória do módulo e da primeira versão completa. Entrada por competência/beneficiário, geração ou registro dos valores, contas a pagar vinculadas, pagamentos registrados, conciliação e auditoria devem compor o fluxo. Ainda falta escolher a fonte dos valores (cálculo existente ou folha externa validada), não decidir se a funcionalidade estará incluída.

O sistema já contém geração e recálculo de folha, contratos, adiantamentos e integração com acertos, além de geração de contas a pagar ao aprovar o período. Preservar e integrar essa capacidade, sem substituí-la silenciosamente por importação externa. Confirmar com o cliente se usa cálculo interno, folha externa validada ou ambos, definindo uma origem responsável por cada competência/beneficiário. A existência do cálculo interno não comprova atendimento de todas as regras trabalhistas. Folha deve entrar no contas a pagar com competência e referência de origem; regeneração ou importação equivalente não pode duplicar compromissos.

Permitir distinguir salário, adiantamento salarial, férias, rescisão e outros tipos definidos pelo cliente, preservando vínculos para evitar que o adiantamento seja pago ou contado novamente no fechamento. Valores brutos, líquidos, descontos e encargos não são intercambiáveis; se o cliente precisar desses indicadores, recebê-los da origem validada e definir sua apresentação com o responsável pela folha. Não inferir custo total de pessoal apenas a partir do débito bancário líquido.

Se o banco apresentar pagamentos individuais, conciliar individualmente. Se apresentar débito agregado, exigir composição/referência do lote para relacionar beneficiários; igualdade do total da folha não basta. Guardar diferença por beneficiário e por lote quando houver, mantendo comprovantes e intervenção manual identificáveis.

Detalhes de salários, documentos e anexos de pessoal devem ter permissões específicas, incluindo busca, exportação e acesso aos arquivos; acesso ao financeiro geral não implica acesso irrestrito à folha. A chefia autorizada continua tendo visibilidade de autoria, conciliação manual e pendências.

#### Critérios de aceite específicos

- Registrar compra da sede sem preencher viagem/motorista e encontrá-la por fornecedor, categoria e centro de custo.
- Compra com duas categorias e um PIX mantém uma saída e indicadores separados.
- Vincular despesa já paga a uma saída existente não duplica pagamento nem deixa saldo indevido a pagar.
- Recorrência cria compromisso a vencer; não altera caixa antes da realização.
- Reembolso de funcionário preserva fornecedor e beneficiário sem duplicar custo.
- Folha individual/agregada segue a estrutura comprovada pelo banco; importação repetida não duplica títulos.
- Usuário sem permissão de pessoal não acessa salários individuais por tela, busca, exportação ou anexo.
- Compra parcelada/cartão não duplica custo com quitação; divergências e decisões manuais mantêm as mesmas regras de auditoria das viagens.

Navegação proposta: **Hoje, A pagar, A receber, Viagens e adiantamentos, Caixa e bancos, Conciliação**. Configurações ficam fora da rotina principal. A visão de contraparte cruza pagar e receber sem compensar valores automaticamente.

O início deve mostrar filas acionáveis: vencer hoje, atrasadas, aguardando aprovação, prontas para pagamento, sem documento, adiantamentos em aberto, descargas sem pagador e divergências bancárias. Cada indicador abre sua lista filtrada.

### Estação de lançamento

- Modal amplo ou painel de trabalho com cabeçalho compartilhado e grade de linhas; escolher viagem/motorista uma vez.
- Navegação por teclado, nova linha, duplicar linha, colar linhas de planilha e preservar padrões da sessão.
- Anexos por item e por pagamento, com visualização ao lado da grade e vínculo inequívoco.
- Rascunho recuperável, validação na própria linha e total sempre visível; falha não perde o trabalho digitado.
- Ações separadas para salvar rascunho, enviar para revisão, programar e registrar pagamento realizado.
- Revisão do lote com quantidade, valor, beneficiário, conta e exceções antes de confirmar; nenhuma linha pode desaparecer silenciosamente.
- Manter filtros, seleção, posição e foco depois de editar ou registrar uma baixa.
- Tabelas densas e legíveis, colunas ajustáveis, busca por contraparte/documento/viagem/valor e filtros salvos.
- Ações em lote exibem elegíveis e bloqueados com motivos; nenhum sucesso genérico para processamento incompleto.

## 6. Caixa e conciliação confiáveis

Regra confirmada pelo usuário: as saídas são registradas no momento do envio, enquanto os gastos da viagem são detalhados depois. O extrato chega ao final e é a fonte de verdade da movimentação bancária. Para a mesma conta, período e data de corte, o caixa bancário confirmado deve reproduzir o extrato. O sistema acrescenta composição, finalidade, documentos e rastreabilidade.

Antes da importação, apresentar saldo operacional provisório baseado nos envios/recebimentos registrados, com indicação de até quando há confirmação bancária. Depois da importação validada, distinguir o valor bancário confirmado das declarações internas ainda divergentes. Não somar os dois como movimentações diferentes. Cada movimento bancário contribui uma única vez para o caixa confirmado, inclusive quando sua finalidade ainda está pendente de identificação.

Exibir saldo inicial em uma data definida, entradas, saídas e saldo final por conta. A igualdade exigida é: saldo inicial confirmado + créditos do extrato − débitos do extrato = saldo final confirmado. Conferir também cada movimento, quantidades e totais de entradas/saídas: dois erros opostos podem deixar o saldo final correto. Uma tela que apenas soma o extrato não prova que os registros internos estão conciliados.

### Tratamento de divergências

| Situação | Interpretação e prioridade proposta | Tratamento |
|---|---|---|
| Saída registrada, viagem ainda não conferida, extrato ainda não recebido | Etapas pendentes normais | Mostrar aguardando prestação de contas e aguardando extrato; não tratar ausência de dados futuros como erro |
| Gastos R$ 480, envio R$ 500 e extrato R$ 500 | Dinheiro confirmado; R$ 20 sem destinação explicada | Manter caixa em R$ 500 de saída e abrir diferença de prestação de contas; revisar itens, recibos, grupos, sobra ou complemento |
| Gastos R$ 500, envio registrado R$ 500 e extrato R$ 520 | Divergência bancária crítica após validar arquivo e correspondência | Preservar declaração original, confirmar identidade da transação e investigar os R$ 20; corrigir registro com motivo/evidência e reavaliar composição. Não aumentar gastos automaticamente |
| Débito no extrato sem saída registrada | Movimentação real sem registro interno | Incluir no caixa confirmado e abrir pendência crítica de identificação; regularizar registro vinculado à mesma linha bancária, sem duplicar saída |
| Saída registrada sem linha correspondente em extrato completo do corte aplicável | Envio declarado sem evidência bancária | Investigar conta/data, duplicidade, agendamento confundido com realização ou erro; corrigir/reverter declaração com histórico. Não assumir automaticamente que o envio ocorreu ou que foi cancelado |
| Saldo final bate, mas existem movimentos sem vínculo | Conciliação incompleta | Bloquear conclusão da conferência bancária até resolver os vínculos; igualdade de saldo isolada não basta |

Não presumir que toda diferença entre gastos e envio seja erro de digitação: também pode haver recibo faltante, grupo incorreto, sobra em posse do motorista ou gasto coberto por outra origem. O operador deve selecionar a causa e a resolução, não apenas informar uma justificativa genérica para fechar.

Uma diferença vira pendência com valor, origem, responsável, prazo, evidências, histórico e ação de resolução. Corrigir item digitado errado; vincular recibo faltante; mover alocação ao grupo correto; manter saldo do motorista; registrar devolução/complemento realmente ocorrido; ou corrigir declaração de saída são ações distintas. Nenhuma delas altera silenciosamente o extrato original.

Exemplo: extrato e envio confirmam R$ 500, mas os recibos somam R$ 480. O banco está conciliado e o acerto da viagem continua pendente em R$ 20. Se o motorista devolver R$ 20, registrar uma nova entrada na data real da devolução e conciliá-la; não reduzir retroativamente o PIX original para R$ 480. Até resolver, os KPIs mostram R$ 480 de custos classificados e R$ 20 a prestar contas, sem transformar a diferença em alimentação, combustível ou despesa genérica.

Manter duas conclusões independentes: **conferência bancária concluída** e **prestação de contas concluída**. Proposta: divergência bancária real bloqueia fechamento bancário definitivo; composição pendente mantém o acerto aberto, mas não impede reconhecer o saldo bancário já confirmado. O período só recebe indicação de integralmente conferido quando ambas as verificações aplicáveis estiverem concluídas.

Caixa físico exige contagem e conferência próprias. O consolidado de banco mais dinheiro físico não é igual ao saldo de uma única conta bancária. Projeção de caixa usa títulos ainda abertos e deve aparecer separada do realizado.

Conciliação em três colunas: extrato, pagamento/lote e composição/origem. Priorizar identificadores bancários quando disponíveis, conta, beneficiário, direção, valor e data. Coincidência de valor não basta para confirmar automaticamente quando há candidatos ambíguos.

Importação deve ser idempotente por conta e identidade da transação; arquivos de períodos sobrepostos não podem duplicar linhas. Guardar arquivo, origem e resultado. Validar conta, cobertura do período, datas, sinais, saldo inicial/final e integridade da leitura antes de concluir que há divergência financeira: falha de importação é diferente de erro na movimentação registrada. Quando o arquivo não fornecer elementos para comprovar cobertura e saldo, mostrar verificação incompleta e solicitar a evidência faltante. Confirmar bancos e formatos reais antes de prometer OFX ou integração automática; a implementação examinada já possui parsing de planilhas/CSV.

Fechamento do período exige totais e pendências explicados, responsável e trilha de reabertura. Não inventar ajuste de caixa para zerar diferença.

## 7. Direção técnica

### Exclusão de acesso dos motoristas

Decisão obrigatória do usuário: motoristas não acessam financeiro, incluindo folha, contas a pagar/receber, caixa, extratos, adiantamentos/acertos financeiros, relatórios, KPIs e documentos financeiros. Isso inclui seus próprios registros financeiros neste módulo. Motorista pode continuar sendo beneficiário ou origem de uma operação sem ter acesso ao dado.

Bloquear por autorização no servidor/banco e acesso aos arquivos, além de remover menus e rotas. Cobrir consultas diretas, comandos/RPCs, exportações, busca, notificações e URLs de comprovantes. Contextos operacionais do motorista não podem expor valores internos nem servir de acesso indireto ao financeiro. Sessões/caches e permissões precisam respeitar revogação de acesso.

O código já tem tela DriverExpenses e caminhos de criação de despesas pelo motorista. A implementação deve inventariar e bloquear esses caminhos financeiros para esse perfil, ajustando o fluxo para o lançamento pelo financeiro no retorno conforme definido. Preservar funcionalidades operacionais não financeiras, como execução de entregas. Eventual recebimento de foto operacional não equivale a autorização para lançar ou consultar despesas; qualquer exceção futura exige decisão explícita.

Homologação com sessão real de motorista: não listar nem consultar por ID registros financeiros, inclusive próprios; não criar/alterar/baixar/conciliar; não exportar nem abrir anexos financeiros; não obter dados pela API ou por telas operacionais. Testar também cadastro de motorista vinculado a usuário e combinação de papéis: o perfil motorista não pode ganhar acesso financeiro por uma concessão genérica de operador. Política recomendada é negar acesso financeiro quando houver papel de motorista na mesma empresa, até eventual regra de exceção explicitamente definida pelo cliente.

### Visibilidade permanente da intervenção manual e prevenção de ocultação

Diretriz confirmada pelo usuário: o controle deve ajudar a prevenir e evidenciar fraude. A conciliação manual deve permanecer identificável para a chefia, permitindo responder imediatamente quem a realizou. Intervenção manual é um sinal de controle e revisão, não prova de fraude.

Separar situação da conciliação e origem da decisão. Um movimento pode estar conciliado com origem automática ou manual. Aceitar uma sugestão do sistema por decisão humana também conta como conciliação manual, com subtipo "sugestão confirmada"; associação escolhida diretamente usa "vínculo manual". Não classificar a confirmação humana como automática apenas porque o sistema sugeriu o candidato.

Na lista, exibir selo textual permanente "Manual" com cor distinta, por exemplo âmbar, ao lado do estado da conciliação. Não depender apenas da cor. Exibir responsável e data em coluna ou detalhe acessível, sem exigir investigação em logs. Para movimentos parcialmente conciliados por pessoas, mostrar "Com intervenção manual"; detalhes identificam os vínculos afetados, seus valores e autores. Disponibilizar filtros por intervenção manual, responsável, período da decisão, motivo e revisão da chefia; incluir esses campos nas exportações e relatórios.

Registrar cada decisão no servidor com identificador estável do usuário autenticado, nome exibido na ocasião, data/hora do servidor, empresa, conta, movimento bancário, registros vinculados, valores, tipo de decisão, motivo obrigatório e evidências. Guardar resultado das verificações, candidatos/alertas apresentados e dados anteriores e posteriores pertinentes. Para automação, guardar regra, versão e execução; registrar o usuário que importou o arquivo separadamente de quem decidiu o vínculo.

O histórico é acrescentado por eventos e não pode ser editado/apagado pelos papéis operacionais, incluindo os da chefia. A indicação histórica é derivada desses eventos, não de uma marca que o operador possa desativar. Desconciliar, corrigir, reimportar ou reconciliar automaticamente depois não apaga a intervenção anterior: mostrar a origem atual e o selo "Histórico de intervenção manual". Exclusão/desativação da conta do usuário não deve destruir sua identificação no histórico. Acesso privilegiado de infraestrutura continua sendo uma fronteira de confiança; definir retenção, backups e proteção adicional dos registros de auditoria antes da implantação.

O detalhe mostra uma linha do tempo: quem vinculou o quê, por qual valor, quando, por qual motivo, verificações disponíveis e eventuais correções/revisões posteriores. A revisão da chefia acrescenta autor, data e decisão próprios e nunca muda a origem manual para automática. Proposta a validar: exigir revisão por outra pessoa para ocorrências críticas e impedir autoaprovação nesses casos; não impor aprovação dupla a todos os casos sem definir a política com o cliente.

Conciliação manual não é autorização para ignorar invariantes: não pode alterar o extrato, consumir duas vezes o mesmo valor, cruzar empresas/contas incompatíveis nem considerar explicada uma diferença apenas com justificativa. O operador pode escolher uma correspondência válida ou registrar alocação parcial, mantendo o restante pendente; discrepâncias reais exigem resolução específica e rastreável.

Homologação: confirmar sugestão gera origem manual; autor e horário vêm do servidor; edição de nome/desativação do usuário preserva identidade histórica; reimportação e reversão não eliminam selo/histórico; vínculo automático posterior mantém indicação de intervenção anterior; lista e exportação permitem filtrar por autor; usuário operacional não consegue apagar ou alterar eventos de auditoria; revisão da chefia não sobrescreve decisão original.

### Conciliação automática após upload: verificações e contingência

Diretriz confirmada pelo usuário: o upload deve disparar conciliação automática com vários métodos de conferência e contingências. A automação não pode prometer certeza absoluta: só deve confirmar casos que cumpram critérios explícitos e verificáveis; ausência de evidência, conflito ou ambiguidade mantém o caso pendente. Score alto não equivale a comprovação.

Pipeline proposto:

1. **Validar o arquivo antes de usar os dados.** Identificar formato/banco, conta e período; validar datas, moeda, sinais e precisão dos valores. Guardar original e hash, versão do parser e relatório de importação. Linhas rejeitadas ou cobertura incompleta não podem desaparecer em uma importação apresentada como completa. Problemas estruturais ficam em quarentena para revisão, sem produzir fechamento automático.
2. **Conferir a extração.** Quando o arquivo trouxer saldos, verificar abertura + créditos − débitos = fechamento e, quando disponíveis, saldos sucessivos. Comparar contagens e totais de controle fornecidos pelo banco. Ausência desses dados mantém a validação correspondente como não disponível. Dois algoritmos sobre a mesma extração não são duas evidências independentes; uma segunda conferência deve usar informação de controle distinta quando existir.
3. **Deduplicar com identidade bancária.** Preferir identificador estável da transação, contextualizado por conta e instituição. Hash do arquivo evita reprocessar o mesmo arquivo, mas não resolve períodos sobrepostos. Sem identificador estável, comparar contexto e multiplicidade; duas transferências legítimas iguais não podem ser apagadas por uma chave de data/valor/nome. Ambiguidade vai para revisão.
4. **Gerar candidatos em ordem de força.** Primeiro identificador bancário exato presente também no registro interno; depois referências documentais e identidade do beneficiário quando disponíveis; por último contexto de conta, direção, moeda, valor e janela de data. Nome aproximado e similaridade de descrição servem para sugerir candidatos. Falta de candidato forte não autoriza reduzir silenciosamente os requisitos de confirmação.
5. **Aplicar barreiras obrigatórias antes de confirmar.** Conta e empresa corretas; direção e moeda compatíveis; valor exato em centavos; identidade/referência coerente; transação e registro não consumidos por outro vínculo incompatível; candidato sem concorrente plausível. Identificador exato com valor divergente é conflito, não autorização para ignorar o valor. A política inicial de confirmação automática exige referência bancária forte nos dois lados e todas as barreiras satisfeitas; os demais casos começam como sugestões e só poderão ganhar automação após validação com dados reais.
6. **Conferir agrupamentos já declarados.** Para um PIX que cobre vários gastos, associar extrato ao envio e conferir a soma de suas alocações separadamente. Não procurar combinações arbitrárias de despesas só porque somam o valor do extrato. Se não houver composição registrada, confirmar o banco quando houver evidência suficiente e manter prestação de contas pendente. Um extrato sem identificador de lote não deve ser associado automaticamente a vários envios apenas pela soma.
7. **Executar verificação final independente da escolha de candidatos.** Antes de gravar, validar novamente saldos disponíveis para alocação, unicidade dos vínculos, valores e versão dos registros. Após gravar, recomputar invariantes: movimento contado uma vez, alocações dentro do valor, totais bancários preservados e nenhuma baixa duplicada. Essa verificação identifica defeitos de lógica/concorrência; não substitui evidência bancária ausente.
8. **Publicar resultado explicável.** Mostrar quantidades e valores importados, duplicados confirmados, conciliados automaticamente, sugeridos, divergentes e rejeitados. Cada confirmação guarda evidências, regra e versão utilizadas, candidatos descartados e execução responsável. Disponibilizar detalhes e desconciliação auditada sem apagar a linha bancária.

Contingências: formatos desconhecidos exigem mapeamento validado; arquivos ilegíveis exigem nova fonte; falta de referência gera sugestão; múltiplos candidatos exigem seleção humana; diferença de valor gera ocorrência; timeout permite consultar/retomar a mesma execução; nova importação sobreposta não recria vínculos. Leitura assistida/OCR, se adicionada, propõe dados e não autoriza conciliação sem validação. Não usar tolerância percentual para confirmar dinheiro: tarifa, juros ou desconto exigem componentes próprios e evidência.

Processamento por estágios com prévia da importação e estados persistidos. Validar o arquivo antes das mutações financeiras, aplicar vínculos em operações atômicas e recuperáveis e nunca anunciar sucesso integral após falha parcial. Uma ocorrência isolada pode deixar casos comprovados conciliados; o período permanece sem fechamento definitivo enquanto houver divergências bancárias. Correção de registro concorrente invalida a decisão antiga e exige reavaliação.

Homologação adicional: PIX iguais no mesmo dia; identificador repetido em arquivos sobrepostos; transações legítimas idênticas sem identificador; sinal invertido; separador decimal incorreto; conta errada; arquivo truncado; datas em virada de período; referência exata com valor conflitante; tarifas separadas; importações concorrentes; falha após gravação e antes da resposta; totais líquidos iguais com linhas incorretas. Montar conjunto de casos reais anonimizados com resultado esperado validado pelo financeiro. Medir falsos positivos, falsos negativos e taxa de revisão; prioridade é não confirmar vínculo errado. Zero falsos positivos no conjunto de homologação é requisito de liberação, não garantia de impossibilidade futura.

Reaproveitar títulos, despesas, acertos e comprovantes existentes. Introduzir ou consolidar entidades para lote, movimento financeiro, alocações, adiantamento/prestação de contas, transferência e vínculos com o extrato. financial_obligations pode ser uma projeção de consulta, mas não deve competir com os títulos como fonte independente de saldo.

Requisitos de integridade: valores em centavos ou numeric com arredondamento definido; transação atômica por operação financeira; chave de idempotência; bloqueio/controle de versão contra baixas concorrentes; isolamento por empresa; autorização no servidor; histórico de ator, data, motivo e valores anteriores. Anexos precisam de acesso protegido e estados de validação.

Filtros, paginação, contagens e somas no servidor, calculados sobre o mesmo conjunto. Para seleção entre páginas, definir se vale a lista explicitamente selecionada ou todos os resultados do filtro. Lotes longos precisam de progresso, resultado por item e retomada segura.

Mapear fontes de despesas para impedir duplicação entre aprovação, manutenção, contas a pagar, adiantamentos e acerto do motorista. Uma origem deve permitir rastrear custo, obrigação, alocações e recebível de repasse sem multiplicar o mesmo efeito financeiro.

## 8. Sequência de entrega e critérios de conclusão

| Etapa | Entrega | Critério de saída |
|---|---|---|
| 0 — Contratos e exemplos | Mapear origens existentes, pagadores, prazos, bancos, permissões, saldos de abertura e protótipos | Decisões críticas da seção 11 resolvidas e casos reais com resultado esperado |
| 1 — Núcleo financeiro | Separar fato, título, movimento, alocações, evidência e auditoria; corrigir sinais e definir migração | Uma movimentação produz um único efeito; parcial, repetição, estorno e concorrência preservam saldos |
| 2 — Entradas fiscais | Autorização CT-e/NFS-e, cancelamento/rejeição, faturas/fechamentos/EDI, baixa manual e KPIs | Um frete conta uma vez em todas as telas, inclusive com cancelamento após recebimento |
| 3 — Saídas e prestação de contas | Grade única, PIX agrupado, descarga, despesas gerais, folha/acertos e manutenção | Fluxos atuais integrados sem nova digitação ou pagamento duplicado; diferenças rastreáveis |
| 4 — Banco e fechamento | Importação, automação conservadora, intervenção manual visível, divergências e previsto × realizado | Saldo e movimentos conferidos por conta/período; autoria e histórico preservados |
| 5 — Piloto e corte | Migração ensaiada, homologação por perfil, desempenho com volume e liberação controlada | Saldos iniciais aprovados, nenhuma duplicação nos casos de teste e retorno operacional viável |
| Posterior — Expansões | OCR, novos formatos, relatórios avançados e automações adicionais de consulta | Ampliação sem reduzir os critérios de integridade já homologados |

Essas etapas organizam dependências; a primeira liberação operacional deve fechar um fluxo completo até conciliação. Não liberar uma grade rápida que ainda produza caixa inconsistente.

### Casos de homologação essenciais

1. Três despesas totalizando R$ 450, um PIX, uma linha de extrato, três alocações, uma saída.
2. Adiantamento de R$ 500, gasto de R$ 450, devolução de R$ 50 e encerramento do saldo do motorista.
3. Adiantamento insuficiente com complemento, sem duplicar reembolso.
4. Saque entre banco e caixa físico, depois despesa em dinheiro; consolidado correto.
5. Descarga cobrável agrupada em fatura sem título duplicado, inclusive ao repetir a origem.
6. Baixa parcial, tarifa/desconto explícito e pagamento agrupado de títulos.
7. Extrato importado antes e depois da baixa; reimportação sobreposta não duplica dinheiro.
8. Estorno, desconciliação e devolução real preservam significados e histórico distintos.
9. Duas pessoas baixando o mesmo saldo; timeout e reenvio não duplicam operação.
10. Dois PIX iguais no mesmo dia para destinatários distintos não são associados apenas pelo valor.
11. Despesa já coberta pelo acerto/adiantamento não volta como novo pagamento em contas a pagar.
12. Lista com volume superior a 1.000 itens apresenta totais completos, filtros corretos e paginação.
13. Extrato e envio de R$ 500 com gastos de R$ 480: caixa conciliado, R$ 20 pendentes na prestação de contas e categorias preservadas.
14. Extrato de R$ 520 contra envio declarado de R$ 500: divergência crítica, histórico preservado e nenhuma alteração automática dos recibos.
15. Débito bancário sem origem aparece no caixa confirmado e na fila de identificação; regularização não duplica movimento.
16. Saída declarada sem evidência em extrato completo permanece divergente; arquivo parcial não produz diagnóstico prematuro de erro financeiro.
17. Erros opostos com saldo líquido igual não permitem concluir conciliação de movimentos.
18. Devolução posterior de sobra é nova entrada na data real, preservando o envio original e o corte dos períodos.

Metas iniciais propostas, a calibrar com o cliente: reduzir pela metade o tempo por lote frente à rotina medida; zero perda de rascunho em falha simulada; localizar origem/comprovantes em até duas ações; medir p95 de busca/filtros com pelo menos 10 mil títulos e volume concorrente representativo. Desempenho só será considerado validado após medição.

## 9. Decisões que faltam para tornar o planejamento definitivo

Confirmado: o fornecedor reembolsa a descarga, limitado a uma descarga por entrega, com fornecedor identificado nas NFs dessa entrega; o sistema apenas registra e concilia transações realizadas externamente; os gastos são lançados em lote no retorno da viagem e associados a envios que normalmente cobrem várias despesas. Falta definir políticas de sobras/complementos e vencimentos.

Roteiro para a próxima conversa com o financeiro:

- Quantas linhas por dia, usuários simultâneos e despesas por viagem? Qual tarefa toma mais tempo hoje?
- Quais bancos, contas, empresas e formatos de extrato? Qual data e saldo de abertura?
- Quem pode lançar, aprovar, pagar, conciliar, estornar e reabrir período? Existem limites de valor?
- Que documento comprova a despesa? Quando a falta de comprovante impede pagamento e quando admite justificativa?
- Descarga pode ter acréscimo, limite, contestação ou valor diferente do custo? Quando vence? O fornecedor único por entrega já está definido.
- Um PIX pode cobrir várias viagens? Há adiantamento em aberto transportado entre viagens?
- Como funcionam pagamentos por cartão corporativo, cartão pessoal, dinheiro e abastecimento faturado?
- Quais compromissos recorrentes, parcelamentos, impostos, folha e manutenção precisam entrar na primeira versão?
- Como tratar compensação entre pagar/receber da mesma contraparte, retenções, descontos e pagamentos a terceiros?
- O que é entregue à contabilidade e quais relatórios são usados para tomar decisões?
- Quais dados históricos devem migrar? Quem valida títulos abertos, adiantamentos e saldos iniciais?

Sugestões para brainstorm posterior: leitura assistida de comprovantes com revisão humana, modelos de lançamentos recorrentes, alertas de duplicidade, extrato da contraparte e previsão de caixa por confiança de recebimento. Priorizar depois de estabilizar o fluxo e medir os gargalos reais.

## 10. Corte e migração

Inventariar títulos, pagamentos, extratos, acertos, descargas e anexos; medir divergências antes de alterar. Definir uma data de corte e validar saldos por conta e motorista com o cliente. Migrar vínculos preservando identificadores e histórico; não presumir que registros antigos marcados matched têm evidência bancária.

Executar ensaio em ambiente isolado, comparar totais e casos de ponta, liberar para grupo piloto e manter caminho de retorno sem duplicar gravações entre fluxos antigo e novo. Dados ambíguos entram em fila de saneamento com responsável. Critério de migração: origem identificável, saldos conferidos e exceções documentadas.

## 11. Revisão integral: gaps e decisões para fechar a especificação

### 11.1 Recursos existentes que precisam de integração explícita

| Evidência no código local | Lacuna encontrada | Regra/entrega necessária |
|---|---|---|
| usePayroll.tsx; approve_payroll_period na baseline gera payables por payroll_entry | Plano anterior enfatizava folha externa e não detalhava o cálculo existente | Integrar geração, recálculo e aprovação atuais; uma origem de folha por competência/beneficiário; reaproveitar os títulos gerados |
| usePayroll.tsx contempla driver_settlement, pagamentos, reembolsos, adiantamentos, already_paid e descontos de ocorrência | Mesmo motorista pode aparecer em viagem, acerto, folha e pagar | Extrato do motorista/funcionário com origens e destinações; pagamento já feito deve abater o destino correto, sem ser repetido pela folha |
| DriverSettlementDrawer.tsx e useDriverSettlements.tsx têm KM, resultado da rota, reembolso, ajustes, pagamentos e recálculo | Modal novo poderia substituir o acerto e perder regras existentes | Grade alimenta acerto existente; separar prestação de contas, remuneração e resultado da viagem; revisar recálculo após ajuste sem reabrir pagamento indevido |
| useClosingReports.tsx tem pagador distinto, itens, pagamentos e situação; useBillingEdi.tsx e navegação têm DOCCOB | Plano citava faturas genericamente e não assegurava continuidade do fechamento/arquivo de cobrança | Fechamento e DOCCOB usam os mesmos títulos/composições e histórico de exportação; emitir/baixar em qualquer tela deve refletir nas demais |
| MaintenanceOrders.tsx registra peças, mão de obra, fornecedor e total; há estoque e ativos na navegação | "Despesa de manutenção" não define se já está coberta por compra, estoque ou pagamento anterior | Mapear OS → item de custo → documento/obrigação → pagamento; peça do estoque não gera novo contas a pagar ao ser consumida; compra e consumo são fatos diferentes |
| useCostCenters.tsx fornece nomes e cadastro completo; useClients.tsx contempla papéis e pagador | Renomear/inativar cadastro pode fragmentar consulta histórica ou confundir contraparte | IDs estáveis e identificação histórica; inativação impede novo uso sem ocultar passado; separar cliente da operação, devedor e pagador efetivo |

Essas são evidências de recursos e caminhos locais, não certificação de funcionamento em produção. Os trechos de baseline citados no diagnóstico precisam ser reproduzidos contra a cadeia completa de migrations e gatilhos antes de qualquer correção de código.

### 11.2 Distinções que faltavam no plano

1. **Cancelar fatura comercial não é cancelar CT-e/NFS-e.** Pelo gatilho confirmado, cancelar um agrupamento de cobrança deve desfazer/reorganizar o agrupamento, preservando títulos fiscais válidos e recebimentos. Cancelar fiscalmente uma origem afeta só sua cobertura. Testar os dois caminhos separadamente; o fluxo existente de fatura e seu recebível precisa ser adaptado a essa diferença.
2. **Autorizar não define sozinho vencimento nem destinatário da cobrança.** Parametrizar tomador/devedor, condição de pagamento, marco de contagem do prazo e fechamento por cliente; preservar a condição aplicada na origem. Sem prazo ou pagador suficiente, criar pendência cadastral visível, sem inventar vencimento. Descarga precisa de regra equivalente por fornecedor.
3. **Recebido não é o único motivo para encerrar saldo.** Separar recebimento, aplicação de crédito, compensação autorizada, desconto/perda e cancelamento. Ações sem movimento bancário não criam entrada/saída de caixa. Renegociação mantém vínculo com títulos originais e evita carteira dobrada. Tratamentos de perda/desconto exigem permissão, motivo e revisão conforme política a validar.
4. **Conciliação bancária e prestação de contas possuem referências diferentes.** Um mesmo envio pode ser repartido entre viagens sem duplicação, desde que cada alocação tenha valor e origem explícitos. Permitir transferência de saldo entre viagens como evento auditado; a decisão de habilitar esse caso depende da prática do cliente.
5. **Recebível precisa de base de valor definida.** Registrar valor de serviço/documento, deduções/retenções confirmadas quando aplicáveis e valor esperado em dinheiro; não assumir que todos os campos fiscais representam o mesmo montante. Importar valores da origem validada, sem criar cálculo tributário ad hoc. Quando houver documento complementar, tratar a parcela incremental e sua origem; substituição continua seguindo as regras de cobertura já descritas.
6. **Arredondamento em rateios precisa fechar.** Ratear em centavos com critério determinístico para distribuir resíduos e guardar composição; soma por categoria, título, viagem e pagamento deve coincidir com o total correspondente. Não aceitar valores negativos como atalho para estorno.
7. **Extrato confirma movimento, não legitimidade.** Um pagamento indevido também aparece no banco. A verificação de finalidade, autorização, recibo e beneficiário é independente da confirmação bancária. Arquivo enviado pelo operador deve guardar proveniência; hash prova preservação após upload, não autenticidade do arquivo original.

### 11.3 Controles adicionais para evidenciar irregularidades

- Detectar recibo/documento reutilizado entre despesas, viagens e pessoas, por identidade documental e arquivo; sinalizar suspeita para revisão. Um recibo legítimo pode ser rateado: modelar um documento com várias alocações limitadas ao valor, sem exigir cópias e sem rotular todo reuso como fraude.
- Registrar alterações de beneficiário, documento de identificação, conta e referência PIX, incluindo autor e valores anteriores; mudança cadastral não reescreve destinatário histórico. Beneficiário diferente do previsto gera exceção visível.
- Visão da chefia com manuais, diferenças abertas, pagamentos sem documentação, alterações posteriores à aprovação, baixas sem entrada bancária e concentração de decisões por usuário; métricas são sinais para investigação, não acusações.
- Estender trilha de auditoria a descontos, cancelamentos, reclassificações, ajustes de valor, anexos substituídos e mudanças de regra de automação; não limitar controle ao botão de conciliar manualmente.
- Definir matriz de permissões concreta: lançar, alterar aprovado, registrar realização, confirmar baixa, conciliar manual, ajustar crédito/desconto, revisar, fechar e reabrir. Ações críticas e autoconfirmação seguem política expressa. A regra atual de revisão de despesas por administrador precisa ser confrontada com os usuários reais do financeiro.
- Manter painel de operações com falha e sincronização fiscal pendente, tentativas e retomada. O chefe deve saber se um total está incompleto por falha técnica, e não receber indicador de zero como se não houvesse movimento.

### 11.4 Fechamento, relatórios e navegação a preservar

Definir pacote de fechamento com saldo por conta, cobertura de extratos, movimentos conciliados, créditos sem origem, títulos abertos, adiantamentos, composição pendente, intervenções manuais e autor da revisão. Exportar dados e índice de comprovantes respeitando permissão, com data de corte e identificadores rastreáveis. Detalhar antes do piloto o formato solicitado pela contabilidade.

A navegação proposta é agrupamento de acessos, não retirada de recursos. Preservar acesso a faturas, fechamentos, DOCCOB, aprovação de despesas, acertos e centros de custo, com atalhos contextuais e permissões adequadas. Distinguir "fechamento de cobrança", "fechamento da folha", "encerramento da viagem" e "fechamento bancário do período" nos textos e estados.

Saldo inicial e carteira anterior devem estar amarrados à data de corte: títulos já pagos não reaparecem, e recebimento de título antigo não volta a gerar faturamento atual. Histórico pré-migração sem evidência suficiente deve ser rotulado como legado com validação de abertura, sem inventar autoria ou conciliação automática.

### 11.5 Corte recomendado e decisões ainda abertas

**Obrigatório na primeira versão completa:** núcleo de valores/alocações; recebível por autorização e reversões fiscais; recebimentos parciais/agrupados e baixa manual; envio ao motorista e grade no retorno; descarga vinculada ao fornecedor devedor; despesas gerais; folha de pagamento e integração de acertos/manutenção existentes; bloqueio de acesso financeiro dos motoristas; banco/caixa; autoria permanente; saldos de abertura; filtros e relatórios completos. A recorrência, parcelas e cartão, caso usados pelo cliente, precisam de tratamento mínimo seguro desde o piloto, mesmo que o assistente avançado venha depois.

**Pode vir depois:** OCR de comprovantes, ampliações de formatos bancários, relatórios avançados de rentabilidade e automações de consulta adicionais. Execução bancária permanece fora do projeto. Cálculo contábil/trabalhista novo não está implicitamente incluído.

Decisões que impedem especificação definitiva, mas não impedem prototipar a rotina:

| Decisão | Por que precisa fechar | Proposta de encaminhamento |
|---|---|---|
| Bancos/formatos e referências disponíveis no PIX | Determinam a taxa possível de conciliação automática segura | Examinar extratos e comprovantes anonimizados, incluindo transações iguais e períodos sobrepostos |
| Prazos, devedores e condições de frete | Autorização cria título, mas não informa toda a agenda de entrada | Validar regras por cliente/pagador e tratamento de retenções |
| Gatilho e identidade da descarga | Fornecedor único pelas NFs e uma descarga por entrega já definidos; importação e recibo podem descrever o mesmo fato | Unificar identidade da entrega e origem legada; gerar recebível na conferência aprovada como proposta |
| Fonte dos valores da folha/acertos | Folha já está confirmada no escopo; falta evitar duas fontes calculando e pagando o mesmo compromisso | Demonstrar uma competência real com adiantamento, acerto e pagamento e definir fonte responsável |
| Perfis internos, alçadas e exceções | Motoristas já estão excluídos; falta definir atribuições dos demais perfis | Nomear papéis internos e decidir quais ações precisam de segunda pessoa, sem conceder acesso financeiro ao motorista |
| Sobras, viagens múltiplas, cartões e parcelas | Definem saldos e cenários mínimos da primeira versão | Homologar exemplos representativos ou desabilitar fluxos não suportados de forma explícita |
| Corte histórico e fechamento | Necessários para comparar caixa e extrato com confiança | Validar saldo por conta, títulos abertos e créditos/adiantamentos na abertura |

Conclusão da revisão: plano adequado como direção de produto e base de protótipo; não rotular como especificação definitiva até fechar a matriz acima e a matriz origem → gatilho → título → pagamento → reversão. O backlog de implementação deve referenciar os critérios de aceite distribuídos nas seções de cada fluxo, além dos casos gerais da seção 8.
