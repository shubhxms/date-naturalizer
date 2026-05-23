import * as chrono from "chrono-node";
import { formatInTz, relative, shortTzLabel } from "./lib/format.js";

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "CODE", "PRE",
  "SELECT", "OPTION",
]);

const MIN_TEXT = 4;
const MAX_TEXT = 20000;
const MAX_SPANS = 2000;

const BLOCK_TAGS = new Set([
  "P", "LI", "TD", "TH", "DD", "DT", "BLOCKQUOTE", "FIGCAPTION", "CAPTION",
  "SUMMARY", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "ARTICLE", "SECTION",
  "HEADER", "FOOTER", "ASIDE", "MAIN", "BODY", "NAV", "FORM", "FIELDSET",
  "LEGEND", "DETAILS", "TR",
]);

const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Article publication date — used as chrono's reference so that relative
// phrases ("yesterday", "in 3 days") resolve against when the page was
// written, not when it's being read. Falls back to today if not found.
function collectDates(obj, out) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const v of obj) collectDates(v, out);
    return;
  }
  for (const k of ["datePublished", "dateCreated", "uploadDate"]) {
    if (typeof obj[k] === "string") out.push(obj[k]);
  }
  for (const v of Object.values(obj)) collectDates(v, out);
}

function detectPubDate() {
  try {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent || "");
        const out = [];
        collectDates(data, out);
        for (const v of out) {
          const d = new Date(v);
          if (!isNaN(d.getTime())) return d;
        }
      } catch {}
    }
  } catch {}
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[itemprop="datePublished"]',
    'meta[name="datePublished"]',
    'meta[name="DC.date.issued"]',
    'meta[name="DC.date"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
  ];
  for (const sel of metaSelectors) {
    const el = document.querySelector(sel);
    const val = el && el.getAttribute("content");
    if (val) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d;
    }
  }
  const time = document.querySelector(
    'article time[datetime][pubdate], article time[datetime][itemprop="datePublished"], time[datetime][pubdate]'
  );
  if (time) {
    const dt = time.getAttribute("datetime");
    if (dt) {
      const d = new Date(dt);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}
const pubDate = detectPubDate();
function makeRefDate() {
  return pubDate ? new Date(pubDate) : new Date();
}

// Implied-year handling. chrono fills in the year of its reference Date
// when the source has no explicit year. We override that per-match by
// looking at the closest year in the surrounding DOM — block first, then
// ancestors — falling back to a year in <title>/<h1>, then today.
const YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;

const PAGE_YEAR_FALLBACK = (() => {
  const sources = [
    document.title || "",
    document.querySelector("h1")?.textContent || "",
  ];
  for (const s of sources) {
    const m = s.match(YEAR_RE);
    if (m) return parseInt(m[1], 10);
  }
  return null;
})();

function findContextYear(blockEl) {
  let n = blockEl;
  let depth = 0;
  while (n && n.nodeType === 1 && depth < 6) {
    const txt = n.textContent || "";
    if (txt.length && txt.length < 5000) {
      const m = txt.match(YEAR_RE);
      if (m) return parseInt(m[1], 10);
    }
    n = n.parentElement;
    depth++;
  }
  return PAGE_YEAR_FALLBACK;
}

// Timezone tokens that, if present in the matched text itself, mean
// chrono already knew the zone — don't override from context.
const TZ_TOKENS =
  /\b(?:UTC|GMT|Z|EST|EDT|CST|CDT|MST|MDT|PST|PDT|IST|JST|AEST|AEDT|BST|CET|CEST|EET|EEST|UTC[+-]\d|GMT[+-]\d|[+-]\d{2}:?\d{2})\b/;
const UTC_LIKE = /\b(?:UTC|GMT|Z)\b/;

// Look up the row (for infobox-style <th>label</th><td>value</td>) and
// the table head/caption for a TZ marker. Returns "UTC" if a UTC-like
// label is found, otherwise null.
function findContextTz(blockEl) {
  if (!blockEl || !blockEl.closest) return null;
  const tr = blockEl.closest("tr");
  if (tr) {
    for (const th of tr.querySelectorAll("th")) {
      if (UTC_LIKE.test(th.textContent || "")) return "UTC";
    }
  }
  const table = blockEl.closest("table");
  if (table) {
    const heads = table.querySelectorAll("thead, caption");
    for (const h of heads) {
      if (UTC_LIKE.test(h.textContent || "")) return "UTC";
    }
  }
  return null;
}

function isoForResult(result, ctxTz, blockEl) {
  const s = result.start;
  // Only override the year for absolute date matches. For relative
  // phrases the year already comes from chrono's resolution against
  // the article publication date.
  const t = result.text || "";
  const isAbsolute = MONTH_NAME.test(t) || ISO_DATE.test(t);
  let year = s.get("year");
  let yearOverridden = false;
  if (isAbsolute && !s.isCertain("year")) {
    const ny = findContextYear(blockEl);
    if (ny != null && ny !== year) {
      year = ny;
      yearOverridden = true;
    }
  }
  const useUtc = ctxTz === "UTC" && !TZ_TOKENS.test(result.text || "");
  if (useUtc) {
    return new Date(
      Date.UTC(
        year,
        (s.get("month") || 1) - 1,
        s.get("day") || 1,
        s.get("hour") || 0,
        s.get("minute") || 0,
        s.get("second") || 0
      )
    ).toISOString();
  }
  const d = s.date();
  if (yearOverridden) {
    const d2 = new Date(d);
    d2.setFullYear(year);
    return d2.toISOString();
  }
  return d.toISOString();
}

let active = false;
let settings = { globalEnabled: true, disabledHosts: [], extraTimezones: [] };
const wrapped = new Set(); // HTMLSpanElement[]

let tooltipEl = null;
let scanQueue = new Set();
let scanScheduled = false;
let observer = null;

function isEnabled(s) {
  return s.globalEnabled && !s.disabledHosts.includes(location.hostname);
}

function shouldSkip(node) {
  let n = node.parentNode;
  while (n && n.nodeType === 1) {
    if (SKIP_TAGS.has(n.tagName)) return true;
    if (n.isContentEditable) return true;
    if (n.classList && n.classList.contains("dn-date")) return true;
    n = n.parentNode;
  }
  return false;
}

// Source-text anchors. chrono's isCertain/get fill in implied values, so
// we test the match's actual characters: keep a result only if its text
// contains an ISO date or a month name plus a digit (day or year).
const MONTH_NAME =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const ANY_DIGIT = /\d/;

const HAS_LETTER = /[A-Za-z]/;

// Anything that could plausibly contain a date or relative phrase.
// Used as a cheap pre-filter before calling chrono.
const DATE_HINTS =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?|ago|today|tomorrow|yesterday|tonight|noon|midnight|now|last|next|this|coming|past|recent|hour|hours|hr|hrs|minute|minutes|min|mins|second|seconds|sec|secs|day|days|week|weeks|month|months|year|years|morning|afternoon|evening|night)\b|\d{4}-\d{2}-\d{2}/i;

