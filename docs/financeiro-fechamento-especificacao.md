# Especificação de fechamento bancário por conta e período

Data: 10/09/2026. Estado: proposta implementável, ainda sem SQL de fechamento. Revisão local do schema candidato, incluindo `20260910140010_finance_account_opening_balances.sql`; não representa implantação remota nem homologação bancária.

## 1. Contrato de produto e estado observado

O fechamento confirma o banco de uma conta em um intervalo inclusivo de dias civis de São Paulo. Não executa transação financeira. Extrato e movimento interno representam o mesmo dinheiro; não se somam. Composição de gastos, contas a pagar/receber, folha e prestação de contas têm estados próprios. Pendência de recibos de R$ 20 em um envio/extrato de R$ 500 mantém a prestação de contas aberta, sem transformar a diferença em custo nem alterar o PIX.

Base: [plano, seção 6](planejamento-financeiro-2026-09-09.md), especialmente conferência por movimento, cobertura, correções e duas conclusões independentes; seção 11.4 para pacote e corte histórico.

Hoje existem diagnósticos, não fechamento definitivo:

- `20260910023911_finance_account_period_review.sql`: totais brutos, líquidos, quantidades, não conciliados, identidade pendente, grupos com evidência inválida e grupos cruzando período; `can_close=false`.
- `20260910130956_finance_statement_period_evidence.sql`: cobertura declarada OFX de dias inteiros, fuso, âncoras, aritmética e revisão manual imutável. `coverage_status=requires_review`, `authenticity_status=not_attested`, `legacy_integration_status=pending`, `can_close=false`. Registrar revisão não muda esses estados.
- `20260910140010_finance_account_opening_balances.sql`: abertura baseada em âncora nativa no dia anterior, fuso -180, uma abertura ativa por conta, reversão auditada e saldo escritural projetado. Não cria entrada de dinheiro; `can_close=false`. Abertura não comprova adoção integral do legado nem cobertura posterior.
- `20260910035550_finance_transfer_period_position.sql`: posição de trânsito pelos registros conhecidos atualmente, explicitamente `frozen=false`.

Todos os nomes de tabelas/comandos novos abaixo são propostos. Não devem ser apresentados como disponíveis.

## 2. Representação persistente proposta

### Fechamentos e reaberturas

`finance_account_period_closures`: `id`, `tenant_id`, `bank_account_id`, `period_start`, `period_end`, `version`, `actor_id`, `actor_name`, `reason`, `request_id`, `created_at`, `snapshot`, `snapshot_revision`, `previous_closure_id` opcional para novo fechamento após reabertura. Datas não nulas, início <= fim, limite de intervalo igual ao diagnóstico; não aceitar fim futuro. IDs externos devem ser validados no mesmo tenant e usar FKs compostas onde suportadas.

`finance_account_period_reopenings`: `id`, `tenant_id`, `closure_id`, `actor_id`, `actor_name`, `reason`, `request_id`, `created_at`, `expected_snapshot_revision`. Uma reabertura por fechamento. As duas tabelas são append-only; `closed` significa ausência de reabertura, sem atualizar a linha original. Refechar gera outro fechamento com novo snapshot, nunca substitui o anterior.

Não permitir dois intervalos ativos sobrepostos para a mesma conta. Verificar sob a trava financeira, com proteção de banco também para INSERT direto autorizado. Se futuramente houver materialização de estado para uma exclusion constraint, ela será projeção interna, não substituto da trilha imutável.

Proibir reabertura de ancestral cujo saldo final foi usado como abertura de fechamento ativo posterior. Primeiro reabrir os dependentes, em ordem decrescente de período; não realizar cascata silenciosa. Uma abertura de conta também não pode ser revertida enquanto sustentar fechamento ativo, inclusive indiretamente por cadeia de saldos.

### Conteúdo mínimo do snapshot

