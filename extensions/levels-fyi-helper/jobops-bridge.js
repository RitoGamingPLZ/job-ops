const ext = globalThis.chrome;
const LOOKUP_START_EVENT = "JOBOPS_LEVELS_LOOKUP_START";
const SALARY_RESULT_EVENT = "JOBOPS_LEVELS_SALARY_RESULT";

document.documentElement.dataset.jobopsLevelsExtension = "1";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || typeof data !== "object" || data.type !== LOOKUP_START_EVENT) {
    return;
  }
  if (typeof data.jobId !== "string" || !data.jobId.trim()) return;

  ext.runtime.sendMessage({
    type: "SET_ACTIVE_LOOKUP",
    jobId: data.jobId,
    title: data.title,
    employer: data.employer,
    location: data.location,
    url: data.url,
  });
});

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.type !== "APPLY_SALARY") {
    return undefined;
  }

  window.postMessage(
    {
      type: SALARY_RESULT_EVENT,
      ...message.payload,
    },
    window.location.origin,
  );
  sendResponse({ ok: true });
  return undefined;
});
