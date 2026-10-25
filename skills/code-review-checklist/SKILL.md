---
name: code-review-checklist
description: Checklist for reviewing code produced in the workspace. Use when reviewing a coder's changes.
---
# Review checklist

Work top to bottom; stop adding findings once the verdict is clear.

1. **Does it do what was asked?** Compare against the client request and acceptance criteria.
2. **Does it run?** If Bash is available, run it or its tests; otherwise trace one realistic input by hand.
3. **Edge cases:** empty input, very large input, wrong types, missing files, unicode.
4. **Security:** untrusted input reaching shell, SQL, file paths or HTML.
5. **Clarity:** misleading names or structure that will cause the next bug.

Severity guide: **high** = wrong result or crash on normal use; **medium** = breaks on a realistic edge case;
**low** = everything else (does not block approval).
