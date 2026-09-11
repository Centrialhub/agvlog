# Pacote financeiro do período — contrato e lacunas

2026-09-10. Leitura/design somente; nenhum SQL implementado e PostgreSQL permanece parado.

## Diagnóstico principal

O dashboard Financial.tsx agrega painéis independentes e explicita que não representa fechamento. Isso está correto, mas não constitui pacote consolidado reconciliável. O mesmo filtro visual seleciona criação de títulos, incorporação fiscal e data da fonte de custo; previsãoNF tem filtro próprio. Os saldos da carteira são atuais, não posição histórica reconstruída no fim escolhido. Não somar os cards como resultado ou balanço.

Snapshots de fechamento62958/73906 conservam prova monetária por conta e período (banco/extrato ou cash/contagem), revisão B, dependências e composição contextual. Não congelam toda carteira comercial e de custos como posição histórica gerencial. Relatório futuro deve distinguir snapshot monetário imutável de consulta gerencial atual.

## Inventário de leitores

| Bloco | Existe | Corte/limite observado | Falta para pacote |
|---|---|---|---|
| Banco | accountPeriodReview/Close/Evidence, saldo abertura, cobertura, conciliação e transferências | Conta + dias SP; snapshot fechado reproduzível | Consolidação por IDs de contas/closures, explicitar contas sem fechamento e fronteira de transferências |
| Caixa físico | cashPeriodPreview/Counts/Evidence73906/74142 | Abertura e contagem final, dinheiro real; diferença persistida | Mesmo consolidado, com evidência cash distinta de extrato |
| FreteNF não faturado | unbilledFreightSummary/Origins53731 | NF issue_date ou data registro tentativa; available soma, reserved/uncertain/authorized/review separados; expected_receipt_date=null, coverage_complete=false | Perspectiva de data esperada negociada, quando existir fonte; não inventar prazo a partir da NF |
| Recebíveis | receivablePortfolioSummary51617 | Seleção por created_at; saldo e vencido avaliados no dia atual, snapshot financeiro por título | Reader as_of com roll-forward e linhas por origem/devedor/vencimento; detalhe exato do agregado, sem depender da lista paginada da tela |
| Fiscal faturado | fiscalDashboard52711 | incorporated_at, gross/net/withheld; origens já incorporadas; pending_jobs escopo tenant_all_dates | Ponte por IDs origem→título→pagamentos e data autorização/competência para relatório; cancelamentos/rejeições pendentes visíveis |
| Descarga | charge por entrega e vínculo de recebível/unloading | Cadeia entrega→NFs mesmo fornecedor→supplier_id→receivable | Sumário por fornecedor com aberto/baixado/contestado e IDs entrega/título, corte histórico; não apenas total da carteira |
| Pagar | usePayables.tsx48 usa select('*') por tenant, ordenado por due_date; leitores por pagamento/título/acerto/folha existem | Não há agregado completo homólogo ao51617; listagem depende do limite do backend | Prioridade: portfolio payable completo, parcial/cancelled/reversões ativas, filtros de vencimento/competência e detalhe server-side |
| Adiantamentos | paid_projection_chain72624 e folha/acertos | Prova por IDs/footprints, não reader gerencial do saldo a prestar contas | Resumo quem recebeu/quanto foi gasto/devolvido/compensado/ainda pendente, preservando múltiplas contas e dias |
| Créditos/entradas sem alocação | Contextos de recebível/movimento e fontes de créditos fiscais/financeiros | Consulta operacional por origem; não identificado sumário completo de créditos disponíveis no período | Separar capacidade de entrada ainda não alocada de crédito comercial de cliente e de adiantamento. Precisam leitores próprios e ponte exata |
| Custos | recordedCostSummary52557 | Lotes+manuais+remuneração; coverage_complete=false; exclui driverexpenses/manutenção bruta/acerto/reembolso/adiantamento | Manifesto de linhas com mesmo conjunto/fingerprint do agregado; posição por competência e revisão; explicitar aquisição de estoque versus consumo atribuído |
| Comprovantes | accountPeriodEvidenceIndex | Só snapshot: movement_receipt e bank_statement, missing_movement_receipt_ids/manual_decisions | Índice de comprovantes de custos/descargas/títulos/folha e vínculo com conta/período sem supor que Pix comprova natureza do gasto |

Referências principais: src/lib/financial/{receivablePortfolioContract,recordedCostSummaryContract,unbilledFreightContract,fiscalDashboardContract,accountPeriodEvidenceIndex}.ts; src/pages/Financial.tsx; src/hooks/usePayables.tsx; migrations51617/52557/52711/53731/62958/72624/73906. `Other` é classificação informada de origem econômica, nunca saldo de diferença sem fonte.

## Envelope proposto (ainda não RPC)

`get_finance_period_package(tenant,from,to,account_ids,mode,as_of)` →

```
{version:1, tenant_id, currency:'BRL', timezone:'America/Sao_Paulo',
 period:{from,to}, mode:'current_management'|'frozen_money', as_of,
 revision, captured_at, account_scope:{ids,complete,excluded_ids},
 money:{accounts:[],consolidation:{}},
 receivables:{...section},payables:{...section},
 forecasts:{...section},advances:{...section},credits:{...section},
 costs:{...section},documents:{...section},
 limitations:[],blocking_issues:[]}
```