// Trust chrono. Reject only obvious junk: too short, or purely
// numeric ranges like "129–130" (unless it's a real ISO date).
function isWantedMatch(result) {
  if (!result.start) return false;
  const t = result.text || "";
  if (t.length < 3) return false;
  if (!HAS_LETTER.test(t) && !ISO_DATE.test(t)) return false;
  return true;
}

// Find the underlinable extent within a chrono match. We trim leading
// connector words ("on", "by", "in", etc.) — anchor at the first date
// token (ISO date, or day-digit-before-month, or month name) — but keep
// trailing time/timezone tokens which are part of the same instant.
function findExtent(text) {
  const iso = text.match(ISO_DATE);
  const month = text.match(MONTH_NAME);
  let s;
  if (iso && (!month || iso.index <= month.index)) {
    s = iso.index;
  } else if (month) {
    s = month.index;
    const left = text.slice(0, s).match(/\d{1,2}(?:st|nd|rd|th)?[\s,\-\.]+$/i);
    if (left) s -= left[0].length;
  } else {
    // Relative phrase — keep the whole match. Leading connectors like
    // "in" are part of the meaning ("in 3 days" vs "3 days ago").
    s = 0;
    while (s < text.length && /\s/.test(text[s])) s++;
  }
  let e = text.length;
  while (e > s && /[\s.,;:!?]/.test(text[e - 1])) e--;
  return e > s ? { start: s, end: e, text: text.slice(s, e) } : null;
}

// Classify the wrap's display granularity from the anchor text.
// "time"  → "May 23, 2026, 3:00 PM"
// "day"   → "May 23, 2026"
// "month" → "May 2024"
function classifyGranularity(result, extentText) {
  if (result.start.isCertain("hour")) return "time";
  if (MONTH_NAME.test(extentText) || ISO_DATE.test(extentText)) {
    const stripped = extentText.replace(MONTH_NAME, "").replace(/\d{4}/g, "");
    return /\d/.test(stripped) ? "day" : "month";
  }
  return "day";
}

