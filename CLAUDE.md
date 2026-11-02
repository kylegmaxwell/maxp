# Project Overview & Architecture (`CLAUDE.md`)

## Stack & Hosting
- **Language/Build:** TypeScript + Vite, running on Node LTS (26, installed via `fnm`; see `WINDOWS.md`).
- **Hosting:** Static GitHub Pages project site.
- **URL Pattern:** `https://kylegmaxwell.github.io/maxp/`
- **Backend:** None. Serverless architecture using client-side code and browser `localStorage`.
- **Environment:** Windows / Git Bash / VS Code.

---

## Layout & Commands
```
index.html        # Vite entry (project root)
vite.config.ts
tsconfig.json
src/              # all application source (main.ts is the entry)
dist/             # build output (not committed)
```
- `npm run dev`: dev server with HMR
- `npm run build`: `tsc --noEmit && vite build` (Vite does not type-check on its own)
- `npm run preview`: serve the production build locally

Deployment: build with `npm run build` and publish `dist/` to GitHub Pages (GitHub Actions workflow).

---

## Tooling & CLI
- **GitHub CLI (`gh`):** Use for repo operations and PRs. Setup is in `WINDOWS.md`.
- **Pages:** Enable in the repo settings or via `gh api` (verify the exact call before documenting it here).

---

## Critical Development Constraints

### 1. Subpath Routing
- The site is hosted under `/maxp/`, not the domain root.
- `vite.config.ts` must set `base: '/maxp/'` (or `'./'`) so built asset URLs resolve.
- **Rule:** In hand-written HTML/CSS, never use root-absolute paths (`/style.css`). Use relative paths (`./style.css`).

### 2. LocalStorage Key Namespacing
- `localStorage` is scoped to the origin (`kylegmaxwell.github.io`), shared across the root site and all project repos.
- **Rule:** Prefix every key with `maxp_`. Access storage only through a single typed wrapper module in `src/` that enforces the prefix:
  ```typescript
  localStorage.setItem('maxp_key_name', JSON.stringify(data));
  ```

  ```