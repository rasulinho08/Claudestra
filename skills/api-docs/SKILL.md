---
name: api-docs
description: Use when documenting functions, CLI commands or HTTP endpoints, with parameters, errors and real request/response examples taken from the code.
---
# API docs

Document what the code does, not what you think it should do. Every example must come from running it
or from reading the exact code path.

## 1. Collect the surface
1. Functions: exported names (`module.exports`, `export`, `__all__`, public `def`), their parameters,
   return values and thrown errors.
2. CLI: argument parsing (`process.argv`, `util.parseArgs`, `argparse`), flags, defaults, exit codes.
3. HTTP: every route (`app.get(`, `router.post(`, `if (req.url ===`, `@app.route`), method, path params,
   query, body fields, status codes, auth requirement.
4. Make a list first; document each item in the same format. Anything internal stays out.

## 2. Format per item
### Function
~~~markdown
### `parsePrice(text: string): number`
Parses a price like "1,50" or "1.50" into a number.
| Param | Type | Required | Notes |
|-------|------|----------|-------|
| text  | string | yes | Comma or dot decimal |
**Returns** number. **Throws** `TypeError` if `text` is not a string.
```js
parsePrice("1,50") // 1.5
```
~~~
### CLI command
```markdown
### `node cli.js convert <input> [--out <file>]`
| Flag | Default | Meaning |
|------|---------|---------|
| --out | stdout | Output file |
Exit codes: 0 ok, 1 bad input, 2 file not found.
Example: `node cli.js convert data.csv --out data.json` -> writes 12 records.
```
### HTTP endpoint
```markdown
### `POST /api/items`
Creates an item. Auth: none.
Body (JSON): `{ "name": "milk", "qty": 2 }` - `name` required string, `qty` integer >= 1 (default 1).
Responses: `201` created item, `400 { "error": "name is required" }`.
```
Show the request as a cross-platform one-liner:
`node -e "fetch('http://localhost:3000/api/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'milk',qty:2})}).then(r=>r.text()).then(console.log)"`
(plain `curl` quoting differs on Windows, so prefer this).

## 3. Rules
- Get real outputs: start the server or call the function and paste what came back. If you could not run
  it, mark the example "(from code, not executed)".
- Document every error response or thrown error the code can produce, with its exact message.
- Use placeholder tokens (`<your-token>`) for auth; never paste real keys.
- One file is enough for small projects (`docs/api.md`); link it from the README.
- If an Azerbaijani version is requested, translate descriptions only; keep names, paths, JSON keys and
  codes unchanged.

## 4. Report
List of items documented, which examples were executed, and gaps or inconsistencies found in the code
(e.g. "DELETE /api/items/:id returns 200 with no body; 204 would be usual").
