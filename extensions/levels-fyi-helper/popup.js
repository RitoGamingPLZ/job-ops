const ext = globalThis.chrome;
const statusEl = document.getElementById("status");

function renderLookup(lookup) {
  if (!statusEl) return;
  if (!lookup) {
    statusEl.textContent = "No active Job-Ops salary lookup.";
    return;
  }

  statusEl.innerHTML = "";
  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.style.color = "#f8fafc";
  title.textContent = [lookup.title, lookup.employer].filter(Boolean).join(" @ ");
  statusEl.appendChild(title);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "Clear active lookup";
  clearBtn.addEventListener("click", () => {
    ext.runtime.sendMessage({ type: "CLEAR_ACTIVE_LOOKUP" }, () => {
      renderLookup(null);
    });
  });
  statusEl.appendChild(clearBtn);
}

ext.runtime.sendMessage({ type: "GET_ACTIVE_LOOKUP" }, (response) => {
  if (ext.runtime.lastError || !response?.ok) {
    renderLookup(null);
    return;
  }
  renderLookup(response.lookup ?? null);
});
