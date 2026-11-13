# BSE Chief 群任务电脑未连接现象

日期：2026-11-11

## 现象

公网 Grok Bot 群组“北交所交易规则适配项目组”中，17:33 发给 Chief 的阶段协调任务仍显示 `Queued · waiting for this Bot’s computer…`。在群组详情选择 Chief 的 Computer 后，Chrome 可访问性树显示 `Computer not connected` 和 `Chief's screen · Waiting for computer`。

## 已确认的证据

- 以上状态来自已登录公网 Chrome 的实际页面，不是本机 UI 预览。最初读取发生在选择 Chief 电脑后的首次面板加载期间。
- K3D 中对应测试用户命名空间 `grok-user-00213195e832242e4afea5b264424355` 的 Agent 与 Desktop Pod 均为 `1/1 Running`；两个 Service 均有对应 Pod endpoint。
- 随后的公网 Chrome 可见刷新已显示 `Current computer screen`、`Bot is in control`；截图是 Chrome `about:blank`。同一时刻 Chief 任务仍显示 `Queued · waiting for this Bot’s computer…`。
- 因此已排除“Agent/Desktop Pod 不在运行”及“Service 没有 endpoint”这两个原因；后续截图证明屏幕读取恢复可见，但没有 API 级 HTTP 证据说明首次空态原因，也没有确认任务排队是否由电脑连接故障直接导致。
- 当前证据不足以把问题归因于镜像 pin、Broker、浏览器控制权或用户接管；没有重启 Pod、清理任务或重放该排队任务。

## 代码路径与排查规则

`ComputerPanel` 先请求 `GET /api/bots/{botId}/computer` 获取 owner，再请求 `/screenshot` 获取 PNG。任一步骤失败都会清空 owner 和当前图像，面板统一显示 `Computer not connected`；诊断中原本包含请求阶段、HTTP 状态和安全诊断码。因此这个文案不是根因，Pod Ready 也不能代表屏幕请求已通。

下次遇到时，先针对同一 Bot 分别核对状态请求和截图请求的 HTTP 状态及安全诊断码，再沿 UserComputer → Broker → 对应租户 Agent/Desktop Service → Worker 追踪。先保留 queued run、桌面 PVC、登录态和现有 Pod；确认失败层后只修复该层。连接恢复后先核对原任务当前状态和屏幕，再决定是否继续，不要重新提交不确定结果的任务。

## 本次状态

根因待定；首次面板空态与仍未启动的 Chief 队列是两个需分别诊断的现象。Chief 阶段任务尚未启动，BSE 多 Bot 端到端流程仍未完成。下一步应核对该 run 的队列/租约状态，并在复现空态时记录 status 和 screenshot 两个公网请求的实际返回；不要因为截图后来恢复就把队列问题标记为已修复。

## 2026-11-12 公网复查

- 已登录 Chrome 再次显示 `Computer status request: HTTP 502`，Chief 仍显示 `Queued · waiting for this Bot’s computer…`。
- 同时只读检查 K3D：Agent/Desktop 仍为 `1/1 Running`，Agent endpoint 为 `10.42.0.212:8083`，Desktop endpoints 为 `10.42.0.200:6080,8082`。
- 最近 10 分钟 Auth 日志没有 `Computer request failed`，Broker 日志也没有 `RESOURCE_MISMATCH`、`BROKER_REJECTED` 或 `desktop_connect_failed` 匹配项。
- 502 是目前观察到的浏览器 HTTP 状态，但还没有请求 ID、反向代理访问日志或同一时刻的 ingress/Auth access log 证据；“错误在业务处理前由中间层返回”只是待验证方向，不是根因结论。
- 电脑截图在前一次刷新中曾成功显示空白 `about:blank`，说明连接状态会间歇变化；不得把 Pod Ready、一次成功截图或一次 502 单独当作全程健康/故障结论。未重启、未改路由、未重放任务。
- 同一轮通过 Chrome 可见点击重开原群后，页面持续显示 `Could not confirm this group chat. Refresh to check its messages before sending again.`，输入框为 disabled；原有消息仍在，但不能确认刷新后的服务端消息状态。未再次发送任务，避免重复。
- 群聊确认失败与电脑状态 502 同时出现，但尚无请求级证据证明它们是同一条隧道/代理故障；单独记录两类请求状态并关联时间与安全 request ID。

## 2026-11-12 队列中的结果审核卡

