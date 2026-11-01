# WORKVERSE 开发说明

运行与功能概览见仓库根目录 [README](../README.md)。

- `client/`：首页、办公室、聊天、文档、经营与CEO界面。
- `server/index.mjs`：本机HTTP与WebSocket服务、页面控制权与启动配置。
- `server/coordinator.mjs`：真实模型协作、角色调度、暂停恢复与保存。
- `server/provider.mjs`：DeepSeek配置与调用、超时和错误分类。
- `server/store.mjs`：原子存档、备份、恢复与多存档切换。
- `server/business.mjs`：确定性的经营结算与财务校验。
- `server/ceo.mjs`：有预算限制的规则CEO，不把融资计为利润。
- `server/test/`：隔离数据目录与模拟模型的回归检查。

独立仓库的本机数据放在根目录 `.workverse/`，已忽略；早期开发工作区自动兼容原配置。网页静态服务只开放客户端、原版引擎与资源，不开放服务端源码、密钥和存档。共享原版引擎只补充文字输入与缩放兼容，原版游戏入口保留。

如需跨机器协作，提交源代码与测试；不提交模型密钥、真实聊天、游戏存档、测试输出或依赖目录。真实模型验收应与模拟测试分别记录。
