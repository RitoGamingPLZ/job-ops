import { createCareerBoardResponseHelpers } from "../../../shared/src/career-board-http";

export const {
  fetchJson: fetchGreenhouseJson,
  optionalString,
  requiredString,
} = createCareerBoardResponseHelpers("Greenhouse");
