# Fechamento por tentativa — fundação de leitura local

**Avanço posterior:** a criação atômica e a integração local das telas estão documentadas em [Fechamento atômico](FECHAMENTO-ATOMICO-2026-08-30.md). O estado, métricas e próximos passos abaixo descrevem a conclusão da fundação de leitura, antes desse avanço; não representam publicação em produção.

Estado: contrato de leitura, projeção e painel React implementados localmente. **Não publicados nem ativados na página de fechamento.** A criação antiga continua inadequada para receber esta prévia: cabeçalho, linhas, resumos e histórico são gravados em chamadas separadas. O próximo lote deve substituí-la por gravação atômica/idempotente e só então ligar o fluxo completo. Este documento não declara o fechamento ou o aplicativo prontos para produção.

## Contrato implementado

- `get_closing_report_sources(tenant, filters)` autoriza operador/administrador ativo da empresa com `auth.uid()`. Helper privado, `search_path` vazio, grants explícitos; anon e service_role não recebem execução. O contrato depende da cadeia de tentativas/conferência e recusa reaplicação.
- Cada origem identifica nota, alocação, tentativa, carga, resultado auditado e saldo físico. A tentativa original usa ID nulo. A antiga alocação lê o snapshot preservado, não o `load_id` atual da nota. A consulta de resultados inclui as tentativas históricas e exclui versões substituídas por correção.
- Metadados administrativos, XML, payload fiscal e dados de credenciais não são devolvidos. Datas de baixa vêm do histórico auditado, nunca do alias `delivered_at`. O filtro de resultado usa dia civil de São Paulo; “somente entregues” exige resultado `delivered`, não entrega parcial.
- A nota continua contendo o frete fiscal/comercial original depois de liberada para reentrega. A projeção não o trata como preço da nova tentativa: apresenta zero com revisão obrigatória até existir o contrato próprio de precificação. Saldo ainda não alocado vem dos itens reservados da tentativa e é identificado como reservado. Pallets, peso e m³ não viram quantidade de volumes por estimativa.
- Um CT-e só é candidato da tentativa original quando há vínculo explícito com a nota **e** a carga. O universo de rateio inclui todas as notas originais vinculadas antes dos filtros de período/cliente/veículo. Referências ausentes ou ambíguas impedem o rateio; não há fallback para atribuir o frete inteiro à primeira nota por falta de denominador.
- A projeção só aceita frete fiscal com situação e SEFAZ autorizados, ambiente `production`, sem cancelamento e sem invalidação. Homologação, sandbox, status contraditório e ambiente desconhecido permanecem diagnósticos. O caminho `fiscal_documents/outbound` é distinguido de `cte_documents`; seu ambiente ainda não é resolvido nesta etapa e não é presumido como produção.
- Rateio em centavos inteiros, com resto distribuído deterministicamente, preserva o valor total do CT-e. O filtro visual não redistribui a parcela das notas omitidas. Duas origens fiscais aceitas são uma ambiguidade a conciliar, inclusive se compartilham chave fiscal; não são somadas ou substituídas silenciosamente.
- As tentativas ocupam linhas distintas, mas contagem e valor global de mercadorias consideram notas distintas. Valores contraditórios da mesma nota e alocações duplicadas de uma tentativa interrompem a prévia. Os subtotais de mercadorias por grupos distintos podem não ser aditivos quando a mesma nota aparece em grupos diferentes; exportação deve explicar essa diferença.
- Limites explícitos: até 500 origens selecionadas, 500 candidatos fiscais e 2.000 origens no universo de rateio. Excesso retorna erro pedindo refinamento, não uma página truncada com total parcial. Período máximo de 366 dias.
- Envelope versionado identifica ator, empresa, filtros normalizados e revisão. O cliente valida sua forma e contexto. A revisão é controle de mudança de leitura, **não assinatura nem autorização para gravar valores enviados pelo navegador**.
- Hook/React Query separa cache por ator, tenant, filtros e modo. Troca de contexto não mantém a prévia antiga. Resposta incompleta, tardia para contexto anterior ou incompatível não vira total financeiro. O painel é estritamente de consulta, sem criação de relatório, faturamento ou pagamento.

## Verificação

