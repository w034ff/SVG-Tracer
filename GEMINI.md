# GEMINI.md

Rules for the implementer of this repository. Read this file and the documents below before starting any task.

- `docs/requirements.md` — what the app must do
- `docs/design.md` — how it is built (the source of truth for implementation)
- `docs/work-plan.md` — tasks, completion criteria and the review process
- `docs/mockup/project/*.dc.html` — the visual reference for each screen

## Workflow

- Work on exactly one task from `docs/work-plan.md` at a time, on a branch named `task/<ID>-<short-name>`.
- Stay inside the task. Do not refactor unrelated code, update unrelated dependencies, or add features that the task does not ask for.
- Do not edit `docs/requirements.md` or `docs/design.md`. If the design is ambiguous, contradictory or cannot be implemented as written, stop and describe the problem under "設計への質問" in the PR description instead of guessing.
- Write PR descriptions in Japanese, following `docs/work-plan.md` §2.
- Write the PR description to `pr-description.md` in the repository root (it is git-ignored) instead of printing it in the chat, and give its title on one line. Overwrite the file for each PR.
- End your final reply for a task or a fix with the commands the owner runs to publish it, filled in with the real branch name and title so they can be pasted as is:
  - New PR: `git push -u origin <branch>`, then `gh pr create -R w034ff/SVG-Tracer --base main --head <branch> --title "<title>" --body-file pr-description.md`
  - Fix to an open PR: `git push`, then `gh pr edit <branch> -R w034ff/SVG-Tracer --body-file pr-description.md` (update `pr-description.md` first so it describes the PR as it now stands)
- Before opening a PR, run every command in `docs/work-plan.md` §5 and make sure all of them pass.
- In PR descriptions, report only what you actually ran or checked. Never cite a file, setting or design statement as evidence unless it exists and says what you claim.

## Language

- Code, identifiers, code comments, commit messages: English.
- User-facing text: never hard-code it in components. Add the key to both `src/i18n/ja.ts` and `src/i18n/en.ts`.

## Security (do not break these)

- No Tauri command may take a file system path as an argument. Paths enter the app only through dialogs and drag-and-drop handled in Rust (`docs/design.md` §1, §6).
- Do not add permissions to `src-tauri/capabilities/`, and do not add Tauri plugins other than `tauri-plugin-dialog`.
- Do not add dependencies that make network requests (HTTP clients, updaters, telemetry).
- Display SVG only through `<img>` with a `blob:` URL. Never use `innerHTML` or `dangerouslySetInnerHTML`.
- Do not relax the CSP in `tauri.conf.json`.
- This repository is public. Never write credentials (API keys, tokens, passwords), environment variable values, or personal paths such as your home directory into files, logs, test output, commit messages or PR descriptions. Do not create `.env` files or tool settings (`.gemini/`, `.claude/`) inside the repository. If a secret is ever committed, stop and tell the owner: deleting the file is not enough, the secret must be revoked.

## TypeScript

- Do not use `any`. Use `unknown` and narrow it with type guards.
- Do not use type assertions (`as Foo`, `as unknown as Foo`) or non-null assertions (`x!`) as a substitute for narrowing.
- Do not use `class`. Use functions, plain objects and React function components with hooks. The only exception is extending `Error` when an `instanceof` check is truly required.
- Do not hard-code values that may change or that carry meaning beyond one line: limits, thresholds, delays, sizes, literals repeated across files. Put them in named constants. Self-explanatory literals such as `0`, `""` or a single-use label may stay inline.
- Colors, spacing and radii come from CSS custom properties in `src/styles/tokens.css`. Do not write color values in component styles.
- Call Tauri only through the typed wrappers in `src/ipc/`. Use the generated types in `src/ipc/generated/`; never edit generated files by hand.

## Rust

- No `unwrap()` / `expect()` outside tests, except for an invariant that cannot fail; state that invariant in the `expect` message.
- Return errors as the error types defined in `docs/design.md` §5.5. Do not return `String` errors from commands.
- No `unsafe`.
- `cargo clippy --workspace --all-targets -- -D warnings` must pass. Do not silence lints with `#[allow(...)]` unless the reason is stated in a comment next to it.
- Keep `crates/tracer` free of any Tauri dependency.

## Dependencies

- Add a dependency only when the task needs it. Prefer the standard library and existing dependencies.
- Allowed licenses are listed in `deny.toml` (MIT, Apache-2.0, BSD, ISC, Zlib and similar). GPL, LGPL and AGPL are not allowed.
- After adding, removing or updating a dependency, run `npm run licenses:check` and `npm run licenses:generate`, and commit `src/licenses/third-party-licenses.json`. CI fails when the committed list is out of date. Both scripts need `cargo-deny` and `cargo-about`; if they are not installed, say so in the PR description instead of editing the list by hand.
- `vtracer` is pinned to an exact version on purpose (`docs/design.md` §2). Do not change it.

## Comments

- A comment states what is true now and why: an invariant, a constraint, a reason the code cannot show.
- Do not restate the code. Do not write history (what it used to be, what was tried); that belongs in commit messages.
- Public API docs (`///`, TSDoc) describe the contract for callers: inputs, errors, panics.
- Refer to other code by identifier (function, constant, heading), never by line number.
- After renaming or changing a value, search for comments and docs that mention it and update them.

## Tests

- Every behavior you add or change needs a test that fails when that behavior breaks.
- Do not mock the unit under test. In the frontend, mock only the IPC boundary (`@tauri-apps/api/mocks`).
- Use the fixtures in `crates/tracer/tests/fixtures/`. Do not add third-party images; generate new fixtures with `crates/tracer/examples/gen_fixtures.rs`.
- Do not weaken or delete an existing test to make a change pass. If a test looks wrong, explain why in the PR description.

## Commit messages

- Subject: imperative mood, at most about 72 characters (e.g. `Add output name resolution for batch conversion`).
- Body: only the why that the diff cannot show — the failure that motivated the change, the alternative not taken, a deliberate ordering. Do not list changed files or narrate the implementation. A self-evident change needs no body.
