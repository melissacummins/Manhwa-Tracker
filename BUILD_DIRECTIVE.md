# Build Directive: Manhwa Tracker → Media Command Center

**Audience:** A Claude Code session (Sonnet-class model is sufficient) executing this document phase-by-phase. Read `AUDIT.md` first for background. Execute phases in order; each phase must pass its acceptance checks and be committed before the next begins. Do not improvise features not listed here — if something is ambiguous, ask the owner (Melissa) rather than guessing.

**Hard constraints (apply to every phase):**

1. **No AI/LLM calls at runtime, ever.** Metadata comes from AniList and TMDB. Do not add any `@google/genai`, OpenAI, or Anthropic runtime dependency.
2. **No new paid services.** Firebase free tier + AniList (free, keyless) + TMDB (free key) only.
3. **Never commit secrets.** The TMDB key lives in `.env.local` (gitignored). The Firebase service-account JSON used by the migration script must be gitignored (add `*service-account*.json` to `.gitignore` in Phase 0).
4. **Never delete or mutate the legacy `manhwas` Firestore collection.** Migration copies data to the new structure; the old collection stays untouched as a fallback until Melissa manually confirms and deletes it herself.
5. `npm run lint` (`tsc --noEmit`) must be green at every commit.
6. Keep the existing visual style (Tailwind v4, glass-card look, lucide icons, motion animations). This is a restructure, not a redesign.

**Known facts about the environment (verified during audit — do not re-derive):**

- Live Firestore: top-level `manhwas` collection, **1,525 docs** (verified via full export 2026-07-25), single user (UID `TKTZCY0gXMcfJB1EFI96W1VecuC3`). Plus `userSettings/{uid}` holding `statusConfig`. Status distribution: Dropped 898, Plan to Read 508, Completed 59, Reading 36, On Hold 24. 38 docs have `isFavorite: true`. No docs are missing `title` or `userId`.
- The Firestore database is **named**, not `(default)`: id `ai-studio-110b0610-559c-484a-878d-10cb79283d09` (see `firebase-applet-config.json`). Both the web SDK (already handled in `src/firebase.ts`) and **firebase-admin in the migration script must target this database id explicitly** — `getFirestore(app, '<that id>')` — or reads will silently return nothing.
- Live statuses are already clean: `Reading`, `Completed`, `On Hold`, `Dropped`, `Plan to Read`. No status remapping is needed.
- Owner's definition of favorite: *finished it and would reread it* → migration sets `wouldRevisit = isFavorite`.
- Live titles no longer contain `" / "` separators (an earlier cleanup split them into `alternativeTitles`). Keep the `" / "`-splitting rule in the migration anyway as a defensive no-op; slash **without** surrounding spaces (e.g. `1/24 Romance`) is part of a title — never split on it.
- 1,491 of 1,525 docs have `alternativeTitles` (5,914 strings total, max 10 per doc). **Some are corrupted fragments from the legacy AI comma-splitting bug** — verified examples: `"Father I Don't Want To Get Married"` carries alt `"Dad"` (from *"Dad, I Don't Want To Get Married"*), `"Hey Boss, I Am Your New Wife"` carries `"CEO"`, one title carries the fragment `"I"`. Many short/non-Latin alts are legitimate native-script titles (e.g. `"하이브"` for *Hive*) — never filter by length or script; the fix is the replace-on-match rule in §1.6 step 5.
- The `notes` field **stays**, both in data and UI (keep the existing textarea in the form). 3 live docs have real notes (e.g. *"This was cancelled 😭"*) — carry them verbatim.
- **17 duplicate pairs** exist under normalized-title comparison (all exactly ×2); dedupe (§1.6 step 4) must merge them and the report must list all 17.
- A verified full export (`manhwatrackerbackup1525items.json`, 2026-07-25) exists as the reconciliation baseline; the dry-run's input count must match it modulo items the owner adds after that date.
- `vite.config.ts` currently injects `process.env.GEMINI_API_KEY` via `define` — remove that in Phase 0. Use `import.meta.env.VITE_TMDB_API_KEY` for TMDB (Vite exposes `VITE_`-prefixed vars natively; no `define` needed).

