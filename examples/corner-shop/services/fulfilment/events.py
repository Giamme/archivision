"""Publishes parcel.shipped. A Lambda cannot hold a NATS connection, so it writes to the bus's SQS outbox; the
bridge relays each message to NATS under the subject in its attributes."""
import json
import os
import time

import boto3

OUTBOX_QUEUE = os.environ["EVENTS_OUTBOX_QUEUE"]
outbox = boto3.resource("sqs").get_queue_by_name(QueueName=OUTBOX_QUEUE)


def publish(subject, payload):
    outbox.send_message(
        MessageBody=json.dumps(payload),
        MessageAttributes={"subject": {"DataType": "String", "StringValue": subject}},
    )


def publish_parcel_shipped(order, parcel):
    """The ParcelShipped payload of @corner/events, camelCase like the TypeScript side."""
    publish(
        "parcel.shipped",
        {
            "orderId": order["orderId"],
            "orderNumber": order["orderNumber"],
            "email": order["email"],
            "carrier": parcel["carrier"],
            "trackingNumber": parcel["tracking_number"],
            "trackingUrl": parcel["tracking_url"],
            "shippedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    )
