# FiberTerm 真机验证问题清单与 RAG 优化整改方案

> 状态：实施规格（基于 2026-08-03 首轮真机日志）
>
> 适用基线：`codex/fiberterm-mvp-integration`
>
> 建议实施分支：`codex/rag-real-device-context`
> 原始日志：仅本地保留，不提交 Git，不导入 RAG

## 1. 结论

首轮真机测试证明现有 FiberTerm 已经具备可用的 SSH、FiberHome 知识检索、Ask 回答和 Agent 只读执行闭环，但也暴露出一个比“继续增加文档数量”更优先的问题：**系统能查到命令，却还不能可靠判断命令应该在哪一层 CLI 中执行，也不能可靠判断分页输出是否真正完成。**

真实操作链不是单层 SSH，而是：

```text
SSH 连接
  -> Linux 维护 Shell
    -> FiberHome ACE 普通 CLI
      -> ACE diagnose 诊断 CLI
```

因此下一轮优化应收敛为“真机会话上下文加固”，而不是扩展成新的大模块。核心目标是：

1. 在提交 Ask/Agent 请求时固定目标终端和 CLI 上下文快照；
2. 用当前 CLI 模式约束 RAG 检索和 Agent 只读执行；
3. 识别分页、密码提示和未知状态，避免把半页输出或等待输入误判为完成；
4. 将“只读但敏感”的命令与普通状态查询区分；
5. 保持 Ask 非自主执行、Agent 才可执行的既有产品边界。

## 2. 证据范围与隐私边界

本报告只使用真机日志的脱敏事实，不记录以下内容：

- 设备 IP、真实主机名、账号或密码；
- 板卡序列号、管理地址、完整配置和告警对象标识；
- 原始终端日志全文。

原始日志不得：

- 提交到 Git；
- 直接导入 RAG；
- 放入普通单元测试 fixture；
- 整段发送给云端模型。

允许进入仓库的测试数据必须是人工重写的最小脱敏 fixture，只保留提示符形态、代表性命令、分页标识和虚构回显。

## 3. 真机测试事实

### 3.1 已验证能力

- Electerm 可通过 SSH 连接真实设备的维护系统；
- 可从维护 Shell 进入 FiberHome ACE CLI；
- ACE CLI 能正常执行时钟、路由邻居、电源、风扇、温度、活动告警、运行配置和业务状态查询；
- 可进入 `diagnose` 子模式并运行诊断查询；
- 终端日志能保存当前滚动缓冲区并继续记录后续输出；
- 现有产品形态已经足以支撑“真实设备 + RAG + Ask/Agent”的 MVP 演示。

### 3.2 不能从单次日志直接得出的结论

日志中出现的自由运行、无邻居、活动严重告警、板卡状态差异等只能视为观测事实。由于缺少测试拓扑、预期业务、端口接线、设备版本和正常基线，AI 不得直接将其判定为设备故障。

推荐的回答结构为：

```text
观测事实 -> 可能含义 -> 当前缺少的上下文 -> 建议核查步骤
```

## 4. 问题清单与优先级

