# Positive unloading cost correction — local UI validation

Local implementation only; no deployment or database changes by this agent.

The dialog exposes original, current and proposed cost and obligation separately from the unchanged collection. Approved obligations require explicit acknowledgement of return to pending. Unknown current amounts remain indeterminate and prevent confirmation. Changes are journaled with author, reason and date.

The durable outbox saves tenant, actor, charge, expense, payable, revision, exact proposal and expected effects before sending. Replay preserves the original request after an uncertain response. Response identity and effects must match before acknowledgement; confirmed success remains terminal if cache refresh fails. Web Locks and compare-before-remove protect another tab's pending request.

## Validation

- Final combined run: 35 tests passed across six files; four panel tests initially failed because a local text edit changed UTF-8 encoding.
- Encoding repaired; all four affected panel tests passed in the focused rerun. Thus all 39 targeted tests passed across the final versions, without claiming a clean combined run after the repair.
- Focused ESLint completed successfully after the repair.
- Logs: unloading-cost-ui-final-2026-09-11.log and unloading-cost-panel-final-2026-09-11.log.
- Tests cover increases/reductions, exact deltas, invalid current values, reapproval, identity mismatch, lost responses, replay, cross-tab pending preservation, stale/error preview hiding and confirmed success with failed refresh.
- Related recorded costs and settlement views preserve null totals; payable portfolio presents current cost versions separately from versions attached to historical payments.

Native backend agent separately reported its first real 150→120→180 flow with these parsers and subsequent cancellation. Backend validation is still being expanded by its owner. Global TypeScript/build and publication belong to the root agent and were not run here.

## Integration

`UnloadingCostCorrectionDialog` props: tenant, actor, chargeId, open, onOpenChange. Parent owns the contextual entry in ExpenseHistoryDetail. Missing preview RPC fails closed and does not authorize confirmation.
