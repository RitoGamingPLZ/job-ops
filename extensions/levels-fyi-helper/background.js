const ext = globalThis.chrome;
const ACTIVE_LOOKUP_KEY = "jobopsActiveLookup";
const LOOKUP_TTL_MS = 30 * 60 * 1000;

async function findJobOpsTabId(preferredTabId) {
  if (typeof preferredTabId === "number") {
    try {
      const tab = await ext.tabs.get(preferredTabId);
      if (
        tab?.id != null &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(tab.url || "")
      ) {
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
    ext.storage.local
      .set({ [ACTIVE_LOOKUP_KEY]: lookup })
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === "GET_ACTIVE_LOOKUP") {
    ext.storage.local
      .get(ACTIVE_LOOKUP_KEY)
      .then((result) => {
        const lookup = result?.[ACTIVE_LOOKUP_KEY] ?? null;
        if (!lookup || Date.now() - lookup.updatedAt > LOOKUP_TTL_MS) {
          sendResponse({ ok: true, lookup: null });
          return;
        }
        sendResponse({ ok: true, lookup });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === "CLEAR_ACTIVE_LOOKUP") {
    ext.storage.local
      .remove(ACTIVE_LOOKUP_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === "SEND_SALARY_TO_JOBOPS") {
    (async () => {
      try {
        const stored = await ext.storage.local.get(ACTIVE_LOOKUP_KEY);
        const lookup = stored?.[ACTIVE_LOOKUP_KEY] ?? null;
        const targetTabId = await findJobOpsTabId(lookup?.sourceTabId);
        if (typeof targetTabId !== "number") {
          sendResponse({
            ok: false,
            error: "No open Job-Ops tab found on localhost or 127.0.0.1.",
          });
          return;
        }

        await ext.tabs.sendMessage(targetTabId, {
          type: "APPLY_SALARY",
          payload: message.payload,
        });
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  }

  return undefined;
});
