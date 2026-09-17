# Auditoria de conclusão do módulo financeiro — 2026-09-14

## Regra de conclusão

O módulo só pode ser considerado concluído quando cada fluxo obrigatório estiver implementado no banco principal, publicado no Sites e exercitado em sessão autenticada, com isolamento entre empresas. Teste local ou migration candidata não equivale a ativação em produção.

Nenhuma rotina desta rodada emite, cancela ou recalcula documento fiscal. Os documentos existentes são somente referências/evidências. Execução bancária também permanece fora do sistema.

## Estado autoritativo

- Sites publicado: versão 42, commit-fonte `07e7285e5232ea628e84088bff5ffd1f9046bea9`, deployment concluído.
- Hotfix de centro de custo: commit isolado `1f4f3a65af0867737e978cb7dbbb40ac68d25d57`, ainda não enviado; push aguarda autorização explícita porque a recompilação renomeou 535 caminhos de bundle. Em 14/09, a repetição no working tree aprovou 3 arquivos/12 testes e ESLint sem avisos; o caso de interface comprova que `Novo centro de custo` e `Salvar centro de custo` permanecem habilitados, e que o clique vazio mostra a validação, marca o campo como inválido e devolve o foco.
- Revalidação HTTP pública em 14/09: `/cost-centers` respondeu `200` referenciando `index-dlDoPdWl.js`; seu manifesto ainda resolve `CostCenters-BpPZ58Zd.js`, que também respondeu `200` e não contém a cópia `Salvar centro de custo`. O artefato local do commit `1f4f3a6` contém `CostCenters-1IOC3tW6.js`, com a nova ação e a validação vazia. Isso comprova que a falha relatada continua sendo divergência de publicação, não regressão do hotfix local.
- Auditoria remota do CRUD de centros de custo em 14/09: `public.cost_centers` tem RLS ativa, nenhum acesso `anon`, privilégios `select/insert/update/delete` para `authenticated`, política restritiva de empresa ativa e políticas permissivas limitadas a operador/admin; a chave única é `(tenant_id,name)` e a FK de `finance_expense_items` bloqueia exclusão de cadastro utilizado. O frontend injeta `x-agvlog-tenant-id` somente nas rotas Supabase da própria origem. Quatro arquivos/15 testes passaram em conjunto para transporte multiempresa, configuração do cliente, mutações tenant-scoped e interface; os advisors atuais não reportaram achado de segurança ou desempenho para `cost_centers`.
- Banco principal: contém a etapa canônica privada de pagamento de adiantamento (`finance_employee_advance_canonical_payment`), mas não contém o catálogo público e as demais candidatas listadas abaixo.
- Preflight remoto somente leitura, repetido em 14/09 no projeto saudável PostgreSQL 17.6: a migration mais recente continua sendo `20260914210507 finance_employee_advance_canonical_payment`; os quatro predecessores de folha conferem exatamente os fingerprints e ACLs esperados pela próxima candidata. O catálogo público, a baixa agrupada, a cobertura operacional, a renegociação, a correção materializada de viagem e a devolução real de adiantamento continuam ausentes, conforme a ordem planejada.
- Preflight remoto da cobertura operacional: PostgreSQL 17.6; as duas funções de `20260914213840` ainda não existem e todos os leitores/tabelas predecessores consultados existem. A aplicação foi recusada pelo gate de segurança até autorização explícita para criar as duas funções persistentes e seus grants; nenhum objeto remoto foi alterado.
- Preflight remoto somente leitura da correção de viagem materializada: os cinco objetos candidatos de `20260914215310` ainda não existem; o contexto predecessor está presente com MD5 `e886db6cf5d0e3f0d0578659dd87266d`, `SECURITY DEFINER`, volatilidade estável e `search_path` vazio, e os dois wrappers e o guarda de cancelamento planejado exigidos estão ativos. O histórico remoto continua terminando em `20260914210507`; nenhum objeto remoto foi alterado.
- Preflight remoto somente leitura da renegociação: as três tabelas privadas e as seis funções públicas de `20260914214752` ainda não existem; os oito predecessores de recebimento, crédito, ajuste, carteira e previsão estão presentes. Todos os sete trechos exatos que a migration substitui conferem, o trecho de atraso da carteira ocorre uma única vez e `get_receivable_financial_context` permanece `SECURITY DEFINER`, com `search_path` vazio, executável somente por `authenticated`. O histórico remoto continua terminando em `20260914210507`; nenhum objeto remoto foi alterado.
- Validação integrada local em 2026-09-14: typecheck sem erros, suíte integrada anterior com 24 arquivos/68 testes aprovados e bateria final das áreas afetadas com 8 arquivos/27 testes aprovados. Depois dela, as regressões de acesso financeiro passaram em 7 arquivos/27 testes, UX de alto volume em 4 arquivos/19 testes e parcelas/fechamento/centro de custos em 6 arquivos/22 testes. O encerramento de adiantamento por entrada bancária real passou em 3 arquivos/9 testes (banco, outbox e UI) e em 6 disputas concorrentes num PostgreSQL 17 nativo descartável. A baixa agrupada passou em 4 arquivos/16 testes funcionais e em outras 6 disputas PostgreSQL nativas, incluindo concorrência com a baixa unitária, reenvio, revogação de acesso durante lock, isolamento entre tenants e ausência de escrita parcial. O ciclo predecessor da folha e o pagamento canônico de acertos passaram em mais 9+9 casos PostgreSQL nativos. As quatro candidatas de adiantamento pago/folha passaram diretamente em outros 9 casos PostgreSQL nativos e 5 arquivos/7 testes funcionais, cobrindo catálogo invoker, idempotência, pagamento parcial, aprovação concorrente, recomputação, revogação de acesso e locks por tenant. O carryover contíguo passou em mais 8 casos PostgreSQL nativos e 2 arquivos/10 testes funcionais/UI, incluindo transporte único, cadeia de prova, corrida de aprovação, recomputação concorrente, revogação durante lock, isolamento por tenant e ausência de caixa ou documento fiscal. A cobertura operacional elevou o total dessas validações nativas para 53 casos: seus 6 casos adicionais e 3 arquivos/5 testes funcionais/UI cobrem todas as origens, reversão, vínculo órfão, datas de São Paulo, isolamento por tenant, ausência de efeitos em caixa/fiscal e 1.005 fontes em 84 ms. A correção de viagem materializada elevou o total para 61 casos nativos: 8 casos PostgreSQL 17 e 3 arquivos/11 testes funcionais/UI provaram ACLs, isolamento, revisão obsoleta, concorrência, revogação de acesso durante lock, imutabilidade, rollback e preservação byte a byte dos vínculos de carga, título e documento fiscal existente. O `build:check` final passou com 4.778 módulos; artefato sem source maps ou material reconhecido como segredo.
- Benchmark local opt-in com 10.000 títulos (PGlite, 20 amostras aquecidas, carga inicial excluída): resumo completo p50 133,60 ms / p95 140,05 ms / máximo 143,20 ms; busca `needle` filtrada antes da página 2 p50 69,10 ms / p95 72,51 ms / máximo 75,22 ms. A consulta retornou exatamente 10.000 títulos no resumo e 500 correspondências/50 linhas na página; isso não substitui a medição hospedada.
- Benchmark PostgreSQL 17 nativo descartável com os mesmos 10.000 títulos e 20 amostras aquecidas: página inicial p95 139,10 ms, página profunda p95 126,01 ms, busca p95 47,32 ms, resumo completo set-based p95 171,15 ms e resumo de cliente/500 títulos p95 33,00 ms. Os seis casos passaram sem lacuna funcional; o controle escalar deliberadamente N+1 levou 17,55 s, comprovando que ele não deve voltar ao caminho publicado. A medição hospedada ainda é necessária porque latência, plano e recursos do banco principal são diferentes.
- A renegociação elevou o total consolidado para 69 casos PostgreSQL 17 nativos. Seus 8 casos adicionais e 3 arquivos/7 testes funcionais provaram ACLs dos três journals e seis APIs, criação e replay idempotente, duas corridas concorrentes, revogação de acesso durante lock, rateio e estorno de caixa por parcela, crédito e desconto, revisão/revogação paginadas, imutabilidade, isolamento entre empresas e ausência de título, caixa ou valor nominal duplicado. A suíte nativa identificou e corrigiu a fronteira pública inacessível: os wrappers agora são definidores com `search_path` vazio, grants explícitos e helpers privados ainda revogados.
- Importação de extrato Excel: a interface bloqueava `Preparar prévia` para `.xls/.xlsx` apesar de o leitor, o mapeamento e o verificador já suportarem workbook. O gate e a cópia foram corrigidos; 4 arquivos/24 testes passaram, incluindo XLSX real em memória com hash, período, linha, totais e caminho preservado, além de ESLint, typecheck e diff check. A correção ainda não está no Sites publicado.
- Validação autenticada no Sites: ainda ausente. O controlador do navegador interno falhou duas vezes ao inicializar; o navegador automatizado alternativo abriu o bundle local em `http://127.0.0.1:4173/cost-centers`, mas a rota redirecionou corretamente para login porque a sessão separada não possui a autenticação do usuário. Nenhuma credencial foi criada, lida ou reutilizada para contornar esse limite.

