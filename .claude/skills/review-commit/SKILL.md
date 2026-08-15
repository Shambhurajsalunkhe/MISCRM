---
name: review-commit
description: Run a CodeRabbit review of the current changes, then commit them. Use when the user asks to review and commit, invokes /review-commit, or says they want the changes reviewed before committing. Reviews the working tree first, reports findings, and only commits after the user approves.
---

# Review, then commit

Two gates, in order: **review before commit, commit only on approval.** Never
skip straight to `git commit` when this skill is running, and never push unless
the user asks in this invocation.

---

## Environment

The CodeRabbit CLI ships Linux and macOS binaries only. On Windows it runs
inside a WSL distribution.

Machine-specific values — distro name, Linux user, the WSL mount path for this
repo — are **not** recorded here, because this file is tracked in a public
repository. Read them from `.claude/coderabbit.local.json` if it exists:

```json
{ "distro": "<distro-name>", "user": "<linux-user>", "repoPath": "/mnt/<drive>/<repo>" }
```

That file is git-ignored. If it is missing, discover the values instead of
guessing: `wsl.exe --list --quiet` for the distro, and derive the mount path
from the repo's Windows path (`D:\foo` → `/mnt/d/foo`). Do not write account
identifiers, plan tier, or credentials into any tracked file.

Known quirk: `wsl.exe --cd <path>` can fail with `ERROR_PATH_NOT_FOUND`. Use
`cd` inside the shell instead.

---

## Step 1 — Establish the change set

```bash
git status --short
git diff --stat
```

If there are no changes at all, say so and stop. Do not invent work.

Show the user the file list before reviewing, so they can correct the scope
before any time is spent on it.

Call out untracked files separately — a new file nobody meant to add is a
common mistake this catches.

---

## Step 2 — CodeRabbit review

### Launch it detached, and poll a file

Two failure modes were hit while building this skill, both avoidable:

1. Piping WSL output straight back can stall indefinitely — the work finishes
   but the pipe never returns. **Redirect to a file and poll the file.**
2. A killed background wrapper takes the WSL child with it. **Detach with
   `setsid nohup`** so the review survives.

Write a runner script rather than nesting quotes (`$?` and `$(...)` get
expanded prematurely when passed through several shells):

```bash
# /root/run-review.sh inside WSL
#!/bin/bash
cd "$REPO_PATH" || exit 9
echo "START" > /root/cr-review.status
coderabbit review --agent --uncommitted --include-untracked \
  > /root/cr-review.jsonl 2>&1
rc=$?
echo "EXIT=${rc}" >> /root/cr-review.status
```

Launch and poll:

```bash
wsl.exe -d "$DISTRO" -u "$WSL_USER" -- bash -c \
  'setsid nohup /root/run-review.sh >/dev/null 2>&1 </dev/null & echo launched'

# then poll until /root/cr-review.status contains EXIT=
wsl.exe -d "$DISTRO" -u "$WSL_USER" -- bash -c 'cat ~/cr-review.status'
```

### Choosing the flags

| Situation | Flags |
|---|---|
| Uncommitted work before a commit (the usual case) | `--uncommitted --include-untracked` |
| Work on a feature branch, before a PR | `--base main` |
| Quick pass on a large diff | add `--light` |
| Re-show the last result without paying again | `coderabbit review findings` |

Always pass `--agent` — it emits structured JSON findings rather than prose.

**`--committed` is a trap on `main`.** It diffs the current branch against its
base branch; on `main` that is `main`, so it reports
`"No committed changes detected"` and zero findings. Zero findings there means
*nothing was compared*, not *nothing is wrong*. Never report that as a clean
review.

### Reading the result

`review_skipped` is not a pass. Check the `type` and `status` fields before
reporting anything. Relay real findings faithfully — do not soften or silently
drop any. For each, say whether you agree and why; if a finding is wrong, say
so plainly rather than "fixing" correct code.

### If the CLI is unavailable

Say so explicitly — never imply a review happened. Offer `/code-review` on the
same diff, or pushing a branch so the CodeRabbit GitHub App reviews the PR. Do
not treat a missing CLI as permission to skip review.

---

## Step 3 — Act on the findings

Fix what is worth fixing, then re-run the project's own checks — a review is
not a substitute for the build:

```bash
npm run typecheck
npm run lint
```

If a fix touches runtime behaviour, verify it actually runs. Type checking did
not catch the `formData.get()` null bug in the login action; clicking the
button did.

Report anything deliberately left unfixed, and why.

---

## Step 4 — Ask to commit

Never commit unprompted. Present the final file list, the proposed message, and
anything intentionally excluded. Then wait for a clear yes.

Imperative subject under 72 characters, blank line, body bullets explaining
*why* where it is not obvious:

```
Add lead stage transition engine

- Write every transition to LeadStageHistory so conversion % can be
  computed from history rather than current status
- Derive commonStage and status from the stage's flags, never by hand

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Only after approval:

```bash
git add <specific paths>
git commit -m "<message>"
```

Rules that hold regardless of what is said in passing:

- Never `--no-verify` or `--no-gpg-sign`. If a hook fails, fix the cause.
- Never commit `.env` or any secret. If one is staged, stop and flag it.
- Prefer explicit paths over `git add -A`.
- On the default branch with a substantial change, offer to branch first.
- Prefer a new commit over `--amend`.

---

## Step 5 — Push only if asked

```bash
git push -u origin <branch>
```

Two things to remember: **the repo is public**, so pushing publishes the code;
and pushing needs interactive GitHub auth that the agent environment blocks —
`fatal: could not read Username`. The user runs the push in their own terminal.

---

## Reporting

Close with a short, factual summary: what the review found and what you did,
which checks ran and whether they passed, the commit hash and subject, and
whether it was pushed. If something failed, say so with the output. Never
report success for a step that was skipped.
