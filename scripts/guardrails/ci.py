import subprocess
import os
import sys
import time

def run(cmd, env=None):
    print(f"Executando: {cmd}")
    # Usamos shell=True para compatibilidade com pipes e redirecionamentos se necessário
    # Mas passamos env explicitamente para garantir hermeticidade
    process = subprocess.Popen(
        cmd, 
        shell=True, 
        stdout=subprocess.PIPE, 
        stderr=subprocess.STDOUT, 
        text=True,
        env=env
    )
    
    for line in process.stdout:
        print(line, end='')
    
    process.wait()
    return process.returncode

def main():
    start_time = time.time()
    print("=== INICIANDO PIPELINE CI HERMÉTICO E PROBATÓRIO ===\n")

    # Ambiente hermético: Não usa .env da aplicação
    ci_env = os.environ.copy()
    # Remove variáveis do Supabase se existirem no ambiente atual
    for key in list(ci_env.keys()):
        if "SUPABASE" in key:
            del ci_env[key]
    
    # Define variáveis para o banco efêmero (PGBOUNCER/POSTGRES LOCAL se disponível, 
    # ou simulação via Vitest + Mock/Database efêmero)
    ci_env["NODE_ENV"] = "test"
    ci_env["VITE_SUPABASE_URL"] = "http://localhost:54321" # Mock/Local
    ci_env["VITE_SUPABASE_PUBLISHABLE_KEY"] = "ci-test-key"

    steps = [
        ("Integridade de Migrations", "python3 scripts/guardrails/migration-integrity.py"),
        ("Lint de Banco de Dados", "python3 scripts/guardrails/db-linter.py"),
        ("Validação de Schema", "python3 scripts/guardrails/schema-check.py"),
        ("ESLint", "bun run lint"),
        ("TypeScript Check", "bun run typecheck"),
        ("Testes de Unidade e Integração (Vitest)", "bun run test"),
        ("Build de Produção", "bun run build")
    ]

    failed = False
    for name, cmd in steps:
        print(f"\n--- Passo: {name} ---")
        code = run(cmd, env=ci_env)
        if code != 0:
            print(f"\n[FALHA] Passo '{name}' retornou código {code}")
            failed = True
            break

    duration = time.time() - start_time
    if failed:
        print(f"\n=== CI FALHOU (Duração: {duration:.2f}s) ===")
        sys.exit(1)
    else:
        print(f"\n=== CI SUCESSO (Duração: {duration:.2f}s) ===")
        sys.exit(0)

if __name__ == "__main__":
    main()
