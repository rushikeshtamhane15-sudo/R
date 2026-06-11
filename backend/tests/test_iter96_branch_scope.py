"""iter-96 backend tests: branch-scope for takeaway-pendency & restaurant orders,
plus franchise_owner write-protection on /admin/messes endpoints.

Bugs fixed in iter-96:
  (1) /admin/messes UI showed HQ-only controls to franchise_owner — backend
      already returns 403 on POST/PATCH/PUT (we re-verify).
  (2) /admin/restaurant/takeaway-pendency was global — now branch-scoped by
      user_id ∈ users-in-mess. FR cross-branch collect → 403.
  (3) /admin/restaurant/orders was global — now branch-scoped likewise.

All test data prefixed TEST_IT96_* and removed on teardown.
"""

import datetime as dt
import os
import uuid

import pymongo
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

MESS_A = "efoodcare-amravati"
MESS_B = "efoodcare-yavatmal"


def _iso():
    return dt.datetime.utcnow().isoformat() + "Z"


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def mongo():
    client = pymongo.MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _seed_user(mongo, *, role, mess_id=None):
    uid = f"TEST_IT96_{role}_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_IT96_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": f"Iter96 {role}",
        "role": role,
        "wallet_balance": 0,
        "created_at": _iso(),
    }
    if mess_id:
        doc["mess_id"] = mess_id
    mongo.users.insert_one(doc)
    mongo.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": "2099-01-01T00:00:00Z",
        "created_at": _iso(),
    })
    return uid, tok


@pytest.fixture(scope="module", autouse=True)
def world(mongo):
    # Snapshot original owner so we can restore on teardown
    orig_a = mongo.messes.find_one({"mess_id": MESS_A}) or {}
    orig_owner_a = orig_a.get("owner_user_id")
    yavatmal_existed_before = bool(mongo.messes.find_one({"mess_id": MESS_B}))

    admin_uid, admin_tok = _seed_user(mongo, role="admin")
    fr_uid, fr_tok = _seed_user(mongo, role="franchise_owner", mess_id=MESS_A)

    # Make sure both messes exist; rebind MESS_A owner to our FR
    mongo.messes.update_one({"mess_id": MESS_A},
                            {"$set": {"name": "Amravati", "active": True,
                                      "owner_user_id": fr_uid}},
                            upsert=True)
    mongo.messes.update_one({"mess_id": MESS_B},
                            {"$set": {"name": "Yavatmal", "slug": MESS_B, "active": True,
                                      "_iter96_seeded": not yavatmal_existed_before}},
                            upsert=True)

    in_uid, _ = _seed_user(mongo, role="subscriber", mess_id=MESS_A)
    out_uid, _ = _seed_user(mongo, role="subscriber", mess_id=MESS_B)

    # Seed restaurant_orders: 2 in Amravati (in_uid), 0 in Yavatmal
    order_ids = []
    for _ in range(2):
        oid = f"TEST_IT96_rest_{uuid.uuid4().hex[:10]}"
        order_ids.append(oid)
        mongo.restaurant_orders.insert_one({
            "order_id": oid, "user_id": in_uid, "status": "paid",
            "total": 250.0, "items": [{"name": "Thali", "qty": 1, "price": 250}],
            "created_at": _iso(),
        })

    # Seed takeaway pendency rows: 2 in Amravati, 0 in Yavatmal
    pend_ids = {"in_a": [], "in_b": []}
    for _ in range(2):
        pid = f"TEST_IT96_pend_{uuid.uuid4().hex[:10]}"
        pend_ids["in_a"].append(pid)
        mongo.restaurant_tiffin_pendency.insert_one({
            "pendency_id": pid, "user_id": in_uid, "tiffin_count": 1,
            "collected": False, "delivered_at": _iso(),
        })

    # one pendency owned by an out-of-mess (yavatmal) user, for cross-branch FR collect test
    cross_pid = f"TEST_IT96_pend_{uuid.uuid4().hex[:10]}"
    pend_ids["in_b"].append(cross_pid)
    mongo.restaurant_tiffin_pendency.insert_one({
        "pendency_id": cross_pid, "user_id": out_uid, "tiffin_count": 1,
        "collected": False, "delivered_at": _iso(),
    })

    yield {
        "admin_tok": admin_tok, "fr_tok": fr_tok,
        "admin_uid": admin_uid, "fr_uid": fr_uid,
        "in_uid": in_uid, "out_uid": out_uid,
        "order_ids": order_ids,
        "pend_in_a": pend_ids["in_a"],
        "pend_in_b": pend_ids["in_b"],
    }

    # Teardown
    mongo.users.delete_many({"user_id": {"$regex": "^TEST_IT96_"}})
    mongo.user_sessions.delete_many({"session_token": {"$regex": "^TEST_IT96_"}})
    mongo.restaurant_orders.delete_many({"order_id": {"$regex": "^TEST_IT96_"}})
    mongo.restaurant_tiffin_pendency.delete_many({"pendency_id": {"$regex": "^TEST_IT96_"}})
    # Drop Yavatmal mess only if we created it
    if not yavatmal_existed_before:
        mongo.messes.delete_one({"mess_id": MESS_B, "_iter96_seeded": True})
    # Restore MESS_A owner
    if orig_owner_a:
        mongo.messes.update_one({"mess_id": MESS_A}, {"$set": {"owner_user_id": orig_owner_a}})
    else:
        mongo.messes.update_one({"mess_id": MESS_A}, {"$unset": {"owner_user_id": ""}})


