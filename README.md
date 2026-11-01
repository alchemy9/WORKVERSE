# WORKVERSE

一个在 Mac 本机运行的 AI 协作与创业经营模拟游戏，基于 Business Tycoon 的办公室画面开发。面向产品新人，观察产品经理、程序员与运营如何把想法变成需求文档与经营方案。

## 功能

- 首页选择存档或开始独立新游戏，退出前保存，旧进度可继续。
- 真实 AI 岗位协作：需求澄清、独立评审、讨论取舍、版本化需求文档与 Markdown 导出。
- 全部记录及角色会话，工作决定与经营结算可追溯。
- 10万虚拟资金、30个游戏日，招聘多人团队，模拟开发、测试、上线与销售。
- AI CEO 托管：自主立项、招聘、设备升级、科技研究、定价推广及受限虚拟应急贷款。
- 全部账目、债务与经营复盘；虚拟收益由透明规则计算，不代表现实收入预测。

开发与交易均在游戏内模拟，不执行真实软件开发、部署或支付。CEO经营策略由规则执行，岗位讨论通过 DeepSeek API 完成。

## 启动

需要 Node.js 24 或更高版本。进入仓库目录：

```sh
npm ci --prefix workverse/server
node workverse/server/index.mjs
```

浏览器打开 <http://127.0.0.1:8010/workverse/>。Mac 也可双击根目录的 `启动WORKVERSE.command`，首次启动会安装锁定的连接依赖。

进入「设置」→「打开本机配置文件」，在 `DEEPSEEK_API_KEY=` 后填写自己的密钥并保存，再点击「重新检查配置」。不要把密钥填写到聊天或提交进仓库。使用的模型为 `deepseek-flash`，API调用费用由模型服务商收取，与游戏虚拟资金分开。

可在开始新游戏后给团队一个项目目标；或者进入「经营」→「开启托管」，由CEO自主立项。

## 数据与密钥

独立下载的仓库默认使用：

- `.workverse/config.env`：本机密钥。
- `.workverse/data/project.json`：当前项目。
- `.workverse/data/saves/`：其他项目存档。
- `.workverse/data/backups/`：自动备份。

`.workverse/` 已被 Git 忽略，服务不会公开这些文件。仅AI协作所需上下文发送给 DeepSeek。项目运行在本机地址，不提供账号和云存档。

早期开发工作区仍兼容原有仓库外存档和配置位置，以设置界面显示的位置为准，不会自动搬迁或清空旧进度。退出游戏回到首页会暂停经营并保存；关闭终端才会停止本机服务。

## 验证

```sh
npm test --prefix workverse/server
```

自动测试使用模拟模型，不需要真实密钥、不产生真实API费用。真实模型效果与市场平衡仍需持续体验验证。当前托管并不包含原版完整地图自由建造、土地扩张与全部公司类型。

## 来源与许可

基于 [TeamDay-AI/business-tycoon](https://github.com/TeamDay-AI/business-tycoon)，沿用办公室引擎、画布、人物、家具和寻路等模块，并保留原版入口与 [原版说明](README.business-tycoon.md)。新增内容位于 `workverse/`。

遵循 [MIT License](LICENSE)，保留原作者 TeamDay AI 的版权与许可声明。本仓库的自动工作流只运行测试，不自动发布网站。
