# Auditoria de visibilidade das origens históricas

`src/test/financeLegacyInventoryVisibilityAudit.test.ts`: **8 testes de caracterização passaram** em PGlite. ESLint passou. Isso comprova a reprodução dos comportamentos descritos, **não a aprovação da completude do inventário**. A migration `42740` permanece intacta; a frente de diagnóstico adicional recebeu os achados.

## Omissões reproduzidas

| Caso | Seed real na fixture | Resultado atual de 42740 / causa |
|---|---|---|
| Folha sem data | `payroll_entry_items.nature='already_paid'`, `occurred_at` e `competence_date` nulos | ID não aparece em rows nem unknown_account. Filtro final `source_day BETWEEN` elimina NULL. Ambos campos são anuláveis no baseline. |
| Data não finita | Recebimento com `received_at='infinity'` | ID eliminado do corte finito. O tipo timestamptz aceita o valor; a lista atual não diagnostica explicitamente a impossibilidade de situá-lo no período. |
| Conta órfã | Pagamento com UUID bancário inexistente | Não pertence à conta selecionada e não tem bank_account_id nulo; desaparece das duas seções. Este é teste de robustez de dados danificados, não afirmação de que o escritor normal consiga violar a FK. |
| Conta de outro tenant | Pagamento do tenant A aponta UUID de conta do tenant B | Não aparece na conta de A; leitura direta da conta B com tenant A é corretamente negada. A FK global do baseline não valida igualdade de tenant; a FK composta posterior `NOT VALID` não comprova saneamento retroativo. |
| Alias divergente | `load_payments.receivable_payment_id` aponta recebimento real, mas valor é 99 versus 12,34 | Alias some porque basta ID/tenant para a exclusão. O recebimento principal permanece, sem indicador dessa divergência na consulta atual. |
| Banco com data incompatível | Linha bancária em 10/09 referenciada por pagamento em 01/08 | Linha bancária excluída por references_to_bank; pagamento excluído por data. Nenhum dos IDs aparece no corte de setembro, embora a linha bancária pertença a ele. |

O inventário atual reconhece origem por ID, mas não verifica todas as equivalências ao excluir projeções. A consulta de exceções deve carregar esses casos independentemente de data/conta resolvida, com motivos específicos e sem somá-los como dinheiro novo.

## Controles positivos executados

Alias de fechamento com ID inexistente no tenant continua visível; mesmo UUID de pagamento encontrado em outro tenant não é usado para deduplicar. Paginação de 31 pagamentos de acerto com conta desconhecida retornou exatamente os 31 IDs sem repetição/omissão em duas páginas, e não alterou o total da conta identificada. Motorista e perfil misto foram rejeitados.

## Limites

Fixture reproduz definições, tipos/defaults e chaves primárias do baseline, com FKs de grafos omitidas conforme o relatório do inventário. Alguns seeds deliberadamente inválidos só representam bancos danificados/importações antigas/restaurações fora das guardas, não uma vulnerabilidade de escrita demonstrada. Os casos de data nula da folha, equivalência inconsistente e corte divergente não exigem desativar guardas nesta consulta de leitura.

Os testes fixam o comportamento da migration original para documentar os defeitos; a nova consulta deverá ter testes independentes exigindo presença dos IDs, e não reutilizar as expectativas de ausência como critério de aprovação. Nenhuma operação remota ou alteração de SQL core foi realizada nesta frente. Validação nativa da nova consulta está pendente de seu contrato.


## Confirmação nativa final

PostgreSQL 17.11, execução 86064: exit 0, cinco testes passaram e servidor descartável encerrado. Comparação exata dos 42 IDs esperados com os 42 retornados, incluindo 32 itens sem data e cinco contrapartes bancárias inconsistentes. SHA256 de 151011: 606d077ab2ff859740ca5eebbd5526ccdd918b979768157c899db0adddeac083.

Casos incluem paginação, datas ausentes/infinita, contas órfãs/de outro tenant, aliases divergentes, exclusão de outro tenant, motoristas/perfil misto e página inválida. Fixture com tabelas baseline e funções reais; FKs de todo o grafo não instaladas permitem corrupção histórica deliberada. Não prova fontes fora das oito tabelas diagnosticadas nem autoriza fechamento.
