import { desktopCapturer, systemPreferences } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { UIElement, WindowInfo } from "../shared/types";

const exec = promisify(execFile);
async function windowsApi(): Promise<any> {
  const nativeImport = createRequire(__filename)(path.join(__dirname, "pdf-import.cjs"));
  const entry = nativeImport.resolve("get-windows").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return nativeImport(pathToFileURL(entry).href);
}
export async function readMacContext(targetId?: number) {
  const api = await windowsApi();
  const win = targetId ? (await api.openWindows()).find((w: any) => w.id === targetId) : await api.activeWindow({ accessibilityPermission: false });
  if (!win || win.owner.processId === process.pid) throw new Error("対象のアプリを前面にして選び直してください");
  const bundle = win.owner.path;
  let plist: Record<string, string> = {};
  try { const versions = await exec("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(bundle, "Contents", "Info.plist")], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 }); plist = JSON.parse(versions.stdout); } catch { /* Unknown version is never inferred. */ }
  const windowInfo = macWindowInfo(win, plist);
  const element: UIElement = { name: win.title || win.owner.name, type: "Window", value: "", bounds: win.bounds, children: [] };
  return { windowInfo, element, surrounding: [], windowTree: [], visibleWindows: [], shouldAutoScreenshot: true };
}
export function macWindowInfo(win: { id: number; title: string; owner: { name: string; path: string; bundleId: string } }, plist: Record<string, string>): WindowInfo {
  return { title: win.title || "", processName: win.owner.name, processPath: win.owner.path, productName: win.owner.name, productVersion: plist.CFBundleShortVersionString || "", fileVersion: plist.CFBundleVersion || "", versionSource: plist.CFBundleShortVersionString ? "product-version" : plist.CFBundleVersion ? "file-version" : "unknown", hwnd: win.id, bundleId: win.owner.bundleId };
}
export async function captureMacWindow(targetId: number): Promise<{ image: string; width: number; height: number }> {
  if (systemPreferences.getMediaAccessStatus("screen") === "denied") throw new Error("システム設定でMudrikNowの画面収録を許可して、アプリを再起動してください");
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1600, height: 1200 } });
  const source = sources.find(s => s.id.split(":")[1] === String(targetId));
  if (!source || source.thumbnail.isEmpty()) throw new Error("対象ウィンドウを撮影できません。画面収録の許可と対象アプリを確認してください");
  const size = source.thumbnail.getSize();
  const directory = path.join(os.tmpdir(), "mudriknow-captures");
  fs.mkdirSync(directory, { recursive: true });
  const image = path.join(directory, `mac-${Date.now()}-${targetId}.jpg`);
  fs.writeFileSync(image, source.thumbnail.toJPEG(80));
  return { image, width: size.width, height: size.height };
}
