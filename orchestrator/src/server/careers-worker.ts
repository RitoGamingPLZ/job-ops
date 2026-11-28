import { logger } from "@infra/logger";
import { createCareersWorkerApp } from "./careers-worker-app";

const port = Number.parseInt(process.env.PORT ?? "", 10) || 3001;
const app = createCareersWorkerApp();

app.listen(port, () => {
  logger.info("Careers-site worker listening", { port });
});