---

## Phase 0 — Cleanup & safety

1. Remove Gemini entirely: `@google/genai` from `package.json`, the `fetchAltTitles` function and "AI Fetch Names" button in `App.tsx`, the `GEMINI_API_KEY` `define` in `vite.config.ts`, and the `GEMINI_API_KEY`/`APP_URL` entries in `.env.example` (replace with a commented `VITE_TMDB_API_KEY=` placeholder).
2. Remove unused dependencies: `express`, `dotenv`, `react-markdown`, `@types/express`, and `tsx` (verify nothing references them first). Run `npm install` to refresh the lockfile.
3. Delete the `testConnection()` function and its invocation in `src/firebase.ts` (it reads a doc the security rules deny, producing a console error on every load).
4. Rename the package from `react-example` to `media-command-center`.
5. Split `src/App.tsx` (741 lines) into:
   - `src/types.ts` — shared interfaces
   - `src/lib/utils.ts` — `cn()` helper
   - `src/components/Header.tsx`, `LoginScreen.tsx`, `StatsBar.tsx`, `MediaCard.tsx`, `MediaForm.tsx`, `SettingsModal.tsx`
   - `src/App.tsx` — state, listeners, layout only
   No behavior changes in this phase; pure extraction.
6. Add `*service-account*.json` and `backups/` to `.gitignore`.

**Acceptance:** app builds and behaves identically (minus the AI button); `tsc --noEmit` clean; `npm run build` succeeds; no `genai`/`GEMINI` string anywhere in `src/` or config.

---

## Phase 1 — Multi-media data model, covers, metadata APIs, migration

### 1.1 Data model

New Firestore layout (per-user subcollections):

```
users/{uid}/media/{itemId}
users/{uid}/settings/config
```

```ts
type MediaType = 'manhwa' | 'manhua' | 'manga' | 'webtoon' | 'anime' | 'movie' | 'tv';

interface MediaItem {
  id: string;                    // doc id
  mediaType: MediaType;
  title: string;                 // primary title only — never contains " / " separators
  alternativeTitles: string[];
  coverUrl: string | null;       // hotlinked from AniList/TMDB
  status: string;
  isFavorite: boolean;
  wouldRevisit: boolean;
  rating: number | null;         // 1–5, Phase 2 UI
  tags: string[];                // Phase 2 UI
  year: number | null;
  externalIds: { anilistId?: number; tmdbId?: number };
  notes: string;                 // free-text notes (existing textarea UI stays)
  createdAt: Timestamp;          // preserve original on migration; serverTimestamp() for new
  updatedAt: Timestamp;
}

interface UserConfig {
  statusConfig: Record<string, string>;  // status name → hex color (existing shape)
}
```

No `userId` field — ownership is the document path.

### 1.2 Security rules

Rewrite `firestore.rules`: keep the existing legacy `manhwas`/`userSettings` blocks **unchanged** (the old app data must stay readable), and add:

```
match /users/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Plus field validation on `users/{uid}/media/{id}` create/update mirroring the legacy rules but: `alternativeTitles` max 25 (AniList synonyms can be numerous), `mediaType` must be one of the seven values, `rating` null or 1–5, `tags` a list of max 20 strings.

### 1.3 Metadata clients (`src/lib/metadata.ts`)

**AniList** (manhwa/manhua/manga/webtoon/anime) — `POST https://graphql.anilist.co`, no auth:

```graphql
query ($search: String, $type: MediaType) {
  Page(perPage: 8) {
    media(search: $search, type: $type) {   # type: MANGA for comics, ANIME for anime
      id
      title { romaji english native }
      synonyms
      coverImage { large }
      startDate { year }
      countryOfOrigin        # KR → manhwa, CN → manhua, JP → manga (suggestion only)
      format                 # MANGA / NOVEL / ONE_SHOT — exclude NOVEL results
    }
  }
}
```

