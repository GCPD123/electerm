# FiberTerm 企业知识 RAG 模块研究与 MVP 选型

> 状态：研究结论，供后续 RAG 实现会话使用
>
> 日期：2026-08-02
> 范围：只研究本地优先的知识导入、检索、引用与 Electerm AI 集成，不包含产品代码

## 1. 执行摘要

FiberTerm 应收敛为“成熟 Electerm + FiberHome 品牌 + 企业知识 RAG”。保留 Electerm 的终端、SSH、SFTP、Ask 和 Agent；新增边界清晰的 RAG Module，把烽火手册、技术文档和案例检索成可引用证据。

必须保持原有模式语义：

- **Ask** 仍调用普通 `AIchat`，只在 AI 窗口输出答案/命令代码块，不主动调用工具，也不写终端。代码块的复制或运行按钮必须由用户主动点击。
- **Agent** 才进入 `runAgentLoop`，可调用包括 `send_terminal_command` 在内的工具。
- **RAG Module 只检索知识，绝不执行命令。** RAG 增强依据，不改变 Ask/Agent 权限，也不能绕过执行审批。

首版推荐：PDF.js + Mammoth + MD/TXT 解析；标题/命令块感知切片；MiniSearch 纯 JavaScript 词法索引；可选 OpenAI-compatible/Ollama embedding；小语料用 JS 精确余弦搜索。所有具体引擎封装在 Adapter 后。这样能最快在 Electron 41/Windows 展示效果，避免新增原生 ABI 风险。

关键核实：截至研究日，DeepSeek 官方公开 API Reference、Chat Completions 和模型页没有 embeddings 端点或 embedding 模型。因此不能把现有 DeepSeek Key 当向量化能力；生成模型与 Embedding Provider 必须独立配置。没有 embedding 时自动退化为本地词法检索。

## 2. 目标与非目标

用户连接烽火设备后询问“查看端口状态”“查看时钟状态”“配置端口限速”，系统应先结合可用的设备型号/版本上下文检索，再给出：适用性、建议命令、模式/前置条件、文档版本/章节/页码引用，以及不确定项。

首版不建设 CMDB、工单、批量编排、统一身份或独立知识服务器；不微调模型；不做扫描 PDF OCR；不索引凭据或终端历史；不因为检索到文档而自动授权命令执行。

## 3. 仓库现状与模块接缝

精确检查当前源码：

- `src/app/lib/ai.js` 已封装 OpenAI-compatible Chat Completions、代理和自定义鉴权头；
- `src/client/components/ai/ai-chat-history-item.jsx` 中 Ask 调用 `AIchat`，Agent 调用 `runAgentLoop`；
- `src/client/components/ai/agent.js` 实现工具循环；
- `src/client/components/ai/agent-tools.js` 集中声明和分发工具，包含 `send_terminal_command`；
- 现有数据层在 Node 22 以上使用内置 `node:sqlite`，旧运行时回退到 `@electerm/nedb`；当前依赖没有 PDF、DOCX、全文索引或向量库；
- Electron 为 `41.2.0`，打包器为 `electron-builder 26.9.0`。

建议新增一个深模块，调用方只见小接口：

```text
importDocuments(inputs, options) -> ImportResult
searchKnowledge(query, context) -> Evidence[]
listDocuments() -> DocumentSummary[]
removeDocument(documentId) -> Result
getKnowledgeStatus() -> KnowledgeStatus
```

```text
Ask ───────┐
           ├── RAG Module ── Parser Adapter
Agent Tool ┘       │         Chunker / Metadata Store
                   │         LexicalIndex Adapter
                   │         Embedding / VectorIndex Adapter（可选）
                   └──────── Citation / Context Builder
```

这是 RAG Module 的 Interface。解析器、切片、MiniSearch、向量计算和 Provider 是隐藏的 Implementation，并通过 Adapter 形成可替换 Seam。Ask/Agent 不得直接依赖具体索引库。

