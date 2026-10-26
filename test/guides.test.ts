import { describe, expect, it } from "vitest";
import { EMERGENCY, FIXED, GUIDES, WORK_ORDER, fillText, findGuide, matchGuides, walk } from "../src/guides";

const ENDINGS = new Set<string>([FIXED, WORK_ORDER, EMERGENCY]);

describe("guide content", () => {
  it("has unique ids", () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
  });

  for (const guide of GUIDES) {
    it(`${guide.id}: every answer leads to a real step or an ending, and every step is reachable`, () => {
      expect(guide.nodes[guide.start]).toBeDefined();
      const seen = new Set<string>();
      const queue = [guide.start];
      while (queue.length) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const node = guide.nodes[id]!;
        expect(node.options.length).toBeGreaterThan(0);
        const nexts = [...node.options.map((o) => o.next), ...(node.auto?.routes.map((r) => r.next) ?? [])];
        for (const next of nexts) {
          expect(ENDINGS.has(next) || next in guide.nodes, `${id} -> ${next}`).toBe(true);
          if (!ENDINGS.has(next)) queue.push(next);
        }
      }
      expect([...seen].sort()).toEqual(Object.keys(guide.nodes).sort());
    });

    it(`${guide.id}: always offers a way to a work order`, () => {
      const all = Object.values(guide.nodes).flatMap((n) => n.options.map((o) => o.next));
      expect(all).toContain(WORK_ORDER);
    });
  }
});

describe("matchGuides", () => {
  it.each([
    ["garbage disposal not working", "disposal"],
    ["My toilet keeps running", "toilet"],
    ["no hot water in the shower", "hot_water"],
    ["smoke detector chirping every minute", "detector"],
    ["AC not cooling", "hvac"],
    ["kitchen sink clogged", "drain"],
    ["fridge is warm", "fridge"],
  ])("%s -> %s", (query, id) => {
    expect(matchGuides(query)[0]?.id).toBe(id);
  });

  it("returns nothing for unrelated text", () => {
    expect(matchGuides("my neighbor is loud")).toEqual([]);
  });
});

describe("walk", () => {
  const disposal = findGuide("disposal")!;
  it("records each question and answer on the way to an ending", () => {
    const w = walk(disposal, [0, 1], { "HC Disposal Wrench": "taped inside the sink cabinet" })!;
    expect(w.at).toBe(WORK_ORDER);
    expect(w.history.map((h) => h.answer)).toEqual(["Yes, it hums", "No, still not working"]);
    expect(w.history[1]!.question).toContain("taped inside the sink cabinet");
  });

  it("rejects answers that don't exist", () => {
    expect(walk(disposal, [5], {})).toBeNull();
    expect(walk(disposal, [0, 0, 0], {})).toBeNull();
  });

  it("skips the water heater question when the property field answers it", () => {
    const hotWater = findGuide("hot_water")!;
    expect(walk(hotWater, [], { "HC Water Heater": "Electric tank, 50 gal" })!.at).toBe("electric");
    expect(walk(hotWater, [], { "HC Water Heater": "Gas tankless" })!.at).toBe("tankless");
    expect(walk(hotWater, [], {})!.at).toBe("type");
  });
});

describe("fillText", () => {
  it("falls back politely when a field is empty", () => {
    expect(fillText("Panel: {HC Breaker Panel}", {})).toBe("Panel: ask F.I.R.M. if you're not sure");
  });
});
