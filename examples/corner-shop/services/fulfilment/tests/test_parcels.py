import pytest
from botocore.exceptions import ClientError

import parcels


def test_record_then_find(order, parcel):
    parcels.record_parcel(order, parcel, "labels/2026/CS-2026-000123.pdf")
    found = parcels.find_parcel("ord_1")
    assert found["status"] == "label_created"
    assert found["tracking_number"] == "3STEST000001"


def test_a_parcel_is_recorded_once(order, parcel):
    order = {**order, "orderId": "ord_twice"}
    parcels.record_parcel(order, parcel, "k")
    with pytest.raises(ClientError):
        parcels.record_parcel(order, parcel, "k")


def test_delivered_parcels_leave_the_transit_list(order, parcel):
    order = {**order, "orderId": "ord_delivered"}
    parcels.record_parcel(order, parcel, "k")
    assert any(p["order_id"] == "ord_delivered" for p in parcels.list_in_transit())
    parcels.update_status("ord_delivered", "delivered")
    assert all(p["order_id"] != "ord_delivered" for p in parcels.list_in_transit())


def test_unknown_order_has_no_parcel():
    assert parcels.find_parcel("ord_missing") is None
