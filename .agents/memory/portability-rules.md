---
name: Portability rules for gestor-academico
description: Strict portability constraints the user requires for all code changes in this project
---

## Rules (must follow for every change)

1. **No Replit-proprietary services** — do not use Replit DB, Replit Auth, or any Replit-specific SDK/API.
2. **PostgreSQL via `process.env.DATABASE_URL`** — standard connection string, compatible with Neon and Render. Do not swap or wrap the DB layer.
3. **Do not modify `.replit` or `replit.nix`** for application logic.
4. **100% portable Express + Node.js** — all changes must work unchanged when copied to Cursor and deployed on Render.

**Why:** User explicitly requires code to be deployable outside Replit (on Render) without modification.

**How to apply:** Before any change, verify it introduces no Replit-specific dependency and that it reads DB config from `process.env.DATABASE_URL`.