## 4. 文档导入

### 4.1 解析器

| 格式 | MVP 方案 | 保留内容 | 限制 |
| --- | --- | --- | --- |
| PDF | `pdfjs-dist`，逐页 `getTextContent()` | 页码、文本项 | 多栏/表格顺序可能错误；无 OCR |
| DOCX | `mammoth` 转语义 HTML，再提取受控结构 | 标题、列表、表格、段落 | 复杂排版有损；输出未净化 |
| Markdown | 轻量 AST/既有生态解析 | 标题路径、代码块、列表 | 嵌入 HTML 必须禁用/净化 |
| TXT | Node 读取与编码检查 | 段落、行 | 无天然章节结构 |

PDF.js 官方提供 Web/Node 的解析基础。Mammoth 能利用 DOCX 样式转换标题、列表和表格，但官方明确复杂文档不保证完美转换，而且不净化输出。因此只保留允许的文本/结构字段，绝不把任意转换 HTML 直接注入 Electron DOM。若 PDF 页面没有有效文本层，导入结果应标记“疑似扫描页，需要 OCR”，不能静默建空索引。

### 4.2 流水线与完整性

```text
选择文件/目录 -> 扩展名/大小/路径检查 -> SHA-256 去重
-> 解析 -> 规范化 -> 元数据确认 -> 切片
-> corpus store -> 词法索引 -> 可选 embedding -> 原子发布索引版本
```

新索引完整成功后才切换活动版本；失败时保留旧索引。保存 parser/tokenizer/schema 版本，任何版本变化可控重建。每个文件单独报告错误，不静默跳过。

### 4.3 切片

不能仅按固定字符切烽火命令手册：

1. 以标题层级为主边界，保存 `headingPath`；
2. 命令语法、参数表、示例和注意事项尽量不拆；
3. fenced code、连续 CLI 行、配置模式切换视为不可分割块；
4. 过长章节再按段落合并，初始约 400–800 模型 token、重叠 60–120 token；
5. 保存相邻 chunk ID，命中语法块后可展开上下文。

数值只是初始值，必须用真实手册评测。命令、接口名、告警码、数字和标点的完整性优先于平均块长。

### 4.4 元数据

```text
Document: id, title, sourcePath, sourceHash, fileType,
  documentVersion, publishedAt, importedAt, parserVersion,
  productFamily[], deviceModel[], softwareVersion[],
  confidentiality, enabled, importStatus, warnings[]

Chunk: id, documentId, ordinal, text, headingPath[], pageStart/pageEnd,
  contentKind, productFamily[], deviceModel[], softwareVersion[],
  commandMode, parserVersion, embeddingModel, embeddingDimension
```

型号和版本不能只靠自动抽取，导入 UI 必须允许确认/补充。检索先按元数据过滤再排序。当前设备版本未知时，答案应说明适用范围并询问，而不是武断套用某型号命令。

## 5. 检索与索引选型

### 5.1 混合检索

词法检索擅长命令关键字、型号、接口和数字；向量检索擅长“端口限速”与“带宽控制/流量监管”等语义改写。推荐流程：

```text
查询规范化 -> 元数据过滤 -> 词法 Top-N
-> 可选向量 Top-N -> RRF 合并 -> 去重/相邻块展开 -> Evidence[4..8]
```

首版无需额外 reranker，先用确定性的 Reciprocal Rank Fusion。

### 5.2 方案比较

