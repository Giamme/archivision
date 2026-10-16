"""Postmark's email API, with a template alias and a model."""
import os

import requests

API_URL = "https://api.postmarkapp.com/email/withTemplate"
TIMEOUT_SECONDS = 10


class PostmarkError(Exception):
    """Postmark refused the email. 4xx means it will refuse it again; 5xx is worth a retry."""

    def __init__(self, status, detail):
        super().__init__(f"Postmark answered {status}: {detail}")
        self.retry = status >= 500


def send_with_template(to, alias, model, tag):
    """Sends one email; returns Postmark's message id."""
    response = requests.post(
        API_URL,
        json={
            "From": os.environ["FROM_ADDRESS"],
            "To": to,
            "TemplateAlias": alias,
            "TemplateModel": model,
            "Tag": tag,
            "MessageStream": "outbound",
        },
        headers={"Accept": "application/json", "X-Postmark-Server-Token": os.environ["POSTMARK_SERVER_TOKEN"]},
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise PostmarkError(response.status_code, response.text[:300])
    return response.json()["MessageID"]
