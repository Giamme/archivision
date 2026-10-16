"""The sent_emails table: one item per email sent, so a message SQS delivers twice is sent once.

An email is claimed before it is sent and marked after; a claim left behind by a Lambda that died between the two
expires after CLAIM_SECONDS, and the next delivery sends it.
"""
import os
import time

import boto3
from botocore.exceptions import ClientError

SENT_EMAILS_TABLE = os.environ["SENT_EMAILS_TABLE"]
table = boto3.resource("dynamodb").Table(SENT_EMAILS_TABLE)

CLAIM_SECONDS = 120
KEEP_DAYS = 90


def message_key(template, reference):
    return f"{template}#{reference}"


def claim(key):
    """True when this caller may send the email: nobody sent it, and no one else is sending it right now."""
    now = int(time.time())
    try:
        table.put_item(
            Item={"message_key": key, "state": "sending", "claimed_at": now, "expires_at": now + KEEP_DAYS * 86400},
            ConditionExpression="attribute_not_exists(message_key) OR (#st = :sending AND claimed_at < :stale)",
            ExpressionAttributeNames={"#st": "state"},
            ExpressionAttributeValues={":sending": "sending", ":stale": now - CLAIM_SECONDS},
        )
        return True
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def release(key):
    """Gives a claim back after a failed send, so SQS's next delivery can try again straight away."""
    try:
        table.delete_item(
            Key={"message_key": key},
            ConditionExpression="#st = :sending",
            ExpressionAttributeNames={"#st": "state"},
            ExpressionAttributeValues={":sending": "sending"},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise


def mark_sent(key, postmark_id):
    table.update_item(
        Key={"message_key": key},
        UpdateExpression="SET #st = :sent, postmark_id = :id, sent_at = :at",
        ExpressionAttributeNames={"#st": "state"},
        ExpressionAttributeValues={":sent": "sent", ":id": postmark_id, ":at": int(time.time())},
    )


def was_sent(key):
    response = table.get_item(Key={"message_key": key})
    return "Item" in response and response["Item"]["state"] == "sent"