- Identidade da conta, moeda BRL, timezone, intervalo, momento de captura, versões das regras e do schema do snapshot.
- Origem do saldo inicial: ID da abertura validada ou ID do fechamento predecessor; âncoras de extrato correspondentes e saldo final.
- Resultado completo dos diagnósticos de conta/período, evidência e abertura; totais brutos/líquidos e quantidades por direção. Centavos serializados como strings, sem ponto flutuante.
- IDs de movimentos, entradas bancárias ativas, imports/linhas relevantes, verificações efetivamente usadas, decisões/reversões de identidade, grupos/reversões de conciliação e evidência da conta. Guardar dados normalizados e hashes necessários para reproduzir a conclusão, não só contagens ou MD5 do total.
- Cobertura aprovada e respectivos arquivos originais: IDs, hash, caminho, versão do parser, limites/fuso e âncoras. Evidência do dia anterior pertence às dependências mesmo fora do intervalo monetário.
- Adoção do legado: ID/versão da revisão do corte, fontes inventariadas, mapeamentos, pendências classificadas e aprovação.
- Posição de transferências no corte com IDs e valores; pendências de composição, créditos sem origem, títulos abertos, adiantamentos, intervenções manuais e índice de comprovantes. Marcar quais são informativas e quais bloqueiam fechamento bancário.
- Autor/revisor, motivo, IDs de eventos/comandos e política de autorização aplicada. Revisão manual permanece identificável permanentemente.

Materializar também dependências relacionais (`finance_account_period_dependencies`, nome proposto): closure, tenant, tipo de fonte, ID, conta e intervalo quando aplicável. Serve para localizar impacto e reabertura; snapshot é a prova histórica. Evitar procurar toda dependência exclusivamente em JSON. Exigir que o comando grave ambos atomicamente.

`snapshot_revision` deve ser calculada no servidor sobre representação determinística da evidência relevante. Mudança de fonte após preview exige novo preview. Hash de revisão detecta mudança, não atesta autenticidade bancária.

## 3. Comandos e autorização

Propor `preview_finance_account_period_close`, `close_finance_account_period` e `reopen_finance_account_period`, wrappers invoker para implementações privadas definer com search_path vazio. Payload estrito versionado, tenant, request UUID, IDs/datas, revisão esperada e motivo de 10 a 2000 caracteres. Reutilizar `finance_commands` para replay pelo mesmo ator, ação e payload; mudança gera conflito. Eventos de fechamento/reabertura guardam resultado e autoria.

Motoristas continuam sem acesso. A política interna de quem fecha/reabre e se exige segunda pessoa permanece decisão aberta do plano; não inferir que todo `can_access` pode fechar. Implementação deve receber capacidade explícita e não liberar o comando até essa política estar definida. Não obrigar segunda pessoa como fato já acordado.

No fechamento: validar autorização, adquirir locks, revalidar autorização, conferir replay, recalcular evidência, comparar revisão, verificar bloqueios, gravar snapshot/dependências/evento/comando atomicamente. Replay válido retorna fechamento anterior mesmo após reabertura posterior, sem criar novo fechamento; sempre exige acesso atual. Falha deixa zero linhas parciais.

## 4. Ordem de locks e guards

Trava compartilhada atual: `pg_advisory_xact_lock(hashtextextended(tenant::text || ':finance',0))`. Fechamento, reabertura e todo escritor afetado disputam essa mesma trava antes da decisão sobre intervalo fechado. Locks de contas em ordem de ID; dependências e fechamentos em ordem estável. Revalidar permissão após qualquer espera relevante.

Recebíveis já possuem caminhos `fiscal → finance → grafo do recebível`, por exemplo `correct_receipt_allocation` em `20260910025658`. Não introduzir `finance → fiscal`. O fechamento deve capturar a projeção disponível sob finance sem chamar processador fiscal nem recompute de folha. Se precisar fiscal, adquirir fiscal primeiro em todos os caminhos envolvidos, com revisão específica. Não segurar locks de storage enquanto se espera finance.

Além do preflight nas RPCs, implementar guard em INSERT das tabelas base. UPDATE/DELETE já imutáveis permanecem proibidos. Guard deve resolver tenant/conta/data no servidor, não confiar em parâmetros do cliente. Writers definer e service-role não ficam dispensados. Escritores de cadastro legados podem adquirir row lock antes de trigger: preferir boundary de comando com lock antecipado; no guard residual usar falha de concorrência/retry explícita, sem introduzir espera com ordem invertida. Provar isso em PG real.

