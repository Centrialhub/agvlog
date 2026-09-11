# Fluxo de descargas por fornecedor — implementação local

Migration `20260910203516_finance_period_unloading_flow.sql`; contrato TypeScript `src/lib/financial/periodUnloadingFlowContract.ts`. Implementa a proposta de fluxo econômico, sem reader de posição as_of ou novos escritores.

## Produto e contrato

`get_finance_period_unloading_flow(_tenant_id,_from,_to,_account_ids,_supplier_id default null,_page default1,_expected_revision defaultnull)` retorna páginas50, totais completos por natureza e fornecedor, opções de fornecedor dos snapshots originais, revisão do conjunto e money_package_revision193723.

Cobranças usam occurred_on imutável da descarga e escopo empresa/fornecedor, independentemente da conta. Recebimentos usam received_at em São Paulo; devoluções usam seu próprio effective_at e conta da saída, nunca fallback para data/conta do pagamento original. Esses dois fluxos respeitam contas selecionadas. Datas desconhecidas permanecem linhas diagnósticas, sem sumir pelo corte. Fornecedor preservado é supplier_id do charge/source_snapshot e comando original, não nome atual do cadastro ou NFs atuais.

origin_totals, receipt_totals e refund_totals são separados: valid/count/amount_cents string ou null. Não são somados como saldo aberto nem receita de frete. Original_due_date é prazo originalmente declarado no comando, sem afirmar vigência atual. A evidência é a disponível agora; registro tardio com data econômica anterior muda revisão, sem reconstruir visibilidade histórica de commit.

## Prova e não duplicação

- Registro original exige pedido record_unloading inequívoco, charge/receivable/supplier/amount compatíveis. Índice parcial por tenant/result.charge_id evita varredura de comandos por evento.
- Recebimento exige comando receive próprio e snapshot anterior do título com devedor/valor compatíveis com a descarga. Mudar devedor antes do primeiro pagamento não atribui recebimento ao fornecedor antigo por mera FK.
- Link usa action e command_id corretos: receber e devolver o mesmo payment_id não multiplicam linhas. Devolução também exige comando reverse, reversal_id, payment_id e declaração money_returned.
- Movimento/transaction precisam conta, direção, natureza permitida, data econômica e valor compatíveis; movimento invalidado não certifica origem.
- Capacidade considera todas as alocações canônicas ativas e associações legadas ativas do movimento, inclusive frete e outros fornecedores. Corrigir alocação libera capacidade; devolver dinheiro não libera a entrada original. Valores inválidos/claims duplicados ou excedentes geram diagnóstico.
- Correção, crédito ou associação legada mantêm sidecars com IDs/ator/registro e exigem revisão da classificação do evento. Não são devoluções bancárias nem recebem data econômica presumida.
- money_links agrupa movement_id uma vez. Pix300 com descarga100+frete200 mostra alocação100 e dinheiro300 ligado, sem somar400. Reuso após correção não vira duas entradas de caixa; valor atribuído indeterminado fica null.

Evento registrado válido não significa extrato confirmado. money_covered exige cobertura válida do helper193723 e fatos congelados compatíveis em todos os campos monetários relevantes, com closure_id ativo. Reabertura tira cobertura e muda revisão, preservando o recebimento registrado. Diagnóstico de composição não altera o bruto do pacote nem cria bloqueio novo de fechamento.

## Volume, revisão e segurança

Datas conhecidas são pré-filtradas antes da classificação cara, mas cobranças antigas com recebimento atual continuam incluídas. Fingerprints incluem provas por hash compacto e claims globais; não armazenam todo o JSON bruto de origem/comando para cada linha da página. Acumulação usa array de JSON para evitar concatenação quadrática de JSON. Hash não depende só da página, maxID ou estado atual do título. Mudança de alocação de frete compartilhado invalida a revisão da descarga, mesmo fora do filtro de fornecedor.

Página>1 exige revisão; mudança retorna40001 finance_history_changed. Auth can_access em cada consulta, IDs de contas validados pelo pacote, motorista misto bloqueado. Helpers internos não têm grant público, exceto dispatcher autenticado; nenhuma tabela ou writer foi liberado.

Schema valida centavos sem Number, datas de calendário, identidades por natureza, unicidade/partição do escopo, contagens/somas por grupo, ponte única e capacidade. safeParse de dado malformado retorna failure sem lançar BigInt em null/texto inválido.

## Validação

Execução ampla: **12 testes passaram** (11 próprios +1 integração bancária do root). Depois dos ajustes finais, **2 regressões novas** de schema malformado e quantidade excessiva no snapshot também passaram; run focado confirmou novamente janeiro/devolução e banco. ESLint passou nos arquivos próprios. Não foi executado TSC nesta subtarefa.

Casos reais: descarga150 janeiro, recebimentos60+90 fevereiro e devolução integral60 março; Pix300 dividido100 descarga/200 frete; correção sem dinheiro novo; reuso de capacidade; duas NFs/uma entrega; devedor alterado antes de receber; fornecedor homônimo/inativo/renomeado; registro tardio; contas fora do escopo; motorista misto; revisão de frete fora do filtro. Recebimento histórico com data infinita usa carga histórica explicitamente limitada para diagnóstico. Snapshot de comando com101 dígitos é injeção de dano com guard de imutabilidade temporariamente desabilitado na fixture, não comportamento autorizado em produção.

Volume: **1.005 descargas criadas pelo comando real**, total100500 centavos e IDs exatos na primeira e última página. O teste completo, incluindo geração das origens, levou aproximadamente41s em PGlite. Uma tentativa anterior com21 recomputações completas e provas JSON grandes excedeu timeout; foi corrigida a acumulação/memória e evitado transformar o teste funcional em21 benchmarks. Isso não é medição de latência em produção.

Root criou teste independente com extrato, Pix300 compartilhado, conciliação, abertura, revisão de cobertura/corte e fechamento reais. Flow retorna descarga100, uma ponte300 coberta e closure_id; reabertura real retira somente a cobertura. A fixture financeira própria não contém fechamentos e não simula sucesso bancário. A integração do root usa recortes reais de DDL/funções; nenhuma das fixtures afirma aplicação de toda a cadeia de produção.

SHA SQL: `12b288b8809da09d3dda8e3ee2c323b32e4defcc5650af25b6cc915ba436a2ae`.
SHA factory financeira: `a5621741eb6b4a8e90769c524362f605da5a1ce027ded9aacfecd8a824bca34d`.

## Limites preservados

Não calcula saldo aberto histórico, vencido, responsabilidade de adiantamentos ou prazo renegociado. Associações legadas não são automaticamente promovidas a recuperação comprovada. O writer atual devolve um pagamento integral; o exemplo de devolver20 de um pagamento60 exige uma evolução específica de devolução parcial, não foi simulado nem implementado neste reader. O teste usa devolução60 preservando a regra real.

Nenhuma aplicação remota, novo dinheiro, nova obrigação, alteração193723 ou PostgreSQL nativo por esta subtarefa. Validação nativa será do agente responsável após confirmação do hash final.
