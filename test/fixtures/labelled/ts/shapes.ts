import format from './util';

export class Circle {
  constructor(private r: number) {}
  area() {
    return Math.PI * this.r ** 2;
  }
  describe() {
    return format(this.area()); // CALL ts/shapes.ts#Circle.describe -> ts/util.ts#format@12, ts/shapes.ts#Circle.area@24
  }
}

export class Square {
  constructor(private s: number) {}
  area() {
    return this.s * this.s;
  }
}

// Dot overrides size: a call through a Shape may run either, so each site is inferred
export class Shape {
  size() {
    return 0;
  }
}
export class Dot extends Shape {
  size() {
    return 1;
  }
}
export function sizes(s: Shape) {
  return s.size() + s.size(); // CALL ts/shapes.ts#sizes -> ts/shapes.ts#Shape.size@12 inferred, ts/shapes.ts#Shape.size@23 inferred
}