function blockAncestor(node) {
  let n = node.nodeType === 1 ? node : node.parentNode;
  while (n) {
    if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) return n;
    if (n.nodeType === 11) return n; // ShadowRoot / DocumentFragment — boundary
    n = n.parentNode;
  }
  return null;
}

function scanRoot(root) {
  if (!root || (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.length < 2) return NodeFilter.FILTER_REJECT;
      if (shouldSkip(n)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const byBlock = new Map();
  let n;
  while ((n = walker.nextNode())) {
    const block = blockAncestor(n);
    if (!block) continue;
    let arr = byBlock.get(block);
    if (!arr) {
      arr = [];
      byBlock.set(block, arr);
    }
    arr.push(n);
  }
  for (const [block, nodes] of byBlock) {
    if (wrapped.size >= MAX_SPANS) break;
    scanBlock(block, nodes);
  }

  // Recurse into open shadow roots (used by YouTube, many web components).
  if (root.querySelectorAll) {
    for (const el of root.querySelectorAll("*")) {
      const sr = el.shadowRoot;
      if (sr && sr.mode !== "closed") {
        scanRoot(sr);
        observeShadowRoot(sr);
      }
    }
  }
}

const observedShadowRoots = new WeakSet();
function observeShadowRoot(sr) {
  if (observedShadowRoots.has(sr)) return;
  observedShadowRoots.add(sr);
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) scheduleScan(node);
          else if (node.nodeType === 3 && node.parentNode) scheduleScan(node.parentNode);
        }
      } else if (m.type === "characterData" && m.target.parentNode) {
        scheduleScan(m.target.parentNode);
      }
    }
  });
  obs.observe(sr, { childList: true, subtree: true, characterData: true });
}

function scanBlock(blockEl, nodes) {
  let combined = "";
  const map = []; // [{ node, start, end }]
  for (const n of nodes) {
    const start = combined.length;
    combined += n.nodeValue;
    map.push({ node: n, start, end: combined.length });
  }
  if (combined.length < MIN_TEXT || combined.length > MAX_TEXT) return;
  // Cheap pre-filter: skip blocks that can't possibly contain a date.
  // Includes absolute date tokens AND relative phrases ("6 hours ago",
  // "yesterday", "last Friday", "in 3 days").
  if (!DATE_HINTS.test(combined)) return;

  let results;
  try {
    results = chrono.parse(combined, makeRefDate(), { forwardDate: false });
  } catch {
    return;
  }
  if (!results.length) return;

  const ctxTz = findContextTz(blockEl);

  // Group wrap operations by text node. A single chrono match may span
  // multiple text nodes (e.g. "26 January 2001 at <span>08:46 IST</span>"
  // splits across two siblings); we wrap each node's intersection so the
  // underline visually covers the whole date+time even though the DOM
  // is fragmented. All sub-ranges share the same data-iso and data-gran.
  const ops = new Map();
  for (const r of results.sort((a, b) => a.index - b.index)) {
    if (!isWantedMatch(r) || r.index < 0 || !r.text) continue;
    const ext = findExtent(r.text);
    if (!ext) continue;
    const absS = r.index + ext.start;
    const absE = r.index + ext.end;
    if (absE <= absS) continue;
    const iso = isoForResult(r, ctxTz, blockEl);
    const gran = classifyGranularity(r, ext.text);
    for (const entry of map) {
      if (entry.end <= absS) continue;
      if (entry.start >= absE) break;
      const localS = Math.max(absS, entry.start) - entry.start;
      const localE = Math.min(absE, entry.end) - entry.start;
      if (localE <= localS) continue;
      let arr = ops.get(entry.node);
      if (!arr) {
        arr = [];
        ops.set(entry.node, arr);
      }
      arr.push({ start: localS, end: localE, iso, gran });
    }
  }

  for (const [textNode, ranges] of ops) {
    if (wrapped.size >= MAX_SPANS) break;
    wrapRangesInNode(textNode, ranges);
  }
}

function wrapRangesInNode(textNode, ranges) {
  if (!textNode.isConnected || !textNode.parentNode) return;
  ranges.sort((a, b) => a.start - b.start);
  const clean = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start < lastEnd) continue;
    clean.push(r);
    lastEnd = r.end;
  }
  if (!clean.length) return;

  const text = textNode.nodeValue;
  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const r of clean) {
    if (wrapped.size >= MAX_SPANS) break;
    if (r.start > cursor) {
      frag.appendChild(document.createTextNode(text.slice(cursor, r.start)));
    }
    const span = document.createElement("span");
    span.className = "dn-date";
    span.textContent = text.slice(r.start, r.end);
    span.dataset.iso = r.iso;
    span.dataset.gran = r.gran;
    frag.appendChild(span);
    wrapped.add(span);
    cursor = r.end;
  }
  if (cursor < text.length) {
    frag.appendChild(document.createTextNode(text.slice(cursor)));
  }
  textNode.parentNode.replaceChild(frag, textNode);
}

