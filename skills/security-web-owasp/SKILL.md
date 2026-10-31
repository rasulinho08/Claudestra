---
name: security-web-owasp
description: Use when reviewing or hardening a small web app or Node/Python server for OWASP Top 10 issues (XSS, injection, auth, CSRF, secrets) and reporting findings with severity and fixes.
---
# OWASP web security review

Review only the code in the current workspace. Report what you can show from the code; never claim a vulnerability
you have not traced from an untrusted input to a dangerous sink.

## Steps
1. List entry points: HTTP routes, form handlers, query/URL params, file uploads, `postMessage`, `localStorage` reads.
2. List sinks: HTML output, shell, SQL, file paths, redirects, `eval`/`new Function`, deserialization.
3. For each input, follow it to a sink. If it arrives unvalidated and unescaped, that is a finding.
4. Search fast with a cross-platform one-liner, e.g.
   `node -e "const fs=require('fs'),p=require('path');(function w(d){for(const f of fs.readdirSync(d)){const x=p.join(d,f);if(f==='node_modules'||f==='.git')continue;if(fs.statSync(x).isDirectory())w(x);else fs.readFileSync(x,'utf8').split('\n').forEach((l,i)=>{if(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|exec\(|execSync|shell=True|os\.system|pickle\.loads|f\"SELECT|\+ *\"SELECT/.test(l))console.log(x+':'+(i+1)+': '+l.trim())})}})('.')"`
5. Walk the checklist below, then write the report.

## Checklist (OWASP Top 10 for small apps)
- **XSS (A03):** user text into `innerHTML`/`document.write` or unescaped templates. Fix: `textContent`,
  `createElement`, or an escape helper replacing `& < > " '`; set a `Content-Security-Policy` header.
- **Injection (A03):** SQL by string concatenation; `child_process.exec` / `os.system` / `subprocess(..., shell=True)`
  with input. Fix: parameterised queries (`?` placeholders in `node:sqlite`/`sqlite3`), `execFile`/`spawn` with an
  argument array, `subprocess.run([...])`.
- **Path traversal (A01):** `../` in file names. Fix: `path.resolve(base, name)` and check it starts with `base + path.sep`.
- **Broken access control (A01):** routes that change data without checking the user owns the resource; IDs taken
  from the client and trusted.
- **Auth failures (A07):** plain-text or fast-hash passwords (use `crypto.scrypt` / `hashlib.scrypt` with a random
  salt), no rate limit on login, session IDs from `Math.random` (use `crypto.randomUUID`), cookies without
  `HttpOnly; Secure; SameSite=Lax`.
- **CSRF:** cookie-authenticated POST/PUT/DELETE without a per-session token or `SameSite` cookie; state changes on GET.
- **Secrets / crypto (A02):** keys, tokens or passwords in source, client JS, or logs (see `secrets-hygiene`); HTTP
  instead of HTTPS for logins.
- **Misconfiguration (A05):** stack traces sent to clients, debug mode on, `Access-Control-Allow-Origin: *` with
  credentials, directory listing, missing `X-Content-Type-Options: nosniff`.
- **SSRF (A10):** server fetches a URL supplied by the user. Fix: allow-list hosts; block private IP ranges.
- **Outdated components (A06):** see `dependency-audit`.

## Severity
- **critical:** remote code execution, SQL injection, auth bypass, leaked live secret.
- **high:** stored XSS, CSRF on a state change, path traversal reading arbitrary files.
- **medium:** reflected XSS needing user interaction, missing rate limit, weak cookie flags.
- **low:** missing hardening headers, verbose errors, informational.

## Report format
```
## Security review: <scope>
| # | Severity | Category | File:line | Issue | Fix |
|---|----------|----------|-----------|-------|-----|
| 1 | high | XSS (A03) | public/app.js:42 | comment text set via innerHTML | use textContent |
Not checked: <what was out of scope or not runnable>
Verdict: block | fix before release | ok
```
Show the fixed code for every critical/high finding. If you fix it yourself, add a `node:test` or `unittest`
case proving the attack input (e.g. `<img src=x onerror=alert(1)>`, `' OR 1=1 --`, `../../etc/passwd`) is now
harmless. For Azerbaijani UIs, include non-ASCII input (`ə ğ ı ö ş ü ç`) in tests so escaping does not break it.
