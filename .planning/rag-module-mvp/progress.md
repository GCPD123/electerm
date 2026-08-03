# FiberTerm RAG MVP 进度日志

## 会话：2026-08-02

### 阶段 1：只读发现与 XLSX Spike

- **状态：** complete
- 执行的操作：
  - 读取用户需求、项目协作规则及持久化规划技能说明。
  - 核验工作区无未提交改动，研究分支本地/远端为 `eea0170b`。
  - 从 `codex/rag-module-research` 创建 `codex/rag-module-mvp`。
  - 建立本次专用的持久化计划、发现与进度记录。
  - 完整阅读产品、架构、路线图、RAG 范围/MVP/研究及 Ask/Agent 安全边界文档。
  - 识别规格中 Agent 条目与 M0/M1 分期的表面歧义；以同文档的交付拆分和当前范围确定本分支不实现 Agent RAG。
  - 精确检查 Ask/Agent、主进程 IPC、preload 以及真实 XLSX（只读）。
  - 确认真实工作簿为 1 个工作表、6 列、200 个物理数据行节点；与研究文档中 204 行的说法存在差异。
  - 核验 SheetJS 与 ExcelJS 的许可/维护状态；暂选 ExcelJS 4.4.0 进入 parser Spike。
  - 读取真实工作簿样式与合并信息：无合并单元格，6 个可见区段表头与 2 个空样式分隔行。
  - 第一次 npm 安装受项目既有 peer 冲突阻止，兼容模式安装超时；确认 ExcelJS 已缓存，改走离线 lockfile 固化。
  - 离线固化发现 npm cache 没有 ExcelJS registry 元数据且临时目录被清理；停止重复安装，准备核验现有开发依赖是否受影响。
  - 确认测试基线使用 `node:test` 与 `node:assert/strict`。
  - 确认 node_modules 的既有 `node-pty` 版本不匹配未由本任务引起；选择已有、锁定的 `yauzl@2.10.0` + `sax@1.6.0` 作为受限 XLSX parser Spike 依赖。
  - 新增 parser runtime fixture 测试；先验证模块缺失的红灯，随后实现并得到绿灯。
  - Parser fixture 与 Standard lint 通过；真实工作簿 smoke 暂返回 0 个单位，已停止后续模块实现并转入 parser 诊断。
  - 诊断真实 OOXML：行/单元格均可读，实际列为 B–G；将新增非 A 列起点的回归测试。
  - 修复动态列偏移后，真实 XLSX smoke 解析出 7 个区段和 190 个命令单位；fixture 与 Standard lint 均通过。
  - 新增并通过 KnowledgeBase 单测：哈希去重、持久化/重启、中文/CLI 检索、删除和 Evidence 来源。
  - 接入主进程知识 IPC、AI 面板知识库管理 Modal、Ask 请求前检索及来源标签；未修改 Agent 或终端路径。
  - 通过 Ask 零写入边界测试、三项 RAG 专项单测、Standard 和 `npm run build`。
  - 用户补充确认：Ask 应仅在私域命令知识相关时使用 RAG；公共知识问题保持普通 AI 回答。开始补充相关性路由回归测试。
  - 真实导入评测：190 条安全命令入库，1 个敏感字段被跳过；20 个 SPN 问题可返回候选，两个公共问题无私域候选。部分泛化问题排序仍需优化。
  - 调整中文检索：剥离“查看、设备、状态”等通用套话后再匹配关键术语，并提高用户问题与命令说明的匹配权重；“时钟、端口、光模块、温度”等问题可带入私域证据，公共问题仍不命中。
  - 建立 20 条本地黄金问题并完成真实工作簿检索评测：19 条有可靠私域证据；“查看 NTP 状态”在当前命令表中无可靠命中，按设计回退普通 AI。
  - 自动验证通过：4 组 RAG 专项测试、Standard lint、正式 Vite 构建全部成功。以浏览器打开本地开发页面无控制台错误；该页面因没有 Electron preload 权限而停在启动画面，不能替代桌面端的本地文件导入烟测。
  - 追加本地提交 `dcf00b44 fix(rag): prioritize specific Chinese query terms`；真实命令表与 `.planning` 本地评测记录均未提交。
  - 用户桌面端点击 AI 时捕获到明确错误：`knowledge-routing.js` 未提供浏览器命名导出。新增浏览器模块加载回归测试，将该文件从 CommonJS 改为 ESM 导出；测试、开发服务模块检查和专项套件均通过，修复提交为 `815fbc19 fix(rag): expose routing helper to browser`。
  - 用户点击 Import XLSX 无反应时，确认 Modal 误用了 `window.pre.openDialog`；桌面 preload 实际只在 `window.api.openDialog` 暴露文件选择器。新增该桌面接口回归测试并修复调用，6 项专项测试均通过，修复提交为 `5e740e15 fix(rag): use desktop workbook picker`。
  - 用户确认真实 SPN XLSX 已在 Electron 桌面端成功导入；修复原有 Windows 开发启动命令的 Unix 路径与不存在的打包入口，新增启动脚本回归测试，7 项专项测试通过，修复提交为 `dc02750a fix(dev): use cross-platform Electron launcher`。下一步仅剩 Ask 的实际回答和引用展示烟测。
  - 用户确认 Ask 已实际检索命令表并展示文档、工作表、区段和行号来源；RAG-M1 的真实桌面验收完成。用户明确要求继续，计划新增 RAG-M2：Agent 先调用只读知识检索工具，再沿用既有确认路径决定是否执行。
  - RAG-M2 实现：新增只读 `search_fiberhome_knowledge` Agent 工具；每次 Agent 请求在模型规划前自动执行预检索并展示工具卡片，模型可按需再次查询。新增先检索/不发终端命令的回归测试；9 项专项测试、Standard 和正式 Vite 构建均通过，尚待真实 Agent 烟测。
  - 用户确认真实 Agent 烟测通过：先显示 `search_fiberhome_knowledge`，再回答，且未出现 `send_terminal_command`。RAG-M2 完成。用户要求继续，进入本地 Windows 安装包交付准备；现有 NSIS 脚本会删除 `dist`，需先改为安全的本地出包流程。
  - 新增 `package:win-local` 与独立 `dist/fiberterm-local` 输出目录，并以回归测试保证不上传、不中断旧 `dist`。打包准备改用项目内 `.cache/npm-packaging`，生产依赖安装失败会明确终止，缺少 Yarn 时仅跳过可选清理。
  - 10 项 RAG/启动/出包脚本回归测试及 `npm.cmd run build` 均已通过。实际出包仍未产生安装程序：npm 正在正常下载生产依赖时被执行环境 64 秒时限强制中断；不得将其表述为已完成的安装包。
  - 检查 npm：官方 registry PING 约 1008ms，国内镜像约 265–325ms；默认 E 盘缓存曾有权限问题。出包准备改为使用项目缓存、国内镜像和 `--prefer-offline`，仍可通过 `FIBERTERM_PACKAGE_REGISTRY` 覆盖。相关回归与 lint 已通过。
  - Agent 受控执行：新增硬性策略。只有可靠烽火知识、用户明确执行意图和 `display`/`show`/`ping`/`tracert`/`traceroute` 只读命令同时满足时，`send_terminal_command` 才会运行；无依据、普通提问和配置类命令都会在发送前拦截。13 项 RAG/启动/出包专项测试及正式构建通过，待真实连接设备完成低风险烟测。
  - 用户确认产品交互规则：Agent 模式本身即授权低风险只读执行，不应重复要求输入“执行”。已移除该额外条件；可靠知识 + 已连接终端时，查询类命令会自动运行，配置类命令仍被拦截。13 项专项测试及正式构建通过。
  - Agent 界面增加可见执行提示：已连接设备时只读烽火查询自动运行，改动性操作需要审核；对应测试与正式构建通过。
  - 同步更新 RAG MVP 说明文档：Ask/Agent 桌面验证、只读自动执行规则和真实设备烟测的剩余边界均与当前实现一致。
  - 用户确认暂停本版本功能开发，先到真实环境试用；已记录后续 RAG-M4 路线：以巡检手册的告警、根因和处理方法为核心，支持 PDF/DOCX 等文档、本地 SQLite 大规模存储、脱敏回显判读与可配置混合检索。命令手册维持当前版本，通用网络知识继续由大模型提供。
