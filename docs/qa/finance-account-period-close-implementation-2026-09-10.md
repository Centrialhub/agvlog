# Fechamento verificável — desenho mínimo de implementação, 2026-09-10

Proposta de implementação local, sem SQL aplicado ou PG iniciado nesta leitura. Complementa `docs/financeiro-fechamento-especificacao.md` com o estado posterior às aprovações de cobertura e associações legadas. Não declara fechamento disponível.

## O que já existe e pode ser usado

- 140010: abertura bancária ativa, origem nativa, histórico/reversão e book; 141240 adicionou abertura de caixa, que não habilita fechamento bancário de cash.
- **142143 resolveu a decisão explícita de cobertura**: `finance_statement_coverage_approvals/reversals`, declaração de originais obtidos do banco e período completo, snapshot/revision. `statement_coverage_review` só retorna approved/current quando revisão ainda bate. Não recriar essa tabela, nem usar apenas period_evidence_reviews. Authenticity continua not_attested; é aprovação humana identificada, não certificação técnica do banco.
- 42740 inventaria pendências monetárias por conta/período; 151011 detecta fontes sem data/órfãs no tenant. Ambos permanecem diagnósticos. Uma página vazia não prova completude.
- 43833 e 45616 associam pagamentos/recebimentos legados por IDs a dinheiro existente; links/reversals e autoria são duráveis. Não há decisão persistida de completude do corte.
- 55442 e 60950 associam representações de custos. Isso é composição, não adoção de dinheiro. Falta de associação de custo não deve sozinha impedir fechamento **bancário**.

## Fatia inicial proposta

Fechar **conta checking/savings em BRL, período já terminado**. Primeiro período começa exatamente em `finance_account_openings.effective_from`; posteriores começam no dia seguinte ao último fechamento ativo da conta. MVP não aceita lacuna de dias nem fechamento que comece depois da abertura sem predecessor. Cash fica fora até existir contrato próprio de contagem do encerramento. Limite recomendado para o comando: 366 dias inclusivos; diagnóstico atual admite até diferença 3660 dias, mas não é necessário congelar uma década por comando.

A primeira implementação positiva deve demonstrar uma conta nova com abertura/cobertura válida e manifesto de legado integral vazio **conferido sobre todas as tabelas**, além de uma conta com recebimento/pagamento legado associado por ID. Não usar flag de ambiente ou botão de administrador para ignorar fonte ainda não implementada.

## Capacidade e comandos

`finance_private.can_close_account_period(tenant)` = `can_access(tenant)` E membership ativa owner/admin no mesmo tenant. Isso herda exclusão de motorista/perfil misto e precisa compor com o contexto ativo de tenant implantado pelas outras frentes. Operador pode ler preview/histórico, mas não fechar/reabrir. Sem obrigar segundo aprovador não acordado.

Wrappers invoker, private definer com search_path vazio:

- `preview_finance_account_period_close(tenant,account,from,to)`: leitura financeira, retorna `revision`, `eligible`, `can_execute` separado de elegibilidade, `blockers[{code,source_table,source_ids,scope}]`, totais em centavos string, cobertura/abertura/predecessor, versão do manifesto. Não usa o can_close=false hardcoded dos diagnósticos como predicado; recompõe as invariantes concretas.
- `close_finance_account_period({version,tenant_id,request_id,account_id,from,to,revision,reason})`: owner/admin, trava finance, locks contas em ordem, reauth, replay, recalcula e compara revisão, valida elegibilidade, grava fechamento/dependências/evento/comando na mesma transação. Não chama worker fiscal, builder ou recompute de folha.
- `reopen_finance_account_period({version,tenant_id,request_id,closure_id,revision,reason})`: mesma capacidade, replay e locks. Rejeita se houver fechamento ativo descendente; sem cascata. Insere reabertura, não atualiza snapshot. Refechar usa request novo e ligação ao fechamento anterior.

Replay exige acesso atual, mesmo ator/ação/payload; retorna o resultado histórico inclusive se o período já foi reaberto depois. Edição do payload com request repetido conflita.

## Tabelas novas mínimas