Cada section: `{basis,date_basis,as_of,coverage,totals_valid,totals,groups,source_manifest_revision,source_count,details_cursor,issues}`. Centavos strings; desconhecido=null. Cada linha de detalhe `{source_table,source_id,origin_ids,classification,occurred_on,competence_on,due_on,expected_on,account_ids,counterparty:{type,id},amount_cents,evidence_ids,projection_of_ids}`. Campos não aplicáveis null; tipos fixos e esquema versionado. `origin_ids` deve ter namespace de tabela+ID+tenant, não UUID isolado. Páginas compartilham revision do mesmo conjunto; mudança exige novo snapshot/consulta, não mistura páginas antigas/novas.

`frozen_money`: account rows referenciam closure_id/revision e retornam a prova congelada. Gerencial não congelado deve aparecer explicitamente separado com seu captured_at atual; não fingir pacote integral histórico. `current_management`: todas seções obtidas em snapshot transacional do servidor; captured_at não deve tornar hash de conteúdo instável. Se não existir reconstrução histórica de uma fonte, responder historical_basis_unavailable em vez de usar valor atual sob rótulo passado.

## Cortes e equações

- Dinheiro: occurred_on SP, [from,to] inclusivo. Saldo final=abertura+entradas−saídas. Banco fechado deve igualar extrato; cash fechado deve igualar contagem. Conta sem prova continua pendente, mesmo se total de outras contas fechar.
- Carteira a receber/pagar: posição as_of requer eventos até o fim daquele dia, mais saldo inicial anterior ao período. Criados/emissões no período são fluxo de carteira, não posição total. Vencido é due_on<as_of, não clock atual quando relatório histórico.
- Resultado por competência: receitas reconhecidas e custos reconhecidos precisam política/fonte próprias. Hoje fiscal incorporado e custos recorded não sustentam DRE contábil completa. Nomear “receitas fiscais incorporadas” e “custos registrados” até existir competência validada.
- PrevisãoNF: valor estimado com estado comercial/fiscal. Sem expected_on, agrupar como “sem data prevista”, nunca distribuir automaticamente em calendário de recebimentos.
- Dinheiro consolidado exige mesma moeda/corte e cobertura explícita de contas. Transferências entre contas incluídas cancelam apenas quando duas pernas por ID estão no corte; saída ainda em trânsito permanece destacada, não recebida ficticiamente. Transferência para conta fora do escopo é fluxo de fronteira, não receita/custo operacional.

## Não somar / não duplicar

| Componentes | Regra |
|---|---|
| Movimento + extrato | Duas representações do mesmo dinheiro; conciliar, não somar |
| CTe/NFSe + título a receber | Fiscal identifica origem do título; não dois créditos |
| NF prevista + NF autorizada/reservada | Exclusão por origem/claims; não dupla expectativa |
| Descarga custo + descarga reembolso | Despesa e direito a receber distintos, fornecedor específico; não receita de frete, não diminuir custo silenciosamente |
| Título + pagamento + entrada alocada | Obrigação, sua baixa e dinheiro; três dimensões |
| Entrada sem alocação + crédito cliente | Podem compartilhar dinheiro, mas crédito pode ter outra causa; exigem IDs e categoria, não equivalência por valor |
| Adiantamento + gastos de viagem + already_paid | Saída, prestação de contas e projeção folha; somente movimento conta caixa e somente custo canônico conta categoria |
| Remuneração + acerto + título folha | Mesma origem remuneratória pode aparecer nas três estruturas; fonte canônica/dedup atuais prevalecem |
| Compra estoque + consumo atribuído + peçaOS | Aquisição financiada uma vez; consumo distribui custo existente. Não somar consumo novamente ao total recorded sem política explícita de estoque/competência |
| Pagamento parcialmente alocado + capacidade remanescente | Partes do mesmo movimento; totais devem conservar centavos por ID |

## Próximos leitores prioritários

1. `get_finance_payable_portfolio` e detalhe consistente: resolve lacuna visível de contas a pagar antes de consolidar. Não derivar total de usePayables limitado.
2. `get_finance_period_money_package`: contas/closures/evidência/cobertura/transferências no mesmo corte, exibindo quais contas faltam; sem tratar caixa físico como banco.
3. `get_finance_receivable_position_as_of` e breakdown de descarga por fornecedor com ponte exata; roll-forward começa na carteira anterior ao período. Reutilizar snapshot financeiro sem fingir histórico inexistente.
4. `get_finance_unallocated_money_and_credit_position`: duas seções independentes (capacidade monetária e créditos comerciais), com links entre elas apenas onde existem IDs.
5. `get_finance_advance_accountability` e `get_finance_period_document_index`: pendências por pessoa/viagem e comprovantes do gasto versus pagamento.
6. Manifestos de custos/fiscal do mesmo conjunto dos agregados; em seguida pacote/exportação durável. Nenhum total deve depender de varrer páginas limitadas no navegador.

A seleção acima não impõe novo gate de fechamento monetário por toda despesa sem categoria. Pendências de composição/comprovante permanecem informativas quando dinheiro e cadeia exigida já estão provados; bloqueios atuais de integridade/B não podem ser removidos pelo relatório. Motoristas/mistos seguem sem acesso; operadores leem; decisões manuais preservam autor/motivo/reversão.

## Validação desta tarefa

Somente inspeção de código e contratos, sem execuçãoSQL/PG. Os nomes novos e equações de posição são propostas, não leitores disponíveis. O pacote não deve ser chamado de balanço patrimonial ou DRE completa sem política contábil e cobertura correspondentes.
