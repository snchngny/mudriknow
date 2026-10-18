import { app, BrowserWindow, screen, dialog, nativeTheme } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { pathToFileURL } from "url";
import * as koffi from "koffi";
import { execFileSync } from "child_process";
import { createTrayWithShow, destroyTray } from "./tray";
import { Config, DEFAULT_CONFIG, ContextPayload, IPC } from "../shared/types";
import { registerIpcHandlers, setContext, setAreaContext, getLastContext, patchConfigPersistOnly, attachAutoScreenshot, setScreenshotMode } from "./ipc-handlers";
import { startHotkeyListener, stopHotkeyListener, applyHotkeys } from "./hotkey";
import { loadConfig, saveConfig, isFirstRun, ensureAgentInWorkingDir } from "./config-store";
import { setToastAppId } from "./notifier";
import { initUpdater, stopUpdater } from "./updater";
import { readContextAtPoint } from "./context-reader";
import { startAreaSelection } from "./area-selector";
import { scanArea } from "./area-scanner";
import { showElementHighlight, showAreaHighlight } from "./highlight";
import { cleanupImage, captureAndOptimize } from "./vision";
import { log, pruneOldLogs } from "./logger";

// Keep this local prototype separate from an installed upstream MudrikNow.
if (process.env.MUDRIK_USER_DATA && path.isAbsolute(process.env.MUDRIK_USER_DATA)) {
  app.setPath("userData", process.env.MUDRIK_USER_DATA);
}
// Keep bundled runtime accounts separate from the user's standalone CLI.
process.env.XDG_DATA_HOME = path.join(app.getPath("userData"), "opencode-data");
process.env.XDG_CACHE_HOME = path.join(app.getPath("userData"), "opencode-cache");

app.commandLine.appendSwitch("enable-features", "BackDropFilter");

import { showSplashScreen, closeSplashScreen } from "./splash/splash-window";
import { startCaptureShimmer, finishCaptureShimmer, cancelCaptureShimmer, freezeCaptureShimmerForShot } from "./guide/guide-overlay";

