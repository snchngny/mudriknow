import { describe, it, expect } from "vitest";
import { fitPanelBounds, panelBoundsDiffer } from "./panel-bounds";

describe("saved panel bounds", () => {
  it("does not repeatedly reposition for Windows DPI rounding", () => {
    const saved = { x: 286, y: 128, width: 643, height: 707 };
    expect(panelBoundsDiffer(saved, { x: 284, y: 128, width: 645, height: 708 })).toBe(false);
    expect(panelBoundsDiffer(saved, { ...saved, x: 386 })).toBe(true);
  });
  it("retains the user position and reduced size", () => {
    const bounds = { x: 123, y: 88, width: 620, height: 480 };
    expect(fitPanelBounds(bounds, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual(bounds);
  });
  it("keeps a position on a monitor left of the primary display", () => {
    expect(fitPanelBounds({ x: -1500, y: 40, width: 600, height: 400 }, { x: -1920, y: 0, width: 1920, height: 1080 }).x).toBe(-1500);
  });
  it("brings a panel from a disconnected monitor back into the visible work area", () => {
    expect(fitPanelBounds({ x: 3000, y: -100, width: 620, height: 480 }, { x: 0, y: 0, width: 1280, height: 720 })).toEqual({ x: 652, y: 8, width: 620, height: 480 });
  });
  it("fits a smaller work area without losing the entire panel", () => {
    const fitted = fitPanelBounds({ x: 0, y: 0, width: 900, height: 1000 }, { x: 0, y: 0, width: 800, height: 600 });
    expect(fitted).toEqual({ x: 8, y: 8, width: 784, height: 584 });
  });
});
