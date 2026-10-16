"""Shipping labels, kept in S3 for reprints from the back office and for the warehouse's label printer."""
import os

import boto3

LABELS_BUCKET = os.environ["LABELS_BUCKET"]
s3 = boto3.client("s3")


def label_key(order_number):
    """labels/2026/CS-2026-000123.pdf: one folder per year, so old labels expire by lifecycle rule."""
    year = order_number[3:7]
    return f"labels/{year}/{order_number}.pdf"


def store_label(order_number, pdf):
    key = label_key(order_number)
    s3.put_object(Bucket=LABELS_BUCKET, Key=key, Body=pdf, ContentType="application/pdf", ServerSideEncryption="AES256")
    return key


def read_label(key):
    response = s3.get_object(Bucket=LABELS_BUCKET, Key=key)
    return response["Body"].read()
