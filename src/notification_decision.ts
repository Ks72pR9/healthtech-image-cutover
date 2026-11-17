export function decideNotification(width: number, height: number): "send" | "hold" {
  return width <= 1600 && height <= 1600 ? "send" : "hold";
}
