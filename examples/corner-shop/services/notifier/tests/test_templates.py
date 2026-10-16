import templates


def test_money_in_euros():
    assert templates.money(3295, "EUR") == "€32.95"
    assert templates.money(5, "EUR") == "€0.05"
    assert templates.money(1000, "CHF") == "CHF 10.00"


def test_order_confirmed_model(order):
    model = templates.order_confirmed_model(order)
    assert model["order_number"] == "CS-2026-000123"
    assert model["total"] == "€32.95"
    assert model["lines"] == [{"name": "Stoneware mug – Sand", "quantity": 2, "total": "€28.00"}]
    assert model["order_url"] == "https://shop.example.com/account/orders/ord_1"


def test_parcel_on_its_way_model(shipped):
    model = templates.parcel_on_its_way_model(shipped)
    assert model["carrier"] == "POSTNL"
    assert model["tracking_url"].startswith("https://")
