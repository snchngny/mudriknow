interface Bounds { x: number; y: number; width: number; height: number }

export function panelBoundsDiffer(a: Bounds, b: Bounds): boolean {
  // Windows' DPI/frame rounding can differ by a pixel or two on readback.
  return (["x", "y", "width", "height"] as const).some(key => Math.abs(a[key] - b[key]) > 2);
}

export function fitPanelBounds(bounds: Bounds, area: Bounds): Bounds {
  const width = Math.min(Math.max(1, area.width - 16), Math.max(560, Math.min(900, Math.round(bounds.width))));
  const height = Math.min(Math.max(1, area.height - 16), Math.max(360, Math.round(bounds.height)));
  return {
    width, height,
    x: Math.round(Math.max(area.x + 8, Math.min(bounds.x, area.x + area.width - width - 8))),
    y: Math.round(Math.max(area.y + 8, Math.min(bounds.y, area.y + area.height - height - 8))),
  };
}
