export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function sum(xs: number[]): number;
export function sum(xs: number[], start: number): number;
export function sum(xs: number[], start = 0) {
  let t = start;
  for (const x of xs) t += clampOne(x); // CALL ts/util.ts#sum -> ts/util.ts#clampOne@28
  return t;
}

function clampOne(x: number) {
  return clamp(x, 0, 100); // CALL ts/util.ts#clampOne -> ts/util.ts#clamp@10
}

export default function format(n: number) {
  return `#${n}`;
}
