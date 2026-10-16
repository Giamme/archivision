"""Lambda entry points of the notifier: one per subject, both fed by SQS from the bus's bridge."""
import json
import time

from postmark import PostmarkError, send_with_template
from sent import claim, mark_sent, message_key, release
from templates import ORDER_CONFIRMED, PARCEL_ON_ITS_WAY, order_confirmed_model, parcel_on_its_way_model


def log(message, **fields):
    print(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "message": message, **fields}))


def on_order_confirmed(event, context):
    """order.confirmed → the order-confirmed email to the customer."""
    return each_record(event, send_order_confirmed)


def on_parcel_shipped(event, context):
    """parcel.shipped → the parcel-on-its-way email with the tracking link."""
    return each_record(event, send_parcel_on_its_way)


def send_order_confirmed(order):
    send_once(ORDER_CONFIRMED, order["orderId"], order["email"], order_confirmed_model(order))


def send_parcel_on_its_way(parcel):
    send_once(PARCEL_ON_ITS_WAY, parcel["orderId"], parcel["email"], parcel_on_its_way_model(parcel))


def send_once(template, reference, to, model):
    key = message_key(template, reference)
    if not claim(key):
        log("already sent", key=key)
        return
    try:
        postmark_id = send_with_template(to, template, model, tag=template)
    except Exception:
        release(key)
        raise
    mark_sent(key, postmark_id)
    log("sent", key=key, postmark_id=postmark_id)


def each_record(event, send):
    """Runs `send` on each SQS record's JSON body; the records to retry go back as batch item failures."""
    failures = []
    for record in event["Records"]:
        try:
            send(json.loads(record["body"]))
        except PostmarkError as err:
            log("postmark refused", message_id=record["messageId"], error=str(err), retry=err.retry)
            if err.retry:
                failures += [{"itemIdentifier": record["messageId"]}]
        except Exception as err:  # retried by SQS, then the dead-letter queue
            log("failed", message_id=record["messageId"], error=repr(err))
            failures += [{"itemIdentifier": record["messageId"]}]
    return {"batchItemFailures": failures}
