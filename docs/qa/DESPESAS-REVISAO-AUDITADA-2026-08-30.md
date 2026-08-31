# Despesas — revisão auditada e efeitos financeiros

Estado: candidata local, **não publicada**. O objetivo completo continua em andamento. Esta etapa cobre revisão operacional; não conclui criação do motorista, lançamento manual, retenção de arquivos ou E2E hospedado.

## Evidência anterior à correção

Quatro testes executaram os corpos reais do baseline, com o esquema financeiro local já capturado, sem nova exportação de produção:

1. Operador com leitura, mas sem política de atualização, recebe zero linhas atualizadas e nenhum erro. A tela anterior anunciava sucesso.
2. Despesa nova em viagem com acerto pago não ativa needs_recalculation.
3. Alterar despesa de empresa aprovada para rejeitada deixa a obrigação financeira ativa.
4. add_driver_settlement_manual_expense referencia vehicle_id e outras colunas ausentes de driver_expenses; lançamento manual falha. **Reproduzido, ainda não corrigido nesta etapa.**

O sincronizador financeiro verdadeiro foi instalado na fixture no lugar da instrumentação de efeitos usada pelos testes anteriores. Os testes desta etapa não consideram um stub como prova de geração de obrigação.

## Implementação local

Migração: 20260830203548_audit_driver_expense_reviews.sql. SHA-256 executado e conferido: 8ab02f25da3b07ff80c5c4088b55830064bbcfa063495ee68912df300e96321e.

- get_driver_expense_review_context: autorização atual de operador/admin, despesa exata, empresa, revisão, validações e histórico.
- list_driver_expenses_for_review: paginação de 50 por filtro, contagem real e escopo de ator/empresa. Não esconde pendências antigas atrás das 100 despesas mais recentes.
- review_driver_expense: aprovação/rejeição somente por administrador, conforme a política anterior; operador continua com consulta. Exige motivo, revisão esperada e UUID persistente, compara SHA-256 do corpo e recupera a confirmação original.
- Membership é revalidado depois de aguardar a chave do pedido. Bloqueios coordenam viagem, acerto, despesa, obrigação e comprovante; conflito aborta integralmente.
- driver_expense_reviews mantém antes/depois, ator, motivo e resposta. RLS, grants explícitos e revogações individuais; helpers não são APIs públicas.
- Escrita direta por papéis API é revogada. Despesa revisada e auditoria ficam imutáveis. FK e trigger diferidos exigem que a decisão corresponda à confirmação gravada no mesmo commit.
- Nova despesa/decisão marca o acerto para revisão inclusive quando aprovado, pago ou fechado. Não altera status, valor devido, valores pagos ou evidência de pagamento. Guardas financeiros existentes impedem novo pagamento/finalização enquanto a revisão está pendente.
- Aprovação de despesa de empresa não reembolsável gera uma única obrigação a conciliar, com valor conciliado zero. Não cria pagamento, movimento bancário ou match, nem sincroniza indiscriminadamente uma janela de datas.
- Não é permitido reabrir ou reescrever silenciosamente uma despesa já decidida. Divergências financeiras legadas exigem um fluxo de conciliação/correção ainda pendente; a migração **não** cancela nem apaga obrigações antigas por inferência.

A tela de aprovação usa as novas APIs e confirmação validada. A prévia fica preservada durante o preenchimento; mudança concorrente exige atualização explícita. Motivo não se perde em erro. Consultas apresentam carregamento/falha em vez de uma lista vazia enganosa. Cards mantêm categoria, valor, origem do pagamento, reembolso, fornecedor, documento, local, hodômetro, descrição e motivo.

Fila versionada local, separada por empresa/ator, persiste antes do envio; Web Locks evitam disputa entre abas. Pedido incerto não é substituído, inclusive após negação posterior. Painel global recupera a revisão após sair da página. Não são guardados tokens ou URLs assinadas na fila.

Comprovante consulta somente caminho da empresa; troca de caminho, ator ou empresa desmonta o resultado anterior e ignora respostas tardias. Falhas e timeout são explícitos. Isso **não** prova retenção física, propriedade do upload ou segurança integral do endpoint de limpeza.

## Verificação desta etapa

