# 沁水县域供应链智慧大屏

画布3268×1290，三列32% / 36% / 32%。静态HTML网站，地图使用真实GeoJSON和D3，12个乡镇已合并；边界细缝和县界差异保留待核验。

## GitHub Desktop与Pages

1. Desktop中创建新仓库，将本包内文件（含.nojekyll）复制到仓库根目录，index.html与assets、components、data并列。
2. Commit后Publish repository；使用免费GitHub Pages时将网页仓库设为Public。
3. GitHub仓库Settings → Pages → Deploy from a branch → main / (root) → Save。
4. 部署成功后点击Visit site，分享显示的网址。

后续修改对应文件、Commit、Push origin，Pages部署完成后访客刷新查看。官方步骤：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 数据说明

演示与真实模式在配置页切换。当前销售来源是已有ERP导出汇总/回放样本及当前浏览器人工导入；品牌代理、合作社、活动权重等滚动消息含参考配置。LIVE为展示标识，底部数据更新显示上海时区的大屏刷新时钟，尚未接ERP或天气自动同步。

手工导入订单/修改配置只影响当前浏览器。多人共享最新业务数据需增加管理导入与公开汇总发布流程。原始Excel可另存Private数据仓库；本公开网页包未包含原始ERP表或坐标系尚未确认的业务点位表。

地图独立数据在data/，网页加载的同步编译版本是map-data.js；修改地图JSON后需要重新编译。使用整套最新发布包可保持一致。图表、地图及Excel解析依赖随网站提供。
