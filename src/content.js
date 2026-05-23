import * as chrono from "chrono-node";
import { formatInTz, relative, shortTzLabel } from "./lib/format.js";

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "CODE", "PRE",
  "SELECT", "OPTION", "BUTTON",
]);

const MIN_TEXT = 4;
const MAX_TEXT = 5000;
const MAX_SPANS = 2000;

const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

function hasDateComponents(result) {
  const s = result.start;
  if (!s || typeof s.get !== "function") return false;
  return s.get("day") != null && s.get("month") != null && s.get("year") != null;
}

function wrapTextNode(textNode) {
  if (wrapped.size >= MAX_SPANS) return;
  const text = textNode.nodeValue;
  if (!text) return;
  const len = text.length;
  if (len < MIN_TEXT || len > MAX_TEXT) return;
  if (shouldSkip(textNode)) return;

  let results;
  try {
    results = chrono.parse(text, new Date(), { forwardDate: false });
  } catch {
    return;
  }
  if (!results.length) return;

  const matches = results
    .filter((r) => hasDateComponents(r) && r.index >= 0 && r.text)
    .sort((a, b) => a.index - b.index);
  if (!matches.length) return;

  const parent = textNode.parentNode;
  if (!parent) return;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const m of matches) {
    if (m.index < cursor) continue; // overlap
    if (m.index > cursor) {
      frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
    }
    const span = document.createElement("span");
    span.className = "dn-date";
    span.textContent = m.text;
    const d = m.start.date();
    span.dataset.iso = d.toISOString();
    frag.appendChild(span);
    wrapped.add(span);
    cursor = m.index + m.text.length;
    if (wrapped.size >= MAX_SPANS) break;
  }
  if (cursor < text.length) {
    frag.appendChild(document.createTextNode(text.slice(cursor)));
  }
  parent.replaceChild(frag, textNode);
}

function scanRoot(root) {
  if (!root || root.nodeType !== 1) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.length < MIN_TEXT) return NodeFilter.FILTER_REJECT;
      if (shouldSkip(n)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const batch = [];
  let n;
  while ((n = walker.nextNode())) batch.push(n);
  for (const t of batch) {
    if (wrapped.size >= MAX_SPANS) break;
    wrapTextNode(t);
  }
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

function renderTooltipContent(date) {
  const lines = [];
  lines.push(`<div class="dn-row dn-primary">${escapeHtml(formatInTz(date, userTz))}</div>`);
  lines.push(`<div class="dn-row dn-rel">${escapeHtml(relative(date))}</div>`);
  for (const tz of settings.extraTimezones) {
    lines.push(
      `<div class="dn-row dn-extra"><span class="dn-tz">${escapeHtml(
        shortTzLabel(tz)
      )}</span> ${escapeHtml(formatInTz(date, tz))}</div>`
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
  tooltipEl.innerHTML = renderTooltipContent(date);
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