# ---------------------------------------------------------------------------
# (1) Takeaway pendency — branch scope
# ---------------------------------------------------------------------------
class TestTakeawayPendencyScope:
    def test_fr_sees_only_branch_pendency(self, world):
        r = requests.get(f"{API}/admin/restaurant/takeaway-pendency", headers=_hdr(world["fr_tok"]))
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body.get("rows") or []
        ids = {r["pendency_id"] for r in rows}
        # All FR-seeded amravati rows visible
        assert set(world["pend_in_a"]).issubset(ids), f"FR missing in-branch rows; got {ids}"
        # Yavatmal cross-branch row NOT visible
        for cross in world["pend_in_b"]:
            assert cross not in ids, "FR leaked cross-branch pendency"
        # response shape echoes scope & mess_id
        assert body.get("scope") == "branch"
        assert body.get("mess_id") == MESS_A

    def test_admin_as_yavatmal_returns_only_yavatmal(self, world):
        r = requests.get(f"{API}/admin/restaurant/takeaway-pendency?as_mess_id={MESS_B}",
                         headers=_hdr(world["admin_tok"]))
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body.get("rows") or []
        # only Yavatmal user's pendency should be present
        for row in rows:
            assert row.get("user_id") == world["out_uid"], (
                f"Yavatmal admin view leaked non-yavatmal user_id={row.get('user_id')}"
            )
        assert body.get("scope") == "branch"
        assert body.get("mess_id") == MESS_B

    def test_admin_as_amravati_includes_seeded_rows(self, world):
        r = requests.get(f"{API}/admin/restaurant/takeaway-pendency?as_mess_id={MESS_A}",
                         headers=_hdr(world["admin_tok"]))
        assert r.status_code == 200, r.text
        body = r.json()
        ids = {row["pendency_id"] for row in (body.get("rows") or [])}
        assert set(world["pend_in_a"]).issubset(ids)
        assert body.get("scope") == "branch"
        assert body.get("mess_id") == MESS_A

    def test_admin_no_param_returns_global(self, world):
        r = requests.get(f"{API}/admin/restaurant/takeaway-pendency", headers=_hdr(world["admin_tok"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("scope") == "global"
        assert body.get("mess_id") is None


# ---------------------------------------------------------------------------
# (2) Takeaway pendency collect — FR cannot collect cross-branch
# ---------------------------------------------------------------------------
class TestTakeawayCollectScope:
    def test_fr_cross_branch_collect_blocked_403(self, world):
        cross_id = world["pend_in_b"][0]
        r = requests.post(f"{API}/admin/restaurant/takeaway-pendency/collect",
                          json={"pendency_id": cross_id},
                          headers=_hdr(world["fr_tok"]))
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        assert "your branch" in (r.json().get("detail") or "").lower() or \
               "branch" in (r.json().get("detail") or "").lower()

    def test_fr_in_branch_collect_ok(self, world, mongo):
        in_id = world["pend_in_a"][0]
        r = requests.post(f"{API}/admin/restaurant/takeaway-pendency/collect",
                          json={"pendency_id": in_id, "notes": "TEST_IT96"},
                          headers=_hdr(world["fr_tok"]))
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # verify persisted
        doc = mongo.restaurant_tiffin_pendency.find_one({"pendency_id": in_id}, {"_id": 0})
        assert doc and doc.get("collected") is True


# ---------------------------------------------------------------------------
# (3) Restaurant orders — branch scope
# ---------------------------------------------------------------------------
class TestRestaurantOrdersScope:
    def test_fr_sees_only_branch_orders(self, world):
        r = requests.get(f"{API}/admin/restaurant/orders", headers=_hdr(world["fr_tok"]))
        assert r.status_code == 200, r.text
        body = r.json()
        orders = body.get("orders") or []
        user_ids = {o.get("user_id") for o in orders}
        # All orders must be from Amravati users only
        for uid in user_ids:
            if uid is None:
                continue
            assert uid != world["out_uid"], "FR leaked Yavatmal order"
        # Our seeded orders are visible
        ids = {o.get("order_id") for o in orders}
        assert set(world["order_ids"]).issubset(ids)
        assert body.get("scope") == "branch"
        assert body.get("mess_id") == MESS_A

    def test_admin_as_yavatmal_zero_orders(self, world):
        r = requests.get(f"{API}/admin/restaurant/orders?as_mess_id={MESS_B}",
                         headers=_hdr(world["admin_tok"]))
        assert r.status_code == 200, r.text
        body = r.json()
        orders = body.get("orders") or []
        # Yavatmal seeded user has no orders
        for o in orders:
            assert o.get("user_id") != world["in_uid"], "Yavatmal view leaked Amravati order"
        assert body.get("scope") == "branch"
        assert body.get("mess_id") == MESS_B

    def test_admin_as_amravati_includes_seeded(self, world):
        r = requests.get(f"{API}/admin/restaurant/orders?as_mess_id={MESS_A}",
                         headers=_hdr(world["admin_tok"]))
        assert r.status_code == 200, r.text
        body = r.json()
        ids = {o.get("order_id") for o in (body.get("orders") or [])}
        assert set(world["order_ids"]).issubset(ids)
        assert body.get("scope") == "branch"
        assert body.get("mess_id") == MESS_A

    def test_admin_no_param_returns_global(self, world):
        r = requests.get(f"{API}/admin/restaurant/orders", headers=_hdr(world["admin_tok"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("scope") == "global"
        assert body.get("mess_id") is None
        # global view contains seeded orders too
        ids = {o.get("order_id") for o in (body.get("orders") or [])}
        assert set(world["order_ids"]).issubset(ids)


# ---------------------------------------------------------------------------
# (4) /admin/messes write-protection for franchise_owner
# ---------------------------------------------------------------------------
class TestFranchiseMessWriteProtection:
    # iter-96: a payload that satisfies MessIn's pydantic validation so the
    # response is the auth check (403), not a pre-auth 422.
    VALID_PAYLOAD = {
        "slug": "TEST_IT96_branch_block",
        "name": "Test branch",
        "tagline": "tag",
        "address": "Test address line",
        "city": "TestCity",
        "state": "Maharashtra",
        "country": "IN",
        "pincode": "444601",
        "is_franchise": True,
    }

    def test_fr_post_messes_403_not_422(self, world):
        r = requests.post(f"{API}/admin/messes", json=self.VALID_PAYLOAD,
                          headers=_hdr(world["fr_tok"]))
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"
        assert "admin only" in (r.json().get("detail") or "").lower()

    def test_fr_put_messes_403(self, world):
        payload = {**self.VALID_PAYLOAD, "slug": "TEST_IT96_put_block"}
        r = requests.put(f"{API}/admin/messes/{MESS_A}", json=payload,
                         headers=_hdr(world["fr_tok"]))
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_fr_assign_owner_blocked(self, world):
        # Real endpoint is PATCH /admin/messes/{id}/owner; spec also mentions POST.
        # Either way the FR must NOT succeed — accept 403 (auth) or 405 (method).
        body = {"owner_user_id": world["fr_uid"]}
        r_patch = requests.patch(f"{API}/admin/messes/{MESS_A}/owner", json=body,
                                 headers=_hdr(world["fr_tok"]))
        assert r_patch.status_code == 403, f"PATCH expected 403, got {r_patch.status_code}: {r_patch.text[:200]}"
        r_post = requests.post(f"{API}/admin/messes/{MESS_A}/owner", json=body,
                               headers=_hdr(world["fr_tok"]))
        assert r_post.status_code in (403, 404, 405), \
            f"POST expected 403/404/405, got {r_post.status_code}"

    def test_admin_post_messes_works(self, world, mongo):
        slug = f"TEST_IT96_admin_create_{uuid.uuid4().hex[:6]}"
        payload = {
            "slug": slug, "name": "Admin-created", "tagline": "tag",
            "address": "Admin address line", "city": "TestCity",
            "state": "Maharashtra", "country": "IN", "pincode": "444601",
            "is_franchise": True,
        }
        r = requests.post(f"{API}/admin/messes", json=payload, headers=_hdr(world["admin_tok"]))
        assert r.status_code == 200, r.text
        out = r.json()
        assert out.get("slug") == slug
        # cleanup
        mongo.messes.delete_one({"mess_id": out.get("mess_id")})
