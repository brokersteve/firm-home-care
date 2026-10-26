import { describe, expect, it } from "vitest";
import { qrSvg } from "../src/start";

describe("QR stickers", () => {
  it("draws an SVG QR code for the start page", () => {
    const svg = qrSvg("https://home.firm.vip/");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
  });
});
