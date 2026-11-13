# BSE 跨 Bot 文件交接与 Agent 运行时排查（2026-11-11）

## 症状

BSE 前端 Bot 在真实云电脑 Chrome 打开并点击了纯模拟交易页，但后续 BSE 测试 Bot 没有收到页面副本。前端 Bot 只把跨任务绝对路径发给测试 Bot，并报告 `bot_handoff` 不支持 `fileIds`；测试 Bot 因自己的任务目录没有 `artifacts/bse-demo/index.html` 而无法验收。由此不能声称跨 Bot 交接或完整多 Agent E2E 通过。

## 已确认原因

1. 工作区中的 `deploy/desktop/dsh-handoff-plugin.mjs` 已扩展 `fileIds` 参数，但被 pin 的 Agent 镜像仍是 `coke-grok-desktop:sha-2670fed3f6830a2344ac7590d5856901e190b00d`。运行中的该镜像没有当前工作区的新交接 schema。检查仓库 `HEAD` 时也确认当时提交版本的插件 schema 没有 `fileIds`；本次变更尚在唯一 feature 分支的工作区中。
2. `bot_handoff.fileIds` 只能引用**当前 run 明确收到的输入附件**。仅有另一个任务的绝对路径、任务输出路径，或任意 Bot 的结果文件 ID 均不够。附件必须先通过群聊/本任务输入交给 Chief，再由 Chief 把同一个输入附件 ID 交给测试 Bot；服务端会校验并复制，测试 Bot 应从自己的 `attachments/` 副本用 `open_artifact` 打开。
3. Agent 与 Desktop 镜像由每个用户 namespace 的不可变 `desktop-image-pin` 分别固定。只更新 Agent Deployment 会使 Broker 校验失败并表现为 `BROKER_REJECTED` / HTTP 503；更新时必须保持 Agent Deployment 和 pin 同步。前置事故详见 [agent-image-pin-mismatch-incident-2026-11-11.md](agent-image-pin-mismatch-incident-2026-11-11.md)。

## 本次恢复与证据

- 以当前工作区重建并导入 `coke-grok-desktop:candidate-bot-handoff-20261111-r2`（arm64，约 913 MB）。
- 只替换 `grok-user-00213195e832242e4afea5b264424355` 的 Agent；未重启 Desktop/Chrome，未改 PVC、MySQL、其他用户 namespace 或 K3D 集群。
- 删除旧不可变 pin 后，Broker 按现有 Desktop 与新 Agent 的 Deployment 镜像重新解析并创建 pin。之后已核对 pin 为 Desktop `sha-2670fed…`、Agent `candidate-bot-handoff-20261111-r2`。
- 直接在新 Agent Pod 中检查 `/opt/coke-dots/dsh-handoff-plugin.mjs`，确认实际运行 schema 包含 `fileIds`、输入文件 ID 校验和请求转发。
- 用已登录公网 Chrome 打开「北交所交易规则适配项目组」，从本机下载目录选中开发 Bot 的 `bse-demo.html`（14 KB），附加到仅发给 Chief 的群任务。群聊 UI 显示附件已排队，任务已发送；下一步须确认 Chief 真实 handoff 的 file ID、测试 Bot 收到副本并在自己的 Chrome 完成交互验收。
- 本次 Chrome 文件选择器中对非 settable 搜索字段调用 `setValue` 返回 `Cannot set a value for an element that is not settable`。恢复方式是点击搜索字段后输入文件名，再选择结果；不重复尝试 `setValue`。

## 下次排查顺序

1. 先对照目标 namespace 的 `desktop-image-pin`、Agent/Desktop Deployment 镜像与实际 Pod 镜像；检查 Agent 容器中的实际插件 schema，不能以本机工作区代码或 `Pod Ready` 推断部署代码已更新。
2. 若要升级 Agent，先建合法的 `candidate-...` tag 并导入现有 K3D；更新目标用户 Agent 时协调 immutable pin。不可只 `kubectl set image` 而保留旧 pin。保存旧 Deployment 与 pin 作为一对一回退点；不触碰 Desktop/PVC。
3. 跨 Bot 文件交接只传当前 run 输入附件列表里的 ID。先把 Bot 产物附加到群消息/Chief 任务，再让 Chief 通过 `bot_handoff.fileIds` 传给测试 Bot；测试 Bot 只打开自己的 `attachments/` 文件。交接前后比对 SHA-256，直到看到真实浏览器标题、URL、控件结果和测试报告附件后才算完成。
4. 浏览器扩展按 URL 绑定超时或重复标签时，改用原生 Chrome 窗口的可见 UI；不要循环重试同一个超时调用。macOS 原生文件选择器字段不可 settable 时，使用可见点击和输入。

## 验收状态

公网群聊的串行测试请求已实际发送，附件 `bse-demo.html` 已附加给 Chief。Chief -> 测试 Bot 的 `fileIds` 交接、测试 Bot 自己的 `open_artifact`/Chrome 点击，以及后续 GitHub PR/Pages 均仍待真实完成证据；当前不能称为 BSE 完整端到端通过。

## 2026-11-12 已存 BSE 页面回归报告复核

