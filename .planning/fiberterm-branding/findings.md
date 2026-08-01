# FiberTerm 品牌化发现

## 已确认品牌方向

- 产品名称：FiberTerm
- 公司名称：FiberHome
- 中文定位：企业智能运维终端
- 视觉方向：深色界面、FiberHome 蓝为主色、橙色少量强调。
- 品牌层级：FiberTerm 为产品主品牌，`by FiberHome` 为公司背书。
- 小尺寸图标建议使用独立方形 FT 标识，完整 FiberHome Logo 只用于空间充足的位置。

## 品牌资源待办

- 用户当前提供的是低分辨率截图，只用于确定视觉方向。
- 正式实现前必须取得 FiberHome 官方 SVG 或透明高清 PNG。
- 正式公司 Logo 不使用 AI 重绘结果替代。

## 代码定位

- `package.json` 的 `name` 当前同时参与运行时名称，直接改名可能影响 Electron 的应用身份与用户数据路径，因此保留内部名 `electerm`。
- 新增独立的 `productName`、`companyName`、`productTagline` 作为展示层品牌字段。
- 窗口标题入口位于 `src/app/lib/create-window.js` 和 `src/app/lib/ipc.js`。
- 开发/构建网页标题入口位于 `build/vite/dev-server.js` 与 `build/bin/pug.js`。
- 启动加载画面位于 `src/client/views/index.pug`。
- 关于页品牌头部位于 `src/client/components/common/logo-elem.jsx`，关于页正文位于 `src/client/components/sidebar/info-modal.jsx`。
- 第一阶段不修改应用 ID、协议名、命令行名、用户目录和升级服务器。

## 首次视觉验收问题与结论

- 首轮改动集中在短暂启动画面和需要手动打开的关于页，主操作界面缺少持续可见的品牌标识，用户正常使用时看起来与原版相同。
- 5570 端口上还运行着修改前启动的旧 Vite 服务；它缓存的页面标题仍是 `electerm`。
- 修正方案：顶部标签栏持续显示 `FT + FiberTerm + by FiberHome`，左上角菜单图标改为 FT，并彻底重启项目自己的 Vite/Electron 实例。
- 新服务自动验证结果：HTML 标题为 `FiberTerm`，启动品牌与顶部持久品牌源码均通过断言。

## 水印回归与质量约束

- 首版 FiberHome 水印通过 `content` 和 `display:flex` 改写了 xterm 的伪元素内容层，导致本地终端提示符不可见。
- 正确实现必须保持 xterm 原有伪元素语义，只允许替换 `background-image`，不得修改 `content`、`display`、对齐或布局属性。
- 已加入 `test/unit-ci/fiberterm-watermark.spec.js`，自动锁定上述约束，并覆盖空白主页不使用覆盖型伪元素。
- 后续品牌改动必须执行：针对性规范检查、回归测试、正式构建、实际功能验收；不能仅凭编译成功宣告完成。
- Electron 的标准 `productName` 字段可能被框架提前用于应用数据目录，因此第一阶段改用自定义 `displayName`；内部 `name` 继续保持 `electerm`。
- 安装包正式名称和数据目录迁移必须留到独立阶段验证，不能混入界面品牌提交。
