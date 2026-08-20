import os
import re
import sys
from pathlib import Path

# Configuração de exceções (JUSTIFICATIVA OBRIGATÓRIA em docs/architecture/guardrail-exceptions.md)
EXCEPTIONS = {
    "migration_exceptions": [
        "20260309182129_212c0575-0f2c-4905-8c4d-1dac9e28a082.sql", 
        "20260309182511_91470c3a-d566-4b7a-96bb-fab1a3bdb57f.sql",
        "20260312144618_f3b6600a-5b2f-4142-bb63-e91f868c2eb0.sql",
        "20260323203909_c1545a12-7b34-4a2c-ac63-7f924be1bb50.sql",
        "20260406155309_a071f5ca-ca8d-4d36-b046-e8fadae822bb.sql",
        "20260415181652_07bfcb79-4829-4e18-b5dc-561137bb140e.sql",
        "20260415195748_4355d97d-649d-41af-bf35-556e53d9c6e6.sql",
        "20260415205657_3d9cb892-5416-4c15-a5cf-b969df7bc81c.sql",
        "20260416022445_d3f87a2b-37e7-412a-aa9e-5fab8e3d112f.sql",
        "20260416190448_498ebe04-9ee4-48d1-84e6-732f074cfe4c.sql",
        "20260416191748_c4508d96-0233-42af-b91b-5667487a129e.sql",
        "20260416202458_f2ab7cc6-7204-47a8-badc-48e3c3153e41.sql",
        "20260416203001_21e1a14a-10b8-4fea-8b5f-8892f639cf8f.sql",
        "20260416203803_d3880667-bf7d-4f08-8e3c-25e18c8815b4.sql",
        "20260422181812_a6ca96ff-eb1e-43b7-a1a7-2eb02e4025ae.sql",
        "20260707182042_f3f31ddd-0999-4bb9-a745-8d27baeda1c1.sql",
        "20260813193538_4d8703c5-9ff2-4947-8fc4-d6e3ef96385f.sql",
        "20260813202445_4f7a6adb-252a-4123-bb6c-02bbbb4222e8.sql",
        "20260813202846_012d5ee1-62e0-4b98-ae4a-38b47d34d4a4.sql",
        "20260813204000_fix_empty_loads_cleanup.sql"
    ],
    "rls_bypass": ["profiles"],
}

def check_migrations():
    """Valida se migrations históricas possuem DML sem tenant_id"""
    print("Checking migrations integrity...")
    migration_dir = Path("supabase/migrations")
    for sql_file in migration_dir.glob("*.sql"):
        fname = sql_file.name
        if fname in EXCEPTIONS["migration_exceptions"]:
            continue
        content = sql_file.read_text()
        if "INSERT INTO" in content or "UPDATE" in content or "DELETE FROM" in content:
            # Skip DML on public/admin/auth/telemetry tables
            if any(t in content for t in ["integration_accounts", "tenants", "audit_logs", "user_roles", "auth.", "positions_last", "positions_raw"]):
                continue
            # Check if it has tenant_id or a bypass comment
            if "tenant_id" not in content.lower() and "-- linter:allow-no-tenant" not in content:
                print(f"Error: DML without tenant_id in {fname}")
                return False
    return True

def check_security_definer():
    """Verifica SECURITY DEFINER sem search_path"""
    print("Checking SECURITY DEFINER functions...")
    migration_dir = Path("supabase/migrations")
    pattern = re.compile(r"SECURITY DEFINER", re.IGNORECASE)
    search_path_pattern = re.compile(r"SET search_path", re.IGNORECASE)
    
    for sql_file in migration_dir.glob("*.sql"):
        fname = sql_file.name
        if fname in EXCEPTIONS["migration_exceptions"]:
            continue
        content = sql_file.read_text()
        if pattern.search(content) and not search_path_pattern.search(content):
            if "-- linter:allow-no-search-path" not in content:
                print(f"Error: SECURITY DEFINER without search_path in {fname}")
                return False
    return True

def check_frontend_direct_writes():
    """Detecta escrita direta do frontend em estados canônicos (Source of Truth)"""
    print("Checking frontend direct writes to SoT...")
    canonical_tables = ["loads", "load_items", "dispatch_trips", "dispatch_stops", "fiscal_documents"]
    src_dir = Path("src")
    
    for ts_file in src_dir.glob("**/*.tsx"):
        content = ts_file.read_text()
        if "// guardrail:allow-direct-write" in content:
            continue
            
        for table in canonical_tables:
            # Detect .from('table') followed by an action, ignoring whitespace
            collapsed = content.replace("\n", "").replace("\r", "")
            pattern = rf"\.from\(['\"]{table}['\"]\)(?:\.|\s)*?(?:update|insert|delete)\("
            if re.search(pattern, collapsed):
                print(f"Error: Direct write to canonical table '{table}' detected in {ts_file}")
                return False
    return True

if __name__ == "__main__":
    success = True
    if not check_migrations(): success = False
    if not check_security_definer(): success = False
    if not check_frontend_direct_writes(): success = False
    
    if not success:
        sys.exit(1)
    print("Guardrails passed!")
