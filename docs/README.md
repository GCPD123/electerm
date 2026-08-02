# FiberTerm 文档导航

新会话先读仓库根目录的 [AGENTS.md](../AGENTS.md)，再根据任务只读取下列相关文档。

| 文档 | 何时阅读 |
|---|---|
| [产品愿景](product-vision.md) | 判断需求是否属于 FiberTerm 产品范围 |
| [总体架构](architecture.md) | 设计跨模块功能或决定代码边界 |
| [开发路线图](development-roadmap.md) | 选择下一项工作、查看分支和阶段状态 |
| [上游同步策略](upstream-strategy.md) | 从 Electerm 官方同步更新或解决冲突 |
| [ADR-001：Fork 与分支策略](decisions/001-fork-and-branch-strategy.md) | 新建分支、合并、向官方贡献代码 |
| [ADR-002：AI 统一执行网关](decisions/002-ai-execution-gateway.md) | 开发 AI 命令执行、审批、安全或审计功能 |
| [AI 命令执行研究](research/ai-command-execution-study.md) | 需要源码级调用链和风险证据时 |

## 文档维护规则

- 长期有效的产品、架构和流程结论写入上述项目文档。
- 重大且难以逆转的选择新增 ADR；不要反复改写历史决策。
- 单个功能的需求、范围和验收标准放在 `docs/features/<feature-name>.md`，功能结束后同步实际状态。
- 临时调查过程不进入长期文档；只保留结论、证据和未决问题。
- 文档中的“已完成”必须能由 Git 提交或测试结果证明。
