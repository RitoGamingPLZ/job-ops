import { logger } from "@infra/logger";
import { createPdfWorkerApp } from "./pdf-worker-app";

const port = Number.parseInt(process.env.PORT ?? "", 10) || 3001;
const app = createPdfWorkerApp();

app.listen(port, () => {
  logger.info("PDF render worker listening", { port });
});
