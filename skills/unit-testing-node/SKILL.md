---
name: unit-testing-node
description: Use when writing or running JavaScript tests with node:test and node:assert (no installs), including testing logic from a browser app by exporting its DOM-free functions.
---
# Unit testing with node:test

## Layout
- Tests live next to the code or in `tests/`, named `<module>.test.js` (e.g. `tests/cart.test.js`).
- Run all: `node --test` (finds `*.test.js`, `*-test.js`, `test/**` automatically). One file: `node --test tests/cart.test.js`.
- If there is no `package.json`, that is fine. If you add one, put `"scripts": { "test": "node --test" }`.
- Never install Jest, Mocha, Vitest or jsdom. `node:test` + `node:assert/strict` cover everything here.

## Make browser code testable (classic scripts, no build)
1. Move pure logic (calculations, parsing, validation, filtering, formatting) into functions that take
   arguments and return values. No `document`, `window` or `localStorage` inside them.
2. Keep DOM code (event listeners, rendering) in a separate part of `app.js` or in `ui.js`.
3. At the end of the logic file add a guard so the same file works in the browser and in Node:
   ```js
   if (typeof module !== "undefined") module.exports = { addItem, totalPrice, parseDate };
   ```
4. In the test: `const { addItem, totalPrice } = require("../app.js");`
5. If DOM code runs at load time, wrap it: `if (typeof document !== "undefined") { init(); }`.
6. Do not add `"type": "module"` to `package.json` in a browser-app folder: Node would then load `app.js` as an
   ES module and the guard above exports nothing. Pure Node projects that already use ESM: `export` + `import`.

## Test file template
```js
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { totalPrice } = require("../app.js");

describe("totalPrice", () => {
  test("sums price * qty", () => {
    assert.equal(totalPrice([{ price: 2.5, qty: 2 }, { price: 1, qty: 3 }]), 8);
  });
  test("empty cart is 0", () => {
    assert.equal(totalPrice([]), 0);
  });
  test("rejects negative qty", () => {
    assert.throws(() => totalPrice([{ price: 1, qty: -1 }]), /qty/);
  });
});
```

## What to test (per function)
- [ ] Normal case with realistic data.
- [ ] Empty input: `""`, `[]`, `{}`, `null`/`undefined` if callers can pass them.
- [ ] Boundaries: 0, 1, max length, first/last day of month, rounding (`0.1 + 0.2`).
- [ ] Invalid input: expected error (`assert.throws`) or expected fallback value.
- [ ] Text with Azerbaijani letters (ə, ğ, ı, ö, ş, ç, ü) if the code sorts, searches or changes case.
  Note `"I".toLowerCase()` is `"i"`, not `"ı"`; use `toLocaleLowerCase("az")` where the app expects it.
- [ ] Async code: `test("...", async () => { assert.equal(await load(), ...); })`; `assert.rejects` for errors.

## Useful asserts
`assert.equal` (strict ===), `assert.deepEqual` (objects/arrays), `assert.match(str, /re/)`,
`assert.throws(fn, /msg/)`, `assert.rejects(promise)`, `assert.ok(value)`.
For floats: `assert.ok(Math.abs(a - b) < 1e-9)`.

## Rules
1. One behaviour per `test`; the name says what is expected ("returns 0 for empty cart").
2. No network, no real time-dependent results: pass dates in as arguments instead of calling `new Date()` inside.
3. Tests create their own data; write temp files under `os.tmpdir()` and delete them in `after()`.
4. Do not weaken a test to make it pass. If code is wrong, fix the code; if unsure, report it.

## Report
Run `node --test` and quote the summary lines (`# pass N`, `# fail N`). For each failure give the test name,
expected vs actual, and whether you fixed the code or left it as an open issue.
