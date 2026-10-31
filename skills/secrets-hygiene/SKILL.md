---
name: secrets-hygiene
description: Use when code, config, logs or reports might contain API keys, passwords or tokens: keep them out of source via .env and .gitignore, redact output, and respond if one leaked.
---
# Secrets hygiene

A secret is anything that grants access: API keys, passwords, tokens, private keys, connection strings with
passwords, signed URLs, session cookies. Never ask the user to paste one into the chat or a task file.

## Rules when writing code
1. Read secrets only from environment variables: `process.env.API_KEY` (Node), `os.environ.get("API_KEY")` (Python).
2. Fail clearly when missing: `if (!process.env.API_KEY) throw new Error("API_KEY is not set (see .env.example)")`.
3. Never put a real value in source, tests, fixtures, client-side JS/HTML, screenshots or commit messages.
   Use obvious placeholders: `API_KEY=your-key-here`.
4. Loading `.env` without installs:
   - Node 22: `node --env-file=.env app.js` (built in), or `process.loadEnvFile()` at startup.
   - Python: a 6-line parser: read lines, skip blanks and `#`, split on the first `=`, strip quotes,
     `os.environ.setdefault(k, v)`.
5. Ship `.env.example` with every variable name and a placeholder; never ship `.env`.
6. Make sure `.gitignore` contains at least:
   ```
   .env
   .env.*
   !.env.example
   *.pem
   *.key
   ```
7. Anything in browser code is public. A key needed by the front end must go through a server-side endpoint.

## Redaction in logs and reports
- Never log full request headers, env dumps, or config objects. Log the variable name and whether it is set.
- Mask when you must show one: keep the first 4 characters, e.g. `sk-a****` (or `****` for short values).
- Before handing over a report, diff or transcript, scan it (cross-platform):
  `node -e "const fs=require('fs');const re=/(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[bp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(password|secret|token|api[_-]?key)\s*[:=]\s*['\"][^'\"]{6,})/i;for(const f of process.argv.slice(1))fs.readFileSync(f,'utf8').split('\n').forEach((l,i)=>{if(re.test(l))console.log(f+':'+(i+1))})" file1 file2`
  Print only file and line, never the matching value.
- Error messages shown to users must not include stack traces with connection strings.

## Review checklist
- [ ] No literal secrets in source, tests, docs or sample data.
- [ ] `.env` ignored, `.env.example` present and current.
- [ ] No secrets in front-end bundles, URLs (query strings end up in logs) or error pages.
- [ ] Logs and reports redacted.

## If a secret leaked
1. Stop and report it immediately to the owner: what kind of secret, where (file:line, commit, log), since when.
   Do not repeat the value in the report.
2. The only real fix is **rotation**: the owner revokes it at the provider and issues a new one. Agents cannot and
   must not do this themselves.
3. Remove it from the working files and move it to `.env`.
4. If it was committed, deleting the line is not enough; history still holds it. Tell the owner history rewriting
   is needed only if the repo is shared, and that rotation is required either way.
5. Note follow-ups: check provider usage logs for misuse, add the pattern to the scan above.

Report template (English, or Azerbaijani if the client writes in Azerbaijani, e.g. "Gizli açar sızıb"):
`Leaked: <type> | Location: <file:line / commit> | Exposed to: <who could see it> | Action needed: rotate at <provider>`
