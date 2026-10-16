import json

import handler
from postmark import PostmarkError


def sqs_event(*bodies):
    return {"Records": [{"messageId": f"m{i}", "body": json.dumps(body)} for i, body in enumerate(bodies)]}


def test_sends_order_confirmed_once(monkeypatch, order):
    sent = []
    monkeypatch.setattr(handler, "send_with_template", lambda to, alias, model, tag: sent.append((to, alias)) or "pm-1")
    order = {**order, "orderId": "ord_handler"}

    handler.on_order_confirmed(sqs_event(order), None)
    handler.on_order_confirmed(sqs_event(order), None)

    assert sent == [("customer@example.com", "order-confirmed")]


def test_parcel_shipped_uses_its_own_template(monkeypatch, shipped):
    aliases = []
    monkeypatch.setattr(handler, "send_with_template", lambda to, alias, model, tag: aliases.append(alias) or "pm-2")
    handler.on_parcel_shipped(sqs_event({**shipped, "orderId": "ord_parcel"}), None)
    assert aliases == ["parcel-on-its-way"]


def test_postmark_4xx_is_not_retried_but_5xx_is(monkeypatch, order):
    def refuse(to, alias, model, tag):
        raise PostmarkError(422 if to == "bad@example.com" else 503, "nope")

    monkeypatch.setattr(handler, "send_with_template", refuse)
    batch = sqs_event({**order, "orderId": "ord_422", "email": "bad@example.com"}, {**order, "orderId": "ord_503"})
    assert handler.on_order_confirmed(batch, None) == {"batchItemFailures": [{"itemIdentifier": "m1"}]}
