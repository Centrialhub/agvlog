# Plano para Ordenação Dinâmica de Tabelas

Implementar ordenação dinâmica em várias tabelas do sistema, permitindo que o usuário organize os dados ao clicar nos cabeçalhos das colunas (ex: ordenar por número de NF, data de emissão, valor, etc.).

## Alterações de Interface (UI)

- **Componente `TableHead`**: Adicionar indicadores visuais (ícones de setas cima/baixo) quando uma coluna for ordenável e estiver ativa.
- **Interatividade**: Transformar cabeçalhos em botões clicáveis que alternam entre ordenação Ascendente, Descendente e Original.

## Detalhes Técnicos

1.  **Novo Hook `useSortableData`**:
    - Criar `src/hooks/useSortableData.ts` para encapsular a lógica de ordenação genérica.
    - Suportar ordenação de strings, números e datas.
    - Manter estado da chave da coluna e direção (`asc` | `desc` | `none`).

2.  **Atualização no Componente de Tabela Base**:
    - Modificar `src/components/ui/table.tsx` para incluir suporte a ordenação no `TableHead` de forma opcional, permitindo retrocompatibilidade.

3.  **Implementação nas Páginas Prioritárias**:
    - **CteMonitor.tsx**: Ordenar por Status, Nº CT-e, Pagador, Emissão.
    - **CteSearch.tsx**: Ordenar por Status, CT-e, Data Emissão, Valor Frete/Carga.
    - **Traceability.tsx**: Ordenar por NF, Data Emissão, Status, SLA.
    - **ImportedNotesSummary.tsx**: Ordenar por NF, Data, Cidade, Valor, Peso.

4.  **Lógica de Ordenação**:
    - Utilizar caminhos de propriedades (ex: `doc.invoice_number`) para acessar dados em objetos aninhados.
    - Garantir que valores nulos sejam tratados corretamente (colocados no final).

## Validação

- Testar ordenação numérica em colunas de ID/Número.
- Testar ordenação cronológica em colunas de Data.
- Verificar se a performance é mantida em tabelas com muitos registros (2000+).
