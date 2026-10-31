---
name: readme-writing
description: Use when writing or updating a project README: what it is, quick start, usage, configuration and troubleshooting, every claim checked against the actual files.
---
# README writing

A README is a promise: every command in it must work in this workspace. Read before you write.

## 1. Gather facts first (do not guess)
1. List the files: `node -e "console.log(require('fs').readdirSync('.',{recursive:true}).filter(f=>!/node_modules|\.git[\\/]/.test(f)).join('\n'))"`
2. Read `package.json` (`scripts`, `bin`, `engines`), `pyproject.toml`/`requirements.txt`, entry files,
   `.env.example`, and any existing docs. Note the real script names, ports, env var names and defaults.
3. Find every config value the code reads: search for `process.env.`, `os.environ`, `argv`, config file names.
4. If something is unknown (licence, author, deploy target), leave it out or put it under **Open questions**
   in your report. Never invent badges, URLs, version numbers, users or benchmarks.

## 2. Structure (keep this order, drop sections that do not apply)
```markdown
# <Project name>
One or two sentences: what it does and for whom.

## Requirements
- Node.js 22 (or Python 3.x) - only what the code really needs.

## Quick start
1. `npm install` (only if package.json has dependencies)
2. `cp .env.example .env` (Windows: `copy .env.example .env`) and fill in values
3. `npm start` -> open http://localhost:3000

## Usage
Two or three real examples with the expected output.

## Configuration
| Variable | Default | Meaning |
|----------|---------|---------|
| PORT     | 3000    | HTTP port |

## Project structure
`src/` server code, `public/` static files, `test/` tests.

## Testing
`npm test`

## Troubleshooting
- **Port 3000 already in use** -> set `PORT=3001`.
```

## 3. Rules
- Quick start reaches a visible result in at most 5 steps. Show the shortest path first, options later.
- Give Windows equivalents where shell syntax differs (`copy` vs `cp`, `set VAR=1` / `$env:VAR=1` vs `VAR=1`),
  or prefer cross-platform `node`/`python` commands.
- Configuration table lists every env var / flag the code reads, with the default taken from the code.
  Never put real secret values in it; use placeholders like `your-key-here`.
- Troubleshooting lists only problems you actually hit or that the code explicitly handles (its error messages).
- Use relative links to files in the repo (`[docs](docs/setup.md)`); check that each target exists.
- If the audience is Azerbaijani, write the README in Azerbaijani (or add `README.az.md`) and keep the
  letters ə, ğ, ı, ö, ü, ç, ş correct; commands and code stay unchanged.

## 4. Verify before you finish
1. Run each Quick start and Testing command you wrote; fix the README (not the facts) if one fails.
2. Re-check every file path, script name and env var against the files.
3. Report: sections written, commands you ran with their result, and anything you could not verify.