| ID | 优先级 | 问题 | 真机证据 | 风险/影响 | 整改方向 |
|---|---|---|---|---|---|
| RT-P0-01 | P0 | 缺少 CLI 会话上下文 | 同一 `show` 命令在 Linux Shell 失败，在 ACE CLI 成功 | RAG 命令正确但执行位置错误 | 新增纯函数式终端上下文识别，区分 Linux、ACE、ACE diagnose、未知 |
| RT-P0-02 | P0 | Agent 只校验“只读 + 有证据”，未校验当前模式 | `show` 前缀可通过现有策略，但当前终端可能仍是 Linux Shell | 自动执行失败，模型可能继续错误修复 | 执行前要求目标固定、上下文可靠、命令视图与当前 CLI 兼容 |
| RT-P0-03 | P0 | 4 秒静默不等于命令完成 | 多个查询出现 `--More--` | Agent 可能把半页输出当作完整结果，或在分页状态继续发命令 | 增加 `paged/waiting_input/ready/unknown` 状态，分页时停止自动闭环 |
| RT-P0-04 | P0 | Agent 目标终端未固定 | 工具省略 `tabId` 时使用执行瞬间的活动标签 | 用户切换标签后可能把命令发到另一设备 | 提交 Agent 请求时固定 `targetTabId`，执行前验证仍是同一连接 |
| RT-P0-05 | P0 | “只读”风险分类过粗 | 运行配置查询会输出大量敏感数据 | 日志、聊天历史或模型请求可能泄露配置 | 新增 `sensitive-read`，默认禁止自动执行并要求明确人工确认 |
| RT-P1-01 | P1 | RAG 未使用已有 `commandView` 约束 | XLSX 已保存命令视图，检索只把它当低权重文本 | 不同 CLI 模式的相似命令可能混排 | 规范化命令视图并做兼容过滤/降权，保留未知兼容降级 |
| RT-P1-02 | P1 | Ask 提交时未保存目标上下文 | 聊天条目只有 prompt/model/mode 等字段 | 异步请求期间切换标签会造成上下文漂移 | 在 `chatEntry` 中保存不可变的最小上下文快照 |
| RT-P1-03 | P1 | 设备型号容易被误猜 | 终端主机名不等于权威产品型号 | 错误型号过滤会排除正确文档或引用错误命令 | 型号只接受书签配置、权威查询结果或用户确认；未知时不猜测 |
| RT-P1-04 | P1 | 回显解读缺少“基线未知”约束 | 单次输出包含状态和告警，但没有预期拓扑 | AI 容易过度诊断 | 在 Ask/Agent 系统约束中加入事实—解释—缺口—核查格式 |
| RT-P1-05 | P1 | 人工输入易混淆字母与数字 | 进入 CLI 时出现 `o`/`0` 输入错误 | 降低体验，错误信息不易理解 | 第一版仅在失败后解释，不做自动纠正或自动重试 |
| RT-P2-01 | P2 | 日志默认可能持续记录 | 保存日志后会继续写入 | 敏感信息持续落盘、文件无限增长 | 后续增加明确的“正在记录”状态、停止入口和敏感提示 |
| RT-P2-02 | P2 | 缺少真机反馈数据闭环 | 当前只有人工查看日志 | 难以持续衡量 RAG 质量 | 建立脱敏黄金问题与人工验收结果，不上传原始日志 |

## 5. 根因定位（对应当前代码）

### 5.1 RAG 已有数据没有被用作模式约束

`src/app/lib/knowledge/xlsx-parser.js` 已将以下字段解析为结构化知识单元：

- `command`
- `commandView`
- `description`
- `usageScope`
- `example`
- `expertNotes`

但 `src/app/lib/knowledge/knowledge-base.js` 当前仅把 `commandView` 作为检索文本参与打分，`searchKnowledge(query, context)` 只对设备型号进行过滤。因此“命令视图”虽然被保存，却没有成为执行前的适用性条件。

### 5.2 Ask 没有固定提交瞬间的终端上下文

`src/client/components/ai/ai-chat.jsx` 创建的 `chatEntry` 没有保存目标终端或 CLI 状态。`src/client/components/ai/ai-chat-history-item.jsx` 在稍后开始 Ask 请求时，仅调用：

```text
searchKnowledge(prompt)
```

如果提交后切换标签页，系统无法可靠还原用户提问时对应的设备环境。

### 5.3 Agent 有证据检查，但缺少目标和 CLI 兼容性检查

`src/client/components/ai/agent-execution-policy.js` 当前主要判断：

- 是否属于 FiberHome 请求；
- 是否存在可靠证据；
- 命令是否以 `display/show/ping/tracert/traceroute` 等只读前缀开头。

它没有判断：

