# 13. Stage: the robot view (second monitor & OBS)

An optional, playful view of a run: a little **Strativu robot** (the Strativu mark as its head on a slim hover body: tapered torso, glowing chest core,
outlined arms that swing, carry parcels and cheer, and a thruster flame instead of legs)
hops along a road between the agents' desks. It carries every handoff as a parcel, works next to the desk of
the agent that is busy and says what that agent is doing, waits with a "?" when something needs your approval,
and celebrates at the end of the road when the run is done.

It is driven by exactly the same events as the graph (doc 6), so it works live, for finished runs and in replay.

## Where to find it

| Place | How |
|---|---|
| In the run screen | The **Graph / Stage** switch above the canvas (your choice is remembered) |
| Pop-out window | The **↗** button next to the switch opens the current run in its own window |
| Second monitor, follows every new run | **▶ Stage window** (top right) opens `#/stage?run=live` |

Typical setup: main window on monitor 1 (prompt, approvals, inspector), stage window full-screen on monitor 2.

## URL options

`http://127.0.0.1:5173/#/stage?run=live&transparent=1&hud=0&fps=30&theme=dark`

| Option | Values | Default | Effect |
|---|---|---|---|
| `run` | `live` or a run id | `live` | `live` follows the running run, else the newest one |
| `transparent` | `1` | off | No sky or background: only road, desks and robot (for OBS overlays) |
| `hud` | `0` | on | Hide the text line (prompt, status, cost) in the corner |
| `fps` | 5–60 | 30 | Frame-rate cap; 15–20 is plenty for streaming |
| `theme` | `dark`, `light` | system | Force a colour scheme |

When the app is built and served by the server (`npm run build && npm start`), use port 8787 instead of 5173.

## OBS (streaming / recording)

1. Keep Claudestra running.
2. In OBS: **Sources → + → Browser**.
3. URL: `http://127.0.0.1:5173/#/stage?run=live&transparent=1&hud=0&fps=30`
   (drop `transparent=1` if you want the night-sky background).
4. Width 1920, height 1080. Leave "Custom CSS" empty; the page is transparent by itself.
5. Optional: tick "Shutdown source when not visible" so it costs nothing while hidden.

## Light on the computer

- Canvas 2D, no WebGL, no blur filters; the background (sky, hills, road) is drawn once into a cached layer
  and only redrawn when the layout or window size changes.
- Frame rate is capped (default 30 fps), device pixel ratio capped at 1.5, particles capped at 140.
- The browser pauses the animation automatically when the tab is hidden; `prefers-reduced-motion` turns hops
  and confetti off and drops to 15 fps.
- One robot and one desk per agent. Loop iterations (coder ⇄ reviewer) reuse the original desks instead of
  adding new ones.

## Desk workers (`apps/web/src/stage/workers.ts`)
Every desk has the agent's own small robot (in the agent's colour) that shows what it is doing right now.
`activityFor(agent, tool)` in `world.ts` picks the animation from the current tool, falling back to the role:

| Activity | When | Animation |
|---|---|---|
| search | WebSearch/WebFetch, Researcher | magnifier sweeping next to a small globe |
| read | Read/Glob/Grep | holds an open book |
| type | Write/Edit/Bash, Coder | types on a laptop with scrolling code |
| think / plan | no tool yet / CEO, PM, BA | thought bubble with dots / a lightbulb |
| paint | Designer writing | easel filling with colour |
| write | Doc Writer | pen drawing lines on paper |
| translate | Translator | letters turning into another alphabet |
| shout | Marketer | megaphone with sound waves |
| chart | Data Analyst | growing bar chart |
| test | Tester | flask with rising bubbles |
| scan / review | Security / Reviewer | shield with a scan line / clipboard ticks |
| blueprint | Architect | lines drawn on a blueprint |
| skill / call | Skill tool / MCP app | glowing book / antenna waves |

Moods (`moodFor`): waiting for approval raises a hand with a blinking "?", done shows happy eyes, failed shows
crossed eyes, not started yet dozes ("z"), skipped is faded.

## How the choreography works (`apps/web/src/stage/world.ts`)

| Event | What you see |
|---|---|
| CEO planning | Robot at HQ: "Planning the work…" |
| `step.started` | Robot hops to that agent's desk; the desk worker starts its job and the lamp pulses |
| `tool.called` | Speech bubble: "Researcher: searching the web", "Coder: writing a file", "asking github"… |
| `step.handoff` | Robot picks up a parcel in the sender's colour and delivers it; the road keeps a glowing trail |
| `step.approval_requested` | Desk shows a blinking "?", robot says "Waiting for your OK…" |
| `step.succeeded` / `failed` | Green check / red cross on the desk |
| `run.completed` | Robot hops to Delivery, confetti, "Done! $0.06" |

If events arrive faster than the robot can walk, older trips are dropped so it always catches up with the
present. Opening a finished run starts at Delivery; use **Replay** to watch the whole journey (16× takes a
few seconds).

## Why 2D and not Blender

A Blender/3D robot would need WebGL and a much heavier render loop for a view meant to run all day on a second
monitor. The 2D robot is drawn from the real Strativu mark (`stage/strativuMark.ts`, generated from
`strativu/tools/logo3d/mark.json`). A 3D version can later swap in behind the same `Director` (the
choreography is renderer-independent).
