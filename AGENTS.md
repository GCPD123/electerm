# FiberTerm 项目协作说明

## 项目定位

FiberTerm 是基于 Electerm 二次开发的企业智能运维终端，面向 FiberHome 网络设备运维场景。项目复用 Electerm 已成熟的终端、SSH、SFTP、会话和跨平台能力，重点建设安全的 AI 运维闭环、企业知识接入和设备运维能力。

内部包名、应用身份和用户数据路径目前继续使用 `electerm`；`FiberTerm` 是展示层产品名称。不要在普通功能中修改应用 ID、协议名、配置目录或升级地址。

## 开始任何任务前

1. 阅读本文件。
2. 阅读 [docs/README.md](docs/README.md)，只打开与当前任务直接相关的文档。
3. 检查当前分支、工作区和目标分支起点，不覆盖用户已有修改。
4. 先说明需求理解、预计修改范围、明确不改的模块、风险和测试方案。
5. 除非用户已经批准实施，否则规划或研究任务不得修改产品代码。

不要为了恢复背景而全面扫描仓库。优先使用文档导航、精确搜索和与功能直接相关的源码。

## 强制开发原则

1. 一个明确功能使用一个 Codex 会话和一个 `codex/` 功能分支。
2. 功能分支默认从 `codex/smartterm-main` 创建；研究、品牌和其他未合并分支不得互相作为起点，除非方案明确要求。
3. 优先复用 Electerm 现有能力，减少对终端、SSH、SFTP、配置和更新核心的侵入。
4. 只修改确认范围内的文件，不顺手重构无关模块，不做全局替换。
5. 所有改动必须考虑 Windows；涉及 shell 时还要区分 PowerShell、cmd、Bash、SSH shell 和网络设备 CLI。
6. 修改前固定目标和边界；修改后审查完整差异，清理调试代码、临时脚本和格式噪声。
7. 至少执行与风险相称的针对性测试。核心终端、SSH、用户数据、安全策略和发布流程必须追加回归检查。
8. 测试失败必须区分代码回归与环境限制，不能静默忽略。
9. 用户验收前不合并到 `codex/smartterm-main`；未经明确要求不直接修改 `master`。
10. 功能完成后更新对应文档或决策记录，让后续会话依赖仓库事实而不是聊天记忆。

## AI 与命令执行安全边界

- AI 生成的命令、Ask 代码块、内置 Agent 和 MCP 变更型工具最终必须经过统一执行策略。
- Agent 授权档位只能改变网关的审批结果，不能绕过网关；自动执行必须有明确的会话、目标和风险范围。
- 未经用户明确批准或当前会话策略自动许可，不得向 PTY、SSH 会话或设备 CLI 写入命令。
- “替我审批”和“受控完全执行”仍受严重风险硬阻断、组织策略、目标变化、批量设备和凭据输入等安全底线约束。
- 提示词 guardrail 不是安全边界；黑白名单正则也不能单独承担完整安全控制。
- 涉及命令执行、SFTP 删除、批量设备、凭据或审计的修改，先阅读 [AI 命令执行研究](docs/research/ai-command-execution-study.md) 和 [ADR-002](docs/decisions/002-ai-execution-gateway.md)。

## Git 与上游

- `origin`：用户的 GitHub Fork，`GCPD123/electerm`。
- `upstream`：Electerm 官方仓库，`electerm/electerm`。
- `codex/smartterm-main`：当前产品集成主线。
- `codex/smartterm-base`：可复现的官方基线参考。
- `master`：Fork 的官方跟踪分支，不作为日常产品开发分支。

同步上游前阅读 [docs/upstream-strategy.md](docs/upstream-strategy.md)。不要用强制重置或未经审查的全量合并覆盖产品改动。

## 常用验证命令（Windows PowerShell）

- 启动开发环境：`npm.cmd start`
- 正式前端构建：`npm.cmd run build`
- 单元测试：`npm.cmd run test-unit-ci`
- 完整 E2E：`npm.cmd test`
- 代码规范：项目脚本使用 Unix 风格路径；Windows 下如失败，应调用项目内 Standard 的 Node CLI，并把缓存放在项目目录内，禁止全局安装依赖。

依赖已经由项目的 `package.json` 与 `package-lock.json` 管理。不要向系统或全局 npm 环境安装项目依赖。

## 完成交付格式

交付时说明：修改文件、关键逻辑、测试结果、已知限制、分支和提交。任何未执行的测试必须明确写出原因。
