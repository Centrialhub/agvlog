## Diagnóstico

Verifiquei um CT-e real no banco (`fiscal_documents.cte_payload->icms`) e o cálculo está de fato incorreto:

```json
{ "embutido": true, "aliquota": 5.35, "base": 3583.74, "valor": 191.73 }
```

Ou seja, mesmo com `embutido=true`, a base é igual ao valor do frete e o imposto é calculado por fora (`base × alíq/100`).

### Regra fiscal (CT-e SEFAZ)

- **ICMS por fora** (`embutido=false`): `vBC = vTPrest`, `vICMS = vBC × pICMS/100`.
- **ICMS por dentro / embutido** (`embutido=true`): o valor do frete **já contém** o ICMS, então a base precisa ser calculada "por dentro":
  - `vBC = vTPrest / (1 − pICMS/100)`
  - `vICMS = vBC × pICMS/100` (equivalente a `vTPrest × pICMS / (100 − pICMS)`)
  - `vTPrest` (valor do frete) **não muda**.

Exemplo (frete = 3.583,74; alíq = 5,35%):
- Por fora → vBC 3.583,74; vICMS 191,73 (o que está sendo enviado hoje — errado).
- Embutido → vBC 3.786,32; vICMS 202,57 (correto).

### O que já vai para o Hub, e o que está faltando

O `cteBuilder` já monta o bloco `payload.icms` com `CST/cst`, `vBC`, `pICMS`, `vICMS`, aliases `base/aliquota/valor`, `embutido` e `isento`, e o `hub-fiscal-proxy` encaminha o body inteiro. Ou seja, os campos **são enviados**; o problema é que os números que enviamos são os de "por fora" quando o operador marcou "embutido", então o Hub grava um vICMS/vBC coerente entre si, mas não com a regra de embutido — e é isso que aparece "sem alíquota correta" no PDF.

Também existem alguns pontos secundários a corrigir junto:

1. **Auto-cálculo desatentado ao toggle "Embutido"**. Todos os pontos que recalculam ICMS (troca de CST, troca de UF de destino, digitar alíquota, digitar base, botão "Recalcular") usam `base × aliq / 100`, sem considerar `icmsEmbutido`. Um usuário que só marca o checkbox não vê nada mudar.
2. **`icmsBase` inicial** é setado como `freight_value` (linha ~180) mesmo quando o default é `embutido=true`. Precisa ser grossed-up no init.
3. **`buildIcmsBlock` no `cteBuilder`** confia no `valor` recebido. Vou torná-lo defensivo: se `embutido=true` e a base recebida for igual ao frete (± centavo), recalcula em modo por dentro. Isso protege contra qualquer chamador antigo que não tenha sido atualizado, e o cálculo passa a ficar correto no payload independente do que a UI preencheu.
4. **Indicador SEFAZ** — hoje enviamos só `embutido: true/false`. Vou adicionar também os aliases `indICMS`/`indIEToma` que o Hub Fiscal reconhece, para deixar explícito que é "ICMS incluído no valor do serviço". Não muda cálculo, só sinalização.
5. **Isento (CST 40/41/51)** — validar que continua zerando vBC/vICMS e ignorando "embutido".

## Mudanças

### `src/lib/fiscal/cteBuilder.ts`

- Nova função auxiliar `computeIcms({ freight, aliq, embutido, isento, providedBase, providedValor })` que:
  - Se `isento` → `{ base: 0, valor: 0 }`.
  - Se `embutido` → `base = freight / (1 − aliq/100)`, `valor = base × aliq/100`. Ignora `providedBase/providedValor` quando eles refletirem cálculo "por fora" (heurística: base ≈ freight). Se o operador digitou base manual claramente diferente do frete, respeita.
  - Se não embutido → mantém `base = providedBase ?? freight`, `valor = providedValor ?? base × aliq/100`.
- `buildIcmsBlock` passa a chamar a auxiliar (recebe `freight_value` como argumento adicional).
- Adiciona `indICMS`/`indIEToma` no bloco quando `embutido=true`.
- Testes novos em `src/test/cteBuilder.test.ts` cobrindo:
  - Embutido com alíq 5,35% em frete 3.583,74 → vBC 3.786,32 e vICMS 202,57.
  - Alternância embutido↔por fora produz vBC/vICMS diferentes.
  - CST 40/41/51 zera mesmo com `embutido=true`.

### `src/components/billing/CteEmissionPreviewDialog.tsx`

- Extrair um helper local `recalcIcms(freight, aliq, embutido, isento)` e usar em **todos** os pontos de atualização:
  - init de `EditableCte` (linhas ~177–182);
  - troca de CST (linha ~1059);
  - toggle "Embutido" (linha ~1083) — hoje só atualiza a flag, precisa recalcular base/valor;
  - toggle "Isento" (linha ~1087);
  - edição de alíquota (linha ~1095);
  - edição de base (linha ~1112) — se `embutido=true` e o usuário digitar a base manual, respeitar e recalcular só o valor via `base × aliq/100`;
  - botão "Recalcular" (linha ~1138);
  - `useEffect` de auto-sugestão por UF (linha ~469).
- Mostrar um hint pequeno abaixo dos campos ICMS explicando que quando "embutido" está marcado a base exibida é grossed-up.

### Verificação

- `bun test` (foco em `cteBuilder.test.ts`).
- Emitir 1 CT-e no sandbox com `embutido=true, aliq=5.35, freight=3583.74` e conferir no `cte_payload` gravado que `vBC≈3786.32` e `vICMS≈202.57`.

## Fora de escopo

- Não mexo em CBS/IBS (regra separada, e os valores hoje já batem com o que o operador espera).
- Não mexo no Hub Fiscal em si — só no que o AGVLog envia.
- Não retroativo: CT-es já autorizadas continuam com o cálculo antigo; só emissões novas usam a fórmula corrigida.
