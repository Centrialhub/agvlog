---
name: Rollback Lógico e Auditoria
description: Inventário de reversão de funcionalidades e limpeza de schema.
type: preference
---

# Inventário de Reversão

## Manter
- Eliminação dos arquivos .js concorrentes (preservando .ts/.tsx).
- Hooks de Repositories/Typed Layer (`useDrivers`, `useClients`, `useAlerts`) pois estabilizam o acesso a dados.
- Normalização de cidades e vínculos de motorista.
- `DUPLICATES_INVENTORY.md` e documentação de arquitetura.

## Corrigir / Desativar
- Rotas de `Ledger` e `MdfeProvisional` desativadas no `App.tsx` para evitar quebra de runtime por falta de componentes removidos.
- Read models que dependem de tabelas/RPCs não aplicadas no banco de produção.

## Remover (Rollback)
- `DataQualityCenter.tsx` revertido para `DataAudit.tsx`.
- `operational_ledger` e fluxos de aprovação financeira imutável.
- `mdfeBuilder.ts` e lógica de MDF-e provisional.
- Testes de integridade de dados que falham por falta de schema.

## Evidência de Banco Limpo
- Migrations aplicadas não foram editadas.
- Novas funcionalidades dependentes de schema não aplicado foram removidas do frontend.
