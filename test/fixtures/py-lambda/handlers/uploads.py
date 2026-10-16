import os

import boto3

s3 = boto3.client("s3")


def on_upload(event, context):
    key = event["Records"][0]["s3"]["object"]["key"]
    obj = s3.get_object(Bucket=os.environ["UPLOADS_BUCKET"], Key=key)
    s3.put_object(Bucket="shop-archive", Key=key, Body=obj["Body"].read())
    return key