| 方案 | 优点 | 风险 | 决策 |
| --- | --- | --- | --- |
| MiniSearch + NeDB/JSON + JS 余弦 | 纯 JS、零外部依赖、Node/浏览器可用，支持字段权重/模糊/前缀/自定义 tokenizer | 内存索引；中文默认 tokenizer 不够；向量精确扫描不适合大库 | **MVP 推荐** |
| Electron 内置 Node 的 `node:sqlite` + FTS5 | 无额外 npm native binding；事务、BM25、snippet | 必须实测 Electron 41 是否含所需 API/FTS5 编译项；中文 tokenizer 仍需处理 | **R0 Spike/第二阶段候选** |
| `better-sqlite3` + FTS5 | 成熟、事务与 FTS5 完整 | 原生 addon，需按 Electron ABI rebuild 和 Windows 构建/打包 | 首版不选 |
| SQLite + `sqlite-vec` | 元数据、全文、向量一库 | 官方仍标记 pre-v1；C 扩展和多平台二进制验证 | 后续候选 |
| 独立向量服务 | 容量与集中管理强 | 部署、鉴权、网络、离线和运维复杂 | 当前不选 |

SQLite FTS5 官方提供 BM25、字段权重、snippet/highlight，长期很合适。但 Electron 官方说明原生 Node 模块需匹配 Electron 所带 Node ABI，`@electron/rebuild` 正用于这个问题。为尽快得到 Windows 可复现演示，首版避免新增原生依赖。

MiniSearch 官方说明其纯 JS、零外部依赖、可自定义 tokenizer，适用于能装入本进程内存的语料。建议首批 3–20 份精选文档、数千至约 2 万 chunks 作为压测范围，而不是产品容量承诺；真实上限由内存、启动和 P95 查询压测决定。

### 5.3 中文与命令 tokenizer

MiniSearch 默认按空格/标点切分，不能直接胜任连续中文。MVP tokenizer 应：

- ASCII 命令、型号、接口、数字保持完整并统一大小写；
- 中文至少生成 2-gram/3-gram，或以后接入经评测的纯 JS 分词 Adapter；
- 保留 `show interface`、`GE1/1/1`、`100M` 等原 token；
- 索引和查询使用同一版本 tokenizer，升级即重建。

### 5.4 小规模向量实现

chunk embedding 可存独立知识数据文件，在 worker/后端做 Float32 归一化点积 Top-K。必须保存 Provider、model、dimension；模型/维度不同不可混搜；使用哈希缓存、批量、限流和断点续建；不得阻塞 React/终端。达到规模阈值后在 `VectorIndexAdapter` 后替换 sqlite-vec 等实现。

## 6. Embedding Provider

### 6.1 DeepSeek 核实

截至 2026-08-02，DeepSeek 官方公开 API 文档可确认 Bearer 鉴权与 Chat Completions；其公开 API/聊天/模型页面没有 embeddings 端点或 embedding 模型说明。因此项目应按“当前没有可依赖的 DeepSeek 官方 embeddings API”设计。这是对官方公开能力的审慎结论，不代表其内部或未来永远没有该能力。

### 6.2 独立配置

```text
Generation Provider（现有）:
  baseURL, /chat/completions, model, apiKey, authHeader, proxy

Embedding Provider（新增）:
  type = disabled | openai-compatible | ollama
  baseURL, path, model, dimensions?, apiKey?, authHeader?, proxy?
  dataDisclosureAccepted, lastValidatedAt
```

优先级：

1. 零配置 fallback：MiniSearch，保证无 embedding 也可用；
2. 本机 Ollama：官方提供 `POST /api/embed`，避免文档外发，但用户自行安装运行时/模型，FiberTerm 首版不捆绑；
3. OpenAI-compatible：OpenAI 官方 embedding 模型适合搜索，但上传公司文档片段前必须明确告知和批准；
4. 其他厂商以后新增 Adapter。

不能自动复用聊天 URL/Key，除非用户显式选择并通过“测试 Embedding 连接”。云 embedding 会外发切片，云聊天会外发检索证据，UI 需分别告知。

## 7. Evidence、引用与生成

`searchKnowledge()` 返回结构化 Evidence，而非自行执行或一段不可追踪的 prompt：

