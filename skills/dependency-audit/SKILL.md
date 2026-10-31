---
name: dependency-audit
description: Use when reviewing package.json, package-lock.json or requirements.txt offline for unpinned versions, unneeded packages, licence problems and typosquatting signs.
---
# Dependency audit (offline)

You have no network, so you cannot check live vulnerability databases. Say so in the report and audit what the
files themselves show. Never install, update or remove packages during the audit; propose changes instead.

## Steps
1. Find manifests: `package.json`, `package-lock.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile`.
2. Dump the direct dependencies (cross-platform):
   `node -e "const p=require('./package.json');for(const k of ['dependencies','devDependencies','optionalDependencies'])for(const [n,v] of Object.entries(p[k]||{}))console.log(k,n,v)"`
   `python -c "import re;[print(l.strip()) for l in open('requirements.txt',encoding='utf-8') if l.strip() and not l.startswith('#')]"`
3. Find which ones are actually used: search source for `require('<name>')`, `from '<name>'`, `import <name>`.
4. Run the checks below and write the report.

## Checks
**Pinning**
- npm: `^`/`~` ranges are normal when a lockfile is committed; `*`, `latest`, `>=`, git URLs or `file:` without a
  lockfile are findings. Lockfile missing or out of sync with `package.json` is a finding.
- Python: every line should be `name==x.y.z`. Bare names or `>=` only are findings for apps (fine for libraries).

**Unnecessary dependencies**
- Declared but never imported: remove.
- Replaceable by the standard library (Node 22 / Python 3): `node-fetch`/`axios` -> `fetch`; `uuid` -> `crypto.randomUUID()`;
  `rimraf`/`mkdirp` -> `fs.rm/mkdir({recursive:true})`; `dotenv` -> `node --env-file`; `left-pad`, `is-number` -> one line;
  `mocha`/`jest` for small projects -> `node:test`; `requests` for simple GETs -> `urllib.request`.
- Build/test tools listed under `dependencies` instead of `devDependencies`.

**Licences** (from `license` fields in `node_modules/<pkg>/package.json` or `package-lock.json`, if present)
- OK for most projects: MIT, ISC, BSD-2/3-Clause, Apache-2.0.
- Flag for the owner: GPL, AGPL, LGPL, SSPL, "UNLICENSED", missing licence. Do not give legal advice; just flag.
- If `node_modules` is absent, write "licence not verifiable offline" rather than guessing.

**Typosquatting and supply-chain signs**
- Names one letter off popular packages (`lodahs`, `expres`, `reqeusts`, `colourama`), extra hyphens or
  `-js`/`-node` suffixes on well-known names, scope mismatches (`@type/node` vs `@types/node`).
- `preinstall`/`install`/`postinstall` scripts in `package.json` or in a dependency's `package.json`.
- Lockfile `resolved` URLs not on `registry.npmjs.org`; `integrity` missing.
- Very new-looking versions (`0.0.1`) of packages that claim to be mature. Mark these as "suspect, verify", not proven.

**Known issues**
- Only mention a CVE or vulnerable version if you are certain; otherwise recommend the owner run `npm audit` or
  `pip-audit` on a machine with network access.

## Report format
```
## Dependency audit: <project>
Scope: direct deps from <files>; offline, no vulnerability database checked.
| Package | Version spec | Used? | Finding | Severity | Recommendation |
|---------|--------------|-------|---------|----------|----------------|
| axios | ^1.6.0 | 1 file | replaceable by fetch | low | remove, use fetch |
Summary: <n> deps, <n> unused, <n> unpinned, <n> licence flags, <n> suspect names.
```
Severity: **high** = suspect/typosquat name or install script from unknown source; **medium** = unpinned without
lockfile, copyleft licence in a closed product; **low** = unused or replaceable dependency.
Write the report in English; add an Azerbaijani summary line if the client communicates in Azerbaijani.
