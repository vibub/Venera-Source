# CosplayTele for Venera-Next

把 [Keiyoushi 的 CosplayTele 扩展](https://keiyoushi.github.io/extensions/#7395748658970167454) 移植到 Venera-Next。支持最新、近七日热门、关键词搜索、分类筛选和单册图库阅读。源站含成人内容；仓库只分发代码，不存放图片，也不需要额外部署服务器。

## 从本地文件安装

1. 使用 [Venera-Next v1.18.5](https://github.com/CyrilPeng/Venera-Next/releases/tag/v1.18.5) 或更新版。首版声明最低版本为 `1.18.5`，原版 Venera 与更早版本未验证。
2. 打开 **漫画源 → 添加来源 → 选择文件**，选择 [cosplaytele.js](cosplaytele.js)。预览应显示 `CosplayTele`，点击 **安装漫画源**。
3. 在「发现」分别打开最新与热门，再用搜索入口选择 `CosplayTele`。点开一项后直接点击「阅读」；每篇文章是一册图库，没有章节列表。

本地试用直接安装 JS，不用先导入 [index.json](index.json)。本地索引里的 `fileName` 是相对路径，上传后才有可下载的基准地址。详见 [Venera-Next 仓库指南](https://github.com/CyrilPeng/Venera-Next/blob/v1.18.5/doc/user/source_repositories.zh.md)。

## 验证情况

开发依赖仅用于本地测试。用 Node.js 22+ 安装并运行：

```powershell
npm ci
npm test
```

测试使用合成页面和 JSON，覆盖索引、分页、搜索筛选、分类、详情、图片顺序、请求头和错误。开发环境直连站点超时，未完成真实站点或客户端验收。若你这边能访问源站，首次发布前可在客户端试一条完整链路：**安装 → 打开最新 → 翻页 → 关键词搜索 → 打开详情 → 阅读多张图片**，再检查热门和分类入口。若浏览器能打开而客户端请求失败，请在「设置 → 调试 → 打开日志」核对具体 HTTP 状态或网络错误。

## 来源与许可

基于 [Keiyoushi CosplayTele 上游源码](https://github.com/keiyoushi/extensions-source/tree/92906c0382547f30a03b3176f2f2429be6b54dce/src/all/cosplaytele) 改编：将 Kotlin 列表、详情和图片解析移植到 [Venera-Next 漫画源 API](https://github.com/CyrilPeng/Venera-Next/blob/v1.18.5/doc/api/comic_source.zh.md)。本仓库使用 [Apache License 2.0](LICENSE)。非 Keiyoushi 或 Venera-Next 官方仓库。
