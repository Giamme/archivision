"""The two emails the notifier sends. The layouts live in Postmark (by alias); this module builds their models."""
import os

ORDER_CONFIRMED = "order-confirmed"
PARCEL_ON_ITS_WAY = "parcel-on-its-way"

SHOP_URL = os.environ.get("SHOP_URL", "https://shop.example.com")
SYMBOLS = {"EUR": "€", "GBP": "£", "SEK": "kr ", "DKK": "kr "}


def money(cents, currency):
    symbol = SYMBOLS[currency] if currency in SYMBOLS else currency + " "
    return f"{symbol}{cents // 100}.{cents % 100:02d}"


def order_confirmed_model(order):
    """The model of the order-confirmed template, from an order.confirmed payload."""
    ship = order["shipping"]
    return {
        "order_number": order["orderNumber"],
        "total": money(order["totalCents"], order["currency"]),
        "lines": [{"name": line["name"], "quantity": line["quantity"], "total": money(line["totalCents"], order["currency"])} for line in order["lines"]],
        "ship_to": f"{ship['name']}, {ship['line1']}, {ship['postalCode']} {ship['city']}",
        "order_url": f"{SHOP_URL}/account/orders/{order['orderId']}",
    }


def parcel_on_its_way_model(parcel):
    """The model of the parcel-on-its-way template, from a parcel.shipped payload."""
    return {
        "order_number": parcel["orderNumber"],
        "carrier": parcel["carrier"].upper(),
        "tracking_number": parcel["trackingNumber"],
        "tracking_url": parcel["trackingUrl"],
    }