- 当前是不是 ACE CLI；
- 当前是不是 diagnose 模式；
- 证据的 `commandView` 是否适用于当前模式；
- 目标标签是否仍是提交时锁定的标签；
- 命令是否属于敏感只读查询。

### 5.4 Agent 把“终端静默”当作“命令完成”

`src/client/store/mcp-handler.js` 的 `mcpWaitForTerminalIdle()` 依赖 `terminalOnData` 的约 4 秒静默状态。真机中的 `--More--` 会等待用户输入，此时终端同样可能静默，所以现有结果可能把分页等待误判为完成。

## 6. 目标模型

### 6.1 `TerminalContextSnapshot`

建议新增一个小而稳定的数据结构：

```js
{
  tabId: 'fixed-tab-id',
  terminalInstanceId: 'local-session-instance',
  transport: 'ssh',
  shellFamily: 'linux' | 'fiberhome-ace' | 'unknown',
  cliMode: 'linux-shell' | 'ace-user' | 'ace-diagnose' | 'unknown',
  interactionState: 'ready' | 'running' | 'paged' | 'password' | 'unknown',
  promptKind: 'linux' | 'ace' | 'ace-diagnose' | 'unknown',
  deviceModel: null,
  confidence: 'high' | 'medium' | 'low',
  capturedAt: 0
}
```

隐私规则：

- 不保存完整终端缓冲区；
- 不保存密码提示之前的输入；
- 不保存真实主机名、IP 或账号到 AI 消息；
- 如需调试证据，只保存脱敏后的提示符类别，不保存原始提示符全文。
- `terminalInstanceId` 只在本地用于判断同一标签是否已经重连，不进入模型消息或知识索引。

### 6.2 识别规则

首版使用本地、确定性的提示符规则，不依赖大模型：

| 状态 | 代表形态 | 结果 |
|---|---|---|
| Linux 维护 Shell | `user@host:...#` 或 `$` | `linux-shell` |
| ACE 普通 CLI | `ACE#`、设备名加 `#` 的已确认变体 | `ace-user` |
| ACE diagnose | `ACE(diagnose)#` 或已确认变体 | `ace-diagnose` |
| 分页 | `--More--` 及手册确认的同义提示 | `paged` |
| 密码等待 | 复用现有 password prompt 状态 | `password` |
| 无法识别 | 无可靠提示符 | `unknown`，禁止 Agent 自动执行 FiberHome 命令 |

规则必须保守：只检查光标附近最后一个有效行，并使用首尾锚定的提示符规则；不能因为历史输出正文中出现 `ACE#` 或 `--More--` 就改变当前状态。分页只在当前等待行匹配时成立。误判时返回 `unknown`，不得为了“看起来智能”猜测模式。

`commandView` 首版规范化建议：

| 知识库原值（示例） | 规范化结果 |
|---|---|
| `用户视图`、经现有手册确认的普通 CLI 同义值 | `ace-user` |
| `diagnose`、`诊断视图`、经现有手册确认的诊断同义值 | `ace-diagnose` |
| 明确标注 Linux/Shell 的知识单元 | `linux-shell` |
| 空值、混合值、未确认值 | `unknown` |

不得只根据 section 标题中的某个单词覆盖明确的 `commandView`；发生冲突时标记 `unknown/conflict` 并禁止自动执行。

### 6.3 RAG 上下文

`searchKnowledge(query, context)` 的 `context` 建议扩展为：

```js
{
  deviceModels: [],
  softwareVersions: [],
  cliMode: 'ace-user' | 'ace-diagnose' | 'linux-shell' | 'unknown',
  commandView: '',
  operationClass: 'status-query' | 'sensitive-read' | 'configuration' | 'unknown'
}
```

兼容原则：

- 旧知识单元没有规范化模式时仍可检索，但标记 `applicability.cliMode = unknown`；
- 明确冲突的模式应过滤或强降权；
- 模式未知时可以给 Ask 展示候选证据，但必须提示用户确认 CLI；
- Agent 自动执行要求高置信度模式匹配，未知或冲突时停止并解释。