1. `finance_account_period_closures`: identidade conta/intervalo, abertura/predecessor, previous_closure_id, snapshot determinístico versionado, snapshot_revision, autor/nome/motivo/request. Append-only, unique tenant/id e request. Snapshot guarda identidades e valores, não somente somas.
2. `finance_account_period_reopenings`: closure_id único por tenant, revisão esperada e autoria/motivo/request. Append-only. Ativo = fechamento sem reabertura.
3. `finance_account_period_dependencies`: closure_id, source_kind, source_id, source_revision/hash, account_id, affected_from/to, dependency_role (`money`, `bank_evidence`, `opening`, `predecessor`, `legacy_review`, `composition_snapshot`). PK composta impede duplicar dependência. Somente comando interno grava; nunca tabela genérica que aceite source_table arbitrária sem resolver tenant.
4. `finance_legacy_cut_reviews/reversals`: conta, início/corte, primeira abertura, classifier_version, raw_source_revision, manifesto e decisões verificadas, autor/motivo. Não é aprovação genérica de inventário: comando só aceita quando cada origem foi mapeada por ID, provada projeção de outra origem ou classificada fora do escopo por evidência determinística. Origem ambígua não recebe botão “ignorar”.

Guard no INSERT de closures e reopening valida contexto interno do comando e ausência de sobreposição sob finance, inclusive para writer definer. FKs compostas onde existam unique tenant/id; não usar FK só ID como prova de tenant. A regra de sobreposição pode ficar em trigger serializado; tabela histórica com reversões não cabe diretamente numa exclusion constraint sem projeção interna adicional.

## Manifesto de legado: trabalho que falta por fonte

O classificador usa conjuntos completos, não RPC paginada. Produz lista ordenada dos IDs, conteúdo monetário relevante e classificação, com hash e versão. Precisa incluir **zero contagens por cada fonte conhecida**, para provar que a tabela foi examinada. Não buscar verdade em `matched`/`paid` sozinho. Revisão inclui fontes indeterminadas sem conta/data no tenant; sua soma não é distribuída entre contas.

| Tabela/origem | Reuso e lacuna para fechamento |
|---|---|
| bank_transactions | Relacionar por IDs dos payments/refunds/projeções/adoptions. Linha restante não pode desaparecer por alias inválido. Falta comando de classificação/adoção para linha bancária antiga sem origem. |
| receivables_payments | Reusar receive links e legacy receipt links ativos, custo/capacidade/data/conta. Reversão financeira e correção de alocação têm efeitos distintos; não ressuscitar dinheiro ao desfazer link. |
| receivable_payment_reversals | Exigir mapeamento do refund real ou crédito/correção explicitamente sem dinheiro; não presumir toda reversal como saída. |
| payables_payments | Reusar origem canonical/legacy_adoption de payable links e suas reversões. Histórico do pagamento continua, active projection decide alocação; não contar reversão de vínculo como pagamento novo. |
| driver_settlement_payments | Usar links/reversals e comando de pagamento33421. Conta ausente exige vínculo comprovado; status do acerto não resolve conta. |
| closing_report_payments, load_payments | Aliases exigem mesmo tenant/ID do recebimento, conta/data/valor compatíveis. ID apenas existente não permite excluir divergência. Corrigir alias inválido exige comando específico. |
| employee_advances | Conferir título/pagamentos e vínculo ao razão por IDs. Status paid sem cadeia íntegra continua indeterminado; ainda falta caminho de resolução integral. |
| payroll_entry_items nature already_paid | ID exato deve alcançar origem monetária já classificada; itens órfãos ou incompatíveis continuam bloqueadores sem duplicar remuneração. |
| finance_internal_transfers, finance_transfer_departures | Snapshot de posição no corte usando movimentos e vínculo, mantendo saída identificada em trânsito. Sem exigir chegada antes do fechamento. |
| financial_obligations, payables/receivables abertos, custos/OS/folha | Não somar ao caixa. Só bloqueiam adoção quando constituem evidência monetária conflitante; pendência de obrigação/composição é informativa no fechamento bancário. |

A aprovação de corte cobre o que foi apurado até o corte sob esse classificador. Para novo fechamento, reavaliar prefixo/cadeia desde abertura (ou predecessor) e novas fontes retroativas. Se existir fonte sem conta/data que não possa ser delimitada, bloqueia todas as contas potencialmente afetadas até resolução; isso não autoriza somar desconhecidos em cada conta.

## Guardas necessários antes de habilitar qualquer fechamento

