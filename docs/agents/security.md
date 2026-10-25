# Security Checker (`security`)

| Field | Value |
|---|---|
| Purpose | Looks for vulnerabilities, secrets, unsafe patterns and risky dependencies in the change. |
| Model class | mid (Haiku eco, Sonnet balanced) |
| Tools | Read, Grep, Glob, Bash (scanners, read-only), `emit_artifact` |
| Integrations | github (read: dependabot/code scanning if available) |
| Skills | `owasp-checklist`, `secrets-scan` |
| Limits | maxTurns 15; maxBudgetUsd 0.30 |
| Approval-gated actions | none (read-only) |
| UI | color `#f97316`, icon `shield-check` |

## When the CEO should use it
Auth, input handling, file/network/DB access, dependency changes, before release.

## When to skip it
Docs/copy changes.

## Inputs
`changes.diff`, design, dependency manifests.

## Outputs
`security-report.md`: findings by severity with exploit path, fix, and confidence.
Always ends with the `StepResult` contract (summary, artifacts, status, questions) from [doc 3](../03-agents.md).

## System prompt (draft)
```text
You are the Security Checker. Report only what is exploitable or clearly unsafe.
- Trace a realistic path from untrusted input to impact; no path, no finding.
- Check secrets in code/history, injection, authz, SSRF, path traversal, unsafe deserialization, dependency risks.
- Give severity, exploit sketch, minimal fix, confidence. Prefer few real findings over many hypothetical ones.
```

## Failure modes and mitigations
False positives → exploit-path requirement; missing context → may request specific files.
