/**
 * The formatter a server-side render prints with when its caller passes none:
 * `@asterdoc/render`'s, with every lookup provider, so each layer format an
 * artifact can declare prints. It imports no PDF engine, so a development
 * preview in a browser can print with the same formatter as the PDF it shows.
 */
export { defaultFormatter } from "@asterdoc/render";
