export type Provider = "mock" | "official";

export interface AppConfig {
  provider: Provider;
  apiBaseUrl?: string;
  apiToken?: string;
  username?: string;
  password?: string;
  country: string;
  appLanguage: string;
  appVersion: string;
  enableWriteTools: boolean;
  requireConfirmation: boolean;
  saveTeeTimeTimeoutMs: number;
  requestTimeoutMs: number;
  webRequestTimeoutMs: number;
  allowUntrustedGolfBoxUrls: boolean;
  includeErrorBodySnippets: boolean;
}

function readBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value: true/false, yes/no, on/off, or 1/0.`);
}

function readProvider(): Provider {
  const provider = process.env.GOLFBOX_PROVIDER ?? "mock";
  if (provider === "mock" || provider === "official") {
    return provider;
  }

  throw new Error(`Unsupported GOLFBOX_PROVIDER: ${provider}`);
}

function readPositiveInteger(name: string, defaultValue: number): number {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function readString(name: string, defaultValue?: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? defaultValue : value;
}

export function loadConfig(): AppConfig {
  return {
    provider: readProvider(),
    apiBaseUrl: readString("GOLFBOX_API_BASE_URL"),
    apiToken: readString("GOLFBOX_API_TOKEN"),
    username: readString("GOLFBOX_USERNAME"),
    password: readString("GOLFBOX_PASSWORD"),
    country: readString("GOLFBOX_COUNTRY", "NO")!.toUpperCase(),
    appLanguage: readString("GOLFBOX_APP_LANGUAGE", "en")!,
    appVersion: readString("GOLFBOX_APP_VERSION", "2.7.003")!,
    enableWriteTools: readBoolean("GOLFBOX_ENABLE_WRITE_TOOLS", false),
    requireConfirmation: readBoolean("GOLFBOX_REQUIRE_CONFIRMATION", true),
    saveTeeTimeTimeoutMs: readPositiveInteger("GOLFBOX_SAVE_TEE_TIME_TIMEOUT_MS", 20_000),
    requestTimeoutMs: readPositiveInteger("GOLFBOX_REQUEST_TIMEOUT_MS", 15_000),
    webRequestTimeoutMs: readPositiveInteger("GOLFBOX_WEB_REQUEST_TIMEOUT_MS", 15_000),
    allowUntrustedGolfBoxUrls: readBoolean("GOLFBOX_ALLOW_UNTRUSTED_URLS", false),
    includeErrorBodySnippets: readBoolean("GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS", false)
  };
}
