# Devolução por saída existente — núcleo privado04822

Nenhuma alteração remota.01312/02519/03921/04429 e helpers publicados não foram editados. Consulta de catálogo em produção preservada nos JSONs de predecessores e triggers; sem leitura de dados pessoais.

## Provas locais

Quatro testes PGlite reais, constraints diferidas executadas; ESLint0. Crédito original600 gerado a partir de recebimento real e cancelamento por helper fiscal real com fatos existentes na fixture. Saída canônica200 registrada antes do refund. Vínculo e replay não criam bank/payment; crédito/banco byte-idênticos. Aplicação400 consome saldo, liberação posterior restaura apenas400 e preserva devolvido200. Leitura interna com authNULL segue válida. Fonte imutável e void vinculado negados.

Pagamento real100 e devolução200 compartilham saída300; tentativa de novo pagamento falha e deixa0pagamentos no título negado. Duas devoluções parciais100 somam200; documento divergente, revisão antiga, tenant errado, replay alterado e revogação são negados. Falha injetada por CHECK depois da primeira devolução demonstra rollback conjunto de journal e finance_event. Auditoria central classifica refund como manual.

Primeira contraprova revelou que a fixture ancestral instalava tabela finance_customer_credits sem trigger immutable. Helper novo agora instala trigger ORIGINAL011121, sem alterar produto e sem contornar guarda. O teste de CHECK também passou a executar triggers diferidos antes de ALTER TABLE. Essas falhas eram lacunas de fixture/ordem do ensaio, não relaxamentos do contrato.

## Dependências e limites

Fixture financeira completa herda agenda/fechamento/custos e instala predecessores fiscais/fatura capturados. Guardas reais check_movement_use/check_settlement_movement_link e ACLmovement_used vieram de SELECT de produção. Corpo movement_used já era igual; só ACL e instalação dos triggers estavam incompletos na fixture.

Núcleo mantém API privada e can_executefalse. Público/catálogo/UI pertencem aos outros agentes. Boundary futuro deverá repinar posição/contexto/writer e impedir journal privado nos DTOs.04822 remove refund_history do contexto de aplicação e do snapshot do writer sem editar01312 original. Não representa nova transferência bancária nem estorno de pagamento original.

Concorrência PostgreSQL nativa e contraprova de fechamento real ainda são ensaios posteriores independentes. Nenhuma equivalência com homologação integral ou implantação é declarada aqui. Documento fiscal existente é conferido quando presente; nome não é prova documental.
