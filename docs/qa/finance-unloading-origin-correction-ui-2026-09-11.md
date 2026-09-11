# Correção da cobrança da mesma descarga — UI local

Entrega de 2026-09-11, sem publicação. Entrada contextual local preparada; o responsável publicará somente após aplicar e verificar os wrappers.

## Contrato e alcance

- `src/lib/financial/unloadingOriginCorrectionContract.ts`: exports `unloadingEffectiveOriginSchema`, `UnloadingEffectiveOrigin`, `unloadingOriginCorrectionContextSchema`, proposal/command/result schemas. Histórico inclui `revision_after` conforme contrato combinado com o autor SQL.
- Client usa os wrappers acordados `get_finance_unloading_origin_correction_context(_tenant_id,_charge_id,_proposal)` e `correct_finance_unloading_origin(_payload)`. Ainda depende da promoção desses wrappers pelo responsável da integração. Não modifica SQL.
- `UnloadingOriginCorrectionDialog` está ligado ao modal do recebível identificado pela FK da descarga, somente para owner/admin. O formulário usa FinanceOptionPicker, catálogo paginado de 30 fornecedores por consulta. A identidade permanece interna; nome é selecionado e ID é apenas referência na prévia. O reader atual não fornece documento, e sua assinatura protegida não foi alterada. Valor digitado em reais é convertido com BigInt, sem Number monetário.
- Original, vigente e proposta são exibidos separadamente. Cancelamento retira o direito de cobrança, sem alegar pagamento/devolução ou alteração do custo/conta a pagar. Datas econômicas não são apresentadas como posição histórica conhecida no passado.
- Dependências bloqueantes são diferentes das informativas. Histórico conserva evento, ator, motivo, data econômica, registro e antes/depois. Paginação visual de 20 eventos não calcula posição pela soma de versões.

## Recuperação e escopo

Outbox por tenant/ator, com WebLocks obrigatório, persistência antes do transporte, corpo exato com proposta/revisão/motivo, checagem dos IDs da resposta e comparação do conteúdo armazenado antes de remoção. Rejeição definitiva somente na primeira tentativa pode limpar. Depois de resposta incerta, replay conserva o mesmo pedido. Dados de outra aba não são sobrescritos/removidos. Pendência de outra descarga apresenta IDs e proposta originais.

Preview usa chave tenant/ator/charge/proposta. Alterar formulário ou consultar novamente oculta a prévia anterior; erro não mantém elegibilidade. Confirmação requer revisão atual, can_execute e declaração explícita de corrigir somente cobrança. Resultado confirmado é terminal mesmo se atualização do cache falhar. Reautorização financeira é responsabilidade do wrapper/writer; o browser também confere escopo antes/depois do envio.

## Verificação

32 testes Vitest em cinco arquivos aprovados, saída 0 (02:26:17): contrato/client5, outbox12, confirmação4, painel3, integração de edição/entrada8. Lint focado sem diagnósticos. Log `docs/qa/unloading-origin-correction-entry-2026-09-11.log`.

Cobertura: IDs/proposta incompatíveis; cancelamento sem campos livres; valores negativos; effective desconhecido; elegibilidade incoerente; perda de resposta/replay; rejeição inicial vs anteriormente incerta; concorrência/abas; armazenamento corrupto; mudança de prévia; falha de cache após confirmação; dinheiro/custo/conta a pagar preservados.

Não executado nesta entrega: TSC global, RPC SQL real novo, teste de navegador ou deploy. O autor SQL foi solicitado a parsear os envelopes reais com os schemas compartilhados. Nenhum dos arquivos de ExpenseHistoryDetail, expenseHistoryContract ou periodUnloadingFlow foi alterado nesta rodada.

## Catálogo e disponibilidade

Incremento de usabilidade: teste real do picker com transporte controlado verifica seleção na página2, ID enviado à prévia e invalidação imediata ao trocar fornecedor. Nenhum campo de UUID livre permanece. Autor SQL confirmou que ainda não existe endpoint público de readiness da correção; root determinou publicação sequencial em vez de novo endpoint de capacidade: entrada local pronta, frontend só publicado após SQL45402/51405/51729 e wrappers verificados. RPC ausente (PGRST202/42883) mostra indisponibilidade sem prévia executável. Nenhuma capacidade genérica foi usada como substituta.

Teste de catálogo confirma página2 e mudança de fornecedor removendo a prévia anterior. Integração confirma identidade tenant/actor/charge proveniente da FK, fechamento sem escrita e ausência do botão para operador. TSC6133 em parâmetros de teste corrigido com nomes _kind/_term; TSC global segue sob responsabilidade root.
