import json

from lib.store import save_order, load_order
from lib.util import money as fmt_money


def create(event, context):
    body = json.loads(event["body"])
    save_order(body)
    return {"statusCode": 201, "body": fmt_money(body["total"])}


def get(event, context):
    return {"statusCode": 200, "body": json.dumps(load_order(event["pathParameters"]["id"]))}
