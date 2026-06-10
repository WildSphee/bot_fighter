import type { Vec2 } from "./types";

export const ZERO: Vec2 = { x: 0, y: 0 };

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(a: Vec2, scalar: number): Vec2 {
  return { x: a.x * scalar, y: a.y * scalar };
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return length(sub(a, b));
}

export function normalize(a: Vec2): Vec2 {
  const size = length(a);
  return size > 0.0001 ? { x: a.x / size, y: a.y / size } : ZERO;
}

export function rotate90(a: Vec2, direction: -1 | 1): Vec2 {
  return direction === 1 ? { x: -a.y, y: a.x } : { x: a.y, y: -a.x };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function angleTo(from: Vec2, to: Vec2): number {
  const delta = sub(to, from);
  return Math.atan2(delta.y, delta.x);
}
