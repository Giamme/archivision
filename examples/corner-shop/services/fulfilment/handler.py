"""Lambda entry points of the fulfilment worker.

on_order_confirmed reads order.confirmed from the bus's SQS bridge, buys a Sendcloud label, keeps the PDF in S3,
records the parcel in DynamoDB and publishes parcel.shipped. track_parcels runs on a schedule and follows the
parcels until Sendcloud says they arrived.
"""
import json
import time

from events import publish_parcel_shipped
from labels import store_label
from parcels import find_parcel, list_in_transit, record_parcel, update_status
from sendcloud import create_parcel, parcel_status


def log(message, **fields):
    """One JSON object per line, so CloudWatch Logs Insights can query the fields."""
    print(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "message": message, **fields}, default=str))


def on_order_confirmed(event, context):
    """SQS batch of order.confirmed messages; only the ones that failed go back to the queue."""
    failed = [record["messageId"] for record in event["Records"] if not ship_record(record)]
    return {"batchItemFailures": [{"itemIdentifier": message_id} for message_id in failed]}


def ship_record(record):
    try:
        ship_order(json.loads(record["body"]))
        return True
    except Exception as err:  # one bad message must not fail the batch
        log("could not ship", message_id=record["messageId"], error=repr(err))
        return False


def ship_order(order):
    """Buys the label, stores it and announces the parcel. Does nothing for an order that already has one."""
    if find_parcel(order["orderId"]) is not None:
        log("already shipped", order_number=order["orderNumber"])
        return
    parcel = create_parcel(order)
    label_key = store_label(order["orderNumber"], parcel["label_pdf"])
    record_parcel(order, parcel, label_key)
    publish_parcel_shipped(order, parcel)
    log("label bought", order_number=order["orderNumber"], carrier=parcel["carrier"])


def track_parcels(event, context):
    """Every 30 minutes: asks Sendcloud about each parcel in transit and records what changed."""
    changed = 0
    for parcel in list_in_transit():
        status = parcel_status(parcel["sendcloud_id"])
        if status != parcel["status"]:
            update_status(parcel["order_id"], status)
            changed += 1
    log("parcels tracked", changed=changed)
    return {"changed": changed}
