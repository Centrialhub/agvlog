# Recuperação das fontes Edge observadas em 26/09

## Escopo

Este registro preserva as fontes completas de três funções publicadas que diferiam do checkout. Os pacotes são históricos; não aprovam publicação nem demonstram estabilidade. O [manifesto de reconciliação](edge-reconciliation-2026-09-26.json) registra as versões, identidades e hashes observados.

| Função | Versão observada | Arquivos fonte |
| --- | --- | --- |
| `agvlog-pipeline-run` | 153 | 7 |
| `ssx-sync-governance` | 14 | 11 |
| `ssx-sync-units` | 146 | 7 |

As 25 referências correspondem a 15 conteúdos únicos, totalizando 169.399 bytes UTF-8 após normalização para LF. Estão versionados em `docs/qa/edge-source-snapshots-2026-09-26/<sha256>.txt`. Os arquivos contêm código, não dados do banco. Os snapshots deixam a recuperação independente do cache ignorado, da branch do PR e da retenção deste worktree.

O `.gitattributes` força LF nesses snapshots também em checkouts Windows. Espaços no fim de linha existentes na fonte publicada são preservados e têm uma exceção restrita a essa pasta na checagem de whitespace do Git. Removê-los alteraria os hashes observados. O gerador rejeita outra codificação ou fim de linha, em vez de aceitar uma fonte diferente sob o mesmo nome de hash.

## Gerar os pacotes isolados

Na raiz do checkout:

```sh
node scripts/prepare-observed-edge-recovery.mjs
node --test scripts/prepare-observed-edge-recovery.test.mjs
```

O gerador [prepare-observed-edge-recovery.mjs](../../scripts/prepare-observed-edge-recovery.mjs) produz um diretório por função em `.codex-build-audit/edge-observed-recovery-2026-09-26/<slug>/`, contendo `supabase/functions/`, `supabase/config.toml` e `manifest.json`. A configuração preserva `verify_jwt=false`, como nas versões observadas; a autenticação interna do código permanece necessária.

O gerador verifica os hashes, os caminhos e a identidade observada. Ele recusa fontes ausentes ou alteradas, links simbólicos, arquivos inesperados e saída divergente. Uma nova geração igual é permitida. Não executa deploy, não altera o banco e não incorpora essas fontes ao diretório de funções candidatas.

**Mantenha cada pacote separado.** Pipeline e governance publicaram versões diferentes de `_shared/ssx-sync-checkpoint.ts`; governance e units publicaram versões diferentes de `_shared/ssx-utils.ts`. Copiar todos para uma pasta comum sobrescreveria uma dessas dependências e deixaria de reproduzir o pacote observado.

## Uso em um plano de retorno

1. Reconfirmar as versões ativas e revisar o estado persistido criado pelo candidato; a observação de 26/09 não comprova o estado atual.
2. Gerar o pacote escolhido, conferir o manifesto e registrar sua identidade no [log do release](release-log-template.md). Preservar a evidência do ensaio, além das fontes versionadas.
3. Ensaiar em staging autenticação, contratos SQL, checkpoints, execução e repetição. Conferir as dependências resolvidas pelo runtime; os arquivos `deno.json` estão incluídos nos hashes.
4. Decidir o retorno pelo resultado desse ensaio e pelo incidente concreto. Após uma publicação, registrar a versão e o bundle efetivamente implantados, os efeitos persistidos e o resultado do smoke.

As versões históricas conservam suas limitações conhecidas, incluindo o falso sucesso na descoberta de unidades sem identidade estável. Restaurá-las pode reintroduzir defeitos que o candidato trata. Hash igual comprova a identidade da fonte recuperada, não a adequação do retorno ao estado atual.

`ssx-sync-rule-violations` usa outro [procedimento de retorno compatível](ssx-violations-compatible-rollback-2026-09-26.md), pois sua v13 literal não reconhece o novo formato de cooldown. Este gerador não reconstrói nem aprova essa v13 literal. A recuperação dos três pacotes acima também não reverte migrações, dados ou frontend.
