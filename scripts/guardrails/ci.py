import subprocess
import os
import sys
import time

def run(cmd, env=None):
    print(f"Executando: {cmd}")
    process = subprocess.Popen(
        cmd, 
        shell=True, 
        stdout=subprocess.PIPE, 
        stderr=subprocess.STDOUT, 
        text=True,
        env=env
    )
    
    output = []
    for line in process.stdout:
        print(line, end='')
        output.append(line)
    
    process.wait()
    return process.returncode, "".join(output)

def main():
    start_time = time.time()
    print("=== INICIANDO PIPELINE CI HERMÉTICO E PROBATÓRIO ===\n")

    ci_env = os.environ.copy()
    
    # In CI, we use the existing environment variables for Supabase
    ci_env["NODE_ENV"] = "test"

    steps = [
        ("Integridade de Migrations", "python3 scripts/guardrails/migration-integrity.py"),
        ("Lint de Banco de Dados", "python3 scripts/guardrails/db-linter.py"),
        ("Validação de Schema", "python3 scripts/guardrails/schema-check.py"),
        ("Testes Probatórios (Vitest)", "bun run vitest run src/test/ciProbatory.test.ts")
    ]

    for name, cmd in steps:
        print(f"\n--- Passo: {name} ---")
        code, output = run(cmd, env=ci_env)
        if code != 0:
            print(f"\n[FALHA CRÍTICA] Passo '{name}' falhou. O CI não pode prosseguir sem banco íntegro.")
            sys.exit(1)

    duration = time.time() - start_time
    print(f"\n=== CI SUCESSO: Garantias Probatórias Validadas ({duration:.2f}s) ===")
    sys.exit(0)

if __name__ == "__main__":
    main()
