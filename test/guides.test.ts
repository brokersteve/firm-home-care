import { describe, expect, it } from "vitest";
import { DIAGRAMS } from "../src/diagrams";
import { EMERGENCY, FIXED, GUIDES, WORK_ORDER, fillText, findGuide, matchGuides, suggestions, walk } from "../src/guides";

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

    it(`${guide.id}: every diagram it names exists`, () => {
      for (const node of Object.values(guide.nodes)) if (node.diagram) expect(DIAGRAMS[node.diagram]).toContain("<svg");
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
    ["water leaking under the kitchen sink", "leak"],
    ["I'm locked out", "lockout"],
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

describe("suggestions", () => {
  const find = (typed: string) =>
    suggestions().filter((s) => typed.toLowerCase().split(/\s+/).every((w) => s.terms.includes(w))).map((s) => s.guide);

  it("offers the right guide as the tenant types", () => {
    expect(find("garb")).toContain("disposal");
    expect(new Set(find("toilet run"))).toEqual(new Set(["toilet"]));
    expect(find("furnace")).toEqual(["hvac"]);
    expect(find("smoke")).toContain("detector");
    expect(find("hot water")[0]).toBe("hot_water");
  });

  it("has no duplicate labels", () => {
    const labels = suggestions().map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("filters in guide text", () => {
  it("lists every filter location", () => {
    const text = fillText("{Filters}", {
      "HC Filter 1 Size": "16x25x1",
      "HC Filter 1 Location": "Hallway ceiling",
      "HC Filter 2 Size": "20x20x1",
      "HC Filter 2 Location": "Basement furnace",
    });
    expect(text).toBe("16x25x1 (Hallway ceiling) and 20x20x1 (Basement furnace)");
  });
});
