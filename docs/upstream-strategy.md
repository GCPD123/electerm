# Electerm 上游同步策略

## 远程仓库角色

- `origin`：`https://github.com/GCPD123/electerm.git`，用户自己的 Fork，用于保存 FiberTerm 分支。
- `upstream`：`https://github.com/electerm/electerm.git`，Electerm 官方仓库，只作为上游来源。

## 分支角色

- `master` 用于跟踪 Fork 中的官方代码线，不承载 FiberTerm 日常产品开发。
- `codex/smartterm-base` 固定一个经过验证的官方基线，便于复现和对照。
- `codex/smartterm-main` 是经过用户验收后的 FiberTerm 集成线。
- 每项研究或功能从产品主线建立独立 `codex/<topic>` 分支。

## 同步流程

1. 获取 `upstream` 最新引用，不立即改动产品分支。
2. 查看官方发布标签、提交范围和迁移说明，选择明确目标版本。
3. 在独立的 `codex/upstream-<version>` 分支演练同步。
4. 先运行官方基线测试，再处理与 FiberTerm 修改重叠的冲突。
5. 对终端提示符、SSH/SFTP、AI、配置、用户数据路径和品牌水印执行专项回归。
6. 完整审查差异并由用户验收后，才合并到 `codex/smartterm-main`。
7. 更新基线版本、路线图和冲突记录。

## 冲突原则

- 冲突是正常现象，不代表无法同步。
- 不用 `git reset --hard`、强制推送或整文件覆盖来“快速解决”冲突。
- 先理解上游意图与 FiberTerm 改动目的，再做最小兼容调整。
- 若同一上游核心区域长期反复冲突，应把 FiberTerm 逻辑移到更独立的模块或适配层。
- 上游同步与新功能开发分开进行，不在同一分支混合提交。

## 向官方贡献

适合所有 Electerm 用户的通用修复，应从干净的官方 `master`/目标基线建立单独分支，只包含通用改动、测试和英文说明，然后从 Fork 向 `upstream` 提交 Pull Request。FiberTerm 品牌、公司策略和专有功能不应混入官方 PR。
