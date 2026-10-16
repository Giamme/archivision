import functools
import typing


def normalize(x):
    return x.strip().lower()


def total(xs):
    return sum(len(x) for x in xs)


def logged(f):
    @functools.wraps(f)
    def wrapper(*a, **k):
        return f(*a, **k)
    return wrapper


def twice(x):
    return x


def twice(x):  # noqa: F811
    return 2 * x


class Counter:
    def __init__(self):
        self.n = 0

    def add(self, k):
        self.n += k
        return self._check()  # CALL py/pkg/helpers.py#Counter.add -> py/pkg/helpers.py#Counter._check@21 inferred {method}

    def _check(self):
        return self.n >= 0


@logged  # CALL py/pkg/helpers.py -> py/pkg/helpers.py#logged@2 {same-file}
def decorated(x):
    return normalize(x)  # CALL py/pkg/helpers.py#decorated -> py/pkg/helpers.py#normalize@12 {same-file}


@functools.lru_cache(maxsize=None)
def kept(x):
    return total([str(x)])  # CALL py/pkg/helpers.py#kept -> py/pkg/helpers.py#total@12 {same-file}


@typing.final
def pinned(x):
    return normalize(x)  # CALL py/pkg/helpers.py#pinned -> py/pkg/helpers.py#normalize@12 {same-file}