const gotTheLock = app.requestSingleInstanceLock();
// Set the AppUserModelID early so modern Windows toasts (response-ready
// notifications) carry the right app identity + icon. Must run before any
// Notification is created.
setToastAppId();
if (!gotTheLock) {
  app.quit();
} else {
  let instanceDialogOpen = false;
  app.on("second-instance", () => {
    if (process.env.MUDRIK_USER_DATA) {
      showChatPanel();
      log("Existing MudrikNow panel shown");
      return;
    }
    if (instanceDialogOpen) return;
    instanceDialogOpen = true;
    log("Second instance attempted — asking whether to close the running one");
    const choice = dialog.showMessageBoxSync({
      type: "info",
      title: "MudrikNow",
      message:
        "MudrikNow is already running in the background. Use Alt+Space, Ctrl+Space, Alt+X, or the tray icon to open it. Do you want to close the running instance first?",
      buttons: ["OK", "Close"],
      defaultId: 1,
      cancelId: 1,
    });
    instanceDialogOpen = false;
    if (choice === 0) {
      app.quit();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let config: Config = { ...DEFAULT_CONFIG };
let splashShownForThisLaunch = false;
import { fitPanelBounds, panelBoundsDiffer } from "./panel-bounds";

const dwmapi = process.platform === "win32" ? koffi.load("dwmapi.dll") : null;
const DwmSetWindowAttribute = dwmapi?.func(
  "int DwmSetWindowAttribute(unsigned long long hwnd, int attr, void *val, int size)"
) || (() => 0);
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_ROUND = 2;

function applyRoundedCorners(win: BrowserWindow): void {
  try {
    const buf = win.getNativeWindowHandle();
    const hwnd = buf.length === 8 ? Number(buf.readBigUInt64LE()) : buf.readUInt32LE();
    const prefBuf = Buffer.alloc(4);
    prefBuf.writeUInt32LE(DWMWCP_ROUND, 0);
    const hr = DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, prefBuf, 4);
    log(`DwmSetWindowAttribute hwnd=0x${hwnd.toString(16)} hr=0x${(hr >>> 0).toString(16)}`);
  } catch (e: any) {
    log(`DWM rounded corners failed: ${e.message}`);
  }
}

function calculatePanelPosition(cursorX: number, cursorY: number): { x: number; y: number; width: number; height: number } {
  const electronCursor = screen.getCursorScreenPoint();
  log(`Cursor: robotjs=(${cursorX},${cursorY}) electron=(${electronCursor.x},${electronCursor.y})`);

  const hasSavedPosition = Number.isFinite(config.panelX) && Number.isFinite(config.panelY);
  const display = hasSavedPosition
    ? screen.getDisplayMatching({ x: config.panelX!, y: config.panelY!, width: config.panelWidth, height: config.panelHeight })
    : screen.getDisplayNearestPoint(electronCursor);
  const workArea = display.workArea;
  if (hasSavedPosition) {
    const bounds = fitPanelBounds({ x: config.panelX!, y: config.panelY!, width: config.panelWidth, height: config.panelHeight }, workArea);
    log(`Restoring saved panel bounds: ${JSON.stringify(bounds)}`);
    return bounds;
  }
  const lx = electronCursor.x;
  const ly = electronCursor.y;
  const rightEdge = workArea.x + workArea.width;
  const bottomEdge = workArea.y + workArea.height;

  // Respect the last user size, keeping it inside the current work area.
  const panelWidth = Math.min(workArea.width - 16, Math.max(560, Math.min(900, config.panelWidth)));
  const panelHeight = Math.min(workArea.height - 16, Math.max(360, config.panelHeight));

  const PADDING = 8;
  const halfWidth = workArea.width / 2;

  // Calculate available space on each side of cursor
  const leftSpace = lx - workArea.x;
  const rightSpace = rightEdge - lx;

  // Bias toward left side (10% of screen width).
  const BIAS = workArea.width * 0.1;

  let panelX: number;
  if (leftSpace >= rightSpace + BIAS) {
    // Cursor far to the right â†’ place panel on LEFT half, centered within it
    const leftHalfCenter = workArea.x + halfWidth / 2; // 25% across screen
    panelX = Math.round(leftHalfCenter - panelWidth / 2);
    log(`Panel placement: LEFT-HALF-CENTER (cursor-right, leftSpace=${Math.round(leftSpace)}, rightSpace=${Math.round(rightSpace)})`);
  } else {
    // Cursor on left or middle â†’ place panel on RIGHT half, centered within it
    const rightHalfCenter = workArea.x + halfWidth + halfWidth / 2; // 75% across screen
    panelX = Math.round(rightHalfCenter - panelWidth / 2);
    log(`Panel placement: RIGHT-HALF-CENTER (cursor-left, leftSpace=${Math.round(leftSpace)}, rightSpace=${Math.round(rightSpace)})`);
  }

  // Clamp horizontal so panel stays on screen
  panelX = Math.max(workArea.x + PADDING, Math.min(panelX, rightEdge - panelWidth - PADDING));

  // Vertically center on screen (not relative to cursor)
  let panelY = workArea.y + Math.round((workArea.height - panelHeight) / 2);
  panelY = Math.max(workArea.y + PADDING, Math.min(panelY, bottomEdge - panelHeight - PADDING));

  log(`Panel: x=${panelX} y=${panelY} width=${panelWidth} height=${panelHeight} | cursor=(${lx},${ly})`);

  return { x: Math.round(panelX), y: Math.round(panelY), width: panelWidth, height: panelHeight };
}

function createWindow(cursorX: number, cursorY: number): BrowserWindow {
  const pos = calculatePanelPosition(cursorX, cursorY);
  log(`Creating window at x=${pos.x}, y=${pos.y}, width=${pos.width}, height=${pos.height}`);

  // Resolve the owl icon for the BrowserWindow (Alt+Tab, taskbar if the
  // user ever un-sets skipTaskbar). Looked up relative to the built main
  // bundle so it works both in dev and packaged.
  const iconCandidates = [
    path.join(__dirname, "..", "assets", "icon.png"),
    path.join(__dirname, "..", "..", "assets", "icon.png"),
    path.join(app.getAppPath(), "assets", "icon.png"),
  ];
  const winIcon = iconCandidates.find((p) => {
    try { require("fs").accessSync(p); return true; } catch { return false; }
  });

  const win = new BrowserWindow({
    width: pos.width,
    height: pos.height,
    x: pos.x,
    y: pos.y,
    frame: false,
    ...(winIcon ? { icon: winIcon } : {}),
    // TRUE per-pixel transparency. All three of these must be set
    // together on Windows â€” without them Electron draws a default
    // opaque white/gray rectangle behind the CSS-rounded `.app`, which
    // is what produced the visible "rectangle behind the rounded
    // corners" bug:
    //   - `transparent: true`        enables the alpha channel
    //   - `backgroundColor: "#00000000"`  clears the default opaque fill
    //   - `hasShadow: false`         disables the OS drop shadow (we
    //                                draw our own macOS-style stacked
    //                                shadow in global.css `.app`)
    // We're also NOT using backdrop-filter (Chromium on an Electron
    // transparent window can't sample the desktop behind) nor Windows
    // acrylic via setBackgroundMaterial (removed 2026-09 — it caused DWM
    // ghost-bar artifacts over the whole screen and compositor lag).
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Window resize is handled by EXPLICIT grips rendered in the renderer
    // (ResizeGrips.tsx — a bottom edge + bottom-right corner handle), NOT by
    // the native Windows edge gutter. `resizable: false` removes the
    // invisible ~6px native gutter on all sides that used to intercept
    // scroll/clicks near the panel edges. The renderer drives resize via the
    // RESIZE_PANEL IPC (clamped below in ipc-handlers to the min/max here);
    // setBounds works regardless of the resizable flag.
    resizable: false,
    minWidth: 560,
    minHeight: 360,
    maxWidth: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Save normal bounds after moving/resizing and flush on hide/close.
  // Never persist minimized window coordinates or dimensions.
  let boundsTimer: ReturnType<typeof setTimeout> | undefined;
  const savePanelSizeOnHide = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (win.isDestroyed() || win.isMinimized()) return;
    const { x, y, width, height } = win.getNormalBounds();
    const patch = { panelX: x, panelY: y, panelWidth: width, panelHeight: height };
    Object.assign(config, patch);
    patchConfigPersistOnly(patch);
    log(`Panel bounds saved: ${JSON.stringify(patch)}`);
  };
  const scheduleBoundsSave = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(savePanelSizeOnHide, 250);
  };
  win.on("move", scheduleBoundsSave);
  win.on("resize", scheduleBoundsSave);
  win.on("hide", savePanelSizeOnHide);
  win.on("close", savePanelSizeOnHide);
  win.on("closed", () => { if (boundsTimer) clearTimeout(boundsTimer); });

  // Desktop-wide cursor polling for the owl mascot. Runs only while the
  // panel is visible â€” ~33ms cadence (~30 Hz) is smooth enough for pupil
  // tracking and cheap enough not to notice. Using the Electron `screen`
  // API (not robotjs) so we don't pay a native-module call per tick.
  let cursorTimer: NodeJS.Timeout | null = null;
  const { screen: electronScreen } = require("electron") as typeof import("electron");
  const startCursorPolling = () => {
    if (cursorTimer) return;
    cursorTimer = setInterval(() => {
      if (win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
      const pos = electronScreen.getCursorScreenPoint();
      win.webContents.send(IPC.CURSOR_POS, pos);
    }, 33);
  };
  const stopCursorPolling = () => {
    if (cursorTimer) {
      clearInterval(cursorTimer);
      cursorTimer = null;
    }
  };
  win.on("show", startCursorPolling);
  win.on("hide", stopCursorPolling);
  win.on("close", stopCursorPolling);
  // After a taskbar-minimize (MINIMIZE_TO_TASKBAR un-skips the taskbar so a
  // restorable button appears), return the panel to its normal tray-centric
  // floating mode (skipTaskbar:true) once the user restores it.
  win.on("restore", () => {
    try { win.setSkipTaskbar(true); } catch { /* window gone */ }
  });

  log(`Loading index.html from ${path.join(__dirname, "index.html")}`);
  log(`dist dir contents: ${fs.readdirSync(path.join(__dirname)).join(", ")}`);

  win.loadFile(path.join(__dirname, "index.html"));

  win.webContents.on("did-finish-load", () => {
    log("Renderer finished loading");
  });

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    log(`ERROR: Renderer failed to load: code=${code} desc=${desc}`);
  });

  win.webContents.on("console-message", (_e, level, msg) => {
    const levels = ["verbose", "info", "warning", "error"];
    log(`Renderer console [${levels[level] || level}]: ${msg}`);
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    log(`ERROR: Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  log("Window created successfully");
  return win;
}

function showPanel(context: ContextPayload): void {
  log(`showPanel called with context: element=${context.element?.type} "${context.element?.name}" (${context.element?.value?.slice(0, 50)}...)`);

  const cursorX = context.cursorPos?.x ?? 400;
  const cursorY = context.cursorPos?.y ?? 400;

  if (!mainWindow) {
    log("No existing window, creating new one");
    mainWindow = createWindow(cursorX, cursorY);
    mainWindow.on("closed", () => {
      log("Window closed");
      mainWindow = null;
    });
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    const pos = calculatePanelPosition(cursorX, cursorY);
    log(`Repositioning existing window to x=${pos.x}, y=${pos.y}, size=${pos.width}x${pos.height}`);
    if (panelBoundsDiffer(mainWindow.getNormalBounds(), pos)) mainWindow.setBounds(pos);
  }

  const sendContext = () => {
    log(`Sending CONTEXT_READY to renderer`);
    mainWindow?.webContents.send(IPC.CONTEXT_READY, context);
  };

  if (mainWindow.webContents.isLoading()) {
    log("Window still loading, waiting for did-finish-load...");
    mainWindow.webContents.once("did-finish-load", () => {
      log("did-finish-load fired, sending context");
      sendContext();
    });
  } else {
    log("Window already loaded, sending context immediately");
    sendContext();
  }

  mainWindow.show();
  applyRoundedCorners(mainWindow);
  mainWindow.focus();
  mainWindow.moveTop();

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.webContents.send(IPC.FOCUS_INPUT);
    }
  }, 150);

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.webContents.send(IPC.FOCUS_INPUT);
    }
  }, 400);

  log("Panel shown and focused");
}

function hidePanel(): void {
  log("hidePanel called");
  if (mainWindow) {
    mainWindow.hide();
    log("Window hidden");
  }
}

function showExistingPanel(): void {
  log("showExistingPanel called â€” re-showing with last context (no reset)");
  if (!mainWindow) {
    log("No existing window, cannot re-show");
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  const pos = calculatePanelPosition(
    lastCursorX ?? screen.getPrimaryDisplay().workAreaSize.width / 2,
    lastCursorY ?? screen.getPrimaryDisplay().workAreaSize.height / 2
  );
  if (panelBoundsDiffer(mainWindow.getNormalBounds(), pos)) mainWindow.setBounds(pos);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.webContents.send(IPC.FOCUS_INPUT);
    }
  }, 150);
}

let lastCursorX: number | null = null;
let lastCursorY: number | null = null;

// Monotonically increasing activation id. Each hotkey press bumps it and
// stamps the resulting context read; any .then that resolves for a superseded
// id is dropped. Without this, a slow first UIA read can finish AFTER a
// faster second read and overwrite the live context with stale data — the
// user sees the panel "stuck on" the previous element.
let activationSeq = 0;

async function handlePointerActivate(cursorPos: { x: number; y: number }): Promise<void> {
  if (process.platform === "darwin") {
    try {
      const { readMacContext, captureMacWindow } = await import("./mac-context");
      const ctx = await readMacContext(mainWindow?.isFocused() ? getLastContext()?.windowInfo?.hwnd : undefined);
      const shot = await captureMacWindow(ctx.windowInfo.hwnd!);
      const context: ContextPayload = { ...ctx, cursorPos, source: "pointer", imagePath: shot.image, hasScreenshot: true };
      setContext(context);
      setScreenshotMode("manual", { physicalWidth: shot.width, physicalHeight: shot.height, scaleFactor: 1 });
      showPanel(context);
    } catch (error: any) { dialog.showErrorBox("アプリの取得", error.message); }
    return;
  }
  const myActivation = ++activationSeq;
  log(`Pointer hotkey at cursor pos: x=${cursorPos.x}, y=${cursorPos.y} (activation #${myActivation})`);
  lastCursorX = cursorPos.x;
  lastCursorY = cursorPos.y;

  // Capture the target before hiding/showing any of our own windows.
  let targetHwnd = 0;
  try {
    const { getActiveHwnd } = await import("./guide/active-window");
    targetHwnd = await getActiveHwnd();
    const ownHandle = mainWindow?.getNativeWindowHandle();
    const ownHwnd = ownHandle ? Number(ownHandle.length === 8 ? ownHandle.readBigUInt64LE() : ownHandle.readUInt32LE()) : 0;
    if (targetHwnd === ownHwnd) targetHwnd = getLastContext()?.windowInfo?.hwnd || 0;
  } catch { /* identity remains unknown */ }

  // Hide any existing panel immediately; show a semi-transparent capture badge
  // near the cursor while we capture context/screenshot. The panel itself is
  // NOT shown until the data is ready — this prevents the "open -> hide ->
  // re-open" flash and the random highlight rectangle the user sees mid-capture.
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  }
  startCaptureShimmer();

    try {
      const ctx = await readContextAtPoint(cursorPos.x, cursorPos.y, targetHwnd);
      if (myActivation !== activationSeq) {
        cancelCaptureShimmer();
        return;
      }

      const context: ContextPayload = { ...ctx, cursorPos, source: "pointer" };
      setContext(context);

      log("Pointer hotkey — always capturing full-screen screenshot with grid");
      try {
        const { screen: electronScreen } = require("electron") as typeof import("electron");
        const display = electronScreen.getDisplayNearestPoint(cursorPos);
        const sf = display.scaleFactor || 1;
        const b = display.bounds;
        // Freeze the sheen band off so it doesn't appear in the screenshot
        // (dim stays — content remains readable). Wait a beat for the
        // renderer to paint the frozen state before GDI grabs the screen.
        freezeCaptureShimmerForShot();
        await new Promise((r) => setTimeout(r, 80));
        const screenshotPath = await captureAndOptimize(
          Math.round(b.x * sf), Math.round(b.y * sf),
          Math.round((b.x + b.width) * sf), Math.round((b.y + b.height) * sf),
          { noGrid: false },
        );
        if (screenshotPath) {
          attachAutoScreenshot(screenshotPath);
          setScreenshotMode("manual", { physicalWidth: Math.round(b.width * sf), physicalHeight: Math.round(b.height * sf), scaleFactor: sf });
          context.hasScreenshot = true;
          context.imagePath = screenshotPath;
          log(`Pointer screenshot attached: ${screenshotPath.slice(-40)} (screen ${Math.round(b.width * sf)}x${Math.round(b.height * sf)} physical @${sf}x)`);
        } else {
          log(`Pointer screenshot capture returned null`);
        }
      } catch (err: any) {
        log(`Pointer screenshot capture failed: ${err?.message || err}`);
      }

      // Play the one-shot end wash, then pop the panel + target highlight.
      finishCaptureShimmer(() => {
        showElementHighlight(ctx.element.bounds);
        showPanel(context);
      });
    } catch (err: any) {
    if (myActivation !== activationSeq) {
      cancelCaptureShimmer();
      return;
    }
    log(`ERROR reading context: ${err.message}`);
    cancelCaptureShimmer();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.CONTEXT_LOADING, false);
    }
  }
}

function handleQuickActivate(cursorPos: { x: number; y: number }): void {
  // In this prototype, ordinary chat also reads the active application.
  void handlePointerActivate(cursorPos);
}

function showChatPanel(): void {
  if (getLastContext() && mainWindow) {
    showExistingPanel();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const workArea = screen.getPrimaryDisplay().workArea;
  const context: ContextPayload = {
    element: { name: "", type: "none", value: "", bounds: { x: 0, y: 0, width: 0, height: 0 }, children: [] },
    surrounding: [], source: "quick",
    cursorPos: { x: Math.round(workArea.x + workArea.width / 2), y: Math.round(workArea.y + workArea.height / 2) },
  };
  setContext(context);
  showPanel(context);
}

function handleAreaActivate(): void {
  const myActivation = ++activationSeq;
  log(`Area hotkey triggered â€” starting area selection (activation #${myActivation})`);
  hidePanel();
  startAreaSelection((rect) => {
    if (myActivation !== activationSeq) {
      log(`Area activation #${myActivation} superseded by #${activationSeq}`);
      return;
    }
    log(`Area selected (physical): (${rect.x1},${rect.y1}) to (${rect.x2},${rect.y2})`);
    const px1 = rect.x1;
    const py1 = rect.y1;
    const px2 = rect.x2;
    const py2 = rect.y2;
    const midX = (px1 + px2) / 2;
    const midY = (py1 + py2) / 2;
    const cursorPos = { x: Math.round(midX), y: Math.round(midY) };
    startCaptureShimmer();
    scanArea(px1, py1, px2, py2, async () => {
      freezeCaptureShimmerForShot();
      await new Promise((r) => setTimeout(r, 80));
    }).then(async ({ elements, imagePath }) => {
      if (myActivation !== activationSeq) {
        log(`Area scan for #${myActivation} superseded by #${activationSeq} â€” discarding result`);
        cancelCaptureShimmer();
        if (imagePath) cleanupImage(imagePath);
        return;
      }
      log(`Area scan found ${elements.length} elements, image=${imagePath ? "captured" : "none"}`);

      const { screen: electronScreen } = require("electron") as typeof import("electron");
      const display = electronScreen.getDisplayNearestPoint(cursorPos);
      const sf = display.scaleFactor || 1;
      const b = display.bounds;

      const context = setAreaContext(elements, rect, cursorPos, imagePath);
      context.source = "area";
      // Play the end wash, then pop the panel (positioned near the rect center)
      // alongside the area highlight.
      finishCaptureShimmer(() => {
        showAreaHighlight(rect);
        showPanel(context);
      });
    }).catch((err) => {
      log(`ERROR scanning area: ${err.message}`);
      cancelCaptureShimmer();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.CONTEXT_LOADING, false);
      }
    });
  });
}

function applyTheme(theme: "system" | "light" | "dark"): void {
  try {
    nativeTheme.themeSource = theme;
    log(`Theme set to: ${theme} (resolved dark=${nativeTheme.shouldUseDarkColors})`);
  } catch (e: any) {
    log(`applyTheme FAILED: ${e.message}`);
  }
}

function applyLoginItemSetting(launchOnStartup: boolean): void {
  try {
    const args: string[] = [];
    if (!app.isPackaged) {
      // In dev mode, process.execPath is electron.exe (not our app binary).
      // Without the app path as the first arg, Windows startup launches
      // electron.exe with only --hidden → shows the default Electron
      // welcome page instead of MudrikNow.
      args.push(app.getAppPath());
    }
    if (launchOnStartup) {
      args.push("--hidden");
    }
    app.setLoginItemSettings({
      openAtLogin: launchOnStartup,
      openAsHidden: true,
      args,
    });
    log(`setLoginItemSettings: openAtLogin=${launchOnStartup}, isPackaged=${app.isPackaged}, args=${JSON.stringify(args)}`);
  } catch (e: any) {
    log(`setLoginItemSettings FAILED: ${e.message}`);
  }
}

// Startup-entry normalization: Electron registers the Run entry under the
// app's AUMID (= electron-builder appId), and our appId changed across
// rebrands (com.hoverbuddy.app → com.mudrik.app → com.mudriknow.app). Each
// rename orphaned the previous entry, so Windows could launch two or more
// instances on boot (clashing with the single-instance guard). Enumerate
// HKCU Run once and delete every entry that is NOT the canonical current
// one but references a legacy app id or one of our exe names. Other apps'
// Electron entries never match (their exes/names differ). Runs before
// applyLoginItemSetting() so exactly one canonical entry remains after it.
const RUN_KEY = "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
const CANONICAL_STARTUP_NAME = "com.mudriknow.app";
const LEGACY_NAME_PATTERN = /com\.hoverbuddy\.app|com\.mudrik\.app/i;
// Matches dev-mode entries (project dir in args) and packaged entries
// pointing at any of our historical exe names (HoverBuddy/Mudrik/MudrikNow).
const OUR_DATA_PATTERN = /hoverbuddy|mudrik\.exe|mudriknow\.exe/i;

function normalizeStartupEntries(): void {
  if (process.platform !== "win32") return;
  if (!app.isPackaged) return; // don't touch registry in dev mode
  try {
    const out = execFileSync(
      "reg",
      ["query", RUN_KEY],
      { encoding: "utf-8", timeout: 2000, windowsHide: true }
    ).toString();
    for (const line of out.split(/\r?\n/)) {
      // Lines look like: "    Name    REG_SZ    C:\path\to\app.exe --args"
      const m = line.match(/^\s*(\S+)\s+REG_SZ\s+(.+)$/);
      if (!m) continue;
      const [, name, data] = m;
      if (name.toLowerCase() === CANONICAL_STARTUP_NAME) continue; // applyLoginItemSetting owns this one
      // A default-AUMID name (electron.app.*) is only ours if its data says so.
      const nameIsOurs = LEGACY_NAME_PATTERN.test(name);
      const dataIsOurs = OUR_DATA_PATTERN.test(data);
      if (!nameIsOurs && !dataIsOurs) continue;
      execFileSync(
        "reg",
        ["delete", RUN_KEY, "/v", name, "/f"],
        { encoding: "utf-8", timeout: 2000, windowsHide: true }
      );
      log(`normalizeStartupEntries: removed stale startup entry "${name}" = ${data.trim()}`);
    }
  } catch {
    // Key doesn't exist or read failed — nothing to clean up.
  }
}

async function maybeShowWelcome(): Promise<void> {
  if (config.hasCompletedWelcome) return;
  try {
    await dialog.showMessageBox({
      type: "info",
      title: "Welcome to MudrikNow",
      message: "MudrikNow runs from the system tray.",
      detail:
        `Press ${config.hotkeyPointer} on any window to open the assistant for the UI element under your cursor.\n\n` +
        `Press ${config.hotkeyQuick} for quick chat — instant AI without screen capture.\n\n` +
        `You can change the model, hotkeys, and startup behaviour from the âš™ menu in the panel.`,
      buttons: ["Get started"],
      defaultId: 0,
      noLink: true,
    });
  } catch (e: any) {
    log(`Welcome dialog failed: ${e.message}`);
  }
  config.hasCompletedWelcome = true;
  saveConfig(config);
}

function showStartupSplash(onClosed?: () => void): void {
  const iconCandidates = [
    path.join(__dirname, "..", "assets", "icon.png"),
    path.join(__dirname, "..", "..", "assets", "icon.png"),
    path.join(app.getAppPath(), "assets", "icon.png"),
  ];
  const iconPath = iconCandidates.find((p) => {
    try { fs.accessSync(p); return true; } catch { return false; }
  });
  const iconUrl = iconPath ? pathToFileURL(iconPath).href : "";

  const display = screen.getPrimaryDisplay();
  const w = 320;
  const h = 200;
  const x = Math.round(display.bounds.x + (display.bounds.width - w) / 2);
  const y = Math.round(display.bounds.y + (display.bounds.height - h) / 2);

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="UTF-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:100%; height:100%; overflow:hidden; background:transparent; }
  body {
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    background:rgba(15,23,42,0.94); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    color:#fff; user-select:none; -webkit-app-region:no-drag;
    animation:fadeIn 0.4s ease; border-radius:12px; cursor:pointer;
  }
  img { width:64px; height:64px; margin-bottom:14px; }
  .title { font-size:15px; font-weight:600; margin-bottom:4px; }
  .hint { font-size:13px; color:rgba(255,255,255,0.65); }
  .dismiss { margin-top:12px; font-size:11px; color:rgba(255,255,255,0.35); }
  @keyframes fadeIn { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
</style></head>
<body onclick="window.close()">
  ${iconUrl ? `<img src="${iconUrl}" alt="MudrikNow" />` : ''}
  <div class="title">MudrikNow is now running in your tray</div>
  <div class="hint">Alt+Space to get started</div>
  <div class="dismiss">Click to dismiss</div>
</body></html>`;

  const win = new BrowserWindow({
    width: w, height: h, x, y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const timer = setTimeout(() => {
    try { if (!win.isDestroyed()) win.close(); } catch (e) { /* already closed */ }
  }, 4000);

  win.once("ready-to-show", () => win.show());

  win.on("closed", () => {
    clearTimeout(timer);
    onClosed?.();
  });
}

app.whenReady().then(async () => {
  if (!gotTheLock) return;
  log("App ready, initializing...");

  const startedHidden = process.argv.includes("--hidden");

  const firstRun = isFirstRun();
  config = loadConfig();
  if (process.env.MUDRIK_USER_DATA || app.isPackaged || process.platform === "darwin") {
    config.hasCompletedWelcome = true;
    config.launchOnStartup = false;
    config.autoGuideEnabled = false;
    config.actionsEnabled = false;
    config.readOnlyCommandsEnabled = false;
    config.workingDir = path.join(app.getPath("userData"), "workspace");
    fs.mkdirSync(config.workingDir, { recursive: true });
    if (process.env.MUDRIK_MODEL) {
      config.model = process.env.MUDRIK_MODEL;
      config.recentModels = [config.model];
      config.hasConfiguredModel = true;
    }
  }
  log(`Config loaded: model=${config.model}, workingDir=${config.workingDir}, firstRun=${firstRun}`);

  // Persist the default config on first run so subsequent launches see it
  // and first-run detection is accurate.
  if (firstRun) saveConfig(config);

  ensureAgentInWorkingDir(config.workingDir, config.readOnlyCommandsEnabled);

  pruneOldLogs(30 * 24 * 60 * 60 * 1000); // 30 days

  applyTheme(config.theme);
  normalizeStartupEntries();
  applyLoginItemSetting(config.launchOnStartup);

  // Always show the splash on every launch — including Windows auto-startup
  // (--hidden). The --hidden flag only suppresses the panel window, not the
  // splash. Without this, Windows startup shows a bare Electron taskbar
  // icon with no visual feedback to the user.
  showSplashScreen({
    pointer: config.hotkeyPointer,
    // area omitted — Area Capture is disabled for redesign
    quick: config.hotkeyQuick,
    lang: config.lang,
  });
  splashShownForThisLaunch = true;

  // On first run the welcome dialog follows the splash; otherwise show it
  // immediately on normal launches that didn't display a splash.
  if (!startedHidden && !splashShownForThisLaunch) {
    await maybeShowWelcome();
  } else if (firstRun && splashShownForThisLaunch && !process.env.MUDRIK_USER_DATA) {
    // Defer welcome until the splash auto-closes so the user isn't buried
    // in stacked windows. We still mark it completed synchronously below.
    setTimeout(() => void maybeShowWelcome(), 4000);
  }

  createTrayWithShow(
    () => {
      const lastCtx = getLastContext();
      if (lastCtx && mainWindow) {
        log("Show Panel from tray â€” re-showing with last context");
        showExistingPanel();
        return;
      }
      // No real context yet. Open an empty panel centered on the primary
      // display so the user can chat without a target element. Previously we
      // synthesized a fake "Test Element" context, which looked like a bug
      // to first-time users.
      log("Show Panel from tray â€” no existing context, opening empty panel");
      const display = screen.getPrimaryDisplay();
      const emptyContext: ContextPayload = {
        element: {
          name: "",
          type: "none",
          value: "",
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          children: [],
        },
        surrounding: [],
        source: "quick",
        cursorPos: {
          x: Math.round(display.workAreaSize.width / 2),
          y: Math.round(display.workAreaSize.height / 2),
        },
      };
      setContext(emptyContext);
      showPanel(emptyContext);
    },
    () => app.quit()
  );
  log("Tray created");

  registerIpcHandlers(config, showPanel, hidePanel, (next, prev) => {
    if (next.hotkeyPointer !== prev.hotkeyPointer || next.hotkeyArea !== prev.hotkeyArea || next.hotkeyQuick !== prev.hotkeyQuick) {
      const result = applyHotkeys({ pointer: next.hotkeyPointer, area: next.hotkeyArea, quick: next.hotkeyQuick });
      if (!result.ok) {
        // Roll back the in-memory config so UI shows the previous working values.
        config.hotkeyPointer = prev.hotkeyPointer;
        config.hotkeyArea = prev.hotkeyArea;
        config.hotkeyQuick = prev.hotkeyQuick;
        saveConfig(config);
      }
    }
    if (next.launchOnStartup !== prev.launchOnStartup) {
      applyLoginItemSetting(next.launchOnStartup);
    }
    if (next.theme !== prev.theme) {
      applyTheme(next.theme);
    }
    if (next.workingDir !== prev.workingDir) {
      ensureAgentInWorkingDir(next.workingDir, next.readOnlyCommandsEnabled);
    }
  });
  log("IPC handlers registered");

  startHotkeyListener(
    {
      onPointerActivate: handlePointerActivate,
      onAreaActivate: handleAreaActivate,
      onQuickActivate: handleQuickActivate,
    },
    { pointer: config.hotkeyPointer, area: config.hotkeyArea, quick: config.hotkeyQuick }
  );
  log("Hotkey listener started");
  if (!startedHidden) showChatPanel();
  // Keep the splash visible long enough for the user to read it, then close.
  if (splashShownForThisLaunch) {
    closeSplashScreen(3600);
  }

  // No update feed until an owned distribution repository is configured.
  log("Updater initialized");

  app.on("before-quit", () => {
    log("App quitting...");
    stopUpdater();
    stopHotkeyListener();
    destroyTray();
  });
});

log("Main process script loaded");

app.on("window-all-closed", () => {
  log("window-all-closed event (suppressed — tray app)");
});