| Tabelas reais | Guard mínimo a implementar |
|---|---|
| finance_movements | INSERT identifica conta/data: impedir dia fechado. Também captura criação indireta por baixa/devolução/transferência. |
| finance_bank_entries; finance_statement_imports/rows | Bloquear publicação com impacto em intervalo fechado, inclusive import sem entrada nova, arquivo sobreposto e âncora from-1. Upload pode ficar em staging externo à evidência ativa. |
| finance_statement_verifications; finance_statement_identity_reviews; finance_statement_review_reversals | Resolver imports/linhas/entradas e dependencies de todos os fechamentos. Nova versão/reversal usada exige reabertura; não trocar evidência congelada silenciosamente. |
| finance_reconciliation_groups/reversals | Checar todas contas/datas e dependências, mesmo se ID de reversão foi criado hoje. Trabalhador automático usa o mesmo guard e fica em revisão recuperável. |
| finance_statement_coverage_approvals/reversals; finance_account_openings/reversals | Impedir reversão de aprovação/abertura usada por fechamento ativo ou descendente. Guard não pode considerar só a data da reversão. |
| bank_accounts | Proteger campos de identidade e exclusão. INSERT/UPDATE de outra conta pode criar identidade duplicada e invalidar matched_exact de conta fechada; conferir tenant inteiro. Rótulo pode mudar, preservando histórico. |
| bank_transactions e fontes monetárias legadas listadas acima | Guard de INSERT/UPDATE/DELETE identifica OLD+NEW conta/data e dependências. Fonte sem data/conta impede alteração silenciosa se houver fechamento potencialmente afetado. Writers corrigidos adquirem finance antes de row locks; trigger residual usa try-lock/retry. |
| finance_internal_transfers/departures | Vínculo de chegada posterior pode completar trânsito sem alterar a perna fechada. Pareamento/correção envolvendo duas pernas já fechadas exige reabertura. Guard de movimentos continua obrigatório. |
| storage.objects | Preservar retenção atual e IDs de originais usados; reabertura não libera apagar comprovantes. Não esperar finance segurando lock storage. |

Composição posterior (novos itens de gasto, link de custo, ajuste de alocação sem novo dinheiro) não reescreve snapshot fechado. Registra evento e aparece como atualização posterior. Se uma revisão altera identidade/valor/data/conta do dinheiro ou evidência bancária congelada, é reabertura; se altera apenas prestação de contas, não. Dependências distinguem esses papéis para não congelar folha inteira por fechamento do banco.

## Predicado único que libera eligible=true

Conta/fuso/identidade válidos; intervalo terminado e contíguo; abertura válida/predecessor ativo; cobertura **approved/current**; revisões de corte atuais e sem fontes indeterminadas; saldo inicial+entradas-saídas=saldo final em centavos; diferenças brutas banco/razão zeradas; cada ID coberto exatamente uma vez por grupo válido N:M; zero entradas/movimentos sem conciliação, linhas não resolvidas, evidências não verificadas e grupos cruzando corte no MVP; zero publicação relevante pendente; guardas completos instalados e snapshot/dependências consistentes. Autenticidade permanece declaração humana registrada. Não exigir mesma quantidade global de entradas banco/razão.

Todos os snapshots excluem relógio corrente de sua revisão determinística; capture timestamp só no fechamento. Regras e identidade das fontes precisam entrar no hash, para mudança de evidência invalidar preview mesmo que o saldo continue igual.

## Ordem implementável agora

**A. Começar imediatamente:** schema append-only de fechamento/reabertura/dependências; capability; produtor de snapshot completo e blockers; guard monetário/evidência e matriz de writers. Sem registro de closure enquanto o produtor acusa classifier_missing ou guards_incomplete. Isso deixa comandos e erro concretos revisáveis, não uma liberação falsa.

**B. Próxima dependência obrigatória:** classificador completo de corte e revisão durável com caso positivo vazio/totalmente mapeado. As fontes não implementadas com linhas presentes bloqueiam; não bloquear eternamente uma conta nova só porque existe uma feature histórica ainda não usada.

**C. Habilitar caminho positivo na mesma versão que completa B e guardas:** testes reais fecham conta sintética nova e conta com legado mapeado; triggers impedem insert retroativo, nova evidência, abertura reversal e reabertura de predecessor com descendente. Replay e revogação pós-espera precisam concorrência PG17 observável. Falha de gravação em evento/dependency faz rollback integral.

**D. Homologação/upgrade:** só depois ensaio de schema completo e mapa remoto/local. Preflight local continua sem bootstrap/extensões Supabase; nada desta proposta substitui esse gate. Não há consulta remota ou servidor iniciado nesta leitura.
