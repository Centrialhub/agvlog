# Recipient IE prevention — 2026-08-31

The 45-operation batch was reconciled against existing Hub documents: 38 authorized and 7 rejected. All 38 source invoices were consumed by their matching CT-e; all 7 rejected sources remained unconsumed. No unresolved CT-e remained for the emitter.

Exactly one of the 45 requests omitted recipient IE. Its matched customer was classified as an ICMS contributor but had a null state_registration. The import report counted IE as present for all 44 source XMLs in that import. The normalization path can discard invalid-length IE values without retaining the raw value or reporting review when XML confidence is high. The original value for the affected invoice was not available, so it was not invented or replaced with another customer's IE.

Changes:
- Carry contributor classification only from the exact matching taxpayer record into CT-e preview validation.
- Block a known contributor with missing, unknown, exempt or invalid-length IE before transmission. Validate the effective edited party and preserve explicit valid corrections, including leading zeroes.
- Preserve recipient CNPJ, raw IE, indicator and UF in invoice import metadata in all three save paths.
- Report invalid/unreadable IE for review even for high-confidence XML imports.

Validation: 70 focused tests passed; TypeScript, targeted implementation lint, production build, bundle and public-artifact checks passed. No fiscal document was emitted. Correcting the existing customer still requires the source XML or confirmed IE for its exact CNPJ.
