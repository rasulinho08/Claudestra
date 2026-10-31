---
name: git-hygiene
description: Use when committing work with git: small focused commits, clear messages, a sane .gitignore, and never committing secrets or build output. Works without a remote.
---
# Git hygiene

Git works fully offline. Never add a remote, push or change global config unless the task asks for it.

## Setup (only if the workspace is not a repo yet)
1. Check: `git rev-parse --is-inside-work-tree`. If it fails and the task wants git, run `git init`.
2. Do not set `user.name`/`user.email` globally. If a commit fails for a missing identity, report it,
   or set it only for this repo if the task allows: `git config user.name "Claudestra agent"`.
3. Create `.gitignore` before the first commit. Start from:
   ```
   node_modules/
   dist/
   build/
   coverage/
   __pycache__/
   *.pyc
   .venv/
   .env
   .env.*
   !.env.example
   *.log
   .DS_Store
   Thumbs.db
   ```
   Add anything the project generates (exports, caches, local databases).

## Before every commit
1. `git status` and `git diff --staged`: read what you are about to commit.
2. Stage files by name (`git add src/price.js test/price.test.js`), not `git add -A` blindly.
3. Check for secrets in the staged diff:
   `git diff --staged | node -e "const s=require('fs').readFileSync(0,'utf8');const m=s.match(/(api[_-]?key|secret|password|token)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY/gi);console.log(m||'no obvious secrets')"`
   Any hit: unstage it, move the value to `.env`, and see the secrets-hygiene skill.
4. No build output, dependencies, large binaries or generated files unless the task asks.
5. Run the tests; do not commit a red state unless the message says so ("WIP: failing test for ...").

## Small commits
- One logical change per commit: a feature, a fix, a refactor, a docs update. Not "everything from today".
- If the diff covers two things, commit them separately (`git add <file>` per group).

## Commit messages
```
Fix price parsing for comma decimals

parsePrice("1,50") returned NaN because only "." was accepted as decimal
separator. Now both are accepted; added a regression test.
```
- Subject: imperative, at most ~60 characters, no trailing period ("Add", "Fix", "Refactor", "Docs").
- Body (optional): what and why, wrapped around 72 characters; mention tests run.
- English by default; write in Azerbaijani only if the project's history already does. Keep the
  original spelling of Azerbaijani names and terms (ə, ğ, ı, ö, ü, ç, ş).

## If something went wrong
- Committed a secret: say so immediately. Removing it in a new commit does not erase it from history;
  the key must be rotated by its owner. Do not rewrite history unless the task asks.
- Wrong last commit, not shared yet: `git commit --amend` to fix message or add a missed file.
- Undo a shared commit safely: `git revert <hash>`; avoid `reset --hard` on work you did not create.

## Report
List the commits made (`git log --oneline -n 5`) and anything left uncommitted on purpose.
