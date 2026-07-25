# CLAUDE.md

Project guidance for Claude Code sessions in this repository.

## About this project

Personal "Media Command Center" (React + Vite + Tailwind v4 + Firebase) tracking
manhwa, manga, movies, and TV with cover images. Read `AUDIT.md` for background
and `BUILD_DIRECTIVE.md` for the build plan and hard constraints before making
changes. Key constraints: no AI/LLM calls at runtime (metadata comes from
AniList/TMDB), no new paid services, never commit secrets, never modify the
legacy `manhwas` Firestore collection.

## Cost rules — IMPORTANT

The owner is on a capped plan. Wasted tokens are real money.

- **NEVER schedule recurring self check-ins, wake-ups, or polling loops** —
  no `send_later` re-arming, no cron/Routine triggers, no `/loop`, no
  sleep-and-poll — unless Melissa explicitly asks for one in the current
  conversation. Each scheduled wake-up re-reads the entire conversation and
  has previously burned through her whole plan.
- For PR monitoring, rely solely on webhook events (`subscribe_pr_activity`).
  If a webhook seems to have been missed, wait for Melissa to say so — do not
  poll to compensate.
- One-shot reminders are fine only when explicitly requested, and must not
  re-arm themselves.

## Workflow conventions

- Verify before committing: `npm run lint` (tsc) and `npm run build` must pass.
- Work phase-by-phase per `BUILD_DIRECTIVE.md`; one PR per phase; a merged PR
  means approval to proceed to the next phase.
