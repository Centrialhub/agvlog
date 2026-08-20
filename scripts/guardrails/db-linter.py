import os
import re
import sys
from pathlib import Path

# Configuração de exceções (JUSTIFICATIVA OBRIGATÓRIA em docs/architecture/guardrail-exceptions.md)
EXCEPTIONS = {
    "migration_exceptions": [
        "20260309182129_212c0575-0f2c-4905-8c4d-1dac9e28a082.sql",
        "20260309182511_91470c3a-d566-4b7a-96bb-fab1a3bdb57f.sql",
        "20260309183833_654d98f0-c5b4-44f8-a618-6d32d00e181c.sql",
        "20260309185553_e1ff4909-ab9d-4b07-b852-4b3dd263cc5f.sql",
        "20260309190552_18c8f593-f7e2-44c1-a0a0-b401dfffb337.sql",
        "20260309191859_c8c2b7fd-e222-4751-a59a-a66c32b87ed3.sql",
        "20260310124912_c2f3595b-e187-4e82-acd3-1c6c84bcfc65.sql",
        "20260310144406_2d9cabc0-283f-42f1-8839-13e10fda8383.sql",
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
        "20260422193725_ea2d0eab-29fb-4110-92a9-811a7aa42730.sql",
        "20260422204346_c8f72015-3c0c-4e75-b43f-3d3c9e3d525f.sql",
        "20260508194926_47e98978-8af1-4262-aa20-677792f92036.sql",
        "20260513205838_72caf02d-48bd-468d-a894-eee45561139f.sql",
        "20260528153622_4671625e-787c-4cb8-b746-dbc155cea37e.sql",
        "20260528153724_4ea9c385-4525-40cd-bc7b-ad5922f8d12d.sql",
        "20260603182257_cef5ee34-be66-4552-b9b1-4afdbfa41cfc.sql",
        "20260603185447_0bc4813e-078a-461e-be22-d4241d72a805.sql",
        "20260707182042_f3f31ddd-0999-4bb9-a745-8d27baeda1c1.sql",
        "20260708171742_cb6cc8ce-6005-4918-9bd1-1bdfea909685.sql",
        "20260722051845_128dc900-4984-4179-bfab-25d0c84bee74.sql",
        "20260728151447_97074871-58a0-4d49-a364-c83ecda20b00.sql",
        "20260731204223_79e1cbdf-342e-4c5b-9f96-6647dd8b18a6.sql",
        "20260801003621_fe7bc03c-7101-4f43-9728-92e0dc7fd912.sql",
        "20260811195442_a1725f97-cfbc-4c01-99ad-3f38bc35cfec.sql",
        "20260811195918_1dddd31d-ad6c-4850-ac13-043133d0e171.sql",
        "20260812190658_c4cbd07a-4791-43fa-9a5f-61cec8237525.sql",
        "20260812191239_a9ed5296-9929-491d-a122-0aca72ef2b95.sql",
        "20260812201622_83200ed0-8bf9-463b-b48d-bea717cc29c1.sql",
        "20260813193538_4d8703c5-9ff2-4947-8fc4-d6e3ef96385f.sql",
        "20260813202445_4f7a6adb-252a-4123-bb6c-02bbbb4222e8.sql",
        "20260813202846_012d5ee1-62e0-4b98-ae4a-38b47d34d4a4.sql",
        "20260813204000_fix_empty_loads_cleanup.sql",
        "20260814193431_0cb767fa-f6c5-4842-b5b0-0baadae92920.sql",
        "20260814211821_c00874f1-f237-4871-8f4d-9f9315bb7f20.sql",
        "20260814212531_862852d0-fd64-4489-a69d-00e4630f30fb.sql",
        "20260815070209_da1a17dc-d2ad-48c1-a18c-798a87c6feba.sql",
        "20260815124300_1d12505c-4778-4977-9a20-3d9d45d38fc4.sql"
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
