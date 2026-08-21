# Finalização de RH e Contas a Pagar

Refatoração do módulo de RH para garantir isolamento de tenant, integridade transacional e bloqueio otimista atômico. Limpeza do componente de Contas a Pagar (Payables) removendo estados simulados.

## User Review Required

> [!IMPORTANT]
> A flag `HR_CORE` será mantida como `false` por padrão até que a migração seja aplicada e validada no ambiente.

## Proposed Changes

### Database & Security
- **Migração de RH**: Implementação das funções `create_employee_v1`, `update_employee_v1` e `delete_employee_v1`.
- **Bloqueio Otimista**: O `update_employee_v1` passará a usar `WHERE version = p_expected_version` para evitar sobrescritas acidentais em ambiente concorrente.
- **Validação de Dependências**: Garantia de que `cost_centers`, `branches` e `managers` pertencem ao mesmo `tenant_id` antes de permitir o vínculo.
- **Auditoria**: Registro detalhado na `entity_state_audit_log` para operações de RH.

### Frontend & UX
- **Payables Cleanup**: Remoção da mutation falsa `approveMut` no arquivo `src/pages/Payables.tsx`. O botão de aprovação será desativado ou restaurado para a lógica real, eliminando mensagens de sucesso enganosas.
- **Feature Flags**: Ajuste em `src/lib/featureFlags.ts` para desativar `HR_CORE` temporariamente durante a transição.

### Visual Edits
- Aplicação dos textos literais solicitados em conformidade com as diretrizes de manutenção do sistema.

## Technical Details
- **Atomic updates**: `UPDATE public.employees SET ... WHERE id = p_id AND tenant_id = p_tenant_id AND version = p_expected_version`.
- **Pre-check audit**: Carregamento da entidade antes da deleção para garantir existência e propriedade, abortando se houver desvio de tenant.
- **RPC inventory update**: Adição das novas assinaturas atômicas na whitelist de permissões.
