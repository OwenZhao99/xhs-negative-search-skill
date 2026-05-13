# XHS Negative Search Skill 提交说明

## 赛道

邪修赛道

## 项目名称

XHS Negative Search Skill

## 项目简介

一个运行在用户已登录 Chrome 小红书页面中的搜索过滤 Skill。用户可以在当前小红书页面右侧打开可拖动面板，输入 negative words，并按作者或可见日期范围过滤搜索结果；命中的内容会在当前页面隐藏，帮助用户减少营销号、引流贴和垃圾信息干扰。

## 演示视频

- B 站：https://b23.tv/32i3BN7
- 小红书：http://xhslink.com/o/1OrAHFA2U1Y

## GitHub

https://github.com/OwenZhao99/xhs-negative-search-skill

## 商业价值说明

小红书搜索在租房、旅游、本地生活、消费决策等场景里经常混入营销号、引流贴和垃圾内容，用户需要反复手动跳过。这个 Skill 把“负向过滤”做成可复用能力，在用户已有登录页面中直接生效，不改变平台原有搜索流程。它可以扩展到达人筛选、品牌投放前清洗、竞品内容监控和垂直社区搜索降噪，降低人工筛选成本，提高信息获取效率。

## 提交包内容

- `skill.md` / `SKILL.md`：Skill 说明与调用方式
- `README.md`：安装、运行、边界说明
- `scripts/xhs_negative_search.js`：核心脚本
- `SUBMISSION.md`：赛道、链接、商业价值说明

## 边界说明

- 不绕过登录、验证码、风控或访问限制
- 只处理用户当前浏览器已加载内容
- 日期过滤依赖页面可见日期文本
- 平台 DOM 变化时需要维护选择器
