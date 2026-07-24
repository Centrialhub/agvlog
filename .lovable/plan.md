## Objetivo

Aproximar a prévia editável do `/cte-hub` do formulário do TMS legado, adicionando campos que ainda faltam no CT-e e tornando **motorista / veículo opcionais** (preenchidos com `.` quando não informados, como o sistema atual faz).

## 1. Motorista e veículo opcionais (regra "ponto")

No `cteBuilder.ts`:

- Remover `Motorista` e `Veículo (placa)` da lista `missing` — deixam de bloquear a transmissão.
- Se `driver` estiver vazio, serializar `motorista: { nome: '.', cpf: undefined }`.
- Se `vehicle.plate` estiver vazio, serializar `veiculo: { placa: '.', uf: undefined, renavam: undefined }`.
- Emitir `warning` (não bloqueia): "Motorista não informado — CT-e será emitido com `.`" e idem para placa.

Na `CteEmissionPreviewDialog.tsx`:

- Aba **Transporte**: acrescentar botão "Sem motorista" / "Sem veículo" que limpa a seleção; badge "Emissão com `.`" quando vazio.
- Remover o `required` visual (asterisco) de motorista/placa.

## 2. Campos novos na prévia (espelhando o TMS legado)

Adicionar ao `EditableCte`, ao `BuildCtePayloadInput` e à UI, agrupados por aba já existente:

**Partes** (nova seção *Terceiros*):
- Expedidor (nome + CNPJ) — já existe no builder, faltam campos na UI.
- Recebedor (nome + CNPJ) — idem.
- Seguradora (nome + apólice + averbação).

**Transporte**:
- Tipo CTRC (`01 NORMAL`, `02 COMPLEMENTAR`, `03 ANULAÇÃO`, `04 SUBSTITUIÇÃO`) — hoje fixo.
- Tipo Veículo (`01 tração`, `02 reboque` etc.) — enum SEFAZ.
- Placa carreta 1 / 2 / 3 (opcionais).
- Tipo de distribuição / Operação.
- Data de emissão (default hoje, editável).
- Nº Ref / Nº Pedido Cliente.
- Prioridade do frete.

**Carga & valores** (expandir composição do frete):
- Frete peso, Valor entrega, Outros, Seguro (%/R$), Despacho/paletização, GRIS/Valor GR, Pedágio, Rastreamento, Carga/Descarga, Ajudante, VL Frete Parceiro, VL Frete Carreteiro, Impostos suspensos.
- Conteúdo, Espécie, Qtd itens, Qtd entrega, Produto predominante, Peso cubado, Valor container.

**Fiscal**:
- ICMS: embutido (sim/não), isento, alíquota, base de cálculo, valor, ST (base/%/valor).
- GNRE: base, alíquota, valor guia, valor frete.
- PIS / COFINS já derivados dos totais; expor alíquota e valor calculado (leitura).
- CBS / IBS (reforma tributária): base, alíquota (0,90% / 0,10%), valor — hoje o builder só recebe `ibs_value` / `cbs_value`; passar a calcular a partir da base × alíquota configurável.
- Valores finais: subtotal, valor financeiro, total do frete (calculados, somente leitura).

Cada novo campo entra no `payload.payload` do builder com uma chave em português (mesma convenção atual: `expedidor`, `recebedor`, `seguradora`, `tipoCtrc`, `placasCarretas[]`, `composicaoFrete: { ... }`, `icms: { ... }`, `gnre: { ... }`, `cbsIbs: { ... }`, `mercadoria: { ... }`).

## 3. Pré-preenchimento via RPC

Estender `cte_defaults_for_group` (nova migration) para devolver, além do que já retorna hoje:

- `driver.name` fica `null` quando não há motorista atribuído (UI mostrará "Sem motorista — emitir com `.`").
- `vehicle.plate` idem.
- Novos blocos: `mercadoria` (peso, valor, qtd NFs, produto predominante = descrição mais frequente das NFs), `composicao_frete` (peso, valor entrega vindos do rate calculado), `icms` (alíquota do tenant), `cbs_ibs` (0,90 / 0,10 padrão).

O `useEffect` de pré-preenchimento existente absorve os novos blocos sem sobrescrever edições do operador (padrão `it.campo || d.campo`).

## 4. Persistência

Uma migration adiciona a coluna `fiscal_documents.cte_payload_extended jsonb` (blocos novos) para não misturar com o `cte_payload` já existente e permitir rollback fácil. O hook `useIssueCTe` já mescla `cte_payload` + payload construído — só ampliar o `merge`.

## 5. Testes

Ampliar `src/test/cteBuilder.test.ts`:

- Motorista/placa vazios → payload contém `.` e não estão em `missing`.
- Seguradora presente → serializada como `seguradora`.
- Composição do frete com `pedagio` e `gris` → aparece no payload.
- CBS/IBS calculados a partir da base × alíquota.

## Fora do escopo

- Emissão real de CT-e complementar/anulação (Tipo CTRC ≠ 01) — só o campo, o fluxo continua "Normal".
- Cálculo automático de ICMS por UF (fica manual, com default do tenant).
- Novos relatórios / dashboards.

## Detalhes técnicos

Arquivos alterados:

```text
src/lib/fiscal/cteBuilder.ts         (input estendido, motorista/placa opcionais)
src/components/billing/CteEmissionPreviewDialog.tsx (novas abas/seções)
src/hooks/useIssueCTe.tsx            (merge do payload estendido)
src/test/cteBuilder.test.ts          (regressões)
supabase/migrations/<ts>_cte_defaults_extended.sql  (RPC + coluna cte_payload_extended)
```

Ordem de execução: migration → builder → dialog → hook → testes.