**TMDB** (movie/tv) — `GET https://api.themoviedb.org/3/search/movie` or `/search/tv` with `api_key=${import.meta.env.VITE_TMDB_API_KEY}&query=...`. Poster URL: `https://image.tmdb.org/t/p/w342${poster_path}`. Map `title`/`name`, `release_date`/`first_air_date` → year, `original_title`/`original_name` → alternative title when different.

Both clients return a common shape: `{ externalId, source: 'anilist'|'tmdb', title, alternativeTitles: string[], coverUrl, year, suggestedMediaType }`. Handle failures gracefully (offline/rate-limit → show "search unavailable, add manually").

### 1.4 Add/edit flow

In `MediaForm`: first a media-type selector (segmented control), then the title input with a **Search** button → debounced call to the right client → results rendered as a horizontal picker of cover thumbnails + title + year → selecting one fills title, alt titles, cover, year, externalIds (all remain editable). Manual entry (no search) must stay fully functional for obscure titles. Keep the existing duplicate warning, upgraded per §2.2 normalization.

### 1.5 List UI

- `MediaCard` gains a cover thumbnail (fixed-width, rounded, `object-cover`; neutral placeholder block with the type's icon when `coverUrl` is null).
- Add a **grid "shelf" view toggle** (cover-forward cards) alongside the existing list view; persist the choice in `localStorage`.
- Filter bar gains a media-type filter (All / per type). Stats bar counts respect the type filter.
- App reads/writes `users/{uid}/media`, ordered by title. Query needs no composite index (single-field order on a subcollection).

### 1.6 Migration script (`scripts/migrate.mjs`, plain Node + `firebase-admin`)

Run by the owner locally: `node scripts/migrate.mjs --dry-run` (default) and `node scripts/migrate.mjs --execute`. Requires `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account JSON (document in the script's `--help` how to generate one: Firebase console → Project settings → Service accounts → Generate new private key). **Must connect to the named database id listed above.**

Steps, in order:

1. **Backup:** dump the entire raw `manhwas` collection (and `userSettings`) to `backups/manhwas-<ISO date>.json` before anything else. Abort if backup write fails.
2. **Reconcile counts:** log total docs read vs. docs having a `title` field vs. docs having a `userId`. Any doc missing `title` or `userId` goes into the report's `needsAttention` list (the legacy app's query silently hides these).
3. **Title splitting:** split `title` on the exact separator `" / "` → first segment is `title`, remaining segments are appended to `alternativeTitles` (dedupe case-insensitively).
4. **Dedupe:** group docs by normalized title (lowercase, Unicode-normalize, strip punctuation, collapse whitespace), including cross-matches via alternative titles. Merge groups: union alt titles and tags, OR the favorite flags, keep the earliest `createdAt`, and keep the "most advanced" status by this precedence: `Completed > Reading > On Hold > Plan to Read > Dropped`. Log every merge in the report.
5. **AniList enrichment:** for each item, search AniList (type MANGA) by primary title. **Accept a match only if** a normalized title/synonym from the result exactly equals one of the item's normalized titles (primary or alternative). On match: **replace** `alternativeTitles` with the AniList set (romaji/english/native variants that differ from the primary title, plus `synonyms`; cap 25) — replacement, not union, is deliberate: most existing alts came from the buggy AI fetch and include comma-split fragments (`"Dad"`, `"CEO"`, `"I"`), and replacing drops the garbage while restoring authoritative names. Record every dropped pre-existing alt string in the report's `droppedAltTitles` map so the owner can restore any she added by hand. Also set `coverUrl`, `year`, `externalIds.anilistId`, and `mediaType` from `countryOfOrigin` (KR→manhwa, CN→manhua, JP→manga; anything else→manhwa). On no confident match: keep the item's existing titles and alts unchanged, `mediaType: 'manhwa'`, `coverUrl: null`, add to report's `unmatched` list. **Rate limit: max 1 request per 2.5 seconds** with exponential backoff on HTTP 429 (honor `Retry-After`). ~1,500 items ≈ 60–70 minutes; print progress every 25 items and write partial state so an interrupted run can resume (cache lookups in `backups/anilist-cache.json`).
6. **Field mapping:** `wouldRevisit = isFavorite`; `rating = null`; `tags = []`; preserve `createdAt`/`updatedAt`; carry `notes` verbatim (empty string when absent).
7. **Write:** batched writes (≤500/batch) to `users/{uid}/media`. Copy `userSettings/{uid}.statusConfig` → `users/{uid}/settings/config`. Old collections untouched (constraint 4).
8. **Report:** write `backups/migration-report.json` — counts in/out, merges performed, unmatched titles, needsAttention docs — and print a human-readable summary.

Dry-run mode performs steps 1–6 and the report, writing nothing to Firestore.

### 1.7 Import/export

Update export to the new schema (pretty-printed JSON, filename `command-center-backup-<date>.json`). Update import to: validate shape, dedupe against existing items via the §1.6-step-4 normalization (skip + report duplicates), and use batched writes.

**Acceptance for Phase 1:** dry-run report reconciles to the live doc count (1,525 as of 2026-07-25, plus anything added since) with zero unexplained losses; the 17 known duplicate pairs appear in the merge log; the 3 docs with notes carry them verbatim; `"Father I Don't Want To Get Married"`-class entries no longer carry fragment alts like `"Dad"` after a confident match; migrated app shows covers for the large majority of items; add-flow finds "Solo Leveling" (AniList) and "The Departed" (TMDB) with covers; a title containing commas round-trips through add/edit intact; legacy collection unmodified (verify by count).

---

## Phase 2 — Nostalgia & quality of life

1. **Vibe tags:** free-form tags on `MediaForm` (chip input with autocomplete drawn from the user's existing tags); tag filter chips in the list UI.
2. **Rating:** 1–5 star widget on card + form.
3. **Would-revisit toggle** on card + form (icon: `RotateCcw` or similar), independent of favorite.
4. **"Pick something nostalgic" button** in the header: selects a random item where `isFavorite || wouldRevisit`, weighted toward the least-recently-updated ones; presents it as a modal with the cover large, title, year, tags, and buttons: "Pick again" / "This one!". No AI involved — it's a weighted random pick.
5. **Smarter duplicate detection** in the add form: normalize as §1.6 step 4, compare both directions (new title vs. existing titles+alts, new alts vs. existing titles).
6. Cards with a non-empty note keep the existing "Has notes" indicator; notes remain editable in the form.

**Acceptance:** tags filter correctly; nostalgia button never returns an item lacking both flags; adding "Solo Leveling!" warns when "Solo Leveling" exists.

---

## Phase 3 — Future modules (OUT OF SCOPE — do not build)

Recipes and medications are future, separately-specced modules. Phase 1's only obligation to them: keep navigation/shell code structured so a new module = new subcollection + new route/section, touching nothing in `media`. The medications module, when specced, must be private-by-design: no external API or AI calls of any kind. Do not scaffold these now.

---

## Operator notes (for Melissa, not the build agent)

- Before running migration `--execute`: open the live app, note the "Total" stat, and take a fresh in-app JSON export as an extra backup.
- Needed once: a free TMDB API key (themoviedb.org → Settings → API) into `.env.local` as `VITE_TMDB_API_KEY=...`, and a Firebase service-account key file for the migration script (never committed).
- The Gemini API key should be revoked in Google AI Studio regardless (it is exposed in the currently-deployed bundle).
- Suggested build invocation per phase: `claude -p "Execute Phase N of BUILD_DIRECTIVE.md. Stop after acceptance checks pass and commit." --model sonnet` or one interactive session working through the phases with a commit per phase.
