import { describe, expect, it } from "vitest";

import { isInsideProject } from "../src/discovery";

describe("project containment uses whole path segments", () => {
  it("uses whole path segments when deciding containment", () => {
    expect(isInsideProject("/p", "/p/../q/a.tsx")).toBe(false);
    expect(isInsideProject("/p", "/p/drafts/a.tsx")).toBe(true);
    expect(isInsideProject("/p", "/p/..drafts/compositions/a.tsx")).toBe(true);
  });
});
