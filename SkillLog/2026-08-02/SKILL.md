---
name: "2026-08-02"
description: Restore and apply the Adaptive Pannellum project context captured on 2026-08-02. Use when continuing, reviewing, debugging, documenting, or extending the sibling app project after its React/Vinext editor work, historical-photo import, pnpm migration, D1/R2 user system, workbench UI refinement, and Tencent SES email-verification integration.
---

# Adaptive Pannellum snapshot — 2026-08-02

Use this Skill as the handoff log for the sibling `../app` project. Treat the live source tree as authoritative when it differs from this dated snapshot.

## Restore context

1. Resolve the application root as `../app` relative to this Skill directory.
2. Read [references/change-log.md](references/change-log.md) before summarizing completed work or planning the next project phase.
3. Read [references/file-inventory.md](references/file-inventory.md) when auditing the exact worktree scope or distinguishing new files from pre-existing tracked files.
4. Read [references/architecture.md](references/architecture.md) before changing routes, rendering, persistence, authentication, or project ownership.
5. Read [references/operations-and-security.md](references/operations-and-security.md) before running the app, touching D1, changing passwords or Pepper, configuring Tencent SES, or handling credentials.
6. Inspect current files and `git status` before editing. Preserve all uncommitted user work; this snapshot was created from a dirty worktree.

## Continue development

- Preserve the current React 19 + Vinext + Vite + Cloudflare Worker architecture and pnpm workflow unless the user explicitly authorizes a migration.
- Keep D1 as the structured source of truth and R2 as blob storage. Keep project ownership and authorization checks server-side.
- Keep passwords one-way hashed with PBKDF2, per-password salt, and the configured server-side Pepper. Never silently change Pepper.
- Keep secrets only in ignored `.dev.vars` locally or hosted secrets. Never copy, log, quote, or commit real credentials.
- Keep phone verification deferred until the user explicitly starts that phase.
- Do not deploy unless the user explicitly asks; work had remained local as of this snapshot.

## Validate changes

Run checks from `../app` in proportion to the change:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Use `pnpm build` when a full test run is unnecessary but the application bundle must be verified. Report lint warnings separately from errors.