| Fonte atual | Guard e conjunto afetado |
|---|---|
| `record_movement`, foundation `20260909212104:77/126` | INSERT `finance_movements`: conta + `occurred_on`. Cobre também projeções e transferências indiretas. |
| `project_receivable_command`, `20260910024438:17/54` | Novo movimento de recebimento/devolução passa pelo guard comum; rollback inclui projeção bank_transactions e comando. Alocação a movimento já existente não muda dinheiro. |
| `record_internal_transfer`, `20260910033918:14/51` | Checar ambos os movimentos, cada conta/data. Guard adicional no vínculo preserva a posição histórica quando ambas as pernas forem anteriores ao corte. |
| `record_transfer_stage`, `20260910034731:14/58` | Checar data da nova perna; chegada posterior tem exceção semântica descrita abaixo, não bypass monetário. |
| `intake_statement`, `20260909222851:63/96/134/139` | INSERT imports, rows, bank_entries. Considerar período declarado, datas reais e âncoras; mesmo arquivo sem nova entrada pode alterar conflito/cobertura. Na primeira implementação, rejeitar intake com qualquer impacto fechado e manter arquivo em estágio não operacional até reabertura. Replay exato continua permitido. |
| `review_statement_identity` / `reverse_identity_review`, `20260909231643:38/159` | INSERT reviews/reversals: linha original, entrada selecionada/criada e dependências de imports. Reversão muda `bank_entry_active` sem editar entrada. |
| `record_statement_verification`, `20260909223737:38/66` | INSERT verifications: todos os fechamentos dependentes do import, inclusive saldo em início-1. Worker deve registrar bloqueio recuperável fora da publicação efetiva, sem substituir a última evidência válida. |
| `reconcile_bank_group` / `reverse_bank_reconciliation`, `20260910013543:61/116` | INSERT groups/reversals: todas as datas/contas dos IDs envolvidos. Reabertura necessária para mudar conciliação congelada. |
| `process_automatic_reconciliation`, `20260910022059:65/105` | Mesmo guard groups. Job identifica período fechado e fica em revisão com motivo, não em loop de retries nem complete enganoso. |
| `bank_accounts` | Proteger exclusão e alteração de banco/agência/número/tipo. INSERT/UPDATE de OUTRA conta duplicada também afeta unicidade: `native_statement_account`, `20260910021404:29`, conta iguais no tenant inteiro. Renomear rótulo pode permanecer permitido, mantendo nome histórico no snapshot. |
| `finance_account_openings` / reversals, `20260910140010` | Reversão/troca de abertura bloqueada quando há fechamento dependente; não basta olhar data de criação da reversão. |
| Originais/comprovantes `storage.objects` | Preservar guards de retenção `20260909222851:15` e `20260909220941:21`; mapear objetos usados no snapshot. Não tornar editável arquivo por estar em período reaberto. |

Correções de alocação de recebíveis (`20260910025658`), vínculos/reversões de pagável/acerto e novas composições de despesas que preservam movimento podem continuar após fechamento bancário, com eventos e indicação de composição posterior. Não reescrever o snapshot. Cancelamento fiscal posterior altera título/crédito, não inventa saída: devolução real é movimento em sua data e obedece guard monetário. Guard de fechamento não deve impedir o processamento fiscal apenas porque o recebimento original é antigo.

## 5. Transferência atravessando o corte

Saída de R$ 500 em 31/01 e entrada em 01/02: janeiro da origem pode fechar com saída conciliada e R$ 500 em trânsito identificado. Não exigir chegada antes de fechar janeiro nem lançar entrada fictícia em janeiro. Chegada de fevereiro pode ser registrada/vinculada à saída fechada se preservar conta/valor/data/identidade da saída e não modificar a evidência bancária de janeiro.

O snapshot de janeiro mantém o que era conhecido na revisão (`awaiting_arrival`). A consulta atual pode mostrar `arrived_after_cutoff`, com ligação posterior auditada; não substituir o status no snapshot. O guard do vínculo precisa inspecionar as pernas e essa regra, em vez de bloquear qualquer referência a movimento antigo. Se a chegada for datada em janeiro fechado, reabrir janeiro da conta de destino antes do INSERT. Correção de pareamento entre duas pernas já dentro de intervalos fechados exige revisar/reabrir os fechamentos afetados. Não permitir transferência sem vínculo explicado receber aparência de trânsito certificado.

## 6. Cobertura, abertura e adoção do legado

O parser nativo hoje qualifica dias inteiros com timestamps explícitos, identidade exata e sem IDs repetidos no arquivo. Aritmética igual e hash correto demonstram consistência do arquivo lido, não sua autenticidade nem ausência de outro extrato. Não promover `requires_review` ou `not_attested` por clique genérico de confirmação.

Criar decisão explícita de cobertura ligada à revisão atual: conta, dias cobertos, âncoras, origem do arquivo, conferente e método. Sem âncoras/cobertura comprováveis, continuar indisponível e solicitar evidência complementar; formato CSV sem informações suficientes não herda certificação OFX. Definir em homologação que evidência de origem satisfaz o cliente; o schema atual não possui atestação de autenticidade. Não prometer certeza absoluta por combinação de heurísticas.

Abertura `140010` é um marco escritural, não receita. Para o primeiro fechamento, exigir abertura ativa e evidência válida, saldo inicial compatível e explicação do trecho entre `effective_from` e início. Para períodos posteriores, preferir fechamento contíguo como predecessor; lacuna de dias exige validação/fechamento do trecho, não simples soma de movimentos não confirmados. Não misturar caixa físico: conta cash necessita contagem própria, ainda fora deste fechamento bancário.

Adoção legada requer inventário por conta/corte de `bank_transactions`, recebimentos, pagamentos de pagáveis/acertos, adiantamentos/créditos e títulos abertos. Mapear por IDs quais fatos já possuem movimento canônico e quais precisam representação histórica explícita. Não deduplicar por valor/data, nem converter status legado matched/paid em prova de extrato. Definir fontes excluídas e motivo; totais contados duas vezes devem falhar a revisão. A retirada do bulk `sync_financial_obligations` em `20260910135125` impede nova projeção enganosa, mas não migra dinheiro histórico nem resolve corte.

Persistir revisão de adoção com saldos/IDs e evidências, sem inventar autoria histórica. Pagamento de título antigo não gera faturamento novo. Pendência histórica sem evidência suficiente fica rotulada; enquanto impactar completude monetária do período, bloqueia fechamento. As capacidades de adoção/revisão aqui propostas ainda não estão implementadas.

## 7. Predicado de elegibilidade

`can_close` somente poderá ser verdadeiro quando houver implementação e política de fechamento, e todas estas condições forem satisfeitas sob lock:

1. Conta bancária válida, identidade única e acesso de fechamento autorizado.
2. Intervalo completo, sem sobreposição fechada e sem fim futuro; abertura/predecessor válido e dependências íntegras.
3. Cobertura aprovada da revisão corrente; âncoras únicas e fusos compatíveis; origem da evidência atende à política homologada.
4. Saldo inicial + créditos - débitos = saldo final. Diferenças de entradas, saídas e líquido entre banco e razão são zero.
5. `unmatched_bank_count`, `unmatched_movement_count`, `evidence_review_count`, `unresolved_row_count` e `unverified_entry_count` iguais a zero. `cross_period_count=0` até existir regra explícita de reconciliação entre períodos; não confundir grupo cruzado com transferência de duas pernas independentes.
6. Quantidades e identidades explicadas por grupos válidos: grupos N:M podem ter contagens distintas entre banco e razão; não exigir igualdade cega da contagem global. Exigir cobertura única de cada ID e valor/sentido coerentes por grupo.
7. Nenhum import/verificação relevante pendente ou falha que deixe conjunto monetário incompleto; worker concorrente não consegue publicar evidência depois da decisão sem passar pelo guard.
8. Adoção do legado concluída no escopo, sem dupla contagem; transferências e créditos sem origem tratados conforme impacto bancário.
9. Snapshot, dependências, evento e comando persistidos atomicamente. Pendências apenas de composição são listadas e impedem o rótulo integralmente conferido, não necessariamente o fechamento bancário.

