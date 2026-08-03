# FiberTerm RAG MVP 发现与决策

## 需求

- 当前只实现 RAG-M0 与 RAG-M1；排除 Agent RAG 工具、命令执行、embedding、向量库、PDF/DOCX/OCR、Python 服务、CMDB/RBAC 和品牌改造。
- Ask 仅可检索与回答；终端写入次数必须为 0，RAG evidence 永远不构成执行授权。
- Ask 需要判断问题是否命中私域命令知识：有可靠命中时携带 RAG evidence；没有可靠命中时保持普通 AI 知识回答，不能用无关命令表内容污染回答。
- 公司 SPNdocs 资料只读、不得复制到仓库、不得提交或打印完整工作簿；fixtures 必须是人工构造且脱敏。
- 用户要求先完成只读检查、设计、第一批测试，之后继续增量实现并在阶段点创建本地小提交；不合并、不推送。

## 研究发现

- 起始工作区无未提交改动；`origin/codex/rag-module-research` 的 HEAD 为 `eea0170b`。
- 分支 `codex/rag-module-mvp` 已从该研究分支创建。
- RAG 是主进程侧的深模块；渲染进程仅经窄 IPC 选择文件、展示状态和引用，不能取得任意文件读取能力。
- Ask 的接缝是 `AIchat`；Agent 的接缝是 `runAgentLoop` / `agent-tools`。M0/M1 不得修改 Agent 工具或终端写入路径。
- 词法首版推荐 MiniSearch，并需自定义、版本化的中文 2/3-gram 与 ASCII CLI tokenizer；索引与查询必须共用同一 tokenizer。
- 导入流水线需要 SHA-256 去重、原子索引发布、失败保留旧索引、解析/索引版本记录，并将资料、索引和聊天/凭据数据隔离。
- `rag-module-mvp.md` 的“必须完成”清单仍列出 Agent 接入，但同一文档的交付拆分把它定义为 RAG-M2，且“新会话首个实施任务”明确只实施 M0/M1；本次按 M0/M1 排除 Agent，作为规格内的交付阶段解释。
- 实测真实 XLSX（只读）：1 个工作表 `Sheet1`，200 个有物理记录的行节点；第 1 行是 6 列表头（命令、命令视图、说明、使用范围、实例、专家解读），第 2 行起为命令记录。研究文档的“204 行”与实际物理行数不一致，应以解析器输出和测试 fixture 固定该事实，不能硬编码行数。
- 当前 `package.json` 不含 XLSX 或 MiniSearch 依赖。`AIchat` 通过 `window.pre.runGlobalAsync('AIchat', ...)` 调用，Agent 独立走 `runAgentLoop`；此分支可以仅在 Ask 请求前添加只读检索。
- 主进程的 `asyncGlobals` 通过 `ipcMain.handle('async', ...)` 暴露服务；新知识服务可保持主进程私有，在该白名单增加有限方法。文件选择已经通过主进程 dialog；渲染层没有直接 Node 文件系统 API。
- 依赖核验：SheetJS CE 的许可为 Apache-2.0，但其 npm 包存在维护和安全疑虑；不选。ExcelJS 提供 XLSX 读取、合并单元格信息与流式读取，MIT 许可，当前发布 `v4.4.0`，因此作为 M0 Spike 候选，安装时严格固定版本。
- 工作簿没有合并单元格。可作为区段识别的可靠样式是整行 `2,2,2,2`：实际可见段落从第 99、135、163、179、197、201 行开始；第 161–162 行为同样样式的空分隔行。普通命令行以样式 `1,1,1,1` 为主，少量多命令记录有其他样式组合。
- ExcelJS 的 tarball 请求曾进入 npm cache；常规安装因现有 peer 约束失败，legacy-peer 安装因网络等待超时。离线 npm 仍没有可用的 registry 元数据且清理了临时模块，不能把 ExcelJS 视为已锁定依赖。
- `npm ls` 的唯一异常是 `node-pty@1.1.0-beta14` 与 package.json 指定 beta34 不符；package/lock 没有被此次任务改动，故把它记录为既有环境状态，不主动重装或升级。
- 单测采用内置 `node:test` + `node:assert/strict`，适合在 `test/unit-ci/` 增加人工构造的 runtime XLSX fixture。
- 项目现有 lockfile 和 node_modules 已含 `yauzl@2.10.0`（MIT）及 `sax@1.6.0`（BlueOak-1.0.0）。它们分别完成惰性 ZIP 读取和事件式 XML 解析，可组合成受限、只读、纯 JS 的 XLSX parser；避免依赖 ExcelJS 的不可复现安装。
- Parser Spike 的人工 XLSX fixture 已先红后绿，覆盖区段、普通命令、单元格命令组、空列、CLI 特殊字符以及稳定来源行号；真实工作簿 smoke 与 lint 将以修正后的命令单独执行。
- Parser 的 lint 已通过，但真实工作簿 smoke 当前错误地返回 0 个单位/区段，说明人工 fixture 未覆盖真实 OOXML；将此作为阻止进入 M1 的 parser 缺陷，先进行低噪声结构诊断与回归修复。
- 诊断确认真实工作簿从 B 列开始（B–G），而人工 fixture 从 A 列开始。解析器错误地把命令列硬编码为 A；应以首个表头中“命令视图”的左侧列作为动态起点，并保留该偏移。
- 修复后的真实语料 Spike：`Sheet1` 有 7 个区段（起始行 1、99、135、163、179、197、201）与 190 个命令单位。区段标题、原始行号、原始换行及命令组均被保留；工作簿不读取宏、链接或嵌入对象。
- KnowledgeBase 单测已覆盖 JSON 原子持久化、SHA-256 去重、中文 2/3-gram、ASCII CLI token、重启恢复、删除和结构化 Evidence。它不接触终端、SSH、SFTP、Agent 或聊天历史数据。

