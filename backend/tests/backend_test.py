"""Backend API tests for Bhagwati Enterprises Invoice app."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://invoice-builder-138.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Health ----------
def test_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    data = r.json()
    assert "message" in data
    assert "Bhagwati" in data["message"]


# ---------- Next bill no ----------
def test_next_bill_no(session):
    r = session.get(f"{API}/next-bill-no")
    assert r.status_code == 200
    data = r.json()
    assert "next_bill_no" in data
    assert isinstance(data["next_bill_no"], int)
    assert data["next_bill_no"] >= 1


# ---------- Invoice CRUD ----------
@pytest.fixture(scope="module")
def created_invoice_ids():
    return []


def make_payload(customer_name="TEST_Customer A", order_no="TEST_ORD-1", bill_no=None):
    p = {
        "order_no": order_no,
        "customer_name": customer_name,
        "customer_address": "TEST Address Line",
        "invoice_date": "2026-01-15",
        "items": [
            {"date": "15/01", "challan_no": "C1", "items": "Cement Bag", "hsn": "2523", "lorry_no": "MH-01", "qnty": 10, "rate": 350},
            {"date": "15/01", "challan_no": "C2", "items": "Sand", "hsn": "2505", "lorry_no": "MH-02", "qnty": 5, "rate": 200},
        ],
        "cgst_rate": 2.5,
        "sgst_rate": 2.5,
        "payment_within_days": "15",
        "subtotal": 4500,
        "cgst": 112.5,
        "sgst": 112.5,
        "total": 4725,
        "amount_in_words": "Four Thousand Seven Hundred Twenty Five Rupees Only",
    }
    if bill_no is not None:
        p["bill_no"] = bill_no
    return p


def test_create_invoice_auto_bill_no(session, created_invoice_ids):
    next_r = session.get(f"{API}/next-bill-no").json()
    expected = next_r["next_bill_no"]
    payload = make_payload(customer_name="TEST_AutoCust")
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "_id" not in data
    assert data["bill_no"] == expected
    assert data["customer_name"] == "TEST_AutoCust"
    assert data["total"] == 4725
    assert len(data["items"]) == 2
    assert "id" in data
    created_invoice_ids.append(data["id"])

    # Counter should be incremented
    nxt = session.get(f"{API}/next-bill-no").json()["next_bill_no"]
    assert nxt == expected + 1


def test_create_invoice_explicit_bill_no(session, created_invoice_ids):
    cur_next = session.get(f"{API}/next-bill-no").json()["next_bill_no"]
    explicit = cur_next + 100
    payload = make_payload(customer_name="TEST_ExplicitCust", bill_no=explicit)
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["bill_no"] == explicit
    created_invoice_ids.append(data["id"])
    # next-bill-no should now be explicit + 1 (counter $max-ed)
    nxt = session.get(f"{API}/next-bill-no").json()["next_bill_no"]
    assert nxt == explicit + 1


def test_list_invoices_sorted_desc(session, created_invoice_ids):
    r = session.get(f"{API}/invoices")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    bill_nos = [d["bill_no"] for d in data]
    assert bill_nos == sorted(bill_nos, reverse=True)
    for d in data:
        assert "_id" not in d


def test_list_invoices_filter_q(session):
    r = session.get(f"{API}/invoices", params={"q": "TEST_ExplicitCust"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    assert all("TEST_ExplicitCust" in d["customer_name"] or "TEST_ExplicitCust" in d.get("order_no", "") for d in data)


def test_get_invoice_by_id(session, created_invoice_ids):
    inv_id = created_invoice_ids[0]
    r = session.get(f"{API}/invoices/{inv_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == inv_id
    assert "_id" not in data


def test_get_invoice_404(session):
    r = session.get(f"{API}/invoices/non-existent-id-xyz")
    assert r.status_code == 404


def test_update_invoice(session, created_invoice_ids):
    inv_id = created_invoice_ids[0]
    payload = make_payload(customer_name="TEST_UpdatedCust", order_no="TEST_ORD-UPDATED")
    payload["customer_address"] = "TEST Updated Address"
    r = session.put(f"{API}/invoices/{inv_id}", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["customer_name"] == "TEST_UpdatedCust"
    assert data["order_no"] == "TEST_ORD-UPDATED"
    assert "_id" not in data
    # Verify GET reflects updates
    g = session.get(f"{API}/invoices/{inv_id}").json()
    assert g["customer_name"] == "TEST_UpdatedCust"
    assert g["customer_address"] == "TEST Updated Address"


def test_update_invoice_404(session):
    r = session.put(f"{API}/invoices/no-such-id", json=make_payload())
    assert r.status_code == 404


# ---------- Customers ----------
def test_customer_autosaved_after_invoice(session):
    r = session.get(f"{API}/customers")
    assert r.status_code == 200
    customers = r.json()
    names = [c["name"] for c in customers]
    assert "TEST_UpdatedCust" in names or "TEST_AutoCust" in names or "TEST_ExplicitCust" in names
    for c in customers:
        assert "_id" not in c


def test_create_customer_idempotent(session):
    payload = {"name": "TEST_DirectCust", "address": "TEST Direct Addr"}
    r1 = session.post(f"{API}/customers", json=payload)
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["name"] == "TEST_DirectCust"
    r2 = session.post(f"{API}/customers", json=payload)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["id"] == d1["id"]  # same record returned


# ---------- Delete ----------
def test_delete_invoice(session, created_invoice_ids):
    # Delete all created invoices
    for inv_id in list(created_invoice_ids):
        r = session.delete(f"{API}/invoices/{inv_id}")
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        # GET should now 404
        g = session.get(f"{API}/invoices/{inv_id}")
        assert g.status_code == 404
        created_invoice_ids.remove(inv_id)


def test_delete_invoice_404(session):
    r = session.delete(f"{API}/invoices/non-existent-id-xyz")
    assert r.status_code == 404


# ---------- Cleanup customers ----------
def test_zz_cleanup_test_customers(session):
    """Best-effort cleanup of TEST_ customers via Mongo if exposed - else skip."""
    # No delete endpoint for customers, just verify they exist (no-op cleanup)
    r = session.get(f"{API}/customers")
    assert r.status_code == 200
