const ext = globalThis.chrome;
const PANEL_ID = "jobops-levels-helper-host";

const CURRENCY_PATTERNS = [
  { regex: /^(?:US\$|\$)/i, code: "USD" },
  { regex: /^CA\$/i, code: "CAD" },
  { regex: /^A\$/i, code: "AUD" },
  { regex: /^S\$/i, code: "SGD" },
  { regex: /^HK\$/i, code: "HKD" },
  { regex: /^NZ\$/i, code: "NZD" },
  { regex: /^£/, code: "GBP" },
  { regex: /^€/, code: "EUR" },
  { regex: /^₹/, code: "INR" },
  { regex: /^CHF/i, code: "CHF" },
];

const SINGLE_AMOUNT_SOURCE =
  "(?:CA\\$|US\\$|A\\$|S\\$|HK\\$|NZ\\$|CHF\\s*|[$£€₹])\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s?[KkMm]?";
const RANGE_REGEX = new RegExp(
  `(${SINGLE_AMOUNT_SOURCE})\\s*(?:-|–|—|to)\\s*(${SINGLE_AMOUNT_SOURCE})`,
  "gi",
);
const SINGLE_REGEX = new RegExp(`(${SINGLE_AMOUNT_SOURCE})`, "g");

function detectCurrency(text) {
  const trimmed = text.trim();
  for (const entry of CURRENCY_PATTERNS) {
    if (entry.regex.test(trimmed)) {
      return entry.code;
    }
  }
  return null;
}

function parseMonetaryAmount(raw) {
  const cleaned = raw
    .replace(/^(?:CA\$|US\$|A\$|S\$|HK\$|NZ\$|CHF\s*|[$£€₹])/i, "")
    .replace(/,/g, "")
    .trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KkMm])?$/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = (match[2] || "").toLowerCase();
  const multiplier = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  const value = Math.round(base * multiplier);
  // Ignore tiny numbers like $5 or $100 that aren't annual compensation.
  return value >= 10_000 ? value : null;
}

function parseSalaryText(rawText) {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const rangeMatch = text.match(
    new RegExp(`(${SINGLE_AMOUNT_SOURCE})\\s*(?:-|–|—|to)\\s*(${SINGLE_AMOUNT_SOURCE})`, "i"),
  );
  if (rangeMatch) {
    const min = parseMonetaryAmount(rangeMatch[1]);
    const max = parseMonetaryAmount(rangeMatch[2]);
    if (min !== null && max !== null && max >= min) {
      return {
        salary: `${rangeMatch[1].trim()} - ${rangeMatch[2].trim()}`,
        salaryMinAmount: min,
        salaryMaxAmount: max,
        salaryCurrency: detectCurrency(rangeMatch[1]) || detectCurrency(rangeMatch[2]),
      };
    }
  }

  const singleMatch = text.match(new RegExp(SINGLE_AMOUNT_SOURCE));
  if (singleMatch) {
    const amount = parseMonetaryAmount(singleMatch[0]);
    if (amount !== null) {
      return {
        salary: singleMatch[0].trim(),
        salaryMinAmount: amount,
        salaryMaxAmount: amount,
        salaryCurrency: detectCurrency(singleMatch[0]),
      };
    }
  }

  return {
    salary: text.slice(0, 200),
    salaryMinAmount: null,
    salaryMaxAmount: null,
    salaryCurrency: detectCurrency(text),
  };
}

function extractSalaryCandidates() {
  const root = document.querySelector("main") || document.body;
  if (!root) return [];

  const text = (root.innerText || "").replace(/\u00a0/g, " ");
  const seen = new Set();
  const candidates = [];

  for (const match of text.matchAll(RANGE_REGEX)) {
    const min = parseMonetaryAmount(match[1]);
    const max = parseMonetaryAmount(match[2]);
    if (min === null || max === null || max < min) continue;
    const label = `${match[1].trim()} - ${match[2].trim()}`;
    if (seen.has(label)) continue;
    seen.add(label);
    candidates.push({
      label,
      salaryMinAmount: min,
      salaryMaxAmount: max,
      salaryCurrency: detectCurrency(match[1]) || detectCurrency(match[2]),
    });
    if (candidates.length >= 6) return candidates;
  }

  for (const match of text.matchAll(SINGLE_REGEX)) {
    const amount = parseMonetaryAmount(match[1]);
    if (amount === null) continue;
    const label = match[1].trim();
    if (seen.has(label)) continue;
    seen.add(label);
    candidates.push({
      label,
      salaryMinAmount: amount,
      salaryMaxAmount: amount,
      salaryCurrency: detectCurrency(label),
    });
    if (candidates.length >= 8) break;
  }

  return candidates;
}

