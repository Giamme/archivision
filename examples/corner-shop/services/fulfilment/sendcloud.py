"""Sendcloud's shipping API: create a parcel with its label, and ask where a parcel is."""
import os

import requests

API_URL = os.environ.get("SENDCLOUD_API_URL", "https://panel.sendcloud.sc/api/v2")
TIMEOUT_SECONDS = 15

# Sendcloud's status ids, mapped to the few states the shop shows
STATUSES = {
    1000: "label_created",
    3: "in_transit",
    5: "in_transit",
    12: "awaiting_pickup",
    11: "delivered",
    62990: "returned",
}


class SendcloudError(Exception):
    """Sendcloud refused the request or did not answer."""


def credentials():
    return (os.environ["SENDCLOUD_PUBLIC_KEY"], os.environ["SENDCLOUD_SECRET_KEY"])


def parcel_weight_kg(order):
    grams = sum(line["weightGrams"] * line["quantity"] for line in order["lines"])
    return max(grams, 100) / 1000


def parcel_request(order):
    """The parcel Sendcloud should create, from an order.confirmed payload (line2 and phone are always there, maybe null)."""
    ship = order["shipping"]
    return {
        "parcel": {
            "name": ship["name"],
            "address": ship["line1"],
            "address_2": ship["line2"] or "",
            "city": ship["city"],
            "postal_code": ship["postalCode"],
            "country": ship["country"],
            "telephone": ship["phone"] or "",
            "email": order["email"],
            "order_number": order["orderNumber"],
            "weight": f"{parcel_weight_kg(order):.3f}",
            "sender_address": int(os.environ["SENDER_ADDRESS_ID"]),
            "request_label": True,
            "apply_shipping_rules": True,
        }
    }


def checked(response):
    if response.status_code >= 400:
        raise SendcloudError(f"Sendcloud answered {response.status_code}: {response.text[:300]}")
    return response


def create_parcel(order):
    """Creates the parcel and downloads its label. Returns what the shop keeps about it."""
    created = checked(requests.post(f"{API_URL}/parcels", json=parcel_request(order), auth=credentials(), timeout=TIMEOUT_SECONDS))
    parcel = created.json()["parcel"]
    label = checked(requests.get(parcel["label"]["label_printer"], auth=credentials(), timeout=TIMEOUT_SECONDS))
    return {
        "sendcloud_id": parcel["id"],
        "carrier": parcel["carrier"]["code"],
        "tracking_number": parcel["tracking_number"],
        "tracking_url": parcel["tracking_url"],
        "label_pdf": label.content,
    }


def parcel_status(sendcloud_id):
    response = checked(requests.get(f"{API_URL}/parcels/{sendcloud_id}", auth=credentials(), timeout=TIMEOUT_SECONDS))
    status_id = response.json()["parcel"]["status"]["id"]
    return STATUSES[status_id] if status_id in STATUSES else "in_transit"