## 7. 修改范围

### 7.1 本轮必须修改

| 文件/模块 | 修改内容 |
|---|---|
| 新增 `src/client/common/fiberhome-terminal-context.js` | 纯函数识别提示符、CLI 模式、分页和未知状态；不负责执行 |
| `src/client/store/mcp-handler.js` | 复用终端缓冲区生成上下文；让状态/等待结果返回 `interactionState` 和 `terminalContext` |
| `src/client/components/ai/ai-chat.jsx` | Ask/Agent 提交时保存固定的目标终端上下文快照；多目标不一致时标记 `mixed` |
| `src/client/components/ai/ai-chat-history-item.jsx` | Ask 检索传入快照；构造提示时说明当前模式和匹配/冲突，不增加任何执行调用 |
| `src/client/components/ai/agent.js` | Agent 预检索传入快照；固定本次 Agent 的目标标签；把上下文交给执行策略 |
| `src/client/components/ai/agent-tools.js` | 搜索工具传递 CLI 上下文；执行工具使用固定目标并处理 `paged/unknown` 状态 |
| `src/client/components/ai/agent-execution-policy.js` | 增加目标一致性、CLI 兼容性、分页/未知状态和 `sensitive-read` 判断 |
| `src/app/lib/knowledge/knowledge-base.js` | 规范化 `commandView`，返回 CLI 适用性并按上下文过滤/降权；保持旧索引可用或明确迁移版本 |
| `src/client/components/ai/ai-chat.jsx`、`ai.styl` | 最小化展示“当前：Linux / ACE / diagnose / 未识别 / 分页中”状态，不改整体布局 |

### 7.2 原则上不修改

- `xlsx-parser.js`：已有 `commandView` 结构化字段，除非测试证明真实表格存在未解析形式；
- SSH、Telnet、SFTP、书签和终端渲染核心；
- RAG 文档导入格式、向量数据库和 embedding；
- 品牌、Logo、应用 ID、用户数据路径和自动更新配置；
- Ask/Agent 模式定义；
- 尚未合并的完整 Execution Gateway 架构。

### 7.3 明确禁止

- 不把真机观察到的进入命令硬编码为所有 FiberHome 设备通用步骤；
- 不在模式未知时自动尝试 `telnet`、`enable`、`diag` 或类似切换命令；
- 不自动翻页、自动发送空格或 `q`，除非后续有单独设计、证据和用户批准；
- 不根据主机名猜测设备型号；
- 不让 Ask 自主执行；
- 不把完整终端输出默认附加到云端模型请求；
- 不提交原始日志或真实配置。

## 8. 分阶段整改步骤

### 阶段 A：脱敏 fixture 与红灯测试

目标：先把真机暴露的问题变成可重复的自动化检查。

1. 新增脱敏 fixture，仅包含虚构主机名和最小提示符/分页样本；
2. 新增 `fiberhome-terminal-context.spec.js`；
3. 覆盖 Linux、ACE、diagnose、分页、密码、未知、误导性普通文本等场景；
4. 扩展现有 RAG 测试，证明 `commandView` 不匹配时不会作为 Agent 自动执行依据；
5. 扩展执行策略测试，证明目标切换、未知模式、分页和敏感只读均被阻断。

退出条件：测试能在未实现整改前准确失败，且 fixture 不含真实设备信息。

### 阶段 B：纯上下文识别模块

目标：只增加观测能力，不改变 Ask/Agent 行为。

1. 实现 `inferFiberhomeTerminalContext()` 纯函数；
2. 从有限的最近行中提取最后一个可靠提示符；
3. 识别分页优先于“空闲”；
4. 在 `mcpGetTerminalStatus()` 返回值中增加上下文字段；
5. 保留现有字段，避免破坏 MCP/Agent 调用方。

退出条件：新增单测通过，现有 MCP 和终端测试不回归。

