const ext = globalThis.chrome;
const ACTIVE_LOOKUP_KEY = "jobopsActiveLookup";
const LOOKUP_TTL_MS = 30 * 60 * 1000;

async function findJobOpsTabId(preferredTabId) {
  if (typeof preferredTabId === "number") {
    try {
      const tab = await ext.tabs.get(preferredTabId);
      if (tab?.id != null && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(tab.url || "")) {
        return tab.id;
      }
    } catch {
      // Tab closed; fall through to querying open localhost tabs.
    }
  }

  const tabs = await ext.tabs.query({
    url: ["http://localhost/*", "http://127.0.0.1/*"],
  });
  return tabs[0]?.id ?? null;
}

function handleAsyncMessage(sendResponse, fn) {
  Promise.resolve()
    .then(fn)
    .then((response) => sendResponse(response))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  return true;
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "SET_ACTIVE_LOOKUP") {
    const lookup = {
      jobId: message.jobId,
      title: message.title || "",
      employer: message.employer || "",
      location: message.location || null,
      url: message.url || "",
      sourceTabId: sender.tab?.id ?? null,
      updatedAt: Date.now(),
    };
    return handleAsyncMessage(sendResponse, async () => {
      await ext.storage.local.set({ [ACTIVE_LOOKUP_KEY]: lookup });
      return { ok: true };
    });
  }

  if (message.type === "GET_ACTIVE_LOOKUP") {
    return handleAsyncMessage(sendResponse, async () => {
      const result = await ext.storage.local.get(ACTIVE_LOOKUP_KEY);
      const lookup = result?.[ACTIVE_LOOKUP_KEY] ?? null;
      if (!lookup || Date.now() - lookup.updatedAt > LOOKUP_TTL_MS) {
        return { ok: true, lookup: null };
      }
      return { ok: true, lookup };
    });
  }

  if (message.type === "CLEAR_ACTIVE_LOOKUP") {
    return handleAsyncMessage(sendResponse, async () => {
      await ext.storage.local.remove(ACTIVE_LOOKUP_KEY);
      return { ok: true };
    });
  }

  if (message.type === "SEND_SALARY_TO_JOBOPS") {
    return handleAsyncMessage(sendResponse, async () => {
      const stored = await ext.storage.local.get(ACTIVE_LOOKUP_KEY);
      const lookup = stored?.[ACTIVE_LOOKUP_KEY] ?? null;
      const targetTabId = await findJobOpsTabId(lookup?.sourceTabId);
      if (typeof targetTabId !== "number") {
        return {
          ok: false,
          error: "No open Job-Ops tab found on localhost or 127.0.0.1.",
        };
      }

      await ext.tabs.sendMessage(targetTabId, {
        type: "APPLY_SALARY",
        payload: message.payload,
      });
      return { ok: true };
    });
  }

  return undefined;
});
