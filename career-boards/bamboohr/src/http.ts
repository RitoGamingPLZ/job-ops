import { createCareerBoardResponseHelpers } from "../../../shared/src/career-board-http";

export const {
  fetchJson: fetchBamboohrJson,
  optionalString,
  requiredString,
} = createCareerBoardResponseHelpers("BambooHR");
