import { Clock } from "lucide-react";
import type React from "react";
import { postedWithinOptions } from "../constants";
import { SingleSelectFilterPill } from "./SingleSelectFilterPill";
import type { PostedWithinFilterPillProps } from "./types";

export const PostedWithinFilterPill: React.FC<PostedWithinFilterPillProps> = ({
  postedWithinDays,
  onPostedWithinChange,
  postedWithinLabel,
}) => (
  <SingleSelectFilterPill<number | null>
    icon={<Clock />}
    label="Posted"
    active={postedWithinDays != null}
    summary={postedWithinLabel}
    value={postedWithinDays}
    options={postedWithinOptions}
    onChange={onPostedWithinChange}
    deselectValue={null}
  />
);
