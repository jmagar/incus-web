---
stack: general
review_agents:
  - code-simplicity-reviewer
  - security-sentinel
  - performance-oracle
  - architecture-strategist
plan_review_agents:
  - code-simplicity-reviewer
  - architecture-strategist
disabled_agents: []
---

<reviewer_context_note>
incus-web is currently a provisioning/control-plane prototype built from Bash, Node .mjs helpers, Incus profiles, distrobuilder image recipes, and operational docs. It is moving toward a Next.js application using the Aurora design system, but the current checkout does not yet contain a package.json or tsconfig. Preserve the working deploy/image path while moving host operations behind explicit contracts and multi-tenant boundaries.
</reviewer_context_note>
