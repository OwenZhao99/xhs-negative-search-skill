#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const keyword = args.keyword || "";
const negativeWords = splitWords(args.negative || args["negative-words"] || "");
const maxResults = Number(args["max-results"] || 50);
const scrolls = Number(args.scrolls || 8);
const delayMs = Number(args.delay || 1400);
const outDir = path.resolve(args.out || path.join(__dirname, "..", "outputs"));
const hideOnPage = Boolean(args["hide-on-page"] || args.hide || args.delete);
const watchPage = args.watch !== "false";
const installPanel = Boolean(args.panel || args.ui);

if (!installPanel && !negativeWords.length) {
  fail("Missing --negative. Example: --negative \"广告,招募,代理,私信,加盟,低价\"");
}

fs.mkdirSync(outDir, { recursive: true });

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});

async function main() {
  activateXhsTab();

  if (keyword) {
    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;
    runChromeJs(`location.href = ${JSON.stringify(url)};`);
    sleep(4000);
  }

  const currentUrl = runChromeJs("location.href");
  if (!/xiaohongshu\.com/.test(currentUrl)) {
    fail(`Active Chrome tab is not Xiaohongshu: ${currentUrl}`);
  }

  if (installPanel) {
    const result = JSON.parse(runChromeJs(panelJs(negativeWords)));
    console.log(`Xiaohongshu negative words panel installed`);
    console.log(`URL: ${currentUrl}`);
    console.log(`Initial words: ${result.words.join(", ") || "(empty)"}`);
    console.log(`Hidden on page: ${result.hidden}`);
    return;
  }

  const seen = new Map();
  for (let i = 0; i <= scrolls && seen.size < maxResults; i += 1) {
    const items = JSON.parse(runChromeJs(scrapeJs()));
    for (const item of items) {
      const key = item.url || item.text;
      if (!key || seen.has(key)) continue;
      seen.set(key, item);
      if (seen.size >= maxResults) break;
    }
    if (i < scrolls && seen.size < maxResults) {
      runChromeJs("window.scrollBy(0, Math.floor(window.innerHeight * 0.9));");
      sleep(delayMs);
    }
  }

  const all = Array.from(seen.values()).slice(0, maxResults);
  const classified = all.map((item) => {
    const haystack = [item.title, item.author, item.text, item.url].filter(Boolean).join("\n");
    const hits = negativeWords.filter((word) => includesFolded(haystack, word));
    return { ...item, negative_hits: hits };
  });

  const clean = classified.filter((item) => item.negative_hits.length === 0);
  const rejected = classified.filter((item) => item.negative_hits.length > 0);
  let pageFilterResult = null;
  if (hideOnPage) {
    pageFilterResult = JSON.parse(runChromeJs(pageFilterJs(negativeWords, { watch: watchPage })));
  }
  const stamp = timestamp();
  const base = keyword ? slug(keyword) : "current-page";

  const cleanPath = path.join(outDir, `xhs-clean-${base}-${stamp}.csv`);
  const rejectedPath = path.join(outDir, `xhs-rejected-${base}-${stamp}.csv`);
  const summaryPath = path.join(outDir, `xhs-summary-${base}-${stamp}.md`);

  writeCsv(cleanPath, clean);
  writeCsv(rejectedPath, rejected);
  writeSummary(summaryPath, {
    keyword,
    currentUrl,
    negativeWords,
    total: classified.length,
    clean,
    rejected,
  });

  console.log(`Xiaohongshu negative search complete`);
  console.log(`URL: ${currentUrl}`);
  console.log(`Total: ${classified.length}`);
  console.log(`Clean: ${clean.length}`);
  console.log(`Rejected: ${rejected.length}`);
  if (pageFilterResult) {
    console.log(`Hidden on page: ${pageFilterResult.hidden}`);
    console.log(`Page filter watcher: ${pageFilterResult.watch ? "on" : "off"}`);
  }
  console.log(`Clean CSV: ${cleanPath}`);
  console.log(`Rejected CSV: ${rejectedPath}`);
  console.log(`Summary: ${summaryPath}`);
}

