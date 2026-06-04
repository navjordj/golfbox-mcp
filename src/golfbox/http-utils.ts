export class GolfBoxHttpError extends Error {
  constructor(
    readonly status: number,
    readonly apiCode: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "GolfBoxHttpError";
  }
}

export class GolfBoxRequestTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly path: string
  ) {
    super(`GolfBox request timed out after ${timeoutMs} ms: ${path}`);
    this.name = "GolfBoxRequestTimeoutError";
  }
}

export function validateGolfBoxBaseUrl(value: string, kind: "api" | "web", allowUntrustedGolfBoxUrls: boolean): string {
  const url = new URL(ensureTrailingSlash(value));
  if (url.protocol !== "https:") {
    throw new Error(`GolfBox ${kind} base URL must use https.`);
  }

  const trustedHosts = kind === "api" ? ["app.golfbox.dk"] : ["www.golfbox.no", "www.golfbox.dk"];
  if (!trustedHosts.includes(url.hostname) && !(allowUntrustedGolfBoxUrls && url.hostname.endsWith(".test"))) {
    throw new Error(
      `GolfBox ${kind} base URL host is not trusted: ${url.hostname}. ` +
        "Set GOLFBOX_ALLOW_UNTRUSTED_URLS=true only for test/dev .test hosts."
    );
  }

  return url.toString();
}

export function sanitizeErrorPath(path: string): string {
  const url = new URL(path, "https://example.invalid/");
  for (const key of ["sessionKey", "SessionKey", "lockGuid", "LockGuid", "token", "Token", "password", "Password", "pass"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.set(key, "redacted");
    }
  }

  return redactSensitiveText(`${url.pathname}${url.search}`);
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "redacted-email")
    .replace(/(Authorization\s*[:=]\s*)([^\s,;"']+)/gi, "$1redacted")
    .replace(/((?:sessionKey|SessionKey|lockGuid|LockGuid|token|Token|password|Password|pass)\s*[=:]\s*)([^&\s,;"']+)/g, "$1redacted");
}

export async function fetchWithTimeout(
  url: URL,
  init: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; timedOut: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return {
      response: await fetch(url, {
        ...init,
        signal: controller.signal
      }),
      timedOut: false
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        response: new Response("", { status: 408, statusText: "Request Timeout" }),
        timedOut: true
      };
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
