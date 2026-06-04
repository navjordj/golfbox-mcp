import type { AppConfig } from "../config.js";
import type { GolfBoxClient } from "./types.js";
import { MockGolfBoxClient } from "./mock-client.js";
import { OfficialGolfBoxClient } from "./official-client.js";

export function createGolfBoxClient(config: AppConfig): GolfBoxClient {
  if (config.provider === "mock") {
    return new MockGolfBoxClient();
  }

  return new OfficialGolfBoxClient({
    apiBaseUrl: config.apiBaseUrl,
    apiToken: config.apiToken,
    username: config.username,
    password: config.password,
    country: config.country,
    appLanguage: config.appLanguage,
    appVersion: config.appVersion,
    saveTeeTimeTimeoutMs: config.saveTeeTimeTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
    webRequestTimeoutMs: config.webRequestTimeoutMs,
    allowUntrustedGolfBoxUrls: config.allowUntrustedGolfBoxUrls,
    includeErrorBodySnippets: config.includeErrorBodySnippets
  });
}