```json
{
  "chunkId": "...",
  "text": "...",
  "score": 0.87,
  "matchTypes": ["lexical", "vector"],
  "source": {
    "documentId": "...",
    "title": "命令参考",
    "documentVersion": "Vx.y",
    "headingPath": ["接口管理", "显示接口"],
    "pageStart": 123,
    "pageEnd": 124
  },
  "applicability": {
    "productFamily": ["..."],
    "deviceModel": ["..."],
    "softwareVersion": ["..."]
  }
}
```

Context Builder 以明确数据边界包装证据，模型输出命令时引用本次实际 Evidence ID。UI 来源卡显示文档、版本、章节、页码和片段。

- 无/低证据：明确“知识库依据不足”，请求型号/版本或补充文档；
- 版本冲突：并列差异，不自动选；
- 模型常识但无 RAG 证据：标记“未由企业知识库验证”；
- 引用只能来自本次检索，禁止模型编造文档名/页码。

## 8. Ask 与 Agent 集成

### R1：Ask + RAG（最快可见）

1. 用户导入 3–5 份版本明确的文档；
2. Ask 请求前调用只读 `searchKnowledge`；
3. 证据加入普通 `AIchat` 请求；
4. AI 窗口显示答案、命令代码块与引用卡；
5. **Ask 到此为止，不调用工具、不主动写终端。** 复制或运行由用户点击代码块按钮；点击运行后才进入既有用户触发的终端路径，后续执行策略单独演进。

这已完整演示“自然语言 -> 查烽火资料 -> 给出可追溯命令 -> 用户决定是否运行”，无需先改 Agent。

### R3：Agent 强制检索工具

新增只读工具：

```text
search_fiberhome_knowledge(query, productFamily?, deviceModel?, softwareVersion?)
```

对于 FiberHome 设备任务，Agent 在第一次调用 `send_terminal_command` 前应先检索，并把 `evidenceIds` 传到执行请求。代码检查“有证据”，不能只靠 prompt。不过证据只说明知识来源，实际命令仍走“请求批准/替我审批/受控完全执行”网关。RAG Module 自身永不调用 `send_terminal_command`。

## 9. 安全与隐私

- 索引/chunk/embedding 独立存放，不混入书签、密钥和终端会话库；
- 不索引 SSH 私钥、密码、Token、剪贴板、终端历史或会话输出；
- 日志不打印 Key、完整文档或完整 prompt；
- 删除文档时删除关联 chunk/embedding，提供清空知识库；
- 云 embedding 与云聊天的数据外发分别提示；
- 文档内容是不可信数据，任何“忽略指令/执行命令/泄露密钥”都不是系统指令；
- 不执行宏、脚本、链接或嵌入对象；Mammoth 结果不直接渲染 HTML，外部文件访问保持禁用；
- Parser 在 worker/受限后端运行，设置文件大小、页数、时间和内存上限；
- 知识来源有审核/启用状态；检索、生成、执行保持三条权限边界。

OWASP 明确指出 RAG 不能完全消除 prompt injection，外部文件的间接注入可能影响连接系统并导致命令执行；其建议包括外部内容隔离、最小权限和高风险人审。Electron 官方也提醒其代码可访问文件系统和 shell，不可信内容风险高，应保持 context isolation/sandbox、校验 IPC sender，且不向渲染层暴露任意文件读取或原始 Electron API。

## 10. 评测与验收

从可使用的真实 FiberHome 文档建立黄金问题集，覆盖端口、光模块、时钟、限速、命令模式、不同型号/版本差异、文档中不存在的问题、含恶意指令的文档。每题记录正确来源、适用性、允许命令、是否应拒答和风险级别。

指标：Recall@5、MRR/nDCG、引用精确率、命令/参数/模式正确性、版本适用性、无证据拒答、安全回归、导入/查询耗时、P95、峰值内存、索引体积、Windows 打包烟测。

首个演示验收：

