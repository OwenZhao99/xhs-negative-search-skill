---
name: xhs-negative-search
description: Use this skill to search or inspect Xiaohongshu pages in the user's logged-in Chrome session, filter visible notes by negative words, and export clean/rejected result reports.
---

# XHS Negative Search

Use this skill when the user wants Xiaohongshu search results reorganized after excluding notes that contain negative words.

## Workflow

1. Confirm the user is already logged in to Xiaohongshu in Google Chrome.
2. Run `scripts/xhs_negative_search.js` from this skill folder.
3. Prefer a small result count first, then increase only if the page stays stable.
4. Export both clean and rejected results so the user can inspect filtering reasons.

## Commands

Search a keyword and filter:

```bash
node scripts/xhs_negative_search.js \
  --keyword "清迈旅拍" \
  --negative "广告,招募,代理,私信,加盟,低价" \
  --max-results 50 \
  --scrolls 8
```

Filter the currently open Xiaohongshu page:

```bash
node scripts/xhs_negative_search.js \
  --negative "广告,招募,代理,私信,加盟,低价" \
  --max-results 50 \
  --scrolls 8
```

Hide matching notes directly on the current Xiaohongshu page:

```bash
node scripts/xhs_negative_search.js \
  --negative "广告,招募,代理,私信,加盟,低价" \
  --hide-on-page \
  --max-results 50 \
  --scrolls 8
```

`--hide-on-page` sets matching note cards to `display: none` in the current page and installs a page watcher so newly loaded cards are hidden too. Refresh the page to restore the original view.

Install a right-side input panel on the Xiaohongshu page:

```bash
node scripts/xhs_negative_search.js --panel
```

Install the panel with initial words:

```bash
node scripts/xhs_negative_search.js --panel --negative "签证,广告,招募"
```

The panel supports comma-separated or line-separated negative words. Click Apply to hide matching notes, Reset to restore loaded notes, or press Cmd/Ctrl+Enter in the textarea to apply.

Panel features:

- Drag the black header to move the panel; position is saved in the page.
- Use "内容排除词" to hide notes by title/card text.
- Use "过滤作者" to hide notes by author name.
- Use the start/end date fields to keep only a visible date range.
- Date filtering only works when a note card exposes date text on the loaded page. Xiaohongshu feed cards often omit publish dates, so the panel reports unknown-date cards and can optionally hide them.

## Outputs

The script writes files under `outputs/`:

- `xhs-clean-*.csv`: notes that did not match negative words
- `xhs-rejected-*.csv`: notes excluded by negative words
- `xhs-summary-*.md`: readable summary with filtering reasons

## Boundaries

- Do not bypass login, CAPTCHA, rate limits, or access controls.
- Only process content visible or loaded in the user's browser.
- If Xiaohongshu changes its DOM, update the selector logic in `scripts/xhs_negative_search.js`.
- Keep search volume modest to reduce account and platform risk.
