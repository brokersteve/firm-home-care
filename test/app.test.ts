import { describe, expect, it } from "vitest";
import { appRoutes, appScript, RESIDENT_CONNECT } from "../src/app";
import { fcmMessage } from "../src/push";

describe("phone app script", () => {
  const script = appScript({ RESIDENT_CONNECT_URL: "https://secure.rentecdirect.com/tenants/" });

  it("is valid JavaScript and does nothing in a browser", () => {
    const run = new Function("window", "document", "location", script);
    expect(() => run({}, {}, { pathname: "/" })).not.toThrow();
  });

  it("knows where Resident Connect lives in both stores", () => {
    expect(script).toContain(RESIDENT_CONNECT.android);
    expect(script).toContain("id1300312018");
    expect(script).toContain("https://secure.rentecdirect.com/tenants/");
  });
});

describe("push", () => {
  it("sends the page to open with the notification", () => {
    const msg = fcmMessage("tok", { title: "Time to change your air filter", body: "It's time.", url: "https://x/t/1/s/" });
    expect(msg.message.token).toBe("tok");
    expect(msg.message.notification.title).toBe("Time to change your air filter");
    expect(msg.message.data.url).toBe("https://x/t/1/s/");
  });
});

describe("app links", () => {
  const env = { APP_ID: "vip.firm.app", APPLE_TEAM_ID: "", ANDROID_CERT_SHA256: "" };

  it("stay off until the store accounts exist", async () => {
    expect((await appRoutes.request("/.well-known/apple-app-site-association", {}, env)).status).toBe(404);
    expect((await appRoutes.request("/.well-known/assetlinks.json", {}, env)).status).toBe(404);
  });

  it("open tenant pages in the app once set", async () => {
    const on = { ...env, APPLE_TEAM_ID: "ABCDE12345", ANDROID_CERT_SHA256: "AA:BB" };
    const apple = (await (await appRoutes.request("/.well-known/apple-app-site-association", {}, on)).json()) as any;
    expect(apple.applinks.details[0].appIDs).toEqual(["ABCDE12345.vip.firm.app"]);
    const google = (await (await appRoutes.request("/.well-known/assetlinks.json", {}, on)).json()) as any;
    expect(google[0].target.package_name).toBe("vip.firm.app");
    expect(google[0].target.sha256_cert_fingerprints).toEqual(["AA:BB"]);
  });
});
