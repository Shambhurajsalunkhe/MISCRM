---
name: review-commit
description: Run a CodeRabbit review of the current changes, then commit them. Use when the user asks to review and commit, invokes /review-commit, or says they want the changes reviewed before committing. Reviews the working tree first, reports findings, and only commits after the user approves.
---

# Review, then commit

Two gates, in order: **review before commit, commit only on approval.** Never
skip straight to `git commit` when this skill is running, and never push unless
the user asks in this invocation.

---

## Step 1 — Establish the change set

```bash
git status --short
git diff --stat
```

If there are no changes at all, say so and stop. Do not invent work.

Show the user the file list before reviewing, so they can tell you the scope is
wrong before any time is spent on it.

Unstaged and staged changes are both in scope. Untracked files are in scope too,
but call them out separately — a new file nobody meant to add is a common
mistake this catches.

---

## Step 2 — CodeRabbit review

Detect the CLI first. Do not assume it is present:

```bash
coderabbit --version
```

### If the CLI is available

Run it against the working tree and wait for it to finish:

```bash
coderabbit review --plain
```

Relay its findings verbatim in substance — do not soften, summarise away, or
silently drop anything it flagged. For each finding, state whether you agree and
why. If you think a finding is wrong, say so plainly rather than fixing
something that was already correct.

### If the CLI is NOT available

Say so explicitly — do not pretend a review happened. As of this writing the
CodeRabbit CLI ships Linux and macOS binaries only, so on native Windows it will
be absent unless it is running under WSL.

Then offer the two working alternatives and let the user pick:

1. **`/code-review`** — the built-in reviewer, run against the same diff. No
   external account or network needed.
2. **PR-based CodeRabbit** — push a branch and open a pull request so the
   CodeRabbit GitHub App reviews it there. Needs the App installed on the repo
   and the `gh` CLI.

Do not choose for them, and do not treat "the CLI is missing" as permission to
skip review entirely.

---

## Step 3 — Act on the findings

Fix what is worth fixing. After any fix, re-run the project's own checks —
a review is not a substitute for the build:

```bash
npm run typecheck
npm run lint
```

If a fix touches runtime behaviour, verify it actually works rather than
assuming the type checker covered it. If a check fails, fix it before
proceeding; do not present a broken tree for commit.

Report anything you deliberately left unfixed, and why.

---

## Step 4 — Ask to commit

Never commit unprompted. Propose a message and wait for a clear yes.

Present:

- the final file list
- the proposed commit message
- anything intentionally excluded

Commit message format — imperative subject under 72 characters, a blank line,
then body bullets explaining *why* where it is not obvious:

```
Add lead stage transition engine

- Write every transition to LeadStageHistory so conversion % can be
  computed from history rather than current status
- Derive commonStage and status from the stage's flags, never by hand

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Then, only after approval:

```bash
git add <specific paths>
git commit -m "<message>"
```

Prefer naming paths explicitly over `git add -A`, so nothing unintended is
swept in.

Rules that hold regardless of what the user says in passing:

- Never use `--no-verify` or `--no-gpg-sign`. If a hook fails, fix the cause.
- Never commit `.env` or any secret. If one is staged, stop and flag it.
- If on the default branch and the change is substantial, offer to branch first.
- Prefer a new commit over `--amend`.

---

## Step 5 — Push only if asked

Do not push as a matter of course. If the user asks:

```bash
git push -u origin <branch>
```

Remember that **this repo is public** — pushing publishes the code. If the
change contains anything that looks sensitive, raise it before pushing rather
than after.

---

## Reporting

Close with a short, factual summary:

- what the review found, and what you did about it
- which checks you ran and whether they passed
- the commit hash and subject
- whether it was pushed

If something failed, say so with the output. Do not report success for a step
you skipped.