function activateXhsTab() {
  const script = `
tell application "Google Chrome"
  repeat with wi from 1 to count of windows
    repeat with ti from 1 to count of tabs of window wi
      if (URL of tab ti of window wi) contains "xiaohongshu.com" then
        set active tab index of window wi to ti
        set index of window wi to 1
        return URL of active tab of front window
      end if
    end repeat
  end repeat
  return "NOT_FOUND"
end tell
`;
  const result = runAppleScript(script);
  if (result === "NOT_FOUND") {
    fail("No Xiaohongshu tab found in Google Chrome. Open Xiaohongshu and log in first.");
  }
}

function runChromeJs(js) {
  const script = `
tell application "Google Chrome"
  repeat with wi from 1 to count of windows
    repeat with ti from 1 to count of tabs of window wi
      if (URL of tab ti of window wi) contains "xiaohongshu.com" then
        return execute tab ti of window wi javascript ${JSON.stringify(js)}
      end if
    end repeat
  end repeat
  return "NO_XHS_TAB"
end tell
`;
  return runAppleScript(script);
}

function runAppleScript(script) {
  return execFileSync("osascript", ["-e", script], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function scrapeJs() {
  return `(() => {
    const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll('.note-item, section'));
    const items = [];
    const seen = new Set();

    for (const card of cards) {
      const anchor = card.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]');
      if (!anchor) continue;
      const url = anchor.href ? new URL(anchor.href, location.href).href.split("?")[0] : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const text = normalize(card.innerText || anchor.innerText || "");
      if (!text || text.length < 2) continue;

      const lines = text.split(/\\n|\\r| {2,}/).map(normalize).filter(Boolean);
      const title =
        normalize(card.querySelector(".title")?.innerText) ||
        normalize(anchor.getAttribute("title")) ||
        lines[0] ||
        text.slice(0, 80);
      const author =
        normalize(card.querySelector(".author .name")?.innerText) ||
        normalize(card.querySelector(".author")?.innerText) ||
        "";
      const likes = normalize(card.querySelector(".like-wrapper .count")?.innerText);

      items.push({
        title,
        author,
        likes,
        url,
        text,
      });
    }

    return JSON.stringify(items);
  })()`;
}

function pageFilterJs(words, options) {
  return `(() => {
    const negativeWords = ${JSON.stringify(words)};
    const shouldWatch = ${JSON.stringify(Boolean(options.watch))};
    const styleId = "xhs-negative-search-style";
    const badgeId = "xhs-negative-search-badge";
    const hiddenAttr = "data-xhs-negative-hidden";
    const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLocaleLowerCase();

    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = '[data-xhs-negative-hidden="true"]{display:none!important;} #xhs-negative-search-badge{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;padding:10px 12px;border-radius:8px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2);max-width:320px;}';
      document.documentElement.appendChild(style);
    }

    const apply = () => {
      let hidden = 0;
      const cards = Array.from(document.querySelectorAll('.note-item, section'));
      for (const card of cards) {
        const anchor = card.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]');
        if (!anchor) continue;
        const text = normalize(card.innerText || "");
        const hits = negativeWords.filter((word) => text.includes(String(word).toLocaleLowerCase()));
        if (hits.length) {
          card.setAttribute(hiddenAttr, "true");
          card.setAttribute("data-xhs-negative-hits", hits.join(","));
        }
      }
      hidden = document.querySelectorAll('[' + hiddenAttr + '="true"]').length;

      let badge = document.getElementById(badgeId);
      if (!badge) {
        badge = document.createElement("div");
        badge.id = badgeId;
        document.body.appendChild(badge);
      }
      badge.textContent = "XHS negative filter: hidden " + hidden + " notes | " + negativeWords.join(", ");
      return hidden;
    };

    if (window.__xhsNegativeSearchObserver) {
      window.__xhsNegativeSearchObserver.disconnect();
      window.__xhsNegativeSearchObserver = null;
    }

    const hidden = apply();
    if (shouldWatch) {
      const observer = new MutationObserver(() => {
        clearTimeout(window.__xhsNegativeSearchTimer);
        window.__xhsNegativeSearchTimer = setTimeout(apply, 250);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.__xhsNegativeSearchObserver = observer;
    }

    return JSON.stringify({ hidden, watch: shouldWatch });
  })()`;
}

function panelJs(initialWords) {
  return `(() => {
    const initialWords = ${JSON.stringify(initialWords)};
    const panelId = "xhs-negative-search-panel";
    const styleId = "xhs-negative-search-panel-style";
    const hiddenAttr = "data-xhs-negative-hidden";
    const hitAttr = "data-xhs-negative-hits";
    const wordsKey = "xhs-negative-search-words";
    const authorsKey = "xhs-negative-search-authors";
    const commentsKey = "xhs-negative-search-comments";
    const dateFromKey = "xhs-negative-search-date-from";
    const dateToKey = "xhs-negative-search-date-to";
    const hideUnknownDateKey = "xhs-negative-search-hide-unknown-date";
    const positionKey = "xhs-negative-search-panel-position";
    const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLocaleLowerCase();
    const splitWords = (value) => String(value || "")
      .split(/[,，\\n]/)
      .map((word) => word.trim())
      .filter(Boolean);

    const getCards = () => Array.from(document.querySelectorAll(".note-item, section"))
      .filter((card) => card.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]'));
    window.__xhsNegativeRemoved = window.__xhsNegativeRemoved || new Map();
    window.__xhsNegativeRemovedUrls = window.__xhsNegativeRemovedUrls || new Set();
    const cardKey = (card) => {
      const anchor = card.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]');
      return anchor ? new URL(anchor.href, location.href).href.split("?")[0] : "";
    };
    const getCommentText = (card) => {
      const selectors = [
        ".comment",
        ".comments",
        ".comment-list",
        ".comment-item",
        "[class*=comment]",
        "[class*=Comment]"
      ];
      const nodes = selectors.flatMap((selector) => Array.from(card.querySelectorAll(selector)));
      return nodes.map((node) => node.innerText || node.textContent || "").join(" ");
    };

    const parseDate = (text) => {
      const now = new Date();
      const normalized = String(text || "").replace(/\\s+/g, " ");
      const full = normalized.match(/(20\\d{2})[.\\/-](\\d{1,2})[.\\/-](\\d{1,2})/);
      if (full) return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
      const monthDay = normalized.match(/(?:^|[^\\d])(\\d{1,2})[.\\/-](\\d{1,2})(?:[^\\d]|$)/);
      if (monthDay) return new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]));
      if (/今天/.test(normalized)) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (/昨天/.test(normalized)) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const daysAgo = normalized.match(/(\\d+)\\s*天前/);
      if (daysAgo) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(daysAgo[1]));
      return null;
    };
    const parseInputDate = (value, endOfDay) => {
      if (!value) return null;
      const date = new Date(value + (endOfDay ? "T23:59:59" : "T00:00:00"));
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const triggerLayout = () => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
      document.body.style.minHeight = document.body.style.minHeight === "0px" ? "" : "0px";
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("scroll"));
      });
    };
    const clearHidden = () => {
      for (const card of document.querySelectorAll("[" + hiddenAttr + "]")) {
        card.removeAttribute(hiddenAttr);
        card.removeAttribute(hitAttr);
      }
      for (const [key, record] of window.__xhsNegativeRemoved.entries()) {
        if (!record.node || !record.placeholder || !record.placeholder.parentNode) continue;
        record.node.removeAttribute(hiddenAttr);
        record.node.removeAttribute(hitAttr);
        record.placeholder.parentNode.insertBefore(record.node, record.placeholder);
        record.placeholder.remove();
      }
      window.__xhsNegativeRemoved.clear();
      window.__xhsNegativeRemovedUrls.clear();
      triggerLayout();
    };

    const applyFilters = (filters) => {
      clearHidden();
      const stats = { hidden: 0, word: 0, author: 0, comment: 0, date: 0, unknownDate: 0, visible: 0 };
      const fromDate = parseInputDate(filters.dateFrom, false);
      const toDate = parseInputDate(filters.dateTo, true);
      for (const card of getCards()) {
        const text = normalize(card.innerText || "");
        const author = normalize(card.querySelector(".author .name")?.innerText || card.querySelector(".author")?.innerText || "");
        const commentText = normalize(getCommentText(card));
        const hits = [];
        const wordHits = filters.words.filter((word) => text.includes(String(word).toLocaleLowerCase()));
        const authorHits = filters.authors.filter((word) => author.includes(String(word).toLocaleLowerCase()));
        const commentHits = filters.comments.filter((word) => commentText.includes(String(word).toLocaleLowerCase()));
        for (const hit of wordHits) hits.push("word:" + hit);
        for (const hit of authorHits) hits.push("author:" + hit);
        for (const hit of commentHits) hits.push("comment:" + hit);

        if (fromDate || toDate) {
          const cardDate = parseDate(card.innerText || "");
          if (!cardDate) {
            stats.unknownDate += 1;
            if (filters.hideUnknownDate) hits.push("date:unknown");
          } else if ((fromDate && cardDate < fromDate) || (toDate && cardDate > toDate)) {
            hits.push("date:out-of-range");
            stats.date += 1;
          }
        }

        if (hits.length) {
          const key = cardKey(card);
          card.setAttribute(hiddenAttr, "true");
          card.setAttribute(hitAttr, hits.join(","));
          if (key && card.parentNode) {
            const placeholder = document.createComment("xhs-negative-removed:" + key);
            card.parentNode.insertBefore(placeholder, card);
            window.__xhsNegativeRemoved.set(key, {
              node: card,
              placeholder,
              parent: placeholder.parentNode,
              hits: hits.join(","),
            });
            window.__xhsNegativeRemovedUrls.add(key);
            card.remove();
          }
          stats.hidden += 1;
          if (wordHits.length) stats.word += 1;
          if (authorHits.length) stats.author += 1;
          if (commentHits.length) stats.comment += 1;
        } else {
          stats.visible += 1;
        }
      }
      triggerLayout();
      return stats;
    };

    const saveConfig = (filters) => {
      localStorage.setItem(wordsKey, filters.words.join(","));
      localStorage.setItem(authorsKey, filters.authors.join(","));
      localStorage.setItem(commentsKey, filters.comments.join(","));
      localStorage.setItem(dateFromKey, filters.dateFrom || "");
      localStorage.setItem(dateToKey, filters.dateTo || "");
      localStorage.setItem(hideUnknownDateKey, filters.hideUnknownDate ? "1" : "0");
    };
    const loadWords = () => {
      const stored = localStorage.getItem(wordsKey);
      if (initialWords.length) return initialWords;
      return stored ? splitWords(stored) : [];
    };
    const readFilters = () => ({
      words: splitWords(panel.querySelector(".xhs-ns-words").value),
      authors: splitWords(panel.querySelector(".xhs-ns-authors").value),
      comments: splitWords(panel.querySelector(".xhs-ns-comments").value),
      dateFrom: panel.querySelector(".xhs-ns-date-from").value,
      dateTo: panel.querySelector(".xhs-ns-date-to").value,
      hideUnknownDate: panel.querySelector(".xhs-ns-hide-unknown-date").checked,
    });

    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.documentElement.appendChild(style);
    }
    style.textContent = [
        '[' + hiddenAttr + '="true"]{display:none!important;}',
        '#' + panelId + '{position:fixed;right:16px;top:96px;z-index:2147483647;width:304px;background:#fff;color:#111;border:1px solid rgba(0,0,0,.12);box-shadow:0 10px 30px rgba(0,0,0,.18);border-radius:8px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;transform:none;}',
        '#' + panelId + ' .xhs-ns-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#111;color:#fff;font-weight:600;cursor:move;user-select:none;}',
        '#' + panelId + ' .xhs-ns-close{border:0;background:transparent;color:#fff;font-size:18px;line-height:1;cursor:pointer;}',
        '#' + panelId + ' .xhs-ns-body{display:block;padding:12px;}',
        '#' + panelId + ' label{display:block;margin:8px 0 4px;color:#444;font-size:12px;font-weight:600;}',
        '#' + panelId + ' textarea{box-sizing:border-box;width:100%;height:68px;resize:vertical;border:1px solid #ddd;border-radius:6px;padding:8px;color:#111;background:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
        '#' + panelId + ' input[type="date"]{box-sizing:border-box;width:100%;height:30px;border:1px solid #ddd;border-radius:6px;padding:0 8px;color:#111;background:#fff;}',
        '#' + panelId + ' .xhs-ns-date-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
        '#' + panelId + ' .xhs-ns-check{display:flex;align-items:center;gap:6px;margin-top:6px;color:#555;font-size:12px;white-space:nowrap;}',
        '#' + panelId + ' .xhs-ns-actions{display:flex;gap:8px;margin-top:10px;}',
        '#' + panelId + ' button{height:30px;border-radius:6px;border:1px solid #ddd;background:#f7f7f7;color:#111;padding:0 10px;cursor:pointer;}',
        '#' + panelId + ' .xhs-ns-apply{background:#ff2442;border-color:#ff2442;color:#fff;font-weight:600;}',
        '#' + panelId + ' .xhs-ns-status{margin-top:10px;color:#555;font-size:12px;white-space:pre-line;max-height:90px;overflow:auto;}'
      ].join("");

    let panel = document.getElementById(panelId);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = panelId;
      document.body.appendChild(panel);
    }
    if (!panel.querySelector(".xhs-ns-panel-v3")) {
      panel.innerHTML = [
        '<div class="xhs-ns-panel-v3"></div>',
        '<div class="xhs-ns-head"><span>Negative Words</span><button class="xhs-ns-close" title="Close">×</button></div>',
        '<div class="xhs-ns-body">',
        '<div><label>内容排除词</label><textarea class="xhs-ns-words" placeholder="签证, 广告, 招募"></textarea></div>',
        '<div><label>过滤作者</label><textarea class="xhs-ns-authors" placeholder="旅行社, 代办"></textarea></div>',
        '<div><label>过滤评论</label><textarea class="xhs-ns-comments" placeholder="私, 已回, 1"></textarea></div>',
        '<div>',
        '<div class="xhs-ns-date-row">',
        '<div><label>开始日期</label><input class="xhs-ns-date-from" type="date"></div>',
        '<div><label>结束日期</label><input class="xhs-ns-date-to" type="date"></div>',
        '</div>',
        '<label class="xhs-ns-check"><input class="xhs-ns-hide-unknown-date" type="checkbox">日期未知也隐藏</label>',
        '</div>',
        '<div class="xhs-ns-actions">',
        '<button class="xhs-ns-apply">Apply</button>',
        '<button class="xhs-ns-reset">Reset</button>',
        '</div>',
        '<div class="xhs-ns-status">Ready</div>',
        '</div>'
      ].join("");
    }

    const header = panel.querySelector(".xhs-ns-head");
    const wordsInput = panel.querySelector(".xhs-ns-words");
    const authorsInput = panel.querySelector(".xhs-ns-authors");
    const commentsInput = panel.querySelector(".xhs-ns-comments");
    const dateFromInput = panel.querySelector(".xhs-ns-date-from");
    const dateToInput = panel.querySelector(".xhs-ns-date-to");
    const hideUnknownDateInput = panel.querySelector(".xhs-ns-hide-unknown-date");
    const status = panel.querySelector(".xhs-ns-status");
    const applyButton = panel.querySelector(".xhs-ns-apply");
    const resetButton = panel.querySelector(".xhs-ns-reset");
    const closeButton = panel.querySelector(".xhs-ns-close");

    const loadedWords = loadWords();
    wordsInput.value = loadedWords.join(", ");
    authorsInput.value = localStorage.getItem(authorsKey) || "";
    commentsInput.value = localStorage.getItem(commentsKey) || "";
    dateFromInput.value = localStorage.getItem(dateFromKey) || "";
    dateToInput.value = localStorage.getItem(dateToKey) || "";
    hideUnknownDateInput.checked = localStorage.getItem(hideUnknownDateKey) === "1";

    const savedPosition = (() => {
      try { return JSON.parse(localStorage.getItem(positionKey) || "null"); } catch (_) { return null; }
    })();
    if (savedPosition && Number.isFinite(savedPosition.left) && Number.isFinite(savedPosition.top)) {
      panel.style.left = savedPosition.left + "px";
      panel.style.top = savedPosition.top + "px";
      panel.style.right = "auto";
      panel.style.transform = "none";
    }

    const refresh = () => {
      const filters = readFilters();
      saveConfig(filters);
      const stats = applyFilters(filters);
      const active = [];
      if (filters.words.length) active.push("words: " + filters.words.join(", "));
      if (filters.authors.length) active.push("authors: " + filters.authors.join(", "));
      if (filters.comments.length) active.push("comments: " + filters.comments.join(", "));
      if (filters.dateFrom || filters.dateTo) active.push("date: " + (filters.dateFrom || "...") + " to " + (filters.dateTo || "..."));
      status.textContent = [
        "Hidden " + stats.hidden + " notes; visible " + stats.visible,
        "By word " + stats.word + ", author " + stats.author + ", comment " + stats.comment + ", date " + stats.date,
        stats.unknownDate ? "Unknown date cards: " + stats.unknownDate : "",
        active.length ? active.join("\\n") : "No filters set"
      ].filter(Boolean).join("\\n");
      return { words: filters.words, hidden: stats.hidden };
    };

    applyButton.onclick = refresh;
    resetButton.onclick = () => {
      wordsInput.value = "";
      authorsInput.value = "";
      commentsInput.value = "";
      dateFromInput.value = "";
      dateToInput.value = "";
      hideUnknownDateInput.checked = false;
      saveConfig({ words: [], authors: [], comments: [], dateFrom: "", dateTo: "", hideUnknownDate: false });
      clearHidden();
      status.textContent = "Reset: all loaded notes visible";
    };
    closeButton.onclick = () => {
      panel.remove();
    };
    panel.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") refresh();
    });
    for (const el of [dateFromInput, dateToInput, hideUnknownDateInput]) {
      el.addEventListener("change", refresh);
    }

    let dragState = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragState = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
    });
    header.addEventListener("pointermove", (event) => {
      if (!dragState) return;
      const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, event.clientX - dragState.dx));
      const top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, event.clientY - dragState.dy));
      panel.style.left = left + "px";
      panel.style.top = top + "px";
      panel.style.right = "auto";
      panel.style.transform = "none";
    });
    header.addEventListener("pointerup", () => {
      if (!dragState) return;
      dragState = null;
      const rect = panel.getBoundingClientRect();
      localStorage.setItem(positionKey, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
    });

    if (window.__xhsNegativeSearchPanelObserver) {
      window.__xhsNegativeSearchPanelObserver.disconnect();
    }
    const observer = new MutationObserver(() => {
      clearTimeout(window.__xhsNegativeSearchPanelTimer);
      window.__xhsNegativeSearchPanelTimer = setTimeout(refresh, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__xhsNegativeSearchPanelObserver = observer;

    const result = refresh();
    return JSON.stringify(result);
  })()`;
}

function writeCsv(filePath, rows) {
  const headers = ["title", "author", "likes", "url", "negative_hits", "text"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(Array.isArray(row[header]) ? row[header].join("|") : row[header] || "")).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeSummary(filePath, data) {
  const hitCounts = new Map();
  for (const item of data.rejected) {
    for (const hit of item.negative_hits) {
      hitCounts.set(hit, (hitCounts.get(hit) || 0) + 1);
    }
  }

  const lines = [];
  lines.push("# Xiaohongshu Negative Search Summary");
  lines.push("");
  if (data.keyword) lines.push(`- Keyword: ${data.keyword}`);
  lines.push(`- Source URL: ${data.currentUrl}`);
  lines.push(`- Negative words: ${data.negativeWords.join(", ")}`);
  lines.push(`- Total loaded notes: ${data.total}`);
  lines.push(`- Clean notes: ${data.clean.length}`);
  lines.push(`- Rejected notes: ${data.rejected.length}`);
  lines.push("");
  lines.push("## Rejection Reasons");
  lines.push("");
  if (!hitCounts.size) {
    lines.push("- None");
  } else {
    for (const [word, count] of [...hitCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${word}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Clean Results");
  lines.push("");
  for (const item of data.clean) {
    lines.push(`- [${escapeMd(item.title)}](${item.url})${item.author ? ` - ${escapeMd(item.author)}` : ""}`);
  }
  lines.push("");
  lines.push("## Rejected Results");
  lines.push("");
  for (const item of data.rejected) {
    lines.push(`- [${escapeMd(item.title)}](${item.url}) - hits: ${item.negative_hits.join(", ")}`);
  }
  lines.push("");

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function splitWords(value) {
  return value
    .split(/[,，\\n]/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function includesFolded(text, word) {
  return String(text).toLocaleLowerCase().includes(String(word).toLocaleLowerCase());
}

function csvCell(value) {
  const stringValue = String(value).replace(/\\r?\\n/g, " ");
  return /[",\\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

function escapeMd(value) {
  return String(value || "").replace(/[\\[\\]]/g, "\\\\$&");
}

function slug(value) {
  return String(value)
    .trim()
    .replace(/\\s+/g, "-")
    .replace(/[\\\\/:*?"<>|]/g, "")
    .slice(0, 40) || "search";
}

function timestamp() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
