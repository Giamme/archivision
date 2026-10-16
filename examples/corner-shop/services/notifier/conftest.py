"""moto stands in for DynamoDB before the service's modules are imported."""
import os

import boto3
import pytest
from moto import mock_aws

os.environ.update(
    {
        "AWS_DEFAULT_REGION": "eu-west-1",
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "SENT_EMAILS_TABLE": "sent_emails",
        "FROM_ADDRESS": "Corner Shop <orders@example.com>",
        "POSTMARK_SERVER_TOKEN": "POSTMARK_API_TEST",
        "SHOP_URL": "https://shop.example.com",
    }
)

AWS = mock_aws()
AWS.start()
boto3.client("dynamodb").create_table(
    TableName="sent_emails",
    BillingMode="PAY_PER_REQUEST",
    AttributeDefinitions=[{"AttributeName": "message_key", "AttributeType": "S"}],
    KeySchema=[{"AttributeName": "message_key", "KeyType": "HASH"}],
)


@pytest.fixture
def order():
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
def shipped():
    return {
        "orderId": "ord_1",
        "orderNumber": "CS-2026-000123",
        "email": "customer@example.com",
        "carrier": "postnl",
        "trackingNumber": "3STEST000001",
        "trackingUrl": "https://tracking.example.com/3STEST000001",
        "shippedAt": "2026-10-02T14:00:00Z",
    }
