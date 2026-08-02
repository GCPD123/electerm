# FiberTerm AI 授权模式研究

## 1. 结论

FiberTerm 不应把所有 AI 命令永久设为“每次点击批准”，也不应恢复 Electerm 当前 Agent 的无审批执行。更合理的产品形态是：

- **Ask**：只负责理解终端上下文、解释输出、生成建议；模型自身没有工具调用能力，永不自主执行。用户点击 Ask 回复中的“运行”按钮时，这个动作才成为一个新的 `ActionProposal`，仍进入统一执行网关。
- **Agent**：具备工具调用和多步闭环能力，并提供三档**会话级**授权：`请求批准`、`替我审批`、`受控完全执行`。
- 三档只改变 Policy Engine 在既定范围内返回 `allow` 还是 `require_approval`；任何档位都不能绕过 `Execution Gateway`、固定目标、风险分类、企业策略、审计和取消。
- “完全执行权限”建议在产品文案中改为**受控完全执行**或**在当前范围内自动执行**，防止用户误解为无边界管理员权限。

这相当于把 Codex 的两层模型移植到 FiberTerm：先确定可触达的资源边界，再确定边界内哪些动作需要审批。OpenAI Codex 官方文档同样将 sandbox/permission profile 与 approval policy 分开描述，并提供 read-only、workspace、danger-full-access、on-request、never 和自动审批审查等组合；FiberTerm 的三档名称是结合网络设备运维场景形成的产品映射，不是照搬某个 Codex UI 标签：[Permissions](https://learn.chatgpt.com/docs/permissions)、[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)。

## 2. 当前 Electerm 的 Ask 与 Agent 边界

### 2.1 产品入口

AI 面板只有 `Ask` 与 `Agent` 两个模式；默认是 Ask，选择会写入本地设置（`src/client/components/ai/ai-chat.jsx:27-54,238-243`）。提交时，模式被固定到聊天条目（`src/client/components/ai/ai-chat.jsx:56-84`），历史项再依据该值选择普通聊天或 Agent 循环（`src/client/components/ai/ai-chat-history-item.jsx:161-188`）。

### 2.2 Ask 的实际边界

Ask 走普通 AI 请求，不向模型提供 Agent 工具，因此模型自身不能操作终端。Ask 会展示用户选择的终端上下文（非 Agent 模式才显示终端选择器，`src/client/components/ai/ai-chat.jsx:135-145`）。

但 Ask 并非绝对“无执行入口”：回复中的代码块带运行按钮，点击后直接调用 `runCommandInTerminal()`（`src/client/components/ai/ai-output.jsx:39-88`）。因此准确边界应是：

> Ask 不允许模型自主执行；用户主动点击运行属于独立的人工发起动作，也必须经过执行网关。

### 2.3 Agent 的实际边界

Agent 的 system prompt 明确要求模型使用工具完成终端操作（`src/client/components/ai/agent.js:6-25`）。模型返回 tool call 后，循环直接调用 `executeToolCall()`（`src/client/components/ai/agent.js:120-152`）；后者可直接发送命令、关闭标签、增加书签、删除 SFTP 文件和运行后台命令（`src/client/components/ai/agent-tools.js:448-513`）。当前工具卡只展示 running/completed/error 和参数/结果，没有批准状态（`src/client/components/ai/agent-tool-call-card.jsx:36-84`）。

所以现状不是“Agent 已有合理完全权限”，而是“Agent 缺少不可绕过的授权边界”。提示词 guardrail 只是拼接 system 文本（`src/client/components/ai/ai-guardrails.js:1-10`），不能替代强制策略。

## 3. 推荐授权模型

### 3.1 两层边界

授权必须分为两层：

1. **作用域（Scope）**：本次 Agent 能操作哪些已连接终端、设备、目录、SFTP 区域和动作类别。
2. **审批策略（Approval Mode）**：在上述范围内，哪些动作自动通过，哪些必须询问，哪些永远拒绝。

这与 Codex 官方安全模型一致：sandbox 决定技术边界，approval policy 决定何时停下确认；目的之一正是避免边界内低风险动作产生审批疲劳。[Sandboxing](https://developers.openai.com/codex/concepts/sandboxing)

### 3.2 三档 Agent 权限

| 模式 | 自动执行 | 必须批准 | 推荐用途 |
|---|---|---|---|
| **请求批准**（默认） | 明确无副作用的内置读取工具，例如列出标签页、读取有限终端输出；首版也可全部展示卡片 | 所有 shell/设备 CLI 命令、写操作、连接切换、文件传输、后台任务 | 生产设备、首次使用、不熟悉的环境 |
| **替我审批** | 独立自动审查器确认的单目标、低风险动作；只读状态/输出工具 | 审查不通过或证据不足的动作；高风险转人工；严重风险拒绝 | 日常查询、巡检、故障定位 |
| **受控完全执行** | 当前会话和明确目标范围内的低/中风险动作，可连续执行 | 高风险动作；扩大目标；凭据输入；策略要求人工确认的动作 | 测试机、实验环境、用户明确授权的短时自动化 |

“替我审批”保持与“请求批准”相同的 scope，只把 eligible approval 交给独立审查器；解析失败或证据不足时 fail closed。OpenAI 官方 auto-review 同样不放宽 sandbox，高风险需要充分用户授权，critical 风险拒绝。[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)

“受控完全执行”并不等于 `allow everything`。Codex 官方 Full access 对应无 sandbox、无 approvals，并不推荐作为常态；FiberTerm 面向远程真实设备，因此应更保守：最多将既定 scope 内、非高风险的 `require_approval` 降为 `allow`，不能改变 `deny`，也不能自动扩大 scope。[Sandboxing](https://developers.openai.com/codex/concepts/sandboxing)

### 3.3 Ask 的行为

Ask 不需要三档权限，因为它没有自主工具循环：

- 提问、解释、生成命令：只读交互。
- “复制”：不进入网关。
- “运行”：生成来源为 `ask` 的 `ActionProposal`；风险分类和 Agent 完全相同。
- Ask 的运行按钮默认逐次确认。未来可以尊重当前会话的“替我审批”，但按钮本身已经是一次明确用户动作，因此第一版保持显示命令卡更清晰。

## 4. 任何模式都不能自动放行的操作

以下规则优先级高于用户选择的授权档位：

### 4.1 永久拒绝（`deny`）

- 明确针对根目录、系统盘、用户主目录或未解析宽泛路径的递归删除/格式化。
- 关闭或篡改 FiberTerm 自身执行网关、审计、安全策略、凭据保护。
- 通过编码、下载后执行、嵌套 shell 等方式规避风险识别，且无法可靠还原真实动作。
- 目标设备或 shell 不明确、目标快照已失效、命令在审批后被修改。
- 企业策略明确禁止的设备、时段、命令或动作。

### 4.2 始终人工确认（`require_approval`）

- 提权与权限修改、服务重启/停止、网络和路由配置变更。
- 删除、覆盖、SFTP 删除/上传覆盖、恢复配置、固件或软件升级。
- 批量设备执行、跨多个标签页执行、目标范围扩大。
- 输入密码、私钥口令、令牌或其他秘密；模型不得代填秘密。
- 长期后台任务、计划任务、持久化改动，以及预计中断连接的操作。
- 风险分类为 high，或分类结果不确定。

Codex 官方安全指导同样不把“更少审批”理解为取消所有保护；标记为 destructive 的 app/MCP 工具始终需要 approval。[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)

## 5. 会话授权生命周期

### 5.1 创建与默认值

- 每个新 AI 会话默认 `请求批准`。
- 切换到更高权限时展示：授权模式、目标设备、有效期、允许动作和不可绕过规则。
- 只有用户可提升权限；Agent、提示词、MCP 客户端和终端输出都不能改变授权模式。

### 5.2 Scope 快照

授权至少绑定：

```text
ApprovalSession {
  chatSessionId,
  mode,
  allowedTargets: [{ tabId, connectionId, host, type }],
  allowedActionClasses,
  createdBy,
  createdAt,
  expiresAt,
  revokedAt?,
  policyVersion
}
```

- 默认只授权用户开启 Agent 时选中的当前终端，不允许“跟随当前活动标签”。
- 切换标签只改变 UI，不改变已授权目标。
- 打开新 SSH、切换设备、加入第二个目标时必须重新确认 scope。
- 授权使用稳定连接标识和目标快照，不能只依赖可复用的 `tabId`。

### 5.3 有效期与降级

- 授权只在当前 AI 会话有效，不跨新会话、应用重启或恢复历史。
- 建议默认最长 30 分钟无操作过期；后台任务可单独保留执行状态，但不能延长 Agent 权限。
- 单项批准区分“仅本次”和“当前会话同类动作”；默认最窄，不提供模糊、永久的“总是允许”。Codex App Server 也将 `accept` 与 `acceptForSession` 建模为不同决策：[App Server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)。
- SSH 重连、主机指纹变化、用户身份变化、进入提权 shell、策略版本变化时自动降级为 `请求批准`。
- 用户可随时“一键暂停 Agent”或“撤销自动执行”；撤销后取消所有待审批提议，并阻止新的终端写入。

### 5.4 审计

每个动作都记录，而不只是被询问的动作：

- 用户请求、Agent 计划、proposal 哈希、实际命令与目标快照。
- 风险等级、匹配规则、授权模式、为何自动批准或人工批准。
- 授权人、批准时间、授权 scope、策略版本。
- 执行开始/结束、退出码、取消/超时状态；输出只保留脱敏和限长版本。
- 权限提升、降级、过期和撤销事件。

聊天记录不是审计记录；删除聊天不能删除执行审计。

## 6. Policy Engine 决策顺序

推荐固定顺序，避免“完全执行”盖过安全规则：

```text
生成 ActionProposal
→ 固定目标、shell、用户与连接快照
→ 检查企业 deny
→ 识别动作和风险
→ 检查 scope 是否覆盖
→ 应用始终确认规则
→ 最后才应用会话 approval mode
→ 网关执行并审计
```

决策优先级：

```text
deny > always-confirm > out-of-scope > session mode > allow
```

无法判断时 fail closed：在“请求批准/替我审批”模式下转人工确认或拒绝；在受控完全执行下也不能把 unknown 当 low，至少要求人工确认，严重不确定则拒绝。

## 7. 对现有架构文档的更新建议

### 7.1 `docs/decisions/002-ai-execution-gateway.md`

应补充以下正式决策：

1. Ask 是非自主执行模式；Ask 运行按钮仍走网关。
2. Agent 三档授权及其准确中文名称。
3. `ApprovalSession`/scope 数据模型和生命周期。
4. Policy Engine 的固定优先级，明确“任何档位不绕过 Gateway”。
5. 永久拒绝与始终确认清单。
6. 权限只在会话有效，目标扩大、重连、提权和策略变化会降级。
7. 权限模式变化与自动批准动作必须审计。

### 7.2 `docs/research/ai-command-execution-study.md`

建议修正原报告中“第一版所有命令都点一次”的绝对表述：

- P0 首个安全版本可默认逐次审批，保证先封堵旁路。
- 同一架构内同时实现三档策略接口；若风险识别测试达到验收门槛，可在 P0/P1 开放“替我审批”的低风险自动通过。
- “受控完全执行”放在网关、scope、审计和取消闭环后启用，不再笼统推迟所有自动化。
- 原报告第 15 节待决问题 1 可关闭，决定采用三档会话授权。

### 7.3 `docs/development-roadmap.md`

阶段 B 应从“所有命令都点击执行”改为：

- 默认请求批准；建立三档授权的数据结构和策略接口。
- “替我审批”保持相同 scope；首批自动通过仅限经过测试的低风险、只读、单目标动作。
- 高风险永远人工确认，严重风险默认拒绝。
- 受控完全执行需在 scope、撤销和审计事件已完成后开放。

阶段 C 增加授权模式选择器、当前 scope 展示、一键降级/撤销和自动批准原因展示。

## 8. 推荐实施切片

1. **P0-1：不可绕过网关**：三入口全部接入；默认请求批准；零写入测试。
2. **P0-2：会话授权模型**：实现三档枚举、scope、过期/撤销和决策优先级；先不开放受控完全执行 UI。
3. **P0-3：替我审批**：引入独立审查决策；首批只开放严格白名单的读取动作，建立 Bash/PowerShell/cmd/设备 CLI 测试矩阵。
4. **P1：受控完全执行**：在目标锁定、取消、输出边界和审计事件完备后开放；必须醒目标识剩余时长和目标。

验收重点：同一动作从 Ask、Agent、MCP 进入时风险结论一致；权限提升不改变 deny/always-confirm；目标切换、命令编辑、重连和过期均使旧授权失效；拒绝、撤销和未批准时终端零写入。

## 9. 最终建议

采纳三档授权，但保留一个清晰原则：

> **Ask/Agent 决定 AI 能否自主规划工具；授权档位决定网关在既定 scope 内询问多少次。两者都不能决定是否绕过网关。**

这既保留 Electerm Agent 带来的“AI 真正替用户做事”的产品价值，也避免每条只读命令都确认造成的体验损耗，同时不会把“效率”建立在无边界执行之上。
