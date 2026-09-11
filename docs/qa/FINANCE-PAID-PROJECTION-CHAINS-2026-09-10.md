# Cadeias comprovadas de adiantamento e already_paid

Migration local 20260910172624_finance_paid_projection_chains.sql, SHA256 `81a04b56856933edce8341a07743d5b977e7a688b877d6cafebaf4fe680d4394`. Sem mudança remota ou edição das migrations B163116/170213.

O helper privado paid_projection_chain(tenant,source_table,source_id) resolve toda a origem antes do filtro temporal. Retorna valid, issue, revision, snapshot e footprints por pagamento/link/movimento/conta/dia/centavos. Adiantamento paid só é válido com empregado coerente, título único apontado por payable_id e source_table/source_id de volta à origem, valor integral e soma dos pagamentos ativos exatos. Cada parcela exige um vínculo ativo, direção out não transferência, tenant/conta/dia SP/driver/valor coerentes e capacidade compartilhada completa.

Folha already_paid exige pais entry/period/employee coerentes e fonte única para o empregado. Fontes suportadas: employee_advances pela cadeia acima; driver_settlement_payments pelo resolvedor170213. Metadata ausente do gerador histórico não substitui nem impede joins; IDs presentes contraditórios são recusados. Folha cancelada ou origem repetida exige revisão explícita. payables_payments como fonte direta de crédito de folha continua sem produtor comprovado e é recusada.

Classificador versão3 adiciona aliases de projeção, sem reservar ou somar dinheiro outra vez. Uma origem multiconta/multidia produz footprints filtrados por conta/corte; a fonte completa e dependências entram na revisão. Data inexistente do item não apaga uma cadeia monetária íntegra. Origem não resolvida permanece bloqueio conservador para contas potenciais; não inferimos sua data a partir de competência ou status.

Guarda diferida usa o mesmo resolvedor para INSERT de already_paid e adiantamento. Permite transição de adiantamento não pago para paid somente sem alterar outros campos além status/autoria/tempo dessa transição. Em corte fechado, cada perna que alcança o corte precisa apontar a movimento congelado nas dependências; pernas em outros períodos continuam explicitamente representadas. Reautorização ocorre no flush. Fontes sem prova seguem a guarda original; novo dinheiro retroativo não é permitido. Evento closed_period_composition_recorded preserva prova/ator e não muda snapshot do banco.

## Validação

11 testes PGlite próprios passaram; ESLint passou. Pagamentos de adiantamento usam apply_finance_payable_movement real. Provas: status paid sem dinheiro recusado; duas contas/dias sem escolher primeira parcela; identidade empregado divergente; folha sem data com origem completa; duplicação de source; projeção tardia íntegra com snapshot de fechamento preservado; revogação no flush; transição approved→paid respaldada; fonte tardia sem pagamento recusada; folha/acerto usa mapping170213 e metadata contraditória falha.

Os casos são agrupados em onze testes. A fixture de fechamento é histórica e isolada, com ticket/dependência de movimento; não afirma ter executado todo workflow de cobertura/classificador/aprovação de fechamento. O caso de acerto semeia payment/link históricos exatos para testar o resolvedor, não executa register/record settlement writer. Native concorrente e ensaio da cadeia inteira de migrations ainda dependem da integração coordenada.

## Limitações preservadas

Ponte financial_obligations de adiantamento não é aprovada sem produtor comprovado; título ambíguo, status pago sem payables_payments e reversão que deixa parcela sem vínculo ficam pendentes. Status de folha cancelada e múltiplas linhas históricas de cobertura exigem revisão, sem reescrever folhas. Não cria saída, título, crédito de reembolso ou entrada de folha; esta entrega reconhece e protege projeções existentes. Definição de active_payable_payments é a final43833: reversão canônica retira parcela ativa; reversão de adoção legada mantém dinheiro histórico, exigindo associação novamente.

Regressão adicional: advance approved com paid_at retroativo permanece bloqueado pela guarda original. O RPC público de revisão foi validado com legacyCutReviewSchema real para cadeia multiconta e origem sem pagamento. Evidence preserva record de arrays.