- 当前可读的测试任务附件 `/workspace/tasks/328a6a99-d42a-4d21-91fd-9b5967d85267/attachments/bse-e2e-report.md` 记录了云电脑 Chromium 的页面级用例：非法数量/价格/证券代码、多字段校验、模拟下单、重复提交阻止、表单修改后禁用旧快照等。报告结论为核心页面演示通过，但有两项提示缺陷：校验成功后修改表单仍显示旧“校验通过”文案；小于 100 股时提示未优先说明最小申报量。另有千分位输入容错建议。
- 报告明确说明：被测 HTML 是复制到测试任务自己的 `artifacts/bse-demo/index.html` 后用 `open_artifact` 打开；当次没有 GitHub、PR 或 Pages 操作。故这是云电脑页面功能回归，不是 Bot 之间经 `fileIds` 完成交接的证据，也不能作为整个多 Agent 项目交付完成的依据。
- 当前任务目录同时保留多个不同 SHA-256 的 `bse-demo/index.html` 版本；不能只凭文件名把测试报告对应到 Developer 的唯一版本。下次交接应记录源文件 ID、接收任务附件 ID、SHA-256 三者一致，再由 Tester 在其云电脑中打开接收副本；最后还需观察到真实 PR 与 Pages 结果。

## 2026-11-12 BSE 新规适配范围与测试文件版本核对

- 从本机 K3D 的同一用户 Agent 工作区只读核对：开发任务 `7bd72e63-ef8b-4a56-b115-80be031f6fc1` 的 `artifacts/bse-demo/index.html` SHA-256 为 `27bf6d5b9777a68c35ebba74dba4edabfbf3a272410819675ae21d23eae109d6`，大小 10,145 字节；其 `README.md` 只描述限价/市价模拟交易，`RULES.md` 明确不覆盖大宗交易。
- 测试任务 `328a6a99-d42a-4d21-91fd-9b5967d85267` 的 `artifacts/bse-demo/index.html` SHA-256 为 `0db3a9b4fd6577facf74cae035dc340c7c0a12569faa5b991d622fceca16c0b8`，大小 13,874 字节，与当前开发任务产物不一致。相同测试哈希还出现在另外两个历史任务目录，但当前文件系统证据不能确定它具体从哪个 Bot/Run 交付。因此 11 月 11 日测试报告不能作为当前开发版本通过的证据。再次交接时必须核对源 `fileId`、接收附件 `fileId` 与 SHA-256；测试任务应打开收到的文件副本，而不是手动复制任意旧版本。
- 官方规则复核：[北证公告〔2026〕17号及《北京证券交易所交易规则》](https://www.bse.cn/jygl_list/200028217.html)第 3.6.5 条规定，无价格涨跌幅限制股票的大宗交易申报价上限不高于“当日竞价交易实时成交均价的 130%”与“已成交最高价”中的较低值；下限不低于“实时成交均价的 70%”与“已成交最低价”中的较高值，均价为已成交金额除以已成交股数。[北证公告〔2026〕43号](https://www.bse.cn/jygl_list/200029608.html)确认该款于 2026-10-26 起实施。当前 demo 仅记录此规则并注明“不触发”，没有实现该新规的交易模式或价格校验；若验收目标是适配这次变更，必须将它作为产品验收缺口，而不能把免责声明当作功能完成。
- 规则功能验收至少要覆盖一个明确标记为“无涨跌幅限制”的合成标的、合成成交额/成交量/高低价、上下边界和边界外拒绝，并保持明显的纯模拟/非真实交易隔离。价格精度/取整和无成交数据时的处理需先由 Research Bot 根据官方资料明确，不能自行猜测。该工作应经群聊由 Research → Developer → Tester 交接，Tester 的实际云电脑页面必须与源文件 SHA 相同。
- 本轮浏览器控制复核没有使用截图：`mcp__cua_repl` 的 `cua.getState()` 和针对当前 URL 的 `cua.getBrowser()` 分别约 30 秒超时并重置 kernel；macOS Chrome AppleScript 只能确认当前活动标签 URL/title，Apple Events JavaScript 也处于关闭状态，System Events 没有提供网页控件。上述超时不能证明 Codex Work 的浏览器设置关闭。未重启/修改任何 Pod、容器、任务、PVC 或浏览器设置；真实群聊 UI、浏览器点击、PR 与 Pages 测试仍未完成。
- 运行时只读复核：当前 Agent 使用 `coke-grok-desktop:candidate-bot-handoff-20261111-r2`，Pod 内 `/opt/coke-dots/dsh-handoff-plugin.mjs` SHA-256 `3f1b0ebae46db488bfe6c5ecbc6a1531d1c0f094e12379cb3961d702803b144d` 与仓库 `HEAD:deploy/desktop/dsh-handoff-plugin.mjs` 相同，含 `fileIds` schema；当前 Desktop 使用 `coke-grok-desktop:sha-2670fed3f6830a2344ac7590d5856901e190b00d`，`/opt/coke-dots/grok-computer-worker.mjs` SHA-256 `a2177ef91108e8600cefd2235e6d8006d6ba63e4f20815c2a92ff9c52564cce6` 与 `HEAD:deploy/desktop/computer-worker.mjs` 相同，含 `open_artifact`。这只确认相关运行文件与 HEAD 一致，不证明 BSE 文件已正确交接或整个任务通过。本轮未重启 Pod。
- 用户重启 ChatGPT 后再次只读复测 Browser 控制：`cua.getBrowser({url:"https://codex.cokeagent.com/grok-bot/"})` 仍在约 30 秒后报 `js execution timed out; kernel reset`。重启 ChatGPT 未恢复控制器；没有截图或坐标操作，也没有改变权限设置。该工具超时仍不足以判定 Work/Computer Use 开关的状态。
