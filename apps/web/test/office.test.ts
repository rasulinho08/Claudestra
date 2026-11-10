// Office floor logic (docs/17): places for tools, routes that keep to the aisles, and the simulation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CORRIDOR_Y, OfficeSim, layoutFor, placeFor, route, seatOf, spot } from "../src/office/floor.ts";
import { appendSpoken } from "../src/Mic.tsx";

test("tools send a worker to the right place", () => {
  assert.equal(placeFor("idle", null), "desk");
  assert.equal(placeFor("working", "Read"), "shelf");
  assert.equal(placeFor("working", "WebSearch"), "web");
  assert.equal(placeFor("working", "Bash"), "server");
  assert.equal(placeFor("working", "Write"), "desk");
  assert.equal(placeFor("working", "mcp__social__create_post"), "desk");
  assert.equal(placeFor("waiting", "Bash"), "boss");
  assert.equal(placeFor("working", null, true), "board");
});

test("routes move along one axis at a time and use the corridor", () => {
  const L = layoutFor(16);
  assert.equal(L.desks.length, 16);
  assert.ok(L.h > layoutFor(7).h, "more desks, taller floor");
  const from = seatOf(L.desks[9]!);
  const to = spot("shelf", 0);
  const path = route(from, to);
  let cur = from;
  for (const p of path) {
    assert.ok(p.x === cur.x || p.y === cur.y, "axis-aligned leg");
    cur = p;
  }
  assert.deepEqual(cur, to);
  assert.ok(path.some((p) => p.y === CORRIDOR_Y), "goes through the corridor");
  const back = route(to, from);
  assert.deepEqual(back[back.length - 1], from);
});

test("the simulation walks people to their place and back", () => {
  const sim = new OfficeSim();
  const team = (tool: string | null, status: "idle" | "working" | "waiting") => [
    { id: "ceo", isBoss: true, status: "idle" as const, tool: null },
    { id: "coder", isBoss: false, status, tool },
  ];
  sim.sync(team(null, "idle"), 0);
  const coder = sim.actors.get("coder")!;
  const home = { ...coder.home };
  assert.ok(sim.seated(coder));
  sim.sync(team("Bash", "working"), 100);
  assert.equal(coder.place, "server");
  assert.equal(sim.envelopes.length, 1, "work handed out");
  for (let i = 0; i < 400; i++) sim.step(0.1, 100 + i * 100);
  assert.deepEqual(coder.pos, spot("server", 0));
  sim.sync(team(null, "idle"), 50_000);
  for (let i = 0; i < 400; i++) sim.step(0.1, 50_000 + i * 100);
  assert.deepEqual(coder.pos, home);
  assert.ok(sim.seated(coder));
});

test("reduced motion: people jump to their place, no envelopes", () => {
  const sim = new OfficeSim(true);
  sim.sync([{ id: "a", isBoss: false, status: "idle", tool: null }], 0);
  sim.sync([{ id: "a", isBoss: false, status: "working", tool: "Read" }], 10);
  assert.deepEqual(sim.actors.get("a")!.pos, spot("shelf", 0));
  assert.equal(sim.envelopes.length, 0);
});

test("dictated words join what is already typed", () => {
  assert.equal(appendSpoken("", " salam "), "salam");
  assert.equal(appendSpoken("Hesabat yaz ", "bu həftə"), "Hesabat yaz bu həftə");
  assert.equal(appendSpoken("abc", "  "), "abc");
});