- 在 Chief 的公网聊天记录中，BSE 前端开发的委派运行显示 `Outcome unknown`，随后出现 `Review uncertain task outcome` 卡片，说明运行暂停时电脑处于 user-control mode、结果未确认，并提供 `I checked · continue` 与 `Retry as a new task` 两个操作。后续 BSE 队列项显示等待电脑/等待处理；这张卡是明确的人工审核门槛，可能阻止队列继续，但尚未通过本次实时操作证明它是所有排队项的唯一根因。
- 用户明确表示没有接管电脑；当前最近可见屏幕是 Chrome `about:blank` 且显示 `Bot is in control`。卡片对历史控制状态的描述没有对应的用户接管审计证据，不能据此把暂停归咎于用户。当前 owner 只能证明现在的状态，不能还原历史瞬间。
- 本轮没有点击 `Retry as a new task`，没有重发未知任务。尝试继续读取审核卡时，CUA `getTab + getAXState` 等待 30 秒后超时并重置会话；重置后的 `getState` 再次超时，因此无法安全完成审核操作。
- 下次先检查同一 Bot 的当前屏幕、控制 owner、该 run 的外部副作用/持久进度和审核卡；`I checked · continue` 只表示已检查并恢复队列，不表示未知结果成功。仅在确认原任务状态、评估重复副作用并得到明确重试授权后，才选 `Retry as a new task`。浏览器控制工具超时时停止重复尝试并保留现场，不要将工具超时误判为应用或电脑根因。
- BSE 多 Bot 端到端仍未完成；没有据此宣称开发、测试、PR 或 Pages 发布成功。

## 2026-11-12 公网队列与本机浏览器控制复查

- 当前已登录公网 Chrome 的 Chief 对话可见三条 `Queued · waiting for your computer`。同一时刻公网主页 HTTP 200，两个租户的 Agent/Desktop Pod 均 1/1 Running，相关 Service endpoint 存在；最近 30 分钟 Auth/Bot 日志过滤未发现 Computer request failure、502、queue/dispatch、control-owner 或 review 匹配日志。它们只说明入口/Pod 活着且没有这些近期日志，不能证明电脑屏幕可控或队列已运行。
- 当前工作树 `src/server/run-store.ts` 的 `queuedScreens` 和 `claimNext` 会在同一 Bot 有 `unknown + recovery_state=pending` 时阻止该 Bot 新任务；`queuedOwners` 还会在用户任一 Bot 有 running/unknown pending 时阻止 owner 队列。该规则可解释“有 queued 但不启动”，但本次尚未取得 Chief 当前 pending run、数据库状态或部署镜像与此工作树版本一致的证据，不能据此认定为唯一根因。审核卡需按 Bot 核实，不能只检查 Chief。
- CUA 新会话 `getState` 再次 30 秒超时并重置；`js_reset` 后重试仍超时。Chrome 9222–9224 没有 CDP 监听端口；通过 Apple Events 执行 JavaScript 被 Chrome 设置拒绝，因为 `View > Developer > Allow JavaScript from Apple Events` 处于关闭状态，本次没有开启它。
- 为确认窗口现场使用了 macOS 截图和 AppleScript。屏幕实际尺寸为 1470×956 逻辑点；此前按缩放截图尺寸发出的 `(1980,1510)` 点击超出屏幕逻辑边界，紧随的 PageUp 后截图显示的是另一个 Chrome 窗口。随后虽然恢复到 Grok 公网窗口，但 `(800,700)` 的点击意外聚焦了 Computer 预览而非预期聊天区。不要再猜坐标或继续发键盘事件；有多个窗口或缩放截图时，先用工具原生窗口/元素定位，逐动作确认目标和结果。测试截图已删除；没有发送聊天消息、点击审核/重试或执行业务动作。
- 只读检查 GitHub remote 时，`git ls-remote` 先报 `HTTP2 framing layer`；将该命令限定到 HTTP/1.1 后又因 20 秒低速退出。没有改全局代理或 Git 配置，远端 main 本轮未重新验证；需要推送时再单命令诊断网络，不能将此网络错误与应用运行故障混为一谈。
- 最新可见状态仍是 Chief 的多个 queued 项；未知结果未确认，未重发。北交所多 Bot 网页点击端到端没有完成。
- 追加验证：运行中的 Auth Pod 使用 `coke-grok-auth:bot-artifact-handoff-20261111-r1`，image digest `sha256:0612b6b52cff15d1e1a52d5d5dbcc672bdfdb5cbf377302ef484fb73b60f629b`；只在容器 `/app/auth.cjs` 内检查固定代码字符串，确认已编译包含有 `queuedScreens`、`status='unknown'`、`recovery_state='pending'` 和 `active.recovery_state` 条件。故“unknown pending 会挡住队列”不只是本地工作树推测，运行包也含这些条件；但仍需核实 Chief 当前具体 run 的 owner-scoped 持久状态才能确认本次排队是否由此触发。


## 2026-11-12 Worker 路径核对更正

- 排查时一度读取 `/opt/coke-dots/computer-worker.mjs`，但项目 Dockerfile 把 Coke Grok Worker 覆盖为 `/opt/coke-dots/grok-computer-worker.mjs`，`start-desktop.sh` 也实际启动后者；基础镜像同名文件不是本项目运行 Worker。前一条“Worker 运行代码落后”的推测已撤回。
- 正确路径的运行文件 SHA-256 为 `a2177ef9…`，与 `git show HEAD:deploy/desktop/computer-worker.mjs` 相符；Auth bundle 含 Browser Task `open_artifact` 免逐步审批分支。未因错误路径重启、替换或修改任何 Pod。
- 这不能解释或清除现存 `Approval requested` 卡：没有把卡片映射到具体 run、lease 与请求审计，根因仍未确认。CUA 本轮 `getState` 再次约 30 秒超时；按用户要求停止截图及盲目坐标操作。BSE 公网点击端到端仍未完成。
