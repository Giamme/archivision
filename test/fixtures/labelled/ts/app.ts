import fmt, { sum } from './util';
import { limit, Circle } from './index';

export function main() {
  const c = new Circle(2); // CALL ts/app.ts#main -> ts/shapes.ts#Circle@17
  const a = c.area(); // CALL ts/app.ts#main -> ts/shapes.ts#Circle.area@15
  const b = c.area(); // CALL ts/app.ts#main -> ts/shapes.ts#Circle.area@15
  console.log(fmt(sum([a, b], 1))); // CALL ts/app.ts#main -> ts/util.ts#format@15, ts/util.ts#sum@19
  return limit(a, 0, 10); // CALL ts/app.ts#main -> ts/util.ts#clamp@10
}

export function twice(c: Circle) {
  return c.area() + c.area(); // CALL ts/app.ts#twice -> ts/shapes.ts#Circle.area@12, ts/shapes.ts#Circle.area@23
}
