const DEFAULTS = {
  globalEnabled: true,
  disabledHosts: [],
  extraTimezones: [],
  convertRelatives: false,
};

const $ = (id) => document.getElementById(id);
const hostEl = $("host");
const localEl = $("local");
const siteToggle = $("site-toggle");
const globalToggle = $("global-toggle");
const relativesToggle = $("relatives-toggle");
const chipsEl = $("chips");
const tzInput = $("tz-input");
const tzList = $("tz-list");
const tzCountEl = $("tz-count");

// Header readout: HH:MM · IANA zone in the user's locale.
function renderLocal() {
  const now = new Date();
  const time = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  localEl.textContent = zone ? `${time}  ·  ${zone}` : time;
}

let currentHost = "";
let state = { ...DEFAULTS };

const TZS =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [];

for (const tz of TZS) {
  const opt = document.createElement("option");
  opt.value = tz;
  tzList.appendChild(opt);
}

function getCurrentHost() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const url = tabs && tabs[0] && tabs[0].url;
      if (!url) return resolve("");
      try {
        resolve(new URL(url).hostname);
      } catch {
        resolve("");
      }
    });
  });
}

function load() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      state = { ...DEFAULTS, ...s };
      resolve();
    });
  });
}

function save(patch) {
  state = { ...state, ...patch };
  chrome.storage.sync.set(patch);
  render();
}

function render() {
  hostEl.textContent = currentHost || "(no page)";
  globalToggle.checked = !!state.globalEnabled;
  relativesToggle.checked = !!state.convertRelatives;

  const siteDisabled = state.disabledHosts.includes(currentHost);
  siteToggle.checked = !!currentHost && !siteDisabled;
  siteToggle.disabled = !currentHost;

  chipsEl.replaceChildren();
  for (const tz of state.extraTimezones) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const label = document.createElement("span");
    label.className = "chip-label";
    label.textContent = tz;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = `Remove ${tz}`;
    x.addEventListener("click", () => {
      save({ extraTimezones: state.extraTimezones.filter((t) => t !== tz) });
    });
    chip.appendChild(label);
    chip.appendChild(x);
    chipsEl.appendChild(chip);
  }
  tzCountEl.textContent = state.extraTimezones.length
    ? String(state.extraTimezones.length)
    : "";
}

siteToggle.addEventListener("change", () => {
  if (!currentHost) return;
  const set = new Set(state.disabledHosts);
  if (siteToggle.checked) set.delete(currentHost);
  else set.add(currentHost);
  save({ disabledHosts: [...set] });
});

globalToggle.addEventListener("change", () => {
  save({ globalEnabled: globalToggle.checked });
});

relativesToggle.addEventListener("change", () => {
  save({ convertRelatives: relativesToggle.checked });
});

function tryAddTz(value) {
  const v = value.trim();
  if (!v) return false;
  if (!TZS.length || TZS.includes(v)) {
    if (state.extraTimezones.includes(v)) return true;
    save({ extraTimezones: [...state.extraTimezones, v] });
    return true;
  }
  return false;
}

tzInput.addEventListener("change", () => {
  if (tryAddTz(tzInput.value)) tzInput.value = "";
});
tzInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (tryAddTz(tzInput.value)) tzInput.value = "";
  }
});

(async () => {
  renderLocal();
  currentHost = await getCurrentHost();
  await load();
  render();
})();