## Candidatas locais ainda não ativadas

| Frente | Migration principal | Estado local | Estado remoto |
|---|---|---|---|
| Adiantamento pago e folha | `20260911124237`, `20260911124625`, `20260911125548`, `20260914191353` | pagamento parcial, aprovação/cancelamento auditados e estornos testados; as quatro candidatas passaram diretamente em 9 casos PostgreSQL nativos e 5 arquivos/7 testes funcionais | somente a primeira etapa privada está no banco |
| Carryover da folha | `20260914215302` | excesso comprovado segue uma única vez para a competência contígua; 8 casos PostgreSQL nativos e 2 arquivos/10 testes funcionais/UI aprovados | não aplicada |
| Baixa agrupada de contas a pagar | `20260914205842` | prévia, rateio, idempotência, outbox, vínculo a um movimento e 6 disputas PostgreSQL nativas testados | não aplicada |
| Cobertura de custos operacionais | `20260914213840` | manutenção, estoque e legado auditado entram sem dupla contagem; 6 casos PostgreSQL 17 nativos e 3 arquivos/5 testes funcionais/UI aprovados, incluindo 1.005 fontes em 84 ms e nenhuma mutação de caixa ou fiscal | não aplicada |
| Renegociação de recebíveis | `20260914214752` | journal/parcelas, revisão, revogação, rateio de caixa/crédito/ajustes, carteira temporal, previsão e histórico paginado; 8 casos PostgreSQL 17 nativos e 3 arquivos/7 testes funcionais aprovados, incluindo concorrência, revogação durante lock, ACLs e ausência de duplicação econômica | não aplicada |
| Correção de viagem materializada | `20260914215310` | encerra operação ativa preservando histórico físico, financeiro e fiscal; 8 casos PostgreSQL 17 nativos e 3 arquivos/11 testes funcionais/UI aprovados, incluindo duas correções concorrentes, revogação de acesso durante lock, rollback da auditoria e 26 guardas de grafo | não aplicada |
| Devolução real de adiantamento de viagem | `20260914220500` | vincula entrada bancária existente ao saldo do motorista, sem criar caixa/despesa ou alterar movimentos; capacidade, tenant, recuperação, UI e 6 disputas PostgreSQL nativas testados | não aplicada |

