import os
import sys
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "vendor"))

from pkg import start
from pkg.helpers import decorated as deco, kept, pinned
from pkg import clean
from pkg.compat import total as ctotal
from pkg.shapes import Square
import pkg.helpers as H
import vendored


def cli():
    first = start(["A"])  # CALL py/main.py#cli -> py/pkg/core.py#run@13 {re-export}
    second = deco(" B ")  # CALL py/main.py#cli -> py/pkg/helpers.py#decorated@14 inferred {decorated}
    third = kept(1)  # CALL py/main.py#cli -> py/pkg/helpers.py#kept@13 inferred {decorated}
    fourth = pinned("C")  # CALL py/main.py#cli -> py/pkg/helpers.py#pinned@14 {decorated}
    print(first, second, third, fourth)
    return len(first)


def shapes():
    sq = Square(2)  # CALL py/main.py#shapes -> py/pkg/shapes.py#Square@10 {cross-module}
    a = sq.area()  # CALL py/main.py#shapes -> py/pkg/shapes.py#Square.area@12 inferred {method}
    b = Square(3).describe()  # CALL py/main.py#shapes -> py/pkg/shapes.py#Square@9 {cross-module}, py/pkg/shapes.py#Shape.describe@19 inferred {method}
    return a, b, H.total(["x"])  # CALL py/main.py#shapes -> py/pkg/helpers.py#total@20 {cross-module}


def use_vendor():
    return vendored.helper()  # CALL py/main.py#use_vendor -> py/vendor/vendored.py#helper@21 inferred {cross-module}


def shadow():
    kept = lambda x: x
    return kept(2)


class Runner:
    def go(self):
        return self.step() + str(len("x")).count("1")  # CALL py/main.py#Runner.go -> py/main.py#Runner.step@21 inferred {method}

    def step(self):
        return 1


class Service:
    def __init__(self):
        self.shape = Square(1)  # CALL py/main.py#Service.__init__ -> py/pkg/shapes.py#Square@22 {cross-module}
        self.spare = Square(2)  # CALL py/main.py#Service.__init__ -> py/pkg/shapes.py#Square@22 {cross-module}

    def total(self):
        return self.shape.area()  # CALL py/main.py#Service.total -> py/pkg/shapes.py#Square.area@27 inferred {attribute}

    def clear(self):
        self.spare = None
        return self.spare.area()


def measure(sq: Square, other: "Square", maybe: Optional[Square] = None):
    a = sq.area()  # CALL py/main.py#measure -> py/pkg/shapes.py#Square.area@12 inferred {annotated}
    return a + other.area() + maybe.area()  # CALL py/main.py#measure -> py/pkg/shapes.py#Square.area@22 inferred {annotated}, py/pkg/shapes.py#Square.area@37 inferred {annotated}


def rebound(sq: Square):
    sq = None
    return sq.area()


def reexports():
    import pkg
    a = pkg.start(["B"])  # CALL py/main.py#reexports -> py/pkg/core.py#run@13 {re-export}
    b = clean(" X ")  # CALL py/main.py#reexports -> py/pkg/helpers.py#normalize@9 {re-export}
    c = ctotal(["y"])  # CALL py/main.py#reexports -> py/pkg/helpers.py#total@9 {re-export}
    return a, b, c


if __name__ == "__main__":
    cli()  # CALL py/main.py -> py/main.py#cli@5 {same-file}
