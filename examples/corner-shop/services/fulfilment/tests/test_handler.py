import json

import handler


def sqs_event(*bodies):
    return {"Records": [{"messageId": f"m{i}", "body": json.dumps(body)} for i, body in enumerate(bodies)]}


def test_ships_an_order_and_publishes(monkeypatch, order, parcel):
    published = []
    monkeypatch.setattr(handler, "create_parcel", lambda o: parcel)
    monkeypatch.setattr(handler, "publish_parcel_shipped", lambda o, p: published.append((o["orderId"], p["tracking_number"])))
    order = {**order, "orderId": "ord_ship"}

    result = handler.on_order_confirmed(sqs_event(order), None)

    assert result == {"batchItemFailures": []}
    assert published == [("ord_ship", "3STEST000001")]


def test_a_second_delivery_buys_no_second_label(monkeypatch, order, parcel):
    bought = []
    monkeypatch.setattr(handler, "create_parcel", lambda o: bought.append(o["orderId"]) or parcel)
    monkeypatch.setattr(handler, "publish_parcel_shipped", lambda o, p: None)
    order = {**order, "orderId": "ord_again"}

    handler.on_order_confirmed(sqs_event(order), None)
    handler.on_order_confirmed(sqs_event(order), None)

    assert bought == ["ord_again"]


def test_only_failed_messages_go_back(monkeypatch, order, parcel):
    def create(o):
        if o["orderId"] == "ord_bad":
            raise RuntimeError("sendcloud is down")
        return parcel

    monkeypatch.setattr(handler, "create_parcel", create)
    monkeypatch.setattr(handler, "publish_parcel_shipped", lambda o, p: None)

    result = handler.on_order_confirmed(sqs_event({**order, "orderId": "ord_good"}, {**order, "orderId": "ord_bad"}), None)

    assert result == {"batchItemFailures": [{"itemIdentifier": "m1"}]}
