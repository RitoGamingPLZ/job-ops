import * as api from "@client/api";
import { showErrorToast } from "@client/lib/error-toast";
import { parseLevelsSalaryMessage } from "@client/lib/levels-fyi";
import type { Job } from "@shared/types.js";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** Listen for same-origin salary payloads relayed by the Levels.fyi Chrome extension bridge. */
export function useLevelsFyiSalaryListener(
  onJobUpdated: (job: Job) => Promise<void> | void,
) {
  const onJobUpdatedRef = useRef(onJobUpdated);
  onJobUpdatedRef.current = onJobUpdated;

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const payload = parseLevelsSalaryMessage(event.data);
      if (!payload) return;

      void api
        .updateJob(payload.jobId, {
          salary: payload.salary,
          ...(payload.salaryMinAmount !== undefined
            ? { salaryMinAmount: payload.salaryMinAmount }
            : {}),
          ...(payload.salaryMaxAmount !== undefined
            ? { salaryMaxAmount: payload.salaryMaxAmount }
            : {}),
          ...(payload.salaryCurrency !== undefined
            ? { salaryCurrency: payload.salaryCurrency }
            : {}),
          salaryInterval: payload.salaryInterval ?? "yearly",
          salarySource: payload.salarySource ?? "levels.fyi",
        })
        .then(async (updated) => {
          await onJobUpdatedRef.current(updated);
          toast.success(`Updated salary from Levels.fyi: ${payload.salary}`);
        })
        .catch((error: unknown) => {
          showErrorToast(error, "Failed to save salary from Levels.fyi");
        });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
}