function createPanel(lookup) {
  const existing = document.getElementById(PANEL_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = PANEL_ID;
  host.style.position = "fixed";
  host.style.right = "16px";
  host.style.bottom = "16px";
  host.style.zIndex = "2147483647";

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .card {
        width: 340px;
        max-width: calc(100vw - 32px);
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 14px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
      }
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .title {
        font-weight: 600;
        font-size: 13px;
        line-height: 1.3;
      }
      .subtitle {
        color: #94a3b8;
        font-size: 11px;
        margin-top: 2px;
      }
      .close {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 2px 4px;
      }
      .close:hover { color: #f8fafc; }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 10px;
      }
      .chip {
        background: #1e293b;
        color: #e2e8f0;
        border: 1px solid #334155;
        border-radius: 9999px;
        padding: 4px 9px;
        font-size: 11px;
        cursor: pointer;
      }
      .chip.active {
        background: #0369a1;
        border-color: #38bdf8;
        color: #ffffff;
      }
      .input {
        width: 100%;
        box-sizing: border-box;
        background: #020617;
        color: #f8fafc;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 13px;
        margin-bottom: 10px;
      }
      .actions {
        display: flex;
        gap: 8px;
      }
      .btn {
        border-radius: 8px;
        padding: 7px 11px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid #334155;
        background: #1e293b;
        color: #e2e8f0;
      }
      .btn-primary {
        flex: 1;
        background: #10b981;
        border-color: #10b981;
        color: #022c22;
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .status {
        margin-top: 8px;
        font-size: 11px;
        color: #94a3b8;
      }
      .status.ok { color: #34d399; }
      .status.err { color: #f87171; }
    </style>
    <div class="card">
      <div class="header">
        <div>
          <div class="title">Send salary to Job-Ops</div>
          <div class="subtitle" id="jobops-target"></div>
        </div>
        <button class="close" id="jobops-close" title="Dismiss">×</button>
      </div>
      <div class="chips" id="jobops-chips"></div>
      <input class="input" id="jobops-input" placeholder="e.g. $180K - $240K or £95,000" />
      <div class="actions">
        <button class="btn" id="jobops-rescan" type="button">Re-scan</button>
        <button class="btn btn-primary" id="jobops-send" type="button">Send to Job-Ops</button>
      </div>
      <div class="status" id="jobops-status"></div>
    </div>
  `;

  const targetEl = shadow.getElementById("jobops-target");
  const chipsEl = shadow.getElementById("jobops-chips");
  const inputEl = shadow.getElementById("jobops-input");
  const statusEl = shadow.getElementById("jobops-status");
  const sendBtn = shadow.getElementById("jobops-send");
  const rescanBtn = shadow.getElementById("jobops-rescan");
  const closeBtn = shadow.getElementById("jobops-close");

  targetEl.textContent = [lookup.title, lookup.employer].filter(Boolean).join(" @ ");

  function renderCandidates() {
    const candidates = extractSalaryCandidates();
    chipsEl.innerHTML = "";
    if (candidates.length === 0) {
      statusEl.className = "status";
      statusEl.textContent =
        "No salary numbers detected yet. Wait for the page to load and click Re-scan, or type a range manually.";
      return;
    }

    candidates.forEach((candidate, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = index === 0 ? "chip active" : "chip";
      chip.textContent = candidate.label;
      chip.addEventListener("click", () => {
        for (const el of chipsEl.querySelectorAll(".chip")) {
          el.classList.remove("active");
        }
        chip.classList.add("active");
        inputEl.value = candidate.label;
      });
      chipsEl.appendChild(chip);
    });

    if (!inputEl.value.trim()) {
      inputEl.value = candidates[0].label;
    }
    statusEl.className = "status";
    statusEl.textContent = `Detected ${candidates.length} salary option${candidates.length === 1 ? "" : "s"} on this page.`;
  }

  closeBtn.addEventListener("click", () => host.remove());
  rescanBtn.addEventListener("click", () => {
    inputEl.value = "";
    renderCandidates();
  });

  sendBtn.addEventListener("click", () => {
    const parsed = parseSalaryText(inputEl.value);
    if (!parsed || !parsed.salary) {
      statusEl.className = "status err";
      statusEl.textContent = "Enter or pick a salary before sending.";
      return;
    }

    sendBtn.disabled = true;
    statusEl.className = "status";
    statusEl.textContent = "Sending to Job-Ops…";

    ext.runtime.sendMessage(
      {
        type: "SEND_SALARY_TO_JOBOPS",
        payload: {
          jobId: lookup.jobId,
          salary: parsed.salary,
          salaryMinAmount: parsed.salaryMinAmount,
          salaryMaxAmount: parsed.salaryMaxAmount,
          salaryCurrency: parsed.salaryCurrency,
          salaryInterval: "yearly",
          salarySource: "levels.fyi",
        },
      },
      (response) => {
        sendBtn.disabled = false;
        if (ext.runtime.lastError || !response?.ok) {
          statusEl.className = "status err";
          statusEl.textContent =
            response?.error || ext.runtime.lastError?.message || "Could not reach Job-Ops tab.";
          return;
        }
        statusEl.className = "status ok";
        statusEl.textContent = "Sent to Job-Ops ✓";
      },
    );
  });

  document.body.appendChild(host);
  renderCandidates();

  // Re-scan once after initial client-side hydration completes.
  window.setTimeout(() => {
    if (!inputEl.value.trim()) {
      renderCandidates();
    }
  }, 1500);
}

ext.runtime.sendMessage({ type: "GET_ACTIVE_LOOKUP" }, (response) => {
  if (ext.runtime.lastError || !response?.ok || !response.lookup?.jobId) {
    return;
  }
  createPanel(response.lookup);
});
