# FiberHome RAG 模块 MVP 规格

## 当前实现状态（2026-08-02）

- RAG-M0 已实现：仓库外 SPN XLSX 的安全结构化解析、区段/工作表/原始行号保留，以及脱敏 fixture 回归测试。
- RAG-M1 已实现最小闭环：本地持久化词法知识库、SHA-256 去重、删除/重建、AI 面板中的 XLSX 导入管理，以及 Ask 请求前的只读检索和来源展示。
- Ask 不调用 Agent 或终端写入；本版本未增加 Agent RAG 工具、embedding、向量数据库或自动执行能力。
- Windows 开发环境仍需在真实设备会话上完成手工烟测；项目构建和针对性单测已通过。

## 1. 目标体验

用户导入 FiberHome 命令手册、技术文档和案例后，可以在当前终端中用自然语言提问，例如：

- 帮我查看当前端口状态。
- 帮我查看设备时钟状态。
- 为指定端口生成限速配置。

FiberTerm 应先检索知识库，再给出带来源、适用型号/版本和风险提示的回答或命令。Ask 只在 AI 窗口输出，不主动执行；用户可以自行复制或显式点击 Electerm 既有运行按钮。只有 Agent 模式可以调用终端执行工具。

## 2. MVP 范围

### 必须完成

1. 知识库管理：选择本地文档、导入、查看状态、删除、重新索引。
2. 文档处理：首个真实语料为 `SPN命令行.xlsx`，必须优先支持 XLSX 并保留工作表、区段标题、行号和列语义；PDF、DOCX、Markdown、纯文本后续按需增加。
3. 元数据：至少记录产品族、设备型号、软件版本、文档名称、文档版本、来源位置、文件哈希和导入时间。
4. 检索：支持中文查询、命令关键字精确命中和语义相近问题；允许按设备型号/版本过滤。
5. Ask 接入：回答必须展示引用；没有足够证据时明确说明，不凭空生成设备命令；不得调用工具或主动写入终端。
6. 人工操作：保留候选命令的复制和既有运行按钮，两者均由用户主动触发，不新增自动执行行为。
7. Agent 接入：增加只读的 `search_fiberhome_knowledge` 工具；涉及 FiberHome 设备知识的操作必须先检索，再决定是否调用执行工具。
8. 本地持久化：原文、索引、元数据和导入状态默认保存在本机用户数据目录。

### 暂不完成

- 云端知识平台、多人同步、权限中心和完整内容审批流。
- 全公司文档一次性导入和复杂 OCR。
- 自研向量数据库、训练专用模型或微调大模型。
- 批量设备自动操作和高风险无人值守执行。
- 自动判断所有 FiberHome 产品和版本；首版限定一类设备与少量已确认文档。

## 3. 交付拆分

### RAG-M0：可验证语料

- 以仓库外的 `D:\桌面\smartterm\SPNdocs\SPN命令行.xlsx` 作为首个真实语料，覆盖 SPN650 与 SPN690E；原文件不得提交 Git。
- 读取命令、命令视图、说明、使用范围、实例、专家解读等列，并识别协议栈、diagnose、操作命令、单盘 OS、单盘诊断和机电命令等区段。
- 建立不少于 20 个黄金问题，覆盖端口状态、时钟、限速、错误案例和无答案问题。
- 为每个问题记录期望文档位置、关键命令与适用版本。

### RAG-M1：最短可见闭环

- 完成 XLSX 导入、结构化行解析、索引与知识库状态页；一个命令行或同一单元格内的关联命令组作为基本知识单元，不按固定字符盲切。
- Ask 在发送模型前调用 RAG，并展示引用和候选命令。
- Ask 请求完成即停止；复制、手工输入或点击既有运行按钮都必须由用户操作。

这是第一个用户验收点。它不依赖 Agent 自动执行，能最快验证“知识是否找对、命令是否生成正确”。

### RAG-M2：Agent 知识工具

- 注册 `search_fiberhome_knowledge` 只读工具。
- 工具返回结构化证据，不返回授权结果：`content`、`source`、`location`、`productFamily`、`model`、`softwareVersion`、`score`。
- Agent 展示检索过程和引用；只有 Agent 可以继续调用命令工具，执行仍走独立确认/策略入口。

