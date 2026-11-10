import assert from "node:assert/strict";
import { test } from "node:test";
import { boardSize, parseBoard } from "../src/missionBoard.ts";
import { changes } from "../src/notify.ts";

test("board.md becomes kanban columns (English and Azerbaijani headings, checkboxes)", () => {
  const b = parseBoard(`MISSION STATUS: ACTIVE
# Board
## Todo
- Research **Eramba**
- [x] Pick 5 tools
1. Write summary.md
## Gedir
* CISO Assistant
## Bitib
- Setup
## Blocked: needs owner
- Which price range? 
- none
`);
  assert.deepEqual(b.todo, ["Research Eramba", "Write summary.md"]);
  assert.deepEqual(b.doing, ["CISO Assistant"]);
  assert.deepEqual(b.done, ["Pick 5 tools", "Setup"]);
  assert.deepEqual(b.blocked, ["Which price range?"]);
  assert.equal(boardSize(b), 6);
  assert.equal(boardSize(parseBoard("just text\n- item without a section")), 0);
});

test("notifications fire for new approvals and finished missions only", () => {
  const a = (id: string) => ({ approvalId: id, runId: "r1", prompt: "task", tool: "Bash" });
  const m = (status: string) => ({ id: "m1", title: "GRC", status });
  assert.deepEqual(changes(null, { approvals: [a("1")], missions: [m("active")] }), [], "nothing on first load");
  const next = changes({ approvals: [a("1")], missions: [m("active")] }, { approvals: [a("1"), a("2")], missions: [m("done")] });
  assert.equal(next.length, 2);
  assert.equal(next[0]!.href, "#/runs?run=r1");
  assert.equal(next[1]!.href, "#/missions?id=m1");
  assert.equal(changes({ approvals: [], missions: [m("done")] }, { approvals: [], missions: [m("done")] }).length, 0);
});
