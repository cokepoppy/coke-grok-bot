# BSE 云电脑本地预览连接失败

日期：2026-11-11（Asia/Shanghai）
状态：根因已由源码与 K3D 实测确认；2026-11-11 已在真实云电脑 Chrome 通过受管 artifact 打开并点击页面控件。Worker 首轮 HTTP 400 的具体异常未确认；独立 Tester、GitHub PR 和 Pages 尚未验收。

## 症状

BSE 开发 Bot 生成的页面文件位于租户工作区，但云电脑 Chromium 打开 `http://127.0.0.1:8765/` 时显示 `ERR_CONNECTION_REFUSED`。失败的是云电脑内部的本地预览连接，不是公网入口或 Google 外网代理。

## 已确认根因

1. **终端命令中的后台服务器会被执行器主动清理。** `computer_terminal` 通过 `runApprovedTerminal()` 在 Agent 容器运行命令。该函数启动独立进程组，并在 `finally` 中对整个进程组发送 `SIGKILL`。因此从终端命令返回后，`nohup ... &` 不能让服务器持续运行。本轮 Agent Pod 只剩一个 `[nohup] <defunct>` 进程，没有 `http.server` 监听。
2. **Agent 和显示 Chrome 的 Desktop 是不同 Pod，loopback 不共享。** 两个 Pod 都挂载同一个 `/workspace` PVC，所以 HTML、CSS 和 JS 文件可共享；但网络命名空间和 `127.0.0.1` 各自独立。Browser User 的 Chromium 进程运行于 Desktop Pod，而终端命令在 Agent Pod 运行。即使 Agent Pod 上的 `127.0.0.1:8765` 有服务，Desktop Pod 的 `127.0.0.1:8765` 也不是它。

## 实测证据

- Mac K3D context：`k3d-tp1121-sandbox-dev`。在用于 BSE 的现有用户 namespace 中，Agent Pod IP 为 `10.42.0.201`，Desktop Pod IP 为 `10.42.0.200`；两者共享 `workspace` PVC，但不是同一个 Pod。
- 临时在 Agent Pod 的 `127.0.0.1:8765` 启动只返回固定测试文本的 Node HTTP 监听器。Agent Pod 请求该地址得到 HTTP 200 和 `agent-loopback-proof`；同时从 Desktop Pod 请求其自己的 `127.0.0.1:8765` 得到 `ECONNREFUSED`。
- 临时监听器随后已 Ctrl-C 停止，并再次确认 Agent、Desktop 两侧都没有 8765 监听。没有创建/删除/重启 Pod 或容器，没有改 PVC、NetworkPolicy、镜像或代理配置。
- 运行中的 Chromium 命令行位于 Desktop Pod。`deploy/desktop/computer-tools.mjs` 中 `runApprovedTerminal()` 的 `finally` 会终止子进程组；`src/server/desktop-resources.ts` 将 Desktop 与 Agent 拆成不同 Deployment，并让两者挂载 `workspace` PVC。
- 当前任务共享工作区中的 `artifacts/bse-demo/` 已有 `index.html`、样式和脚本；问题在页面的服务/访问路径，不是页面文件缺失。

## 正确修复方向

- 不要再从 Agent 的 `computer_terminal` 通过 `nohup` 启动持久预览服务；终端工具有意在每次命令结束时清理进程组。
- 不要把 Agent 服务绑定到 `0.0.0.0` 或扩宽租户 NetworkPolicy 来绕过问题。当前分离隔离是设计边界，桌面 Pod 网络策略只开放必要端口。
- 后续用云电脑显示页面时，应由 Desktop Worker 提供经任务目录校验的只读 artifact preview，或在 Desktop Pod 内加入受管理、仅本机可访问的预览服务。必须让最终的 Chromium 实际加载该页面，并从 Chrome 所在网络命名空间验证标题/内容和 UI 点击；`Agent` 内 `curl 200`、Pod Ready 或静态文件存在都不算通过。
- 验证流程需分开检查：(a) 服务进程是否仍运行；(b) Desktop Chromium 是否能连上；(c) 页面是否可见且交互；(d) 公网代理/外网是否正常。修复本地预览不能改变云电脑外网代理的诊断结论。

## 后续验收

2026-11-11，BSE 前端开发续作在本机 K3D 运行，并通过签名态公网 UI 触发真实 Pi/DeepSeek。Bot 在任务目录生成 `artifacts/bse-demo/index.html`，通过 Browser User `open_artifact` 打开云电脑 Chromium 的 `file:///workspace/tasks/be84721e-3ccd-42e2-afaa-0dc85fbc826d/artifacts/bse-demo/index.html`。页面标题为“北交所模拟交易终端（纯模拟）”；随后 Browser User 点击“委托校验”和“模拟下单”，页面出现校验结果及 `#1 920001 示例科技 买入 11.20 × 100 股 已受理（模拟）`。可见聊天中的 Bot 电脑截图显示该页面与模拟委托记录。没有连接真实券商/行情。

同一 run 的执行详情有多次 `open_artifact failed` 后成功；Bot 总结记录首轮 Worker HTTP 400、当时 URL 为 `chrome-error://chromewebdata/`，同参数重试后成功。受限诊断没有保留 400 的具体 Worker 异常，故其子原因仍未知，应与已证实的 localhost 拒绝连接分开记录。当前实际 Chrome 证据证明 artifact 打开与两个页面控件已运行，但独立 Tester、多 Bot 后续阶段、PR/Pages 仍未完成；不能把这次开发验证称为完整项目端到端验收。