1. 至少导入 PDF、DOCX、MD/TXT 各一份并显示错误/警告；
2. 三个代表问题返回真实引用；
3. “端口限速”给出有证据的建议命令；
4. 无 embedding 时仍可检索；
5. 无证据不编造来源；
6. Ask 不主动执行；点击运行仍是用户显式操作，并按项目执行策略处理；
7. 恶意文档文字不会触发 Agent 工具；
8. 针对性单测、`npm run build`、Windows 安装/运行烟测通过。

具体正确率阈值应在真实语料基线后固定，不能在研究阶段凭空承诺。

## 11. 分阶段计划

### R0：技术 Spike

- 用脱敏样本文档验证 PDF.js/Mammoth 结构；
- 在 Electron 41 开发版与安装包探测 `node:sqlite`、`PRAGMA compile_options`、FTS5；
- MiniSearch 自定义 tokenizer 跑 20–30 个黄金问题；
- 固定知识目录、schema、Module Interface 和 fixture；
- 不改 Ask/Agent 行为。

### R1：本地知识库 + Ask 引用（首个可见版本）

- 导入、列表、状态、删除、重建 UI；
- 四格式解析，扫描 PDF 警告；
- 切片、元数据、MiniSearch；
- Ask 自动检索并在 AI 窗口显示引用/命令；
- 仍只允许用户主动复制/点击运行。

### R2：可选向量与混合检索

- 独立 Embedding Provider 配置/测试；
- OpenAI-compatible + Ollama Adapter；
- 哈希缓存、断点重建、向量版本、RRF；
- 与 lexical-only 对比，显著改善才默认启用。

### R3：Agent 知识工具

- `search_fiberhome_knowledge`；
- 设备命令执行前检索策略与 `evidenceIds`；
- 接入统一分级审批网关；
- 注入、版本冲突、无证据回归测试。

### R4：有真实规模需求再做

SQLite FTS5/sqlite-vec 或服务端 Adapter、OCR、表格专项、reranker、知识包签名/发布、多租户和集中审计。

## 12. 下一开发会话建议边界

不要一次实现 R1–R3。首个分支只交付 R0 + R1 的最小纵切：固定少量真实脱敏资料与黄金问题；建立 RAG Module；先完成 MD/TXT 与 PDF，随后小提交补 DOCX；完成 MiniSearch 与引用；接入 Ask；单测、构建和 Windows 烟测。用户看到效果并验收后，再决定 embedding 与 Agent。

## 13. 已知限制

- 真实资料的版权、保密等级和是否允许发云模型需项目方确认；
- 未拿到真实样本，切片/tokenizer/元数据参数只是起点；
- OCR、复杂表格、拓扑图和图片说明不在 MVP 保证范围；
- MiniSearch 上限需在目标 PC 用真实语料压测；
- Electron 41 的 `node:sqlite`/FTS5 必须运行时实测，不能从在线 Node 文档直接推断；
- 不同产品线 CLI 差异需元数据与设备识别共同处理；
- RAG 降低幻觉但不保证命令正确，也不替代审批和回显校验；
- DeepSeek 能力可能更新，应定期按官方文档复核。

## 14. 一手资料

- [DeepSeek API Reference](https://api-docs.deepseek.com/api/deepseek-api/)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [PDF.js Getting Started](https://mozilla.github.io/pdf.js/getting_started/) 与 [Examples](https://mozilla.github.io/pdf.js/examples/)
- [Mammoth.js 官方仓库](https://github.com/mwilliamson/mammoth.js/)
- [MiniSearch 官方仓库](https://github.com/lucaong/minisearch)
- [SQLite FTS5 官方文档](https://www.sqlite.org/fts5.html)
- [Node.js `node:sqlite`](https://nodejs.org/api/sqlite.html)
- [Electron `@electron/rebuild`](https://packages.electronjs.org/rebuild/)
- [sqlite-vec 官方仓库](https://github.com/asg017/sqlite-vec)
- [OpenAI `text-embedding-3-small`](https://developers.openai.com/api/docs/models/text-embedding-3-small)
- [Ollama Generate embeddings API](https://docs.ollama.com/api/embed)
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