- 创建/修改的文件：
  - `.planning/rag-module-mvp/task_plan.md`
  - `.planning/rag-module-mvp/findings.md`
  - `.planning/rag-module-mvp/progress.md`

## 测试结果

| 测试 | 输入 | 预期结果 | 实际结果 | 状态 |
|------|------|---------|---------|------|
| Git 基线核验 | 工作区、远端研究分支 | 工作区干净且提交为 `eea0170b` | 符合 | 通过 |
| XLSX 结构读取 | 仓库外真实工作簿 | 不修改文件并识别工作表/列 | 1 表、6 列、200 个物理行节点 | 通过 |
| XLSX 依赖核验 | SheetJS 与 ExcelJS 官方仓库 | 选取纯 JavaScript、许可合适且持续维护的候选 | 选 ExcelJS 4.4.0；排除 SheetJS npm 包 | 通过 |
| XLSX 区段结构读取 | 仓库外真实工作簿 | 识别区段、不读取/复制全表 | 6 个可见区段，样式表头行可识别 | 通过 |
| 可复现依赖检查 | package-lock 与本地 node_modules | XLSX parser 依赖无需外部下载 | `yauzl` + `sax` 均存在且已锁定 | 通过 |
| XLSX parser fixture | 人工构造、脱敏 XLSX | 保留结构化命令语义与来源 | 通过 | 通过 |
| KnowledgeBase | 人工解析结果与临时本地目录 | 去重、检索、重启恢复、删除 | 通过 | 通过 |
| Ask RAG boundary | Ask 请求实现 | 检索期间无终端/Agent 调用 | 通过 | 通过 |
| 正式前端构建 | `npm.cmd run build` | Vite production build 成功 | 通过 | 通过 |
| 真实导入与黄金问题初测 | SPN XLSX、20 个 SPN 问题、2 个公共问题 | 私域检索与公域回退 | 20 个有候选；2 个无候选；泛问排序待优化 | 进行中 |
| 真实 XLSX parser smoke | 仓库外真实工作簿 | 返回命令单位和区段 | 190 单位 / 7 区段 | 通过 |