## Casos essenciais do plano

Legenda: **L** = comprovado localmente; **R** = comprovado no banco/Sites atual; **E2E** = comprovado em sessão autenticada publicada.

| # | Caso | Evidência atual | Falta para conclusão |
|---:|---|---|---|
| 1 | três despesas, um PIX, uma linha e uma saída | L | ativar e repetir E2E |
| 2 | adiantamento 500, gasto 450, devolução 50 | L | ativar `20260914220500` e repetir E2E autenticado |
| 3 | adiantamento insuficiente e complemento | L | ativar e repetir E2E |
| 4 | saque banco → caixa físico → despesa | L/R nos contratos existentes | repetição autenticada |
| 5 | descarga cobrável sem duplicidade | L/R para origem de descarga | repetição autenticada com documento existente |
| 6 | parcial, desconto/tarifa e pagamento agrupado | L, incluindo concorrência PostgreSQL nativa entre baixa agrupada e unitária | ativar baixa agrupada e repetir E2E |
| 7 | extrato antes/depois da baixa e reimportação | L/R para OFX/CSV; L para XLS/XLSX após corrigir o botão que bloqueava a prévia | publicar a correção, reproduzir arquivo real do usuário e E2E |
| 8 | estorno, desconciliação e devolução distintos | L/R em writers existentes | repetição autenticada |
| 9 | concorrência, timeout e reenvio | L em PGlite/outboxes e PostgreSQL 17 nativo (63 casos: devolução, baixa agrupada, ciclo predecessor da folha, pagamento de acerto, candidatas de adiantamento/folha, carryover, correção de viagem materializada e renegociação) | repetir E2E publicado e ampliar o ensaio hospedado nos writers ativados |
| 10 | PIX iguais não associados só pelo valor | L/R em regras de conciliação | repetição autenticada |
| 11 | despesa coberta não volta ao contas a pagar | L | ativar candidatas e repetir E2E |
| 12 | mais de 1.000 itens com totais/paginação | L, incluindo 10 mil no PGlite e no PostgreSQL 17 nativo (6 casos, totais exatos, p95 registrados) e 1.005 fontes operacionais resumidas exatamente em 84 ms | repetir a medição no PostgreSQL hospedado e E2E |
| 13 | envio 500, gastos 480, sobra 20 | L | ativar e repetir E2E |
| 14 | extrato 520 × envio 500 | L | ativar e repetir E2E |
| 15 | débito sem origem na fila de identificação | L/R | repetição autenticada |
| 16 | saída sem evidência e arquivo parcial | L/R | repetição autenticada com extrato representativo |
| 17 | erros opostos não conciliam pelo saldo líquido | L/R | repetição autenticada |
| 18 | devolução posterior como nova entrada real | L | ativar e repetir E2E |

