from .helpers import normalize, Counter, twice
from . import helpers as h


def run(items):
    out = [normalize(x) for x in items]  # CALL py/pkg/core.py#run -> py/pkg/helpers.py#normalize@12 {cross-module}
    c = Counter()  # CALL py/pkg/core.py#run -> py/pkg/helpers.py#Counter@9 {cross-module}
    c.add(len(out))  # CALL py/pkg/core.py#run -> py/pkg/helpers.py#Counter.add@7 inferred {method}
    # a name defined twice is one symbol (its first definition), and a call to it is ambiguous
    n = twice(len(out))  # CALL py/pkg/core.py#run -> py/pkg/helpers.py#twice@9 ambiguous {redefined}
    return h.total(out) + _local(out) + n  # CALL py/pkg/core.py#run -> py/pkg/helpers.py#total@14 {cross-module}, py/pkg/core.py#_local@27 {same-file}


def _local(xs):
    return len(xs)
