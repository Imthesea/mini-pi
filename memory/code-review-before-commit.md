---
name: code-review-before-commit
description: 提交前必须先展示代码给用户审查，用户同意后才能提交
metadata:
  type: feedback
---

每次写完代码后，**必须先展示改动内容给用户审查**，用户确认后**再** commit 和 push。

**绝对不能**跳过审查直接提交。

**流程：**
1. 写完代码 → 展示 diff 或关键文件内容
2. 对比 Pi 原项目，标注差异
3. 等用户说"提交" → commit + push

**Why:** 用户需要审查每一行代码，确保质量和对齐 Pi。
