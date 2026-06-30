# Next.js Workspace Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Next.js/Aurora control-plane slice: an authenticated read-only workspace inventory dashboard for the current Incus workspace.

**Architecture:** Add a new `apps/web` Next.js App Router application beside the existing provisioning scripts. The web app reads identity from reverse-proxy/OIDC headers, calls a read-only provisioner interface, and renders an Aurora-styled dashboard without mutating Incus state.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, shadcn CLI, Aurora shadcn registry, Vitest.

## Global Constraints

- The existing `deploy.sh`, image build scripts, `/setup/`, and container runtime path must continue working unchanged.
- Aurora components and tokens must be installed with the shadcn CLI from `https://aurora.tootie.tv/r/...`.
- The web app must not call raw Incus mutation endpoints in this slice.
- The first inventory can use a deterministic local adapter when Incus is unavailable.
- No secrets, `.env` files, age keys, or user dotfiles may be committed.

---

### Task 1: Scaffold The Web App

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/eslint.config.mjs`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/vitest.config.ts`

**Interfaces:**
- Produces: `npm --prefix apps/web run dev`, `build`, `lint`, and `test`.
- Produces: App Router root at `/`.

- [ ] **Step 1: Create the Next.js app under `apps/web`**

Run:

```bash
npx create-next-app@latest apps/web --ts --tailwind --eslint --app --src-dir false --import-alias "@/*" --use-npm --yes
```

Expected: `apps/web/package.json` exists and `npm --prefix apps/web run lint` can start.

- [ ] **Step 2: Add Vitest**

Run:

```bash
npm --prefix apps/web install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Expected: dev dependencies are added to `apps/web/package.json`.

- [ ] **Step 3: Add a basic `test` script**

Update `apps/web/package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web package-lock.json package.json
git commit -m "feat(web): scaffold next app"
```

### Task 2: Install Aurora Through shadcn

**Files:**
- Create/modify: `apps/web/components.json`
- Create/modify: `apps/web/app/globals.css`
- Create: `apps/web/components/ui/*`
- Create: `apps/web/lib/utils.ts`

**Interfaces:**
- Produces: Aurora token layer and UI primitives imported from `@/components/ui/...`.

- [ ] **Step 1: Initialize shadcn in `apps/web`**

Run:

```bash
cd apps/web
npx shadcn@latest init --yes
```

Expected: `components.json` exists.

- [ ] **Step 2: Install Aurora tokens and dashboard primitives**

Run:

```bash
cd apps/web
npx shadcn@latest add https://aurora.tootie.tv/r/aurora-tokens.json
npx shadcn@latest add https://aurora.tootie.tv/r/aurora-button.json
npx shadcn@latest add https://aurora.tootie.tv/r/aurora-card.json
npx shadcn@latest add https://aurora.tootie.tv/r/aurora-badge.json
npx shadcn@latest add https://aurora.tootie.tv/r/aurora-separator.json
npx shadcn@latest add https://aurora.tootie.tv/r/aurora-tooltip.json
```

Expected: Aurora registry files are vendored into `apps/web`.

- [ ] **Step 3: Ensure dark Aurora shell**

Update `apps/web/app/layout.tsx` so `<html>` has `className="dark"` and fonts are loaded with `next/font/google`.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): install aurora registry components"
```

### Task 3: Add Identity And Workspace Inventory Domain

**Files:**
- Create: `apps/web/lib/auth/identity.ts`
- Create: `apps/web/lib/workspaces/types.ts`
- Create: `apps/web/lib/workspaces/provisioner.ts`
- Create: `apps/web/lib/workspaces/provisioner.test.ts`

**Interfaces:**
- Produces: `getActorFromHeaders(headers: Headers): ActorContext`
- Produces: `getWorkspaceInventory(actor: ActorContext): Promise<WorkspaceInventory>`

- [ ] **Step 1: Write tests for identity parsing and fallback inventory**

Create `apps/web/lib/workspaces/provisioner.test.ts` with assertions for:
- `x-auth-request-email` and `x-auth-request-preferred-username` produce actor email/display name.
- missing headers produce a local dev actor.
- inventory returns one `incus-web` workspace in development mode.

- [ ] **Step 2: Implement identity and workspace types**

Create exact domain types mirroring the v1 contract where needed: `ActorContext`, `WorkspaceState`, `WorkspaceSetupSummary`, `WorkspaceInventory`.

- [ ] **Step 3: Implement read-only provisioner**

Implement deterministic fallback data for this slice:

```ts
export async function getWorkspaceInventory(actor: ActorContext): Promise<WorkspaceInventory>
```

It returns the current `incus-web` workspace, owner identity from the actor, `state: "running"`, and setup checks as `"unknown"` when no live adapter is present.

- [ ] **Step 4: Run tests and commit**

```bash
npm --prefix apps/web run test
git add apps/web/lib
git commit -m "feat(web): add workspace inventory domain"
```

### Task 4: Render The Aurora Workspace Dashboard

**Files:**
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/components/workspace-dashboard.tsx`
- Create: `apps/web/components/workspace-dashboard.test.tsx`

**Interfaces:**
- Consumes: `getActorFromHeaders(headers())`
- Consumes: `getWorkspaceInventory(actor)`
- Produces: Dashboard cards for actor, workspace state, resources, setup, and terminal access.

- [ ] **Step 1: Write render test**

Create a React test that renders `WorkspaceDashboard` with fixture inventory and asserts:
- actor email is visible
- `incus-web` is visible
- setup status labels are visible
- terminal link text is visible

- [ ] **Step 2: Implement dashboard component**

Use Aurora `Card`, `Badge`, `Button`, and `Separator`; use Lucide icons for actions/status. Keep layout work-focused and dense.

- [ ] **Step 3: Wire `app/page.tsx`**

Read request headers with Next.js `headers()`, derive actor, fetch inventory, and render `WorkspaceDashboard`.

- [ ] **Step 4: Run lint/test/build and commit**

```bash
npm --prefix apps/web run lint
npm --prefix apps/web run test
npm --prefix apps/web run build
git add apps/web
git commit -m "feat(web): render workspace inventory dashboard"
```

### Task 5: Document And Verify

**Files:**
- Modify: `README.md`
- Modify: `docs/contracts/multi-tenant-control-plane-v1.md` if implementation notes require a non-breaking clarification.

**Interfaces:**
- Produces: local dev instructions for the web control plane.

- [ ] **Step 1: Document dev commands**

Add a README section:

```bash
npm --prefix apps/web run dev
npm --prefix apps/web run test
npm --prefix apps/web run build
```

- [ ] **Step 2: Final verification**

Run:

```bash
npm --prefix apps/web run lint
npm --prefix apps/web run test
npm --prefix apps/web run build
git status --short
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/plans/2026-06-30-nextjs-workspace-inventory.md
git commit -m "docs: add web control plane dev notes"
```

## Self-Review

- Spec coverage: This plan implements migration step 2 and the read-only half of migration step 3 without mutating host state.
- Placeholder scan: No TODO/TBD placeholders are required for implementation.
- Type consistency: `ActorContext`, `WorkspaceInventory`, and `getWorkspaceInventory` are defined before use.
