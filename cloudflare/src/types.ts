import type { AppStore } from "./app-store";
import type { ScrapeCoordinatorDO, ScraperContainer } from "./scrape-coordinator";

export interface Env {
  APP_STORE?: DurableObjectNamespace<AppStore>;
  SCRAPE_COORDINATOR?: DurableObjectNamespace<ScrapeCoordinatorDO>;
  SCRAPER_CONTAINER?: DurableObjectNamespace<ScraperContainer>;
  DATA_BUCKET?: R2Bucket;
  ASSETS?: Fetcher;
  BROWSER?: Fetcher;
  INTERNAL_SYNC_SECRET?: string;

  // Maintenance & scraper pool configuration
  WRITE_FREEZE?: string;
  SCRAPER_POOL_SIZE?: string;

  // Non-secret runtime vars from wrangler.jsonc
  NODE_ENV?: string;
  DATA_DIR?: string;
  PORT?: string;
  APP_PUBLIC_URL?: string;
  R2_BUCKET_NAME?: string;

  // Secrets & optional app configuration (configured via `wrangler secret put`)
  R2_ACCOUNT_ID?: string;
  JWT_SECRET?: string;
  CRON_SECRET?: string;
  WEBHOOK_SECRET?: string;
  JOBOPS_PUBLIC_BASE_URL?: string;
  MODEL?: string;
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ATLASCLOUD_API_KEY?: string;
  RXRESUME_API_KEY?: string;
  RXRESUME_URL?: string;
  GMAIL_OAUTH_CLIENT_ID?: string;
  GMAIL_OAUTH_CLIENT_SECRET?: string;
  GMAIL_OAUTH_REDIRECT_URI?: string;
  SSO_REDIRECT_BASE_URL?: string;
  SSO_GOOGLE_CLIENT_ID?: string;
  SSO_GOOGLE_CLIENT_SECRET?: string;
  SSO_GITHUB_CLIENT_ID?: string;
  SSO_GITHUB_CLIENT_SECRET?: string;
  SSO_OIDC_ISSUER_URL?: string;
  SSO_OIDC_CLIENT_ID?: string;
  SSO_OIDC_CLIENT_SECRET?: string;
}
