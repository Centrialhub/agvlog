# Contrato do cálculo de frete

Regra confirmada pelo usuário em 29/09/2026: **a tabela pertence ao fornecedor/remetente da NF-e**. Evidências e estado de publicação: [log de 29/09](release-log-2026-09-29-cte-preview-freight.md).

## Identidades que não podem ser confundidas

| Campo | Significado |
| --- | --- |
| `fiscal_documents.client_id` / `FreightInput.clientId` | Cliente destinatário; contexto de entrega e de região. |
| `fiscal_documents.remitter_cnpj` / `supplierTaxIds` | CPF/CNPJ do remetente da NF-e. Resolver por identidade completa, com pontuação removida. |
| `FreightInput.supplierId` | Cadastro do remetente em `clients`, na empresa ativa, marcado `is_supplier`. |
| `freight_tables.client_id` | Nome legado do vínculo com o **fornecedor**. Comparar com `supplierId`, nunca com o destinatário. |
| `sourceDocumentIds` | NF-es vigentes que dão origem ao cálculo agregado. Não usar o CNPJ da transportadora emitente do CT-e como remetente das NF-es. |

O grupo pagador ausente é obtido do fornecedor identificado. O simulador pode informar um grupo explicitamente. O nome do fornecedor não deve ser inventado como identidade do tomador/pagador fiscal. Restrições explícitas de tabela continuam exigindo informação correspondente.

## Regras de seleção

1. Consultas sempre delimitadas pela empresa ativa. Cadastro ambíguo, documento excluído/inacessível ou identificação incompleta produz falha visível.
2. Um cálculo agregado não escolhe o primeiro fornecedor de um lote misto. Calcular separadamente; na prévia que soma fretes por nota, todos precisam ter resultado válido.
3. Regiões com `client_id`/`payer_group` nulos são gerais. Uma região específica compatível tem precedência; empate exige revisão. Restrições de outra UF, cliente ou grupo não são ignoradas.
4. Tabelas bloqueadas, fora da vigência ou de outra empresa não participam. Não desbloquear tabelas para fazer um teste passar.
5. Nenhuma tabela compatível é uma pendência de frete. Não retornar sucesso com zero, reutilizar resultado de outro contexto ou aceitar soma parcial como completa.
6. Preservar fretes manuais. Na pré-emissão, base editada, componente Frete Peso e ICMS devem permanecer coerentes. Resposta atrasada não pode apagar a edição.
7. Transmitir o snapshot fiscal reservado. Conflito com reserva anterior exige reconciliação; não contornar a reserva para enviar novos valores.

## Cobertura obrigatória ao alterar estes fluxos

- Importação XML/CSV, recálculo de NF-e, criação/recálculo de CT-e, carga, workbench, pré-emissão e simulador devem usar o mesmo contrato de fornecedor.
- Testar remetente e destinatário diferentes, fornecedor sem tabela, tabela bloqueada/vencida, duplicidade cadastral, lote misto, isolamento entre empresas, paginação, regiões gerais/específicas, falha de consulta e resposta obsoleta.
- Testar edição monetária brasileira e conferir valor no snapshot e no despacho, incluindo conflito de snapshot.
- Executar a suíte `freightSupplierCalculation.test.ts` junto das suítes de pré-emissão e dos consumidores alterados. Ela executa o motor e o preenchimento reais com transporte de banco simulado; não comprova RLS nem operação autenticada.
- Antes de publicar, fazer o smoke autenticado no staging com fornecedor, destinatário e valores sintéticos conhecidos, conferir gravação/log e cumprir o Quality gate do projeto.

## Registro e operação

Para cada release, registrar SHA, ambiente, horário UTC, causa reproduzida, comandos/resultados e pendências. O log de cálculo existente registra tabela, região, critérios, componentes e resultado; `matched_criteria.client_id` mantém o nome legado do critério da tabela, que representa o fornecedor.

Consultas de diagnóstico em produção devem preferir contagens agregadas. Um frete antigo positivo não prova que o calculador atual funciona: pode ter sido manual ou calculado sob outra configuração. Não recalcular documentos históricos nem alterar tabelas bloqueadas em massa como efeito colateral de uma correção.
