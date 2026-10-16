import sent


def test_an_email_is_claimed_once():
    key = sent.message_key("order-confirmed", "ord_claim")
    assert sent.claim(key) is True
    assert sent.claim(key) is False


def test_marked_emails_count_as_sent():
    key = sent.message_key("parcel-on-its-way", "ord_mark")
    sent.claim(key)
    assert sent.was_sent(key) is False
    sent.mark_sent(key, "pm-123")
    assert sent.was_sent(key) is True
    assert sent.claim(key) is False


def test_a_released_claim_can_be_taken_again():
    key = sent.message_key("order-confirmed", "ord_release")
    assert sent.claim(key) is True
    sent.release(key)
    assert sent.claim(key) is True