Enquanto faltarem schema de fechamento/reabertura, guards, política de autorização/cobertura e adoção do legado, os `can_close=false` atuais devem permanecer. Esta especificação não remove esses bloqueios.

## 8. Matriz de cenários e aceitação

| Cenário | Resultado exigido |
|---|---|
| OFX íntegro, cobertura/âncoras válidas, razão totalmente conciliado, abertura/legado aprovados | Um fechamento e pacote reproduzível; nenhum movimento novo. |
| Líquido igual, entradas/saídas diferentes ou IDs sem vínculo | Bloquear; apontar divergência concreta. |
| Grupo N:M legítimo com contagens diferentes | Aceitar se todos IDs únicos cobertos e valores/sentido válidos; não falhar só por contagem global. |
| Mesmo request simultâneo | Um fechamento; replay idêntico. Mesmo request/payload diferente ou outro ator: conflito. |
| Writer de movimento segura lock, fechamento aguarda | Provar espera com `pg_blocking_pids`; fechamento reavalia e rejeita revisão antiga. |
| Fechamento segura lock, writer retroativo aguarda | Após commit, writer falha sem dinheiro/command/event parcial. |
| Permissão revogada enquanto aguarda | Negar após espera; zero fechamento/mutação. |
| INSERT direto via definer/worker em tabela protegida | Mesma proteção do comando, sem bypass service-role. |
| Novo import sobreposto sem novas entradas, mas novo conflito/âncora | Reabertura ou estágio não operacional; não alterar evidência do fechamento silenciosamente. |
| Nova verificação/reversão de identidade de import usado em dois períodos | Identificar os dois dependentes; bloquear publicação até resolução/reabertura. |
| Nova conta duplica identidade da conta fechada | Impedir invalidação silenciosa de matched_exact, inclusive corrida de cadastro. |
| Alteração só do nome da conta | Pode atualizar apresentação atual; snapshot retém nome e identidade originais. |
| Conciliar/reverter grupo fechado manualmente ou por worker | Bloquear até reabertura; autor manual nunca desaparece. |
| Reabrir e corrigir, depois refechar | Histórico original preservado; novo snapshot vinculado ao anterior, com comparação disponível. |
| Reabrir predecessor/abertura usados por período posterior | Bloquear com IDs dependentes; exigir reabertura ordenada, sem cascata escondida. |
| Saída janeiro fechada, chegada fevereiro | Aceitar chegada real em fevereiro aberto; preservar snapshot de janeiro e vínculo auditado. |
| Chegada retroativa em destino já fechado | Bloquear INSERT; não mudar data para contornar. |
| Despesa/composição chega depois, banco já fechado | Registrar composição sem duplicar caixa e manter rótulo de atualização posterior. |
| Devolução real posterior ou cancelamento fiscal sem devolução | Primeiro cria saída na data real aberta; segundo só altera obrigação/crédito, sem dinheiro fictício. |
| Abertura válida mas legado não adotado | Permanecer can_close=false. |
| CSV sem âncora/conta/cobertura suficiente; OFX com fuso conflitante | Verificação incompleta, sem aceite automático por saldo igual. |
| Falha ao gravar evento/dependências após snapshot | Rollback integral. |
| Atualização/exclusão de original após fechamento ou reabertura | Retenção continua obrigatória. |
| Conta cash ou fim futuro | Recusar no contrato bancário atual. |

Testes de concorrência devem usar PostgreSQL real descartável e verificar espera observável, além de rollback/replay. Testes SQL de contrato cobrem fontes indiretas reais, inclusive projeção de recebíveis e workers. Homologação com extratos anonimizados dos bancos do cliente e validação do corte seguem necessárias; passar testes locais não certifica autenticidade dos extratos nem implantação.