## 错误日志

| 时间戳 | 错误 | 尝试次数 | 解决方案 |
|--------|------|---------|---------|
| 2026-08-02 | 默认 PowerShell 解码导致附件乱码 | 1 | 显式指定 UTF-8。 |
| 2026-08-02 | 组合 PowerShell 搜索命令引号不匹配 | 1 | 拆分搜索并使用单引号正则。 |
| 2026-08-02 | Web 工具返回包装假设错误 | 1 | 直接处理工具返回值。 |
| 2026-08-02 | npm 常规安装 ERESOLVE | 1 | 使用 `--legacy-peer-deps`。 |
| 2026-08-02 | npm 兼容模式安装超时 | 1 | 确认缓存，使用离线 lockfile 更新。 |
| 2026-08-02 | npm 离线安装 ENOTCACHED | 1 | 先检查 node_modules 完整性。 |
| 2026-08-02 | 预设 unit-ci 测试文件不存在 | 1 | 读取真实测试文件。 |
| 2026-08-02 | 规划补丁上下文不匹配 | 1 | 重读规划文件后重试。 |
| 2026-08-02 | npm 离线安装 ENOTCACHED | 1 | 采用已锁定的 ZIP/XML 解析库。 |
| 2026-08-02 | npm ls 显示 node-pty beta 版本不匹配 | 1 | 视为既有环境状态，不修改。 |
| 2026-08-02 | 实际 XLSX Node 内联脚本语法错误 | 1 | 用命名 async 函数重试。 |
| 2026-08-02 | Standard 默认缓存目录无写权限 | 1 | 指向项目 `.cache`。 |
| 2026-08-02 | PowerShell 解释 Node 脚本 | 1 | 使用 here-string 管道。 |
| 2026-08-02 | Node 管道内中文路径乱码 | 1 | 使用环境变量。 |
| 2026-08-02 | 真实 XLSX 解析为空 | 1 | 诊断 OOXML 差异并补充回归。 |
| 2026-08-02 | 中文“状态”检索得到多个候选 | 1 | 验证期望端口命令排第一，保留 Top-N。 |

## 五问重启检查

| 问题 | 答案 |
|------|------|
| 我在哪里？ | 阶段 1：只读发现与 XLSX Spike。 |
| 我要去哪里？ | 完成 parser、知识模块、UI/Ask 集成、验证与交付。 |
| 目标是什么？ | 完成安全且可追溯的 FiberTerm RAG-M0/M1。 |
| 我学到了什么？ | 见 findings.md。 |
| 我做了什么？ | 核验基线、创建分支和规划记录。 |
