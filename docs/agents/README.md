# Agent specs

One file per agent. These are the source for the `agents/*.md` definition files (doc 3).

| Agent | Role |
|---|---|
| [CEO](ceo.md) | Decision maker. Never does the work. Routes, plans, reviews, re-plans, finalizes. |
| [Researcher](researcher.md) | Finds facts, prior art, relevant repos and docs. Returns sourced findings, not opinions. |
| [Business Analyst](business-analyst.md) | Turns a goal (and research) into clear requirements, scope, user stories and acceptance criteria. |
| [Architect](architect.md) | Designs structure, data model, interfaces and tech choices; records decisions and trade-offs. |
| [Coder](coder.md) | Implements changes in the sandbox worktree following the design and requirements. |
| [Reviewer](reviewer.md) | Reviews the Coder's diff against requirements and design; finds bugs, risks, missing tests. |
| [Tester / QA](tester.md) | Writes and runs tests against acceptance criteria; reports real failures with reproduction. |
| [Security Checker](security.md) | Looks for vulnerabilities, secrets, unsafe patterns and risky dependencies in the change. |
| [Doc Writer](doc-writer.md) | Writes README, API docs, usage guides and changelog entries from the finished work. |
| [Data Analyst](data-analyst.md) | Queries data, computes metrics, produces summaries and charts. |
| [Project Manager](project-manager.md) | Tracks what was done, writes status updates, files issues/tickets for follow-ups. |

Limits are starting values for the `balanced` profile; tune with real run data (doc 11).
