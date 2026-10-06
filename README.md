# 沁水县供应链智慧运营指挥大屏 · V0.16.1

2026-10-06更新包，用于覆盖已发布的同一个GitHub Pages仓库。消费者指标已改为真实10天会员统计及随订单回放更新，本包包含完整网页、依赖和匿名聚合数据。

画布3268×1290，三列32% / 36% / 32%。静态HTML网站，地图使用真实GeoJSON和D3。用户提供的沁水曲屏-2-2.png作为未配准的装饰地形背景，深蓝蒙层上动态绘制县界、12乡镇、隐藏常驻乡镇名称，保留已确认业务点位能力；龙港镇100公里辐射圆心通过整体投影居中。另一张效果图未用于底图或裁取图形。边界细缝和县界差异保留待核验。

## 更新已经发布的GitHub Pages

1. 解压更新包。在GitHub Desktop选择之前发布大屏的仓库，点Fetch origin；出现Pull origin时先拉取远端更新。
2. GitHub仓库Settings → Pages确认当前发布分支和目录，沿用已有设置。例如main / (root)时复制到仓库根目录；main / docs时复制到docs目录。
3. Desktop菜单Repository → Show in Finder打开本地仓库。将解压后的index.html、所有.js文件以及assets、components、data整个文件夹复制到之前index.html所在的发布目录，同名网站文件覆盖；目录合并时确认新增的consumer-replay-data.js与data/consumer-replay-metrics.json已加入。保持index.html与assets、components、data同层，并保留.nojekyll。仓库的.git、.github、CNAME和已有.gitignore保持原样。
4. 回到Desktop的Changes，填写Summary：更新大屏V0.16.1，点击Commit to当前发布分支，再点Push origin。
5. 在GitHub的Actions中等待最新Pages部署成功，随后打开原来的网站地址。沿用同一仓库和Pages设置，网址不变；如仍见旧版，用无痕窗口重新检查。

如果Pages的Source为GitHub Actions，自定义工作流决定部署产物目录；应沿用既有流程并让本包成为实际上传的网站产物，不能假定仓库根目录就是发布目录。本包是已完成构建的静态网页，不需要安装依赖或重新构建。

官方说明：
- Pages发布来源：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Desktop提交：https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop
- Desktop推送：https://docs.github.com/en/desktop/making-changes-in-a-branch/pushing-changes-to-github-from-github-desktop

## 数据说明

演示与真实模式在配置页切换。内置今日演示采用2026-10-02、10-03交易流水的2,049张订单与5,864条实物明细，实收55,774.59元，运行时映射为当前上海日期，保留sourceDate。客单价随已累计订单实收净额/张数变化，基数不进入客单价。订单和明细逐单核对，明细不重复相加。当前销售来源是已有ERP文件及当前浏览器人工导入；品牌代理、合作社、活动权重等滚动消息含参考配置。LIVE为展示标识，底部数据更新显示上海时区的大屏刷新时钟，ERP自动同步尚未接入。

天气实况与7天预报已由和风真实接口验证，网页使用data/weather-latest.json及weather-data.js快照，带独立获取时间。网页配置可读取HTTPS共享天气JSON；本包无JWT、私钥或认证配置。持续上游调用需另部署天气后台并核验共享免费预算；GitHub Pages不运行Node后台。静态JSON不会自动变成新天气，修改weather-latest.json后也需同步生成weather-data.js并重新发布，保持离线版一致。需求/农业提示为阈值参考规则，不是销量预测结论。

手工导入支持订单主表与可选明细、真实今日或10月2日/3日映射今日两种用途，重复应用替换整批数据；操作仍只影响当前浏览器。多人共享最新业务数据需增加管理导入与公开汇总发布流程。原始Excel可另存Private数据仓库；本网页包不含原始ERP表。地图原表派生JSON包含74条待核验点位记录（67条有数值坐标、7条缺失），业务点位默认不上屏；当前雷达以真实龙港镇边界计算的几何中心为圆心，地理半径100公里；未启用未知业务坐标。当前中央#FE0100红星与“沁水供应链园区”是龙港镇辐射中心的示意标识，不是原表园区地址；坐标系核实并统一为WGS84后可接入真实业务点位和分色线路，雷达仍保持龙港镇中心。界面已隐藏未配准与待确认字样，状态仍保留在数据说明。

消费者分析先计算9月24日至10月3日实际10天会员数据，显示平均消费频次和期间复购率，不标作30日。完整汇总为2027笔会员正额订单、818名购买会员、425名多次下单会员，结果2.48次与51.96%。默认在9月24日至10月1日会员汇总上随10月2日、3日订单回放推进，末值与完整统计一致；匿名与负额订单不增加会员次数，重复滚动不重复累计。data/consumer-replay-metrics.json只有聚合计数和进度，指纹绑定原内置批次；无会员映射的新导入不猜测人数。后台实际汇总与回放层分离，每60秒读取不会覆盖正在回放的指标。网页不发布会员编号、姓名或电话，指标不是全体匿名客流行为。原始表在私有处理端生成汇总；file://使用consumer-metrics-data.js、consumer-replay-data.js随包快照，更新JSON后同步编译发布。

智慧决策随当前订单/配置变化生成本地规则建议，AI代理尚未配置。基础配置中已提供HTTPS代理入口，按最短30秒调用、15秒超时，失败回退规则；代理需返回结构化JSON并在后端保存模型密钥。只提交汇总数据，不提交原始Excel或客户字段。详细合同见data/AI决策分析接口说明.md。

地图独立数据在data/，网页加载的同步编译版本是map-data.js；修改地图JSON后需要重新编译。today-replay-data.js为data/today-replay-orders.json的同步版本，更新演示源时需同步生成，原始Excel不放网页仓库。使用整套最新发布包可保持一致。图表、地图及Excel解析依赖随网站提供。地形图片assets/qinshui-terrain.png随包提供，配准状态记录在data/qinshui-terrain-background.json；图片仅作用户确认的装饰背景，不代表地形与行政区精确对应。
