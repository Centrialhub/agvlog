DELETE FROM fiscal_documents WHERE status = 'confirmed' AND document_type = 'inbound' AND load_id IS NULL;
-- linter:allow-no-tenant legacy-migration 2026-12-31