### 阶段 C：Ask + RAG 上下文约束

目标：Ask 明确告诉用户命令应在哪一层执行，但仍不自主执行。

1. 提交 Ask 时固定选中终端快照；
2. 单目标：把 `cliMode` 传给 `searchKnowledge()`；
3. 多目标且模式不一致：标记 `mixed`，要求用户选择一个目标，不生成唯一可运行命令；
4. RAG 返回 `commandView`/`cliMode` 适用性和冲突说明；
5. Ask 提示中加入“当前会话层级”和“命令适用层级”；
6. 保持现有 `rag-ask-boundary.spec.js`：Ask 路径不得出现终端写入或 Agent 工具调用。

退出条件：在 Linux Shell 询问 ACE 状态命令时，Ask 会说明需要进入正确 CLI；不会直接把命令描述成当前可执行。

### 阶段 D：Agent 目标固定与执行前校验

目标：只读自动执行必须同时满足“有证据、目标固定、模式匹配、非敏感、非分页”。

1. Agent 提交时固定 `targetTabId` 和连接身份快照；
2. 预检索和所有 FiberHome 命令复用同一快照；
3. 若活动标签变化，仍只能操作固定目标；目标关闭/重连/身份变化则停止；
4. 执行策略新增明确拒绝原因；
5. `send_terminal_command` 返回分页时停止工具循环并要求用户处理；
6. `show running-config` 类命令归为 `sensitive-read`，不进入当前低风险自动执行白名单；
7. 不借本轮改动扩大配置命令或诊断命令的自动执行权限。

退出条件：所有 P0 安全测试通过；切换标签、分页或模式不匹配时终端零写入。

### 阶段 E：最小 UI 与真机验收

目标：让用户看得懂系统为什么执行或停止。

1. AI 面板显示当前上下文标签；
2. 模式未知、模式冲突、分页和敏感只读时显示短原因；
3. 不重排现有 Ask/Agent 主界面，不改品牌布局；
4. 先用本地 fixture 验证，再进行单台真机烟测；
5. 真机只执行已由知识库验证的低风险查询；任何配置、诊断模式切换和敏感只读由用户手工操作。

退出条件：用户能从 UI 看清“当前在哪一层、命令适用哪一层、为什么没有自动执行”。

## 9. 黄金问题与验收矩阵

| 编号 | 用户问题/场景 | 当前上下文 | 预期行为 |
|---|---|---|---|
| G01 | “查看时钟状态” | Linux Shell | Ask 给出引用和 ACE 适用层级；Agent 不直接发送 `show` |
| G02 | “查看时钟状态” | ACE 普通 CLI | Ask 给出带来源命令；Agent 仅在证据可靠且非敏感时可执行 |
| G03 | “查看 HA 组件状态” | ACE 普通 CLI | 若知识注明 diagnose，则解释需切换模式；不自动进入 diagnose |
| G04 | 同上 | ACE diagnose | 检索优先匹配 diagnose 证据；按现有授权规则处理查询 |
| G05 | 任意查询遇到 `--More--` | paged | 返回“等待分页输入”；Agent 停止后续命令，不把半页结果判定完成 |
| G06 | “导出完整运行配置” | ACE | 标记敏感只读；Ask 可解释，Agent 不自动执行 |
| G07 | 用户提交后切换标签 | 任意 | Agent 不跟随新活动标签；固定目标失效时停止 |
| G08 | 多个 Ask 目标处于不同 CLI | mixed | 提示选择单一目标，不生成唯一可运行命令 |
| G09 | 主机名看似包含型号 | 未验证 | 不自动填充设备型号；提示型号未知 |
| G10 | 状态输出含告警/无邻居 | ACE | 只陈述事实与可能含义，明确需要拓扑/基线，不直接下故障结论 |
| G11 | 知识库无匹配 | 任意 | 明确“未找到可靠依据”，不凭模型常识生成厂商命令 |
| G12 | 普通 Linux 问题 | Linux Shell | 不强制套用 FiberHome RAG，不破坏原 Electerm AI 行为 |

