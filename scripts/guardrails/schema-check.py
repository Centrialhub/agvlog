import subprocess
import os
import sys
import shutil
import time

def run_command(cmd, cwd=None, env=None):
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd, env=env)
    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
    return result

def check():
    print("Iniciando schema-check com banco efêmero...")
    
    # 1. Verificar se psql está disponível
    if run_command("psql --version").returncode != 0:
        print("Erro: psql não encontrado. Pulei execução real.")
        sys.exit(1)

    # 2. Criar banco efêmero (usando postgres local se disponível)
    # Em ambientes de CI, geralmente temos DATABASE_URL ou um postgres local
    db_name = f"tmp_schema_check_{int(time.time())}"
    
    # Tentativa de criar banco
    if run_command(f"createdb {db_name}").returncode != 0:
        # Se falhar, tenta usar o banco padrão e rodar em um schema separado
        print("Aviso: Não foi possível criar banco. Tentando schema efêmero no banco atual...")
        db_name = os.environ.get("PGDATABASE", "postgres")
        schema_name = f"tmp_schema_{int(time.time())}"
        setup_sql = f"CREATE SCHEMA {schema_name}; SET search_path TO {schema_name}, public;"
    else:
        schema_name = "public"
        setup_sql = ""

    # 3. Aplicar migrations em ordem
    migration_dir = "supabase/migrations"
    migrations = sorted([f for f in os.listdir(migration_dir) if f.endswith(".sql")])
    
    conn_str = f"dbname={db_name}"
    
    for m in migrations:
        path = os.path.join(migration_dir, m)
        print(f"Aplicando {m}...")
        # Aplicamos cada migration
        res = run_command(f"psql {conn_str} -v ON_ERROR_STOP=1 -f {path}")
        if res.returncode != 0:
            print(f"ERRO Real em {m}: Falha na execução SQL.")
            sys.exit(1)

    # 4. Validar se objetos críticos existem
    print("Validando objetos gerados...")
    check_query = "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';"
    res = run_command(f"psql {conn_str} -t -c \"{check_query}\"")
    tables = res.stdout.strip().split('\n')
    
    critical_tables = ["loads", "load_items", "dispatch_trips"]
    for t in critical_tables:
        if not any(t in line for line in tables):
            print(f"ERRO: Tabela canônica {t} não foi criada.")
            sys.exit(1)

    print("Schema check executado com sucesso em banco efêmero.")

if __name__ == "__main__":
    # Em ambientes sem postgres real acessível via 'createdb', falhamos explicitamente
    # para não dar "verde falso".
    check()
