export class WebCookieJar {
  private readonly cookies = new Map<string, string>();

  add(response: Response): void {
    const headersWithSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies =
      typeof headersWithSetCookie.getSetCookie === "function"
        ? headersWithSetCookie.getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie")!]
          : [];

    for (const setCookie of setCookies) {
      const [pair] = setCookie.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
  }

  header(): string {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}