Fixtures reutilizam as migrações operacionais reais e dados sintéticos. Campos auxiliares vêm somente da baseline local; a permissividade de colunas nullable da fixture não prova paridade integral com o Supabase hospedado. Não houve nova exportação de esquema/funções de produção.

Testes focados cobrem SQL, projeção financeira e React real contra a RPC SQL local. Teste inicial revelou que o frete da nota permanecia original e que itens de reentrega estavam reservados, não em `load_items`: a implementação passou a tratar essas duas fontes explicitamente. Nenhuma regra de integridade ou asserção foi removida para contornar o resultado.

Resultados definitivos, processos encerrados com código zero:

- **46 testes focados**: 19 SQL, 21 de projeção/validação e 6 de React real contra o SQL. Os testes de tela cobrem histórico/reentrega, rateio com nota omitida, resposta incompleta/recuperação de leitura, troca de tenant durante resposta atrasada, troca de operador para motorista e filtros inválidos.
- **Gate completo: 1.892 testes em 153 arquivos**, 46 novos em relação à conferência administrativa C. Node 22.23.2/npm 10.9.4. Tipos, lint geral e crítico, baseline estrutural, sintaxe de 40 Edge Functions, build e scanner de artefato público passaram. Lint focado dos oito novos arquivos TypeScript/React/testes também passou com zero avisos. Maior chunk: 488,3 KiB, limite 500 KiB.
- Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches e 81,81% funções. Não é cobertura integral do aplicativo e não mede integralmente os arquivos novos.
- **199 casos nativos PostgreSQL 17.11**, seis novos: aplicação/leitura sem alteração de evidências, saldo reservado/histórico, ACL/tenant/papel, snapshot consistente durante atualização fiscal concorrente, revogação de membership e reaplicação recusada. Cluster em loopback encerrado, sem conexão com produção. SHA-256 da candidata efetivamente carregada: `80e61b8d9acf4ba679e29105dca168905521fd13ebd948c0e6138a7de8c447c5`.
- `git diff --check` passou. Nenhum processo deste lote ficou em execução. Esses testes não são E2E autenticado hospedado, teste visual ou auditoria Axe completos.

## Próximo lote obrigatório

1. Implementar criação de rascunho em uma transação, com chave idempotente, resposta persistida, autorização e locks ordenados, revisão revalidada e totais construídos/validados no servidor. Não confiar em `itemsOverride` ou totais de uma prévia editável. Recuperação após resposta perdida deve repetir o mesmo corpo/chave, vinculados ao ator e tenant.
2. Preservar importação de planilhas com origem explicitamente não auditada. O modelo resumo hoje perde valores ao criar cabeçalho porque não possui itens; corrigir também os resumos/contagens sem inventar vínculos operacionais.
3. Adaptar fechamento/envio/reabertura/cancelamento/edição/faturamento e seus escritores diretos. Revisar duplicidade com recebíveis criados por CT-e, pagamento idempotente, revisões posteriores de resultado e autorização financeira. Não revogar DML utilizado antes de oferecer os substitutos funcionais.
4. Resolver origem/ambiente do caminho outbound e conciliar as duas representações fiscais. Implementar revisão de preço/vínculo fiscal por nova tentativa antes de permitir cobrança da reentrega. Não assumir que a NF reutilizada autoriza reutilizar o CT-e antigo.
5. Ligar o painel à página somente com o escritor atômico. Exportações PDF/Excel/CSV precisam manter carga, tentativa, resultado e origem dos valores, além dos totais por nota distinta. Não reutilizar os resumos antigos que somam a mercadoria novamente por linha.
6. Cobrir múltiplas reentregas, correções após relatório/faturamento, recuperação, concorrência e compatibilidade entre módulos; ensaiar contenção/restauração preservando histórico. Publicação requer preflight e validação autenticada coordenada. A rejeição anterior de exportação/DDL amplo não foi contornada.

As orientações Supabase/PostgreSQL fundamentaram o isolamento, privilégios explícitos e leitura consistente; React orientou o escopo do cache e descarte de respostas obsoletas. Sem emissões fiscais, pagamentos, mensagens externas, serviços pagos ou chamadas SSX neste lote. SSX segue inativo.