## 10. 自动化测试范围

建议新增或扩展：

- `test/unit-ci/fiberhome-terminal-context.spec.js`
- `test/unit-ci/rag-knowledge-base.spec.js`
- `test/unit-ci/rag-ask-routing.spec.js`
- `test/unit-ci/rag-ask-boundary.spec.js`
- `test/unit-ci/rag-agent-knowledge.spec.js`
- `test/unit-ci/rag-agent-execution-policy.spec.js`

关键断言：

1. Ask 路径仍没有 `send_terminal_command`、`executeToolCall` 或终端写入；
2. `commandView` 匹配时证据保留，明确冲突时不作为自动执行依据；
3. `unknown/mixed/paged/password` 均不能进入 FiberHome 自动执行；
4. 固定目标与实际目标不一致时终端零写入；
5. `sensitive-read` 不能被普通 `show/display` 前缀绕过；
6. 新字段是向后兼容扩展，原有终端状态调用仍工作；
7. 原始日志、IP、主机名、账号和序列号不会出现在 fixture、快照或错误消息中。

建议验证命令：

```powershell
node --test test/unit-ci/fiberhome-terminal-context.spec.js test/unit-ci/rag-knowledge-base.spec.js test/unit-ci/rag-ask-routing.spec.js test/unit-ci/rag-ask-boundary.spec.js test/unit-ci/rag-agent-knowledge.spec.js test/unit-ci/rag-agent-execution-policy.spec.js
```

随后对本次实际修改文件执行 Standard，并运行：

```powershell
npm.cmd run build
```

## 11. 真机验收纪律

1. 先在本地 fixture 和模拟终端通过全部测试；
2. 真机验收只连接一台明确的测试设备；
3. 第一次只使用 Ask，确认上下文和引用；
4. Agent 只测试低风险、已验证、无分页或输出量可控的查询；
5. 不执行配置命令、模式切换、重启、清除、删除、写文件或批量操作；
6. 测试前后确认目标标签和提示符；
7. 日志保存后立即停止录制，并人工脱敏；
8. 真机结果由用户确认后再合并，不自动推送远程仓库。

## 12. 分支与提交策略

不要继续修改已固化的 `codex/rag-module-mvp`。建议从当前集成基线创建：

```text
codex/fiberterm-mvp-integration
  -> codex/rag-real-device-context
```

推荐小提交：

1. `test(rag): add sanitized real-device context fixtures`
2. `feat(rag): infer FiberHome CLI session context`
3. `feat(rag): route Ask retrieval by CLI context`
4. `fix(agent): pin target and stop on incompatible terminal state`
5. `feat(ai): show FiberHome terminal context status`
6. `docs(rag): record real-device validation results`

每个提交都应独立通过对应小范围测试。完成后保留功能分支，由用户先验收，再决定是否合并回 `codex/fiberterm-mvp-integration`。未经明确允许不得推送。

## 13. 完成定义

只有同时满足以下条件，才可称本轮整改完成：

- Ask 的非自主执行边界保持不变；
- 当前 CLI 模式能够保守识别并在 AI 面板可见；
- RAG 引用展示命令适用模式；
- Agent 目标固定，标签切换不会改变执行目标；
- 模式未知/冲突、分页、密码等待、敏感只读时不会自动写终端；
- 黄金问题全部通过；
- 原有 RAG、SSH、终端、品牌测试及生产构建无回归；
- 真机烟测由用户确认；
- 原始日志和真实设备信息未进入 Git。

## 14. 后续但不属于本轮

- 统一 Execution Gateway 的三档授权完整实现；
- 自动分页与可取消的交互式命令状态机；
- 设备型号/版本的权威自动发现；
- 配置前后差异、回滚方案和事务式执行；
- 告警/性能输出的结构化解析器；
- 日志脱敏导出和企业审计中心；
- PDF/DOCX、向量检索和公司级知识平台。