function flushScan() {
  scanScheduled = false;
  const roots = Array.from(scanQueue);
  scanQueue.clear();
  for (const r of roots) {
    if (r.isConnected) scanRoot(r);
  }
}

function scheduleScan(root) {
  scanQueue.add(root);
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => setTimeout(flushScan, 100));
}

function unwrapAll() {
  for (const span of wrapped) {
    if (!span.isConnected) continue;
    const tn = document.createTextNode(span.textContent || "");
    span.replaceWith(tn);
  }
  wrapped.clear();
  // text nodes have new identity, so cached seen set is still valid;
  // but new merged neighbors will be rescanned via observer if re-enabled.
}

// ---- Tooltip ----
function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "dn-tooltip";
  document.documentElement.appendChild(tooltipEl);
  return tooltipEl;
}

const MONTH_FMT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
});

function renderTooltipContent(date, gran) {
  const lines = [];
  if (gran === "month") {
    // Month+year only — not an instant, no TZ conversion meaningful.
    lines.push(`<div class="dn-row dn-primary">${escapeHtml(MONTH_FMT.format(date))}</div>`);
    lines.push(`<div class="dn-row dn-rel">${escapeHtml(relative(date, "month"))}</div>`);
    return lines.join("");
  }
  const withTime = gran === "time";
  lines.push(
    `<div class="dn-row dn-primary">${escapeHtml(formatInTz(date, userTz, withTime))}</div>`
  );
  lines.push(`<div class="dn-row dn-rel">${escapeHtml(relative(date, gran))}</div>`);
  for (const tz of settings.extraTimezones) {
    lines.push(
      `<div class="dn-row dn-extra"><span class="dn-tz">${escapeHtml(
        shortTzLabel(tz)
      )}</span> ${escapeHtml(formatInTz(date, tz, withTime))}</div>`
    );
  }
  return lines.join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function positionTooltip(target) {
  const r = target.getBoundingClientRect();
  const t = tooltipEl;
  t.style.left = "0px";
  t.style.top = "0px";
  t.setAttribute("data-show", "");
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  const margin = 6;
  let left = r.left;
  let top = r.bottom + margin;
  if (left + tw > innerWidth - 4) left = innerWidth - tw - 4;
  if (left < 4) left = 4;
  if (top + th > innerHeight - 4) top = r.top - th - margin;
  t.style.left = left + "px";
  t.style.top = top + "px";
}

function showTooltip(target) {
  const iso = target.dataset.iso;
  if (!iso) return;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return;
  ensureTooltip();
  tooltipEl.innerHTML = renderTooltipContent(date, target.dataset.gran || "day");
  positionTooltip(target);
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.removeAttribute("data-show");
}

function onMouseOver(e) {
  const t = e.target;
  if (t && t.nodeType === 1 && t.classList && t.classList.contains("dn-date")) {
    showTooltip(t);
  }
}
function onMouseOut(e) {
  const t = e.target;
  if (t && t.nodeType === 1 && t.classList && t.classList.contains("dn-date")) {
    hideTooltip();
  }
}

// ---- Activation ----
function activate() {
  if (active) return;
  active = true;
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  window.addEventListener("scroll", hideTooltip, { passive: true, capture: true });

  scheduleScan(document.body);

  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) scheduleScan(node);
          else if (node.nodeType === 3 && node.parentNode) scheduleScan(node.parentNode);
        }
      } else if (m.type === "characterData" && m.target.parentNode) {
        scheduleScan(m.target.parentNode);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function deactivate() {
  if (!active) return;
  active = false;
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("mouseout", onMouseOut, true);
  window.removeEventListener("scroll", hideTooltip, true);
  hideTooltip();
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  unwrapAll();
}

function applySettings(next) {
  settings = { ...settings, ...next };
  if (isEnabled(settings)) activate();
  else deactivate();
}

// ---- Bootstrap ----
chrome.storage.sync.get(
  { globalEnabled: true, disabledHosts: [], extraTimezones: [] },
  (s) => applySettings(s)
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const next = { ...settings };
  for (const k of Object.keys(changes)) {
    next[k] = changes[k].newValue;
  }
  applySettings(next);
});
