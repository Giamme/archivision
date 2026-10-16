"""Fake AWS for the tests: moto starts before the service's modules are imported, so their module-level clients,
table and queue are moto's."""
import os

import boto3
import pytest
from moto import mock_aws

os.environ.update(
    {
        "AWS_DEFAULT_REGION": "eu-west-1",
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "LABELS_BUCKET": "corner-shop-labels",
        "PARCELS_TABLE": "parcels",
        "EVENTS_OUTBOX_QUEUE": "corner-shop-events-outbox",
        "SENDCLOUD_PUBLIC_KEY": "test-public",
        "SENDCLOUD_SECRET_KEY": "test-secret",
        "SENDER_ADDRESS_ID": "1",
    }
)

AWS = mock_aws()
AWS.start()
boto3.client("s3").create_bucket(Bucket="corner-shop-labels", CreateBucketConfiguration={"LocationConstraint": "eu-west-1"})
boto3.client("sqs").create_queue(QueueName="corner-shop-events-outbox")
boto3.client("dynamodb").create_table(
    TableName="parcels",
    BillingMode="PAY_PER_REQUEST",
    AttributeDefinitions=[
        {"AttributeName": "order_id", "AttributeType": "S"},
        {"AttributeName": "status", "AttributeType": "S"},
        {"AttributeName": "updated_at", "AttributeType": "S"},
    ],
    KeySchema=[{"AttributeName": "order_id", "KeyType": "HASH"}],
    GlobalSecondaryIndexes=[
        {
            "IndexName": "by-status",
            "KeySchema": [{"AttributeName": "status", "KeyType": "HASH"}, {"AttributeName": "updated_at", "KeyType": "RANGE"}],
            "Projection": {"ProjectionType": "ALL"},
        }
    ],
)


@pytest.fixture
def order():
    """An order.confirmed payload as @corner/orders publishes it."""
    return {
        "orderId": "ord_1",
        "orderNumber": "CS-2026-000123",
        "email": "customer@example.com",
        "totalCents": 3295,
        "currency": "EUR",
        "shipping": {"name": "Sam Example", "line1": "1 Sample Street", "line2": None, "city": "Dublin", "postalCode": "D02 XY00", "country": "IE", "phone": None},
        "lines": [{"sku": "MUG-SAND", "name": "Stoneware mug – Sand", "quantity": 2, "weightGrams": 380, "totalCents": 2800}],
        "placedAt": "2026-10-01T09:30:00Z",
    }


@pytest.fixture
def parcel():
    return {
        "sendcloud_id": 9001,
        "carrier": "postnl",
        "tracking_number": "3STEST000001",
        "tracking_url": "https://tracking.example.com/3STEST000001",
        "label_pdf": b"%PDF-1.4 test",
    }