- 4 testes de reprodução do legado.
- 12 testes da candidata SQL: replay, obrigação única, rejeição, autorização, revisão desatualizada, valores divergentes, comprovante, preservação de acerto pago, rollback tardio, DML negado, confirmação diferida e paginação.
- 13 testes da página/diálogos React ligados às RPCs SQL locais: aprovação, consulta de operador, rejeição e motivo, recuperação, prévia alterada, quota, troca de empresa, confirmação errada, campos inconsistentes, erro de consulta, paginação e isolamento do comprovante.
- 8 testes da fila persistente: armazenamento antes do envio, confirmação compatível, erro certo/incerto, cliques duplicados, outra decisão, versão/escopo e mudança de sessão.
- Total: **37 novos testes**. Transporte Supabase substituído por adaptador local e assinatura de comprovante simulada; **não é E2E HTTP/Auth/Storage hospedado**.
- Gate geral aprovado, código zero: **2.078 testes/170 arquivos**, tipos, lint, baseline de qualidade (113/113 avisos explícitos de any; nenhum novo arquivo >500 linhas), sintaxe de 40 Edge Functions, build e scanner de artefato público. Node 22.23.2/npm 10.9.4; maior chunk 488,3 KiB. Sem source maps ou material secreto reconhecido no artefato.
- Cobertura do subconjunto configurado: 93,03% statements/linhas, 65,83% branches e 81,81% funções. Não é cobertura integral do aplicativo.
- **247 testes PostgreSQL 17.11 nativos aprovados**, código zero, com dez novos: aplicação sem alterar dinheiro; aprovação idêntica concorrente; aprovação contra rejeição; edição concorrente; revogação durante espera; rollback tardio e reenvio; sinalização de acerto pago; remoção concorrente do comprovante; duas despesas na mesma viagem; imutabilidade e RLS. Cluster descartável encerrado, sem conexão com produção.
- CLI 2.116.0: assessores locais retornaram ECONNREFUSED em 127.0.0.1:54322; stack Supabase completa não ativa. PGlite e PostgreSQL nativo não substituem Auth, PostgREST, Storage e PostGIS completos.
- A primeira bateria da candidata encontrou dependência indevida de extensions.digest. Foi substituída por SHA-256 nativo do PostgreSQL, como nos comandos anteriores, e as regressões foram repetidas com sucesso.
- Na fixture, foram acrescentados a função real de escopo de viagens e o grant de leitura de drivers exigidos pelas políticas reais do baseline. Não foram criadas colunas fictícias para fazer o lançamento manual passar.
- Hashes anteriores preservados: faturas e345e26f41d2ccc4c2b21d3f5450983eb41ca359856d61dc29afd11472ae5ccf; recebimentos 031851dab23c76b18d872cd81837e60224156f5f6e3a3ad07a81bfaa0b67464d.

## Pendências para o fluxo integral e publicação

1. Criação idempotente pelo motorista e pela operação; corrigir o contrato quebrado do lançamento manual e definir correção/reenvio de despesa rejeitada sem apagar a decisão anterior.
2. Devolver ao motorista o motivo/histórico da revisão com escopo próprio. Hoje sua lista existente recebe status por realtime/refetch, mas ainda não apresenta esse histórico.
3. Corrigir coerência de origem/adiantamento no formulário, validação de valor, escopo de cache, rascunho, upload e resposta incerta na criação. O legado de criação ainda existe e pode duplicar lançamentos.
4. Provar propriedade, existência, retenção e limpeza segura dos comprovantes. O gateway usa serviço privilegiado; verificação de prefixo por tenant não equivale a propriedade individual. Não desativar scanner nem acionar serviço pago para passar QA.
5. Conciliação de dados legados, obrigações já existentes, acertos aprovados/pagos e demais escritores financeiros. Sinalizar revisão não resolve automaticamente o saldo: preservar evidência até uma decisão auditada.
6. Ensaiar contenção/retomada e preflight delimitados; coordenar backend e frontend. Não reabrir escrita direta como fallback e não promover toda a árvore local suja.
7. Validar fluxo autenticado motorista → operação → acerto/financeiro no ambiente autorizado, incluindo teclado/zoom/Axe, uploads reais e pós-deploy. Credenciais somente por canal seguro. Não repetir operações amplas anteriormente rejeitadas por auto-review.

Nenhuma publicação, transmissão fiscal, transferência, mensagem externa, ativação SSX ou serviço pago foi executado nesta etapa. Skills Supabase/PostgreSQL orientaram privilégios, RLS, locks e evidência financeira; React orientou isolamento dos componentes, formulários nomeados e recuperação versionada. A revisão de privilégios segue a documentação oficial de [funções do banco](https://supabase.com/docs/guides/database/functions).
