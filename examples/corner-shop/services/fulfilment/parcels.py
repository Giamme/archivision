"""The parcels table: one item per order, keyed by order id, with a by-status index to find what is in transit."""
import os
import time

import boto3

PARCELS_TABLE = os.environ["PARCELS_TABLE"]
table = boto3.resource("dynamodb").Table(PARCELS_TABLE)

IN_TRANSIT = ("label_created", "in_transit", "awaiting_pickup")


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def find_parcel(order_id):
    response = table.get_item(Key={"order_id": order_id}, ConsistentRead=True)
    return response["Item"] if "Item" in response else None


def record_parcel(order, parcel, label_key):
    """Writes the parcel once: a second write for the same order fails its condition instead of overwriting."""
    table.put_item(
        Item={
            "order_id": order["orderId"],
            "order_number": order["orderNumber"],
            "email": order["email"],
            "sendcloud_id": parcel["sendcloud_id"],
            "carrier": parcel["carrier"],
            "tracking_number": parcel["tracking_number"],
            "tracking_url": parcel["tracking_url"],
            "label_key": label_key,
            "status": "label_created",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        },
        ConditionExpression="attribute_not_exists(order_id)",
    )


def update_status(order_id, status):
    table.update_item(
        Key={"order_id": order_id},
        UpdateExpression="SET #s = :s, updated_at = :t",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": status, ":t": now_iso()},
    )


def list_in_transit():
    """Every parcel not yet delivered or returned, oldest update first, through the by-status index."""
    items = []
    for status in IN_TRANSIT:
        query = {
            "IndexName": "by-status",
            "KeyConditionExpression": "#s = :s",
            "ExpressionAttributeNames": {"#s": "status"},
            "ExpressionAttributeValues": {":s": status},
        }
        while True:
            page = table.query(**query)
            items += page["Items"]
            if "LastEvaluatedKey" not in page:
                break
            query["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return items