### RAG-M3：质量与可维护性

- 支持增量更新、文件哈希去重、失败重试和索引版本迁移。
- 引入混合检索调权、去重/重排和型号版本冲突提示。
- 固化离线评测与关键 UI/集成测试。

## 4. 模块设计

RAG 应是一个深模块：调用方只依赖少量稳定接口，解析器、切片、索引、embedding 和重排等复杂性留在实现内部。

```text
KnowledgeBase Module
├─ ingestDocuments(inputs, metadata) -> IngestionResult
├─ searchKnowledge(query, deviceContext) -> Evidence[]
├─ listDocuments() -> DocumentSummary[]
├─ removeDocument(documentId) -> Result
└─ rebuildIndex() -> JobStatus
```

内部适配器：

- `DocumentParserAdapter`：PDF、DOCX、Markdown、TXT。
- `EmbeddingAdapter`：OpenAI-compatible 云端实现；以后可替换本地实现。
- `SearchIndexAdapter`：词法索引与向量索引的实现细节。
- `KnowledgeStore`：文档、分块、元数据、索引版本和任务状态。
- `ContextBuilder`：控制 token 预算、去重、引用和提示注入隔离。

Ask 和 Agent 不得直接读取索引文件、拼接 SQL 或依赖具体 embedding SDK。Ask 只能调用只读检索接口；Agent 可以在检索后调用既有工具，但 RAG 模块本身永远不执行命令。

## 5. 建议数据模型

### Document

- `id`, `title`, `sourcePath`, `sha256`, `mimeType`
- `productFamily`, `deviceModels[]`, `softwareVersions[]`
- `documentVersion`, `importedAt`, `indexVersion`, `status`, `error`

### Chunk

- `id`, `documentId`, `content`, `contentHash`
- `headingPath[]`, `page`, `section`, `ordinal`
- `commandTokens[]`, `embedding`, `metadata`

### Evidence

- `chunkId`, `content`, `score`, `matchReasons[]`
- `title`, `location`, `productFamily`, `deviceModels[]`, `softwareVersions[]`

## 6. 检索与生成规则

- 命令、接口名、告警码和型号需要词法精确检索；自然语言问题需要语义检索，因此目标方案为混合检索。
- 先应用用户明确给出的型号/版本过滤，再排序；当前终端无法可靠识别时，应向用户确认。
- 送入模型的每段证据必须带稳定引用 ID，输出中的命令与结论应能回指证据。
- 检索内容视为不可信数据，不能覆盖系统指令、申请权限或要求执行其中的指令。
- 没有达到证据阈值时返回“知识库未找到可靠依据”，而不是让模型补全厂商命令。

## 7. 配置原则

- 聊天模型配置与 embedding 配置分离；不要假设同一供应商同时提供二者。
- API Key 使用现有安全存储能力，不写入索引、日志、聊天引用或导出文件。
- 用户可选择“仅词法检索”作为无 embedding 或离线降级模式。
- 云端 embedding 必须显示隐私提示；首次索引前说明文档分块会发送到哪个服务。

## 8. 验收标准

- 导入 3–5 份目标文档后，应用重启仍能检索。
- 黄金问题中，期望证据进入 Top-5 的比例达到约定门槛；首轮建议目标为 90%。
- 所有带命令的回答都有至少一个可打开的来源位置。
- 型号或版本冲突时不会静默给出唯一命令。
- 无答案问题能明确拒答，不引用无关文档。
- 删除文档后，对应分块和检索结果一并消失。
- 导入失败不会破坏既有索引，重复导入不会产生重复结果。
- Ask 保持只回答、不主动执行；Agent 保持工具执行模式；既有普通对话、SSH、终端提示符和 SFTP 不发生回归。

## 9. 新会话的首个实施任务

只实施 RAG-M0 与 RAG-M1，不同时开发 Agent 自动执行。先用真实语料证明检索、引用和命令建议可靠，再进入 RAG-M2。