这些方向有价值，但不应混入本次“CLI 上下文 + RAG 适用性 + Agent 真机安全”增量，以免扩大改动面。

## 15. 原 RAG 会话启动话语

下面这段话可以完整交给负责 RAG 的 Codex 会话：

```text
继续 FiberTerm 的 RAG 优化工作。首轮真机验证已经完成，本次不要重新做一遍泛化研究，请直接以仓库中的实施规格为准：

D:\桌面\smartterm\electerm\docs\research\real-device-rag-hardening-plan.md

开始前请完整阅读：
1. 仓库根目录 AGENTS.md；
2. docs/research/real-device-rag-hardening-plan.md；
3. docs/features/rag-module-mvp.md；
4. docs/decisions/003-rag-first-product-scope.md；
5. docs/decisions/002-ai-execution-gateway.md；
6. 与本次改动直接相关的现有源码和测试。

当前已验收 RAG 分支 codex/rag-module-mvp 必须保留为固化基线，不要继续直接修改它。请先检查 git status、当前分支和提交关系，保护所有已有改动；从 codex/fiberterm-mvp-integration 创建或恢复功能分支 codex/rag-real-device-context。未经我明确允许不要 push、不要合并、不要改远程仓库。

本次目标仅限于真机暴露的增量问题：
- 识别 Linux Shell、ACE 普通 CLI、ACE diagnose、分页、密码等待和未知状态；
- 在 Ask/Agent 提交时固定最小、脱敏的终端上下文快照；
- 让 RAG 使用已有 commandView 字段约束/标记命令适用 CLI；
- 保持 Ask 只检索、解释和生成候选命令，模型不得自主执行；
- Agent 的 FiberHome 只读自动执行必须同时满足：证据可靠、目标固定、CLI 模式匹配、非分页、非密码等待、非敏感只读；
- 用户切换标签不能改变 Agent 已固定的执行目标；
- 遇到 --More-- 时不得把半页输出当作完成，也不得擅自自动翻页；
- show running-config 等只读但敏感的命令不得因为 show/display 前缀而自动放行；
- 不根据主机名猜测型号，不硬编码 telnet/diag 等设备进入步骤，不上传或提交原始真机日志。

严格按照文档的阶段 A→E 小步实施。先用完全脱敏、虚构的数据写红灯测试，再实现纯上下文模块；随后分别接入 Ask、RAG、Agent，最后做最小 UI。每个阶段只改必要范围，执行对应的小范围测试后再继续。不要重写 SSH、终端、书签、RAG 存储或品牌模块，也不要顺便开发向量库、完整执行网关或其他延期功能。

重点检查并按文档约束以下文件：
- src/client/common/fiberhome-terminal-context.js（新增纯函数模块）
- src/client/store/mcp-handler.js
- src/client/components/ai/ai-chat.jsx
- src/client/components/ai/ai-chat-history-item.jsx
- src/client/components/ai/agent.js
- src/client/components/ai/agent-tools.js
- src/client/components/ai/agent-execution-policy.js
- src/app/lib/knowledge/knowledge-base.js
- 对应 test/unit-ci 测试

必须保留并验证现有 Ask 边界测试：Ask 路径不得出现 executeToolCall、send_terminal_command 或任何终端写入。兼容性上保留现有 API 字段，只追加上下文字段；旧知识索引要么继续可用，要么采用明确、可测试的版本迁移，不能静默破坏用户已导入知识库。

完成代码后执行文档列出的针对性 node --test、修改文件的 Standard 检查和 npm.cmd run build。然后做一次差异审查，确认没有真实 IP、主机名、账号、序列号、完整配置或原始日志进入 Git。不要自行连接或操作真实设备；停下来给我一份变更摘要、测试证据和逐项真机验收步骤，由我亲自测试确认后再决定提交、推送和合并。
```
