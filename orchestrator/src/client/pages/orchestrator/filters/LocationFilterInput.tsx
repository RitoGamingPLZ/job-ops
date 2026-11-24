import { MapPin, X } from "lucide-react";
import type React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LocationFilterInputProps } from "./types";

export const LocationFilterInput: React.FC<LocationFilterInputProps> = ({
  locationFilter,
  onLocationFilterChange,
}) => (
  <div className="relative">
    <MapPin className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    <Input
      aria-label="Filter by location"
      value={locationFilter}
      onChange={(event) => onLocationFilterChange(event.target.value)}
      placeholder="Location"
      className={cn(
        "h-7 w-[150px] rounded-md pl-7 text-xs shadow-none",
        locationFilter.trim() ? "pr-7" : "border-dashed",
      )}
    />
    {locationFilter.trim() ? (
      <button
        type="button"
        aria-label="Clear location"
        onClick={() => onLocationFilterChange("")}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    ) : null}
  </div>
);