## 技术决策

| 决策 | 理由 |
|------|------|
| 使用项目内 `.planning/rag-module-mvp/` 保存实施记录 | 让长期、多阶段实现能在上下文压缩后恢复，且不混淆已有研究计划。 |
| M0/M1 仅接入 Ask，不接入 Agent 工具 | 交付拆分与用户给定范围都将 Agent RAG 放在 M2；避免扩大权限与执行面。 |
| 首版只实现本地词法检索，不增加 embedding 或原生 SQLite 依赖 | 符合 M0/M1、Windows 打包风险最低，并确保离线可用。 |
| 知识模块作为 `src/app/lib` 的主进程服务，通过有限 IPC 使用 | 与现有 AI/IPC 架构相容，保持解析、索引和原文件读取不进入渲染进程。 |
| 选择 `yauzl@2.10.0` + `sax@1.6.0` 作为 XLSX parser Spike 依赖，排除 SheetJS 和无法锁定的 ExcelJS | 两者已被项目 lockfile 固定、均为纯 JS 和允许许可证；ZIP/XML 的最小实现能精确控制仅读取 XLSX 所需部件。 |
| XLSX 区段由表头样式识别，空的同样式行跳过 | 实际工作簿不存在合并单元格；样式 2 的表头行能稳定划分后续命令区段。 |
| 在依赖无法可靠锁定前不开始依赖 ExcelJS 的产品代码 | 当前 registry/cache 无法完成可复现安装；先检查并恢复项目现有依赖树。 |
| parser 由“命令视图”表头动态定位第一个有效列 | 真实资料从 B 列起；固定 A 列会导致空索引。 |
| Ask 的私域/公域路由以检索相关性为准 | 私域命中才给模型命令证据；无命中或低相关度时保留正常 AI 逻辑。 |
| Agent 模式即为只读查询执行授权 | 用户确认：已切到 Agent 且知识可靠、设备已连接时，不应再要求输入“执行”；配置或其他改动仍不得自动执行。 |
| 下一版知识库聚焦巡检与故障诊断 | 命令手册维持当前形态；优先导入包含告警、根因和处理方法的巡检手册。公共协议原理保留给大模型，私域 RAG 重点存厂商差异、版本差异、回显/告警判读与处置经验。 |

## 遇到的问题

- Windows 本机的 npm 用户配置把默认 cache 指向 `E:\Nodejs\node_cache`，曾导致权限错误；出包流程现已固定使用项目内 `.cache/npm-packaging`。
- 2026-08-03 实测 npm 官方 registry PING 约 1008ms，`registry.npmmirror.com` 约 265–325ms。仅本地出包流程默认使用该镜像并优先复用缓存，可用 `FIBERTERM_PACKAGE_REGISTRY` 覆盖；不修改用户全局 npm 配置。
- 当前安装包尝试的阻塞原因是执行环境 64 秒时限，而不是 registry 不可达：npm 日志记录了持续成功的依赖下载。

| 问题 | 解决方案 |
|------|---------|
| 附件在默认 PowerShell 解码下显示乱码 | 改用 UTF-8 解码；需求内容已确认。 |
| 研究资料称 XLSX 有 204 行，实际工作表物理行节点为 200 | 用真实解析输出作为 M0 的准绳；后续 parser 测试不依赖文档中的硬编码行数。 |
| 初次源代码搜索 PowerShell 引号不匹配 | 使用分步、单引号正则重试；未修改文件。 |
| 首次 web 工具结果按错误包装解包 | 改为直接记录工具返回值后成功完成依赖核验。 |
| npm 离线解析 ExcelJS ENOTCACHED，临时模块被清理 | 不重复安装；先检查项目 node_modules 的完整性。 |
| 预设 unit-ci 测试文件不存在 | 改读实际 `test/unit-ci` 文件，采用仓库既有 node:test 模式。 |
| 规划更新补丁上下文不匹配 | 重读当前文件后再以准确上下文修改。 |
| ExcelJS 安装无法完成可复现 lockfile | 不再进行网络重试，采用已锁定的 `yauzl` + `sax` 实现受限 OOXML parser。 |
| `npm ls` 报 node-pty beta 版本不匹配 | 既有 node_modules 状态；不改变无关依赖。 |
| 知识检索返回同含“状态”的时钟候选 | 测试固定“端口命令为第一名”而非错误要求仅返回一个结果；词法 Top-N 是预期行为。 |
| 实际 XLSX Node 内联脚本括号不完整 | 采用简单的命名 async 函数重试。 |
| Standard 写入用户缓存目录受限 | 使用项目 `.cache` 作为 `XDG_CACHE_HOME`。 |
| Node 实际解析命令被 PowerShell 直接解释 | 使用 here-string 交给 `node -`。 |
| 管道源代码中的中文路径被错误解码 | 以环境变量传递路径。 |
| 真实 XLSX 返回 0 个解析单位 | 分析 OOXML tag/attribute 差异并增加回归覆盖。 |
| 真实工作簿起始列为 B，parser 假定 A | 令 parser 从 header 语义推导列偏移，并把 fixture 改为 B–G。 |

## 资源

- 需求源：用户附件 `pasted-text.txt`（按 UTF-8 读取）。
- 项目文档：`docs/features/rag-module-mvp.md`、`docs/research/rag-module-study.md` 及用户列出的 ADR/产品文档。

## 视觉/浏览器发现

- 本任务暂未使用视觉或浏览器资料。
