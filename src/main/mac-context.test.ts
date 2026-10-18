import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
const mocks = vi.hoisted(() => ({ permission: vi.fn(() => "granted"), sources: vi.fn() }));
vi.mock("electron", () => ({ desktopCapturer: { getSources: mocks.sources }, systemPreferences: { getMediaAccessStatus: mocks.permission } }));
import { macWindowInfo, captureMacWindow } from "./mac-context";
afterEach(() => { mocks.permission.mockReturnValue("granted"); });
describe("macOS context adapter (mocked OS)", () => {
  it("separates app release from bundle build and preserves unknown versions", () => {
    const win = { id: 42, title: "private.txt", owner: { name: "TextEdit", path: "/System/Applications/TextEdit.app", bundleId: "com.apple.TextEdit" } };
    expect(macWindowInfo(win, { CFBundleShortVersionString: "1.20", CFBundleVersion: "400" })).toMatchObject({ productVersion: "1.20", fileVersion: "400", versionSource: "product-version", hwnd: 42 });
    expect(macWindowInfo(win, {})).toMatchObject({ productVersion: "", versionSource: "unknown" });
  });
  it("does not substitute a different window when the selected source is missing", async () => {
    mocks.sources.mockResolvedValue([{ id: "window:88:0", thumbnail: {} }]);
    await expect(captureMacWindow(42)).rejects.toThrow("対象ウィンドウ");
    mocks.permission.mockReturnValue("denied");
    await expect(captureMacWindow(42)).rejects.toThrow("画面収録");
  });
  it("captures only the selected window and records actual image dimensions", async () => {
    mocks.sources.mockResolvedValue([{ id: "window:42:0", thumbnail: { isEmpty: () => false, getSize: () => ({ width: 800, height: 600 }), toJPEG: () => Buffer.from("synthetic fixture") } }]);
    const shot = await captureMacWindow(42);
    try { expect(shot).toMatchObject({ width: 800, height: 600 }); expect(fs.readFileSync(shot.image, "utf8")).toBe("synthetic fixture"); }
    finally { fs.unlinkSync(shot.image); }
  });
});
