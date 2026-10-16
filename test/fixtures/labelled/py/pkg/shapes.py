class Shape:
    def __init__(self, side):
        self.side = side

    def area(self):
        return 0

    def describe(self):
        return f"{self.name()}: {self.area()}"  # CALL py/pkg/shapes.py#Shape.describe -> py/pkg/shapes.py#Shape.name@24 ambiguous {override}, py/pkg/shapes.py#Square.name@24 ambiguous {override}, py/pkg/shapes.py#Shape.area@39 ambiguous {override}, py/pkg/shapes.py#Square.area@39 ambiguous {override}

    def name(self):
        return "shape"


class Square(Shape):
    def area(self):
        return self.side * self.side

    def name(self):
        return super().name() + "/square"  # CALL py/pkg/shapes.py#Square.name -> py/pkg/shapes.py#Shape.name@24 {method}
