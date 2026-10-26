import { describe, expect, it } from "vitest";
import { doneLink, homeLink, sign, verify } from "../src/links";

describe("signed links", () => {
  it("verifies its own signatures and rejects tampering", async () => {
    const sig = await sign("s3cret", "home", "42");
    expect(await verify("s3cret", sig, "home", "42")).toBe(true);
    expect(await verify("s3cret", sig, "home", "43")).toBe(false);
    expect(await verify("other", sig, "home", "42")).toBe(false);
  });

  it("builds URL-safe links", async () => {
    expect(await homeLink("https://app.test", "s", "42")).toMatch(/^https:\/\/app\.test\/t\/42\/[A-Za-z0-9_-]{22}$/);
    expect(await doneLink("https://app.test", "s", "42", "filter", "2026-10-01")).toMatch(/\/done\/42\/filter\/2026-10-01\/[A-Za-z0-9_-]{22}$/);
  });
});