## Bloqueios de ativação

1. O push isolado do hotfix de centro de custo exige autorização explícita para substituir os 535 caminhos recompilados no branch principal do Sites. A auditoria independente encontrou somente dois arquivos-fonte novos e zero mudanças inesperadas.
2. As migrations de baixa agrupada, folha e devolução de adiantamento instalam writers/triggers persistentes. Elas não executam PIX, pagamento externo ou emissão fiscal, mas podem bloquear gravações inconsistentes, materializar valores comprovados na folha ou reservar a capacidade de movimentos já registrados; a aplicação no banco principal exige confirmação explícita de risco.
3. As candidatas dependentes devem ser aplicadas em ordem, com preflight/fingerprints, advisors de segurança/desempenho e smoke read-only após cada migration.
4. A homologação publicada precisa de uma sessão autenticada acessível ao executor ou acompanhamento direto do usuário; não se deve criar, ler ou reutilizar credenciais pessoais para contornar essa exigência.

## Ordem de ativação preparada

1. Não reaplicar `20260911124237`: seu conteúdo canônico já foi promovido no remoto como `20260914210507 finance_employee_advance_canonical_payment`.
2. Aplicar e validar, nesta ordem, `20260911124625` (folha usa apenas pagamentos comprovados), `20260911125548` (ciclo auditado), `20260914191353` (fronteira pública) e `20260914215302` (carryover contíguo).
3. Aplicar individualmente `20260914205842` (baixa agrupada), `20260914213840` (cobertura operacional), `20260914214752` (renegociação), `20260914215310` (correção de viagem materializada) e `20260914220500` (devolução real de adiantamento), interrompendo a sequência ao primeiro preflight divergente.
4. Após cada migration: conferir a nova entrada no histórico remoto, executar smoke read-only dos objetos criados e revisar advisors de segurança e desempenho antes de prosseguir.
5. Publicar primeiro o hotfix isolado de centro de custo; a versão completa do frontend só deve ser empacotada contra o banco já ativado e depois exercitada em sessão autenticada.

Esta ordem é somente um runbook. Nenhum writer, trigger ou deployment pendente foi ativado ao documentá-la.

## Decisões de produto ainda abertas

- alçadas específicas para dados salariais e ações críticas;
- fonte responsável da folha/acerto e composição de débito bancário agregado;
- condições/vencimentos por pagador e tratamento de retenções;
- política de sobras entre múltiplas viagens, cartão e parcelamento;
- corte histórico, saldos de abertura e formato final do pacote contábil.

Até essas decisões serem homologadas, os caminhos sem regra suficiente devem continuar visíveis e bloqueados, sem vencimento, rateio, autoria ou conciliação inventados.

## Comprovações adicionais locais

- As parcelas da renegociação aparecem na carteira, no diálogo do acordo, no histórico do pagamento e dentro dos diálogos de fatura e fechamento, sempre vinculadas ao recebível original.
- A regressão SQL cobre leitura e escrita cross-tenant, além de perfil motorista/misto, com rejeição `finance_access_denied`.
- Em lote de despesas, uploads pendentes bloqueiam somente as respectivas linhas; outras linhas continuam editáveis e o envio final permanece protegido.
- Opções financeiras cacheadas não ficam selecionáveis durante refetch; a folha não apresenta zeros ou ações baseadas em leitura ainda pendente.
- `financePortfolioPerformance.benchmark.test.ts` mantém o ensaio de 10 mil títulos fora do CI normal e registra p50/p95/máximo do resumo e da busca paginada somente quando `FINANCE_PORTFOLIO_BENCHMARK=1`.
