# Manhwa Tracker → Personal Command Center: Audit & Build Plan

**Date:** 2026-07-25
**Scope:** Audit of the existing Manhwa Tracker app, assessment of the "Command Center" expansion idea (movies, shows, covers, eventually recipes/medicines), tooling recommendation, and a phased build plan. The detailed build directive for the implementing model will be written after this plan is approved.

---

## Part 1: Audit of the current app

The app is a single-page React/Vite app with Firebase (Google sign-in + Firestore) and a Gemini API call for fetching alternative titles. It works, but has one confirmed bug, one real security problem, and several structural issues that matter for the expansion.

### 1.1 The alternate-names bug — root cause found

`src/App.tsx:545-549`:

```ts
contents: `List alternative names for the manhwa titled "${title}". Return ONLY a comma-separated list of names. ...`
// ...
const names = text.split(',').map(n => n.trim())...
```

The app asks Gemini for a **comma-separated list**, then splits on every comma. Any title that itself contains a comma — like *"XYZ, 123"* — gets chopped into two fake titles ("XYZ" and "123"). Exactly the behavior you observed.

The shallow fix is asking for JSON output instead. But the **real** problem is one level deeper: an LLM is the wrong tool for this job entirely.

Alternative titles for manhwa/manga are *facts that live in free public databases*. Asking a language model to recall them:
- costs money per request,
- can hallucinate names that don't exist,
- and requires fragile text parsing (which is what broke).

**Recommended replacement — the AniList GraphQL API:**
- Free, no API key required, generous rate limits.
- Returns structured JSON: romaji / English / native titles, a `synonyms` array, **and cover image URLs** — so this one change also delivers your cover-image feature for manhwa.
- No parsing step that can break. A title with forty commas in it comes back as one clean string in a JSON array.

For movies and TV, the equivalent is **TMDB (The Movie Database)** — free API key, returns posters, alternative titles, year, genres, etc.

### 1.2 Security: the Gemini API key ships to every visitor's browser

`src/App.tsx:542` reads `process.env.GEMINI_API_KEY` in client-side code. Vite bakes that value into the JavaScript bundle at build time, which means **anyone who opens dev tools on the deployed site can copy your Gemini key and run up usage on your account**. This is a common flaw in AI Studio-generated apps.

