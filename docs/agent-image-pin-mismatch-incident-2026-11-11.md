# Agent 镜像 pin 漂移事故记录（2026-11-11）

## 现象

部署 artifact handoff 候选后，公网 Auth 的电脑控制请求返回 `BROKER_REJECTED` / HTTP 503；Desktop Broker 对 `/v1/personal-computer` 记录 `RESOURCE_MISMATCH`。聊天任务停在 `Queued · waiting for your computer`，不能据此算作 E2E 通过。

## 已确认根因

user namespace `grok-user-00213195e832242e4afea5b264424355` 的不可变 `desktop-image-pin` 将 Desktop 与 Agent 都钉在 `coke-grok-desktop:sha-2670fed3f6830a2344ac7590d5856901e190b00d`。部署时只把该 namespace 的 Agent Deployment 更新成 `coke-grok-desktop:bot-artifact-handoff-20261111-r1`，未同步不可变 pin。Broker 以 pin 生成期望资源，再校验现有 Deployment，因此检测到 Agent image 不一致并拒绝控制请求。

此外，候选 tag `bot-artifact-handoff-20261111-r1` 不符合当前 `isValidDesktopImageRef` 规则（仅接受 `sha-<40位小写十六进制>` 或 `candidate-...`）；不能用于新 pin/新 namespace。

## 恢复与保护

- 将 Auth runtime 的新租户 Agent 默认镜像恢复为 pinned SHA。
- 只回滚 Agent Deployment 到同一 SHA；没有重启 Desktop/Chrome Pod，没有改动不可变 ConfigMap、PVC、MySQL 或 K3D 集群。
- 验证 Agent、Desktop 和 pin 三者一致；回滚后 Broker/Auth 最近日志窗口内没有再出现 `RESOURCE_MISMATCH` / `BROKER_REJECTED`。
- Auth 候选仍保留 `open_artifact` 无逐步审批修复。未清除 Docker/K3D 中候选镜像。

## 下次避免

Desktop/Agent 镜像升级必须使用符合校验规则的不可变 tag，并通过发布流程原子协调目标租户 pin、Agent Deployment 和未来租户默认配置；禁止只 `kubectl set image` 更新已有租户 Agent。部署前读取并比较所有目标用户 namespace 的 `desktop-image-pin` 与现有 Deployment；部署后必须用公网已登录 Chrome 验证 Broker 控制请求、Browser User `open_artifact` 和实际页面交互。

## 验收状态

环境镜像漂移已恢复。随后 2026-11-11 17:09（Asia/Shanghai）通过已登录公网 Chrome 实际提交 BSE 前端续作，Bot 在真实云电脑 Chrome 打开 `artifacts/bse-demo/index.html`，点击“委托校验”通过（920001、买入、12.50、1000 股、金额 12,500.00），点击“模拟下单”生成模拟委托 `SIM8813436801` 并显示“已受理”。这证明本次 Browser User 打开和模拟页面交互恢复。

但该 Bot 随后报告当前运行时的 `bot_handoff` 工具不支持 `fileIds`，因此只把路径发给 BSE 端到端测试 Bot；测试 Bot 是否收到文件副本、能否从自己的附件目录打开并完成测试，仍未验证。回滚到旧 Agent SHA 恢复了 Broker，但也意味着尚未部署当前分支的文件交接能力。不得把页面点击成功描述为完整多 Bot E2E 成功。

本次 Chrome 扩展按 URL 绑定现有标签页超时；可见原生 Chrome 中有多个同 URL 标签。改用 CUA 原生 Chrome 窗口与可访问性树完成公网 UI 操作后成功。下次遇到标签绑定超时，改走原生 Chrome 的可见窗口/标签操作，不要循环重试扩展绑定。
