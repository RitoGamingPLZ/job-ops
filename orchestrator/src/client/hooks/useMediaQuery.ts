import { useEffect, useState } from "react";

type MissingMatchMedia = "throw" | "false";

// "throw" calls matchMedia unguarded (throws when absent); "false" reports no match.
function canMatch(missingMatchMedia: MissingMatchMedia): boolean {
  if (typeof window === "undefined") return false;
  return (
    missingMatchMedia === "throw" || typeof window.matchMedia === "function"
  );
}

export function useMediaQuery(
  query: string,
  missingMatchMedia: MissingMatchMedia = "throw",
): boolean {
  const [matches, setMatches] = useState(() =>
    canMatch(missingMatchMedia) ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (!canMatch(missingMatchMedia)) return;
    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);
    handleChange();
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [query, missingMatchMedia]);

  return matches;
}
