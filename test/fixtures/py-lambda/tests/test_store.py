import pytest

from lib.store import save_order


def test_save_order_needs_an_id():
    with pytest.raises(KeyError):
        save_order({})