Moving metadata lookups to AniList/TMDB removes the Gemini dependency entirely, which fixes this by deletion — the cleanest kind of fix. (TMDB's key is also client-visible, but TMDB keys are free, rate-limited, and designed for client use, so the blast radius is essentially zero.)

### 1.3 No cover images

The data model (`Manhwa` interface, `src/App.tsx:54-64`) has no image field at all. We'll add `coverUrl` and populate it from AniList/TMDB at add-time. We store only the URL (hotlinking is explicitly supported by both services), so there's no image hosting cost.

### 1.4 Data model is manhwa-only and flat

Current structure: a top-level `manhwas` collection where every document carries a `userId` field. Issues:

- **Not extensible.** "manhwas" is baked into the collection name, the security rules, and every query.
- The `where('userId'...) + orderBy('title')` query requires a composite Firestore index; if it's missing, the list silently fails to load.
- Recommended shape for the Command Center:

```
users/{uid}/media/{itemId}     ← manhwa, manga, movies, TV, anime (shared shape)
users/{uid}/settings/config
users/{uid}/recipes/{id}       ← later, different shape
users/{uid}/meds/{id}          ← later, different shape, extra-locked rules
```

Per-user subcollections make security rules trivial (`request.auth.uid == uid` on the path), remove the composite index problem, and let each future module have its own schema instead of forcing everything into one.

### 1.5 Smaller code issues (worth fixing while we're in there)

| Issue | Location | Why it matters |
|---|---|---|
| Entire app in one 741-line file | `src/App.tsx` | Fine for v1, hostile to expansion. Split into components/modules. |
| JSON import writes docs one-by-one, no dedupe | `App.tsx:172-196` | Slow, and re-importing a backup duplicates every entry. Use batched writes + skip existing titles. |
| `new Date()` instead of `serverTimestamp()` | `App.tsx:185-187, 585, 594` | Timestamps depend on the device's clock. |
| Security rules cap `alternativeTitles` at 10 | `firestore.rules:47` | The AI-fetch merge can exceed 10, making saves fail with a confusing error. |
| Duplicate check is exact-match only | `App.tsx:560-573` | "Solo Leveling" vs "Solo Leveling!" slip past. Normalize punctuation/whitespace before comparing. |
| `testConnection()` reads a doc the rules deny | `firebase.ts:71-80` | Logs a scary console error for every user on every load. Delete it. |
| Unused dependencies: `express`, `dotenv`, `react-markdown`, `tsx`, `@types/express` | `package.json` | AI Studio template cruft. Package is still named `"react-example"`. |
| No tests, no lint beyond `tsc` | — | At minimum keep `tsc --noEmit` green; add a few unit tests around dedupe/normalization logic. |

### 1.6 Existing data is already corrupted

The comma bug means entries saved with AI-fetched names likely have **split fragments stored in Firestore right now** ("XYZ" and "123" as separate alt titles). Rejoining them programmatically is unreliable — we can't know which fragments belonged together. The right repair: a **one-off migration script** that re-queries AniList for each entry's main title and *replaces* the alternative-titles array with authoritative data (and adds the cover URL in the same pass). Free, deterministic, no LLM involved.

---

## Part 2: Audit of the Command Center idea

### What's solid

- **The core concept is good and appropriately scoped for personal use.** One place for "things I love," per-user data, free-tier infrastructure throughout. Firestore's free tier (50K reads/20K writes per day) is orders of magnitude beyond personal usage.
- **Manhwa + movies + shows belong together.** They share a shape: title, cover, status, rating, notes, tags. One `media` module with a `mediaType` field covers all of them — this is a small change, not a rewrite.
- **The nostalgia use-case suggests cheap, high-value features:** free-form "vibe tags" (`cozy`, `revenge-arc`, `cried`), a personal rating, a "would revisit" flag, and a **"Pick something nostalgic" button** that surfaces a random favorite you haven't touched in a while. All trivial to build once the data model supports it.

### Where it could go wrong

1. **The god-schema trap.** Recipes and medicines do *not* share a shape with media (ingredients/steps vs. dosage/schedule vs. chapters/seasons). If we design one universal "item" schema now to cover everything forever, it will be mediocre at all of it. **Recommendation:** build a modular shell — shared auth, navigation, search, and design system — where each module (Media now; Recipes, Meds later) owns its own collection, schema, and screens. Adding a module later means adding files, not migrating data.

2. **Medicines are sensitive health data.** Treat that module differently when we get to it: strictest security rules, **never** sent to any third-party API or AI model, and no metadata-lookup features. It should be a plain, private CRUD module. Worth deciding then whether it even belongs in the same app or in a second app sharing the shell.

3. **Scope creep is the main project risk.** Every module built "while we're at it" delays the ones you actually asked for. The plan below ships media tracking + covers first and explicitly defers the rest.

4. **Firebase lock-in is acceptable, not ideal.** Supabase (which you already use) would also work and offers SQL + easier export. But your data, auth, and rules already live in Firebase, it's free at this scale, and migrating adds a week of work for no user-visible benefit. **Recommendation: stay on Firebase.** Revisit only if a future module needs relational queries.

---

## Part 3: Tooling recommendation (the efficiency section)

Guiding rule, matching your instruction: **use the free deterministic tool wherever one exists; reserve AI for judgment, not lookup.**

| Job | Right tool | Cost | Why not AI |
|---|---|---|---|
| Manhwa/manga alt titles + covers | AniList GraphQL API | Free, no key | It's a database lookup. AniList is authoritative; an LLM guesses. |
| Movie/TV metadata + posters | TMDB API | Free key | Same reason. |
| Repairing existing corrupted alt-title data | One-off Python/Node script (run once by the build agent) | Free | Deterministic re-fetch and replace; nothing to "reason" about. |
| Building the app itself | Claude Code, **Sonnet-class model** | Cheapest capable tier | This is well-specified CRUD + API integration — a strong directive makes an expensive model unnecessary. `claude -p` headless per-phase, or one interactive session. |
| Runtime AI features in the app | **None** | $0/month | Removing Gemini fixes the key leak, the comma bug, and the ongoing bill in one move. |

The only place AI earns its keep at *runtime* would be a future "recommend me something based on my favorites" feature — and even that should be a deliberate later decision (with the key behind a server function, not in the browser).

---

## Part 4: Proposed build phases

**Phase 0 — Cleanup & safety (small)**
Remove Gemini + the exposed key; strip unused dependencies; delete `testConnection`; rename package; split `App.tsx` into modules; keep `tsc` green.

**Phase 1 — Media Command Center (the core ask)**
- New data model: `users/{uid}/media/{itemId}` with `mediaType` (`manhwa | manga | manhua | anime | movie | tv`), `coverUrl`, `rating`, `tags`, `wouldRevisit`, plus existing fields. Updated security rules.
- Add-flow: type a title → search AniList or TMDB (by media type) → pick the right match from a visual list with covers → title, alt titles, cover, year auto-fill. Manual entry stays available for obscure titles.
- Cover images on cards and a grid/"shelf" view.
- **Migration script:** moves existing `manhwas` docs into the new structure, re-fetches authoritative alt titles from AniList (fixing the comma-corrupted data), and attaches covers. Run once, with a dry-run mode and a JSON backup taken first.
- Import/export updated for the new model, with dedupe on import.

**Phase 2 — Nostalgia & quality of life (fast follow)**
Vibe tags with filtering; personal ratings; "Pick something nostalgic" random-favorite button; smarter duplicate detection (punctuation/whitespace-insensitive, checks alt titles both directions); status colors per media type if wanted.

**Phase 3 — Future modules (deferred, separate discussion each)**
Recipes module; medicines module (private-by-design, no external APIs); anything else. Each gets its own mini-spec; the Phase 1 shell is built so these bolt on without touching media data.

---

## Part 5: What happens next

1. You review this document and we adjust anything — tool choices, phases, features in/out.
2. On approval, I write the **build directive**: a precise, self-contained instruction document (data schemas, API query shapes, component structure, security rules, migration steps, acceptance checks) that a Sonnet-class Claude Code session can execute phase-by-phase without guessing.
3. Build proceeds phase-by-phase, each phase reviewable before the next starts.
