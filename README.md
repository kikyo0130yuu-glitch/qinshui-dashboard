# 沁水县供应链智慧运营指挥大屏 · V0.31

2026-10-07更新。门店金额轴改为0、200、500、1000、3000、8000、1.5万，采用非等距分段刻度，让小额门店更明显。刻度间距接近，较大区间稍宽；超过1.5万元柱条封顶，完整金额在上方更新，销售合计和订单联动保持。月度图隐藏本期截止日期、当月实际金额标签和完成率，源金额与日期不变。价格指数保留，未来7天金额/数量样例按品类缩小3至6倍，仅为原型参数。

天气已实测取得10月7日实况和7天预报。联动建议包含需求/农业/配送/仓储/采购五类、约10条，每7秒显示新一组两条，鼠标停留暂停。右下智慧决策建议沿用原有规则。

## 更新已有GitHub Pages

仓库：https://github.com/kikyo0130yuu-glitch/qinshui-dashboard ，main分支、根目录网页。

1. GitHub Desktop选择原仓库，Fetch origin / Pull origin，Repository → Show in Finder。
2. 将本包index.html、point-collector.html、所有.js、assets、components、data、automation整套复制到仓库根目录。合并隐藏.github/workflows/qinshui-weather-pages.yml（Finder按Command + Shift + .），保留.git、CNAME和其它原有文件。不要额外套dist目录。
3. 首次添加automation/request-ledger.json，已初始化2026年10月发生的4次本地请求。以后更新务必保留仓库中累积计数，不能用旧包覆盖或删除该文件。
4. Commit to main → Push origin。Settings → Pages → Source选择GitHub Actions。
5. Settings → Secrets and variables → Actions添加QWEATHER_API_HOST、QWEATHER_DEVELOPER_ID、QWEATHER_PROJECT_ID、QWEATHER_CREDENTIAL_ID、QWEATHER_PRIVATE_KEY这5个Secrets。使用已匹配公钥的原Ed25519私钥，不重新生成。私钥只填Secret，不放仓库。本包不含私钥。
6. Actions选择Qinshui daily weather and Pages → Run workflow → main，核对刷新和部署成功后继续用原网址。

本地交付的《GitHub-天气每日更新配置步骤.md》列有准确入口、字段值和私钥查找方法。本次未代为推送或配置GitHub Secrets，工作流尚需上述设置启用。

## 每日刷新

计划每天北京时间07:17（UTC 23:17），一次取实况与7天预报，最多2次天气请求。浏览器每10分钟只读公开快照，不调用和风；普通Push只部署，不请求天气。工作流会在同一次运行中发布Pages，避免机器人提交无法触发后续部署的问题。

项目每月上限100次，按用户确认仅本项目调用及本地持久计数计算；未读取和风控制台用量。每次先提交请求预留再调用，失败/取消不退回计数，无自动重试。源失败保留天气快照和原时间，任务报告失败；不以底部页面时钟伪造天气更新。以后新增其他和风消费者需重核共享免费预算。

工作流仅将index.html、point-collector.html、assets、components、data和根目录.js部署到Pages，automation和.github不作为站点资源上传。接口认证只在GitHub runner内，快照无凭据。

## 保留的地图与业务口径

画布3268×1290，三列32% / 36% / 32%。地图保留67个用户确认高德坐标转换的真实业务点：9门店、57后勤、1园区；65条双向连接线。7条缺坐标仍待补，3组重合记录保留。交通运输事业发展中心、苏庄大食堂、梁庄幸福食堂已按用户最新GCJ-02值更正并转换为WGS84，67条正式点均在当前县界内。原提取快照保留，更正独立保存于data/qinshui-point-corrections.json。黄色门店、绿色后勤、红色园区；龙港镇几何中心100公里雷达；装饰地形未配准，不作行政数据来源。

演示销售基数按原日均×60%，新订单净额100%计入；真实模式与月度实际不打折。梅河店固定底部、9秒门店轮播、内部流光。9月实际135.68万元；10月实际183088.28元截至5日、预期200.26万元；未来11月202万元、12月312万元、1月358万元为用户授权配置，未接远端AI月度预测。消费者频次/复购基于已有10天会员样本，不代表完整30天全体消费者。ERP中类字典已存，商品预测仍为展示样例；库存与库容分开，智慧决策为本地规则。完整说明见data/需求与数据对接说明.md。

发布包不含原始ERP Excel、会员标识、天气私钥。相关页面、订单联动、图表SVG、天气轮播、JWT/Host、额度/跨月/失败保留均已检查；GitHub任务仍需远端运行验收。无需安装npm依赖。

官方说明：
- https://dev.qweather.com/docs/finance/pricing/
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
