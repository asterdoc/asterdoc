import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webAnalyticsDefines } from "../build-web-analytics";
import { WEB_ANALYTICS_BEACON } from "@/lib/web-analytics";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("webAnalyticsDefines", () => {
  it("turns the Web Analytics beacon on when the build sets WEB_ANALYTICS=on", () => {
    vi.stubEnv("WEB_ANALYTICS", "on");
    expect(webAnalyticsDefines()).toEqual({ __WEB_ANALYTICS__: "true" });
  });

  it("keeps the beacon off for a local build with no flag", () => {
    vi.stubEnv("WEB_ANALYTICS", "");
    expect(webAnalyticsDefines()).toEqual({ __WEB_ANALYTICS__: "false" });
  });

  it("keeps the beacon off for any other flag value", () => {
    vi.stubEnv("WEB_ANALYTICS", "off");
    expect(webAnalyticsDefines()).toEqual({ __WEB_ANALYTICS__: "false" });
  });

  it("ignores the Cloudflare environment", () => {
    vi.stubEnv("WEB_ANALYTICS", "");
    vi.stubEnv("CLOUDFLARE_ENV", "production");
    expect(webAnalyticsDefines()).toEqual({ __WEB_ANALYTICS__: "false" });
  });
});

describe("package scripts", () => {
  const scripts = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).scripts as Record<
    string,
    string
  >;

  it("builds the prod deploy with the beacon on", () => {
    expect(scripts["deploy:prod"]).toMatch(/\bWEB_ANALYTICS=on pnpm build && /);
  });

  it("leaves the plain build without the beacon", () => {
    expect(scripts.build).not.toContain("WEB_ANALYTICS");
  });

  it("never selects a wrangler environment, which would rename the single prod Worker", () => {
    for (const script of Object.values(scripts)) {
      expect(script).not.toContain("CLOUDFLARE_ENV");
    }
  });
});

describe("WEB_ANALYTICS_BEACON", () => {
  it("loads the Cloudflare beacon with the asterdoc.com site token", () => {
    expect(WEB_ANALYTICS_BEACON.src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(JSON.parse(WEB_ANALYTICS_BEACON.beacon)).toEqual({ token: "b816b5bb32824715ad6f7f00a1172654" });
  });
});
