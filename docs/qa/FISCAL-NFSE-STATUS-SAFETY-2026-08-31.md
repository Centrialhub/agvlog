# Fiscal status safety and NFS-e verification — 2026-08-31

## Corrected behavior

- CT-e and NFS-e reconciliation preserve committed terminal status AND its protocol, number, message, source flags and receipt when processing/error/timeout responses arrive late.
- Receipt recovery stores the Hub document ID before mirror confirmation; retries remain GET-only. Provider errors are preserved in the polling envelope and the UI receives the committed result.
- Exhausted polling serializes with reconciliation, cannot downgrade an authorized/rejected/cancelled document, and queues uncertain durable emissions without marking their sources available again.
- NFS-e payer resolution uses the selected party and exact CNPJ. Missing sender address fields no longer fall back to recipient fields. The same resolver handles grouped and individual issuance; a single-note manual correction is honored.
- Malformed payer CPF/CNPJ length is rejected before sending. Billing queries refresh after unsuccessful issuance too, since a rejection or timeout may commit local changes.

## Production evidence (read/consult only; no emission initiated by this audit)

Tenant: 6e874e6e-5bca-486d-9928-bef0646989c4.

- CT-e 270 / series 1: authorized; protocol 131264829388436; NF447165 consumed and absent from billing eligibility.
- Operator issued NFS-e 41 / RPS61: local ID fea482b7-841f-46e5-a6e0-23bb08af7b6e, Hub bb3a93e1-7505-4193-bdd9-fc39cf3c989d, production intent 37eb9aa1-f6d6-439a-93c3-89a29f2ee5d9.
- NFS-e ledger authorized/recorded, local issued, PDF and XML references present, production-billable. NF447164 destined for Montes Claros linked and consumed; one reservation and one intent.
- Authenticated GET reconciliation through nfse-status-poll (pg_net41154): HTTP200, checked1, outcome issued. No additional emission POST.
- Eligibility SQL matching useBillingDocuments returned zero available rows for BOTH NF447164 and NF447165. Browser visual verification was not performed.
- Older RPS60 is an unissued draft for the same source and lacks service code; it was left unchanged. Already-consumed-source checks prevent another fiscal claim for it.

## Validation

Full LF checkout suite: 234 files, 2761 tests passed. A subsequent additional NFS-e availability variant passed with the targeted 34-test run. TypeScript, touched frontend lint, Edge syntax (46 files), production build, bundle and public-artifact checks passed.

Migration: 20260831161743_preserve_terminal_fiscal_receipts. Updated functions: hub-fiscal-proxy, cte-status-poll, nfse-status-poll. No credential rotation, new fiscal issuance, cancellation, or historical-document deletion.
