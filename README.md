# CosplayTele for Venera-Next

把 [Keiyoushi 的 CosplayTele 扩展](https://keiyoushi.github.io/extensions/#7395748658970167454) 移植到 Venera-Next。支持最新、热门排行、关键词搜索、分类筛选、详情推荐和单册图库阅读。仓库只分发代码，不存放图片，也不需要额外部署服务器。

## 从本地文件安装

1. 使用 [Venera-Next v1.18.5](https://github.com/CyrilPeng/Venera-Next/releases/tag/v1.18.5) 或更新版。首版声明最低版本为 `1.18.5`，原版 Venera 与更早版本未验证。
2. 打开 **漫画源 → 添加来源 → 选择文件**，选择 [cosplaytele.js](cosplaytele.js)。预览应显示 `CosplayTele`，点击 **安装漫画源**。
3. 在「发现」打开最新与近七日热门，或用搜索入口选择 `CosplayTele`。打开图集即可阅读。点详情「信息」里的分类或标签名称，可在应用内打开对应的源站作品列表并翻页；详情下方还会显示源站提供的 **Recommend For You**（相关推荐）。
4. 在分类页打开 **Best Cosplayer**，可按短名切换源站目录前 30 位作者（选项超过 8 个时，Venera-Next 会用下拉框显示）；退出后重新进入可更新这组选项。完整名单在 **发现 → CosplayTele · 作者目录**，滚动时每批并行加载最多 3 位，每位下方展示其分类首页的第一部作品。成功的预览在当前会话内复用 6 小时；刷新会重新读取作者名单，未过期的作品预览仍会复用。点作品卡打开详情，或点「查看更多」进入对应作者的图集页。个别作者的预览加载失败时，仍可通过「查看更多」重试；点发现页的刷新按钮重新读取[源站目录](https://cosplaytele.com/best-cosplayer/)。从 1.3.0 或更早版本更新后，若旧作者目录仍在报错或入口消失，请完全退出并重新打开应用，再到发现页设置中重新启用「CosplayTele · 作者目录」；无需清除应用数据。
5. 在 **Top Cosplay** 下查看 24 小时、3 天或 7 天榜。**Video Cosplay** 列出归入视频分类的帖子；源仍只读取图集图片，视频可用详情中的原网页链接查看。

本地试用直接安装 JS，不用先导入 [index.json](index.json)。本地索引里的 `fileName` 是相对路径，上传后才有可下载的基准地址。详见 [Venera-Next 仓库指南](https://github.com/CyrilPeng/Venera-Next/blob/v1.18.5/doc/user/source_repositories.zh.md)。

## 验证情况

开发依赖仅用于本地测试。用 Node.js 22+ 安装并运行：

```powershell
npm ci
npm test
```

离线测试使用合成页面和 JSON，覆盖索引、分页、搜索筛选、作者目录、排行、详情推荐、图片顺序、请求头和错误。另用源站的 HTML 和 JSON 验证了最新翻页、搜索、详情推荐、图片列表和新增分类入口；尚未在 Venera-Next 客户端完成界面验收。若客户端请求失败，可在「设置 → 调试 → 打开日志」核对具体 HTTP 状态或网络错误。

## 来源与许可

基于 [Keiyoushi CosplayTele 上游源码](https://github.com/keiyoushi/extensions-source/tree/92906c0382547f30a03b3176f2f2429be6b54dce/src/all/cosplaytele) 改编：将 Kotlin 列表、详情和图片解析移植到 [Venera-Next 漫画源 API](https://github.com/CyrilPeng/Venera-Next/blob/v1.18.5/doc/api/comic_source.zh.md)。本仓库使用 [Apache License 2.0](LICENSE)。非 Keiyoushi 或 Venera-Next 官方仓库。
