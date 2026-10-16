import os

import boto3

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["ORDERS_TABLE"])
sqs = boto3.client("sqs")


def save_order(order):
    table.put_item(Item=order)
    sqs.send_message(QueueUrl=os.environ["JOBS_QUEUE"], MessageBody=order["id"])


def load_order(order_id):
    return table.get_item(Key={"id": order_id}).get("Item")


def archive(client, key):
    # a client passed in: the scan cannot tell which store it is
    client.put_object(Bucket="shop-archive", Key=key)
