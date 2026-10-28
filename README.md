# Coke Grok Bot

当前提供桌面界面基础的本地预览。预览中的 Bot、消息和引导卡保存在当前浏览器的 localStorage；它们不是服务器账号，也没有连接真实 Agent、Google 登录、MySQL 或云电脑。

```sh
npm ci
npm run dev -- --port 5182
```

打开 http://127.0.0.1:5182/。首次状态可以创建、切换和重命名 Bot，并保存本地消息；清除浏览器站点数据会清除这些预览数据。`?reference=101-new-bot` 是隔离的官方视频对图状态，不读写普通预览数据。

`npm run build` 检查 TypeScript 并构建；`npm test` 验证逐帧工具；`npm run test:ui` 使用本机 Chrome 进行本地交互和布局测试。

对图使用 `research/comparisons/101-newbot.json` 和 `npm run compare:reference -- research/comparisons/101-newbot.json artifacts/ui/reference-101-actual.png`。官方参考帧需先按 `research/README.md` 获取，视频素材不进入 Git。对图结果受视频压缩、字体和原始缩放不确定性影响，不能单凭差异指标声称像素级完成。

截图比对工具和栅格算法源自 Coke Dots 的 `origin/main` 提交 `4213e769e49da7a479ab2ad186584c77b721fa69`；本项目的界面与功能独立实现。
