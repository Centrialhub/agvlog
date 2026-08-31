# Liberação pontual para reemissão — 31/08/2026

O usuário informou expressamente que os CT-e anteriores das notas abaixo foram cancelados e pediu nova emissão antes da conciliação geral com o Fiscal Hub.

| NF | CT-e anterior |
| --- | --- |
| 443663 | 234 |
| 444796 | 266 |
| 444797 | 267 |
| 444798 | 268 |
| 446066 | 262 |
| 446068 | 263 |
| 446069 | 259 |
| 446070 | 261 |
| 446071 | 264 |
| 446072 | 265 |
| 446083 | 260 |

## Intervenção restrita

- As onze fontes estavam confirmadas, sem exclusão, sem NFS-e, sem reserva fiscal e sem vínculo no catálogo de CT-e.
- As operações antigas eram legadas e ainda constavam como autorizadas no AGV. Nenhum status, recibo, protocolo ou payload antigo foi apagado ou marcado artificialmente como cancelado.
- Duas transações (dez NFs da tabela e a inclusão posterior da NF 443663) limparam apenas os vínculos de consumo da fonte. Cada fonte recebeu delivery_meta.operator_reported_cte_cancellation com vínculo anterior, número, recibo, data de consumo, solicitação, status observado e reconciliation_pending=true/provider_cancellation_confirmed=false.
- As transações validaram tenant, identidade e estado antigo, travaram as fontes, recusaram novos vínculos e foram ensaiadas com ROLLBACK antes do COMMIT.
- Não foi transmitido novo documento fiscal. A liberação se baseia no relato do usuário; a confirmação dos cancelamentos no provedor continua pendente.

## Dados e código

- Sete cadastros de destinatários tinham IE mineira com 11 dígitos. Foram formatados com dois zeros iniciais, mantendo os dígitos existentes; os dois verificadores conferem pelo roteiro oficial https://www.sintegra.gov.br/Cad_Estados/cad_MG.html. Antes/depois e CNPJ exato foram auditados nas fontes. A verificação matemática não equivale a nova consulta de vínculo cadastral na SEFAZ.
- Corrigida a função cte_defaults_for_group para usar product_summary, coluna existente, preservando as verificações de acesso e tenant.
- A disponibilidade agora considera vínculos legados com recibo autorizado/processando mesmo sem timestamp, reserva ou catálogo. Uma fonte explicitamente liberada fica disponível e volta a ser bloqueada quando a nova operação começa.
- Testes: 69 casos aprovados (disponibilidade, montagem de CT-e, resolução de partes e prévia SQL, incluindo isolamento entre tenants). TypeScript, lint, build e inspeção do artefato executados antes da publicação.

## Conciliação posterior

Usar os IDs antigos preservados na auditoria de cada fonte para conciliar os cancelamentos. Não recolocar vínculos antigos sobre uma nova emissão, nem concluir que a liberação operacional comprova cancelamento no Fiscal Hub.

