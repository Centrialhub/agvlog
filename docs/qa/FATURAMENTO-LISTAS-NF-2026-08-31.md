# Disponibilidade de notas para faturamento — 31/08/2026

## Regra implementada

- CT-e: NFs de entrada ainda não faturadas cujo destino é diferente do município do emitente ativo padrão da transportadora.
- NFS-e: somente NFs de entrada ainda não faturadas com destino no mesmo município desse emitente.
- Comparação por cidade e UF normalizadas; quando ambos estão presentes, os códigos IBGE prevalecem. Município desconhecido não é classificado como igual.
- Marcas de emissão e vínculos com documentos emitidos/em processamento impedem nova seleção. Rascunhos, prévias, documentos anulados e falhas definitivas não consomem a NF por si só. A consulta por número específico não contorna essas verificações.

## Correções

A consulta do resumo pendente usava deleted_at em cte_documents, coluna inexistente, e falhava com HTTP 400. O resumo agora usa a mesma origem de elegibilidade das duas listas, sem filtrar por modalidade.

As importações e atualizações de NFs invalidam o cache do faturamento. As listas renovam os dados ao abrir/retomar a tela; o diálogo de NFS-e também atualiza ao reabrir. Consultas paginadas carregam todas as NFs e referências de CT-e/NFS-e, sem depender de um limite maior que o teto do PostgREST.

As telas oferecem Atualizar notas e Mostrar todas as NFs não faturadas. A segunda ação remove todos os filtros da tela, mantendo a regra do município e os bloqueios fiscais. O acesso /billing?focus=pending ignora os filtros salvos ao abrir. Falhas de consulta são exibidas, e a transmissão fica indisponível durante atualização/erro.

A prévia de CT-e não permite confirmar a emissão de destinos locais caso o emitente/destino seja alterado depois da seleção.

## Verificação

- Quinze testes de regressão usando o cliente Supabase/PostgREST real com transporte HTTP de teste. Incluem paginação além de mil registros, isolamento por tenant, falhas, destinos homônimos, marcações de faturamento e atualização após importação.
- BillingPage e NFSeFromInvoicesDialog são renderizados de verdade nos testes de DOM, com o hook compartilhado real. Conferência individual das células: lote de 60 notas dividido em 49 CT-e e 11 NFS-e, sem sobreposição; limpeza de filtros restaurando a lista correta.
- Repetição local das telas com números/destinos consultados no banco: aprovada. O snapshot fica fora do controle de versão; nenhum dado de cliente foi adicionado ao teste público. BILLING_INVOICE_SNAPSHOT permite esse replay local opcional; o teste padrão usa dados sintéticos.
- TypeScript, ESLint dos arquivos alterados, baseline de qualidade, build e verificadores do artefato: aprovados em Node 22.23.2.
- A suíte geral é executada em checkout limpo com LF, como armazenado no Git. O checkout Windows com core.autocrlf=true apresentou divergências em hashes/contratos SQL de outros módulos; esses arquivos e verificações não foram modificados. A primeira verificação DOM excedeu o timeout por consultas acessíveis repetidas; o teste foi otimizado para conferir as células em uma passagem, sem aumentar o timeout.

Resultado final: 2.668 testes em 224 arquivos aprovados, código de saída zero, em checkout limpo com LF (Node 22.23.2). Os 15 testes deste lote também passaram no replay local com o snapshot mínimo do banco.

## Limites

O navegador integrado não iniciou por falha do sandbox Windows (helper_unknown_error); a sessão autenticada do site publicado não foi verificada. A evidência de interface disponível é a renderização DOM das telas locais, não uma validação HTTP/Auth completa em produção.

Este lote altera a disponibilidade/seleção das NFs. Não contém migração nem configuração de credencial, não emitiu documentos reais e não substitui a homologação com o provedor descrita no pacote fiscal anterior. A atualização de main não atesta que o host já publicou o frontend.
