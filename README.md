# XHS Negative Search Skill

一个用于小红书网页的 negative words 过滤工具。它复用你本机 Google Chrome 里已经登录的小红书页面，不绕过登录、验证码、风控或访问限制。

## 功能

- 在小红书页面注入可拖动过滤浮窗
- 输入 negative words 后直接隐藏命中的笔记卡片
- 支持按作者名过滤
- 支持按页面可见日期范围过滤
- 支持“日期未知也隐藏”
- 支持滚动后自动过滤新加载内容
- 支持导出 clean / rejected CSV 和 Markdown summary

## 使用方式

先在 macOS 的 Google Chrome 中手动登录小红书，然后打开小红书页面。

注入可视化过滤面板：

```bash
node scripts/xhs_negative_search.js --panel
```

注入面板并预填排除词：

```bash
node scripts/xhs_negative_search.js --panel --negative "签证,广告,招募"
```

直接在页面隐藏命中卡片并导出报告：

```bash
node scripts/xhs_negative_search.js \
  --negative "签证,广告,招募,代理,私信" \
  --hide-on-page \
  --max-results 50 \
  --scrolls 8
```

搜索关键词后过滤：

```bash
node scripts/xhs_negative_search.js \
  --keyword "清迈租房" \
  --negative "签证,广告,招募,代理,私信" \
  --hide-on-page \
  --max-results 50 \
  --scrolls 8
```

## 输出

报告会写入：

```text
outputs/
```

包括：

- clean CSV
- rejected CSV
- Markdown summary

## 边界

- 不绕过登录、验证码、风控或访问限制
- 只处理当前 Chrome 已登录且已加载出来的小红书页面内容
- 小红书信息流卡片通常不展示发布日期，日期过滤只对页面可见日期文本生效
- 小红书页面结构变化时，可能需要更新选择器逻辑
- 不建议高频、大批量抓取，适合人工授权的辅助整理和过滤
