---
name: code-review-before-commit
description: 提交前必须先让用户审查代码
metadata:
  type: feedback
---

每次实现完代码后，**必须先展示改动内容给用户审查**，用户确认后**再** commit 和 push。**绝对不能**跳过审查直接提交。

**Why:** 用户需要审查每一行代码，确保质量和方向正确。跳过审查导致 commit 历史混乱、代码无法追踪。

**How to apply:** 实现完代码 → 展示 diff/关键文件内容给用户 → 等用户确认 → commit + push。用户说了"提交吧"再提交。
