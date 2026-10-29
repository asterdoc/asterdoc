export function webAnalyticsDefines(): Record<string, string> {
  return { __WEB_ANALYTICS__: JSON.stringify(process.env.WEB_ANALYTICS === "on") };
}
