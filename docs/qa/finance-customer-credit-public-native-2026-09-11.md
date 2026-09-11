# Crédito de cliente: catálogo, composição e fronteira pública

Candidatas locais via CLI: 103921 (catálogo e APIs públicas) e 104429 (composição em lista/carteira). Nenhum commit, stage, deploy ou comando remoto nesta frente. O núcleo 101312 pertence ao agente banco e permaneceu congelado durante o ensaio nativo.

## Resultado

- Catálogo/boundary: 3 testes PGlite; 35 títulos do mesmo pagador distribuídos em duas páginas, revisão completa detecta mudança fora da página; aplicação/liberação/replay públicos autenticados, parsers da UI, ausência de evidência bruta, isolamento tenant/misto/revogado/anon e rejeição de guarda com evento/predicado adulterados.
- Composição: 1 teste PGlite com definições reais capturadas dos seis leitores. Crédito40 + cash10 liquida título50; estorno apenas10 preserva aplicação40 e deixa saldo10. Lista, carteira e linhas de status apresentam dinheiro/crédito/liquidado separados. Constraints diferidas são explicitamente verificadas antes do rollback/encerramento do positivo.
- Fonte fiscal: 1 teste independente do predecessor prova que nova observação cancelada legítima muda fingerprint mas preserva crédito e dinheiro. O núcleo corrigiu o vínculo imutável separadamente da revisão corrente.
- PostgreSQL nativo17.11: 5 casos passaram, sessão72919, saída0; servidor descartável encerrado. Mesmo crédito disputado por dois títulos; crédito contra recebimento nas duas ordens; revogação enquanto aguarda; lock de linha da fonte antes do writer. Não houve deadlock ou capacidade excedida. SQL congelado é verificado por SHA antes/depois do runner.

## Contratos

`get_finance_customer_credit_options(_tenant_id,_query)` oferece credits/targets/history, offset/limit (máximo100), total e próximo offset explícitos. A revisão abrange todo o conjunto e a prova corrente da fonte; expected_revision desatualizado retorna40001. Pagador/empresa vinculados no servidor. Targets incluem somente títulos elegíveis do mesmo pagador. Histórico inclui liberações manuais/sistêmicas, valores remanescentes e elegibilidade atual, sem snapshot bruto.

`preview_finance_customer_credit_application` retorna o DTO revisado do núcleo e can_execute condicionado à elegibilidade/ACL. `record_finance_customer_credit_application` delega ao writer privado, sem grants no núcleo. Pins cobrem corpos/ACL/search_path/volatilidade, cinco triggers (incluindo deferred) e journal privado com RLS. A migration104429 fixa os seis leitores capturados e preserva campos antigos; apenas acrescenta composição monetária textual.

## Limites e preservação

As fixtures usam documentos fiscais locais e processamento real em SQL; não emitem documentos nem chamam provedor. O runner reaproveita a fixture por transporte psql persistente, substituindo somente o cliente PGlite. A pequena ponte expect(...).toBe usa node:assert para validar respostas reais, sem simular sucesso de negócio. Não é ensaio de browser ou Supabase Auth hospedado. Compatibilidade forecast02519 foi revisada e testada pelo root; não foi duplicada no runner nativo desta frente.

Os testes nunca desabilitam guardas de negócio; o teste negativo altera somente um trigger dentro de savepoint para provar que a promoção recusa seu contrato adulterado. Arquivos anteriores de runners permanecem intactos. Hashes e allowlist exata estão no JSON adjacente.
