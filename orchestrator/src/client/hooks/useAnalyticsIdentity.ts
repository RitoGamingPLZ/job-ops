import * as api from "@client/api";
import { useEffect } from "react";
import { identifyAnalyticsUser } from "@/lib/analytics";
import { useAuthSession } from "./useAuthSession";

export function useAnalyticsIdentity(): void {
  const hasSession = useAuthSession();

  useEffect(() => {
    let cancelled = false;

    if (hasSession) {
      void api
        .getCurrentAuthContext()
        .then((context) => {
          if (cancelled) return;
          identifyAnalyticsUser(context.analyticsDistinctId);
        })
        .catch(() => {
          // Ignore auth fetch errors; analytics identity is best-effort.
        });

      return () => {
        cancelled = true;
      };
    }

    identifyAnalyticsUser(null);
    return () => {
      cancelled = true;
    };
  }, [hasSession]);
}
