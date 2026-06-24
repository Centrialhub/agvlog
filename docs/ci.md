# CI commands (AGVLog)

This project uses **Bun** as its package manager (`bun.lockb` is the source of truth).

| Step    | Command                              |
| ------- | ------------------------------------ |
| Install | `bun install --frozen-lockfile`      |
| Lint    | `bun run lint`                       |
| Test    | `bun run test`                       |
| Build   | `bun run build`                      |
| Dev     | `bun run dev`                        |

Do not commit `package-lock.json` — only `bun.lockb`.