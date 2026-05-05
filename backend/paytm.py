"""
Paytm for Business — Dynamic QR / UPI payment integration helpers.

Encapsulates:
  - AES + SHA256 checksum generation/verification (Paytm's proprietary scheme)
  - Create Dynamic QR Code API call
  - Transaction Status polling
  - Webhook signature verification

Mirrors the reference Python SDK behaviour so generated checksums validate
against Paytm's servers verbatim.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import random
import string
from typing import Any

import httpx
from Crypto.Cipher import AES

# Paytm IV is a public constant from their SDK
_IV = b"@@@@&&&&####$$$$"
_BLOCK = 16


def _pad(data: str) -> bytes:
    pad = _BLOCK - (len(data) % _BLOCK)
    return (data + chr(pad) * pad).encode()


def _unpad(data: bytes) -> str:
    pad = data[-1]
    return data[:-pad].decode()


def _aes_encrypt(data: str, key: str) -> str:
    cipher = AES.new(key.encode("utf-8"), AES.MODE_CBC, _IV)
    return base64.b64encode(cipher.encrypt(_pad(data))).decode()


def _aes_decrypt(data: str, key: str) -> str:
    cipher = AES.new(key.encode("utf-8"), AES.MODE_CBC, _IV)
    return _unpad(cipher.decrypt(base64.b64decode(data)))


def _salt(length: int = 4) -> str:
    alpha = string.ascii_letters + string.digits
    return "".join(random.choice(alpha) for _ in range(length))


def generate_checksum(body: dict | str, merchant_key: str) -> str:
    """Return Paytm checksum for a given body + merchant key."""
    payload = body if isinstance(body, str) else json.dumps(body, separators=(",", ":"), sort_keys=True)
    salt = _salt(4)
    hashed = hashlib.sha256(f"{payload}|{salt}".encode()).hexdigest()
    return _aes_encrypt(hashed + salt, merchant_key)


def verify_checksum(body: dict | str, merchant_key: str, checksum: str) -> bool:
    """Verify checksum returned by Paytm in a webhook or API response."""
    try:
        payload = body if isinstance(body, str) else json.dumps(body, separators=(",", ":"), sort_keys=True)
        decrypted = _aes_decrypt(checksum, merchant_key)
        salt = decrypted[-4:]
        received = decrypted[:-4]
        expected = hashlib.sha256(f"{payload}|{salt}".encode()).hexdigest()
        return hmac.compare_digest(received, expected)
    except Exception:
        return False


class PaytmClient:
    """Thin wrapper around Paytm's Dynamic QR + Transaction Status endpoints."""

    STAGING = "https://securegw-stage.paytm.in"
    PRODUCTION = "https://securegw.paytm.in"

    def __init__(
        self,
        merchant_id: str,
        merchant_key: str,
        client_id: str = "C11",
        environment: str = "staging",
    ):
        self.mid = merchant_id
        self.key = merchant_key
        self.client_id = client_id
        self.base_url = self.PRODUCTION if environment.lower() == "production" else self.STAGING

    @property
    def enabled(self) -> bool:
        return bool(self.mid and self.key)

    async def create_dynamic_qr(self, order_id: str, amount: float, pos_id: str = "S1_POS1", notes: str | None = None) -> dict:
        body = {
            "mid": self.mid,
            "orderId": order_id,
            "amount": f"{amount:.2f}",
            "businessType": "UPI_QR_CODE",
            "posId": pos_id,
            "orderDetails": notes or f"Order {order_id}",
        }
        head = {"clientId": self.client_id, "version": "v1", "signature": generate_checksum(body, self.key)}
        url = f"{self.base_url}/paymentservices/qr/create"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, json={"body": body, "head": head}, headers={"Content-Type": "application/json"})
            r.raise_for_status()
            return r.json()

    async def get_order_status(self, order_id: str) -> dict:
        body = {"mid": self.mid, "orderId": order_id}
        head = {"signature": generate_checksum(body, self.key), "version": "v1"}
        url = f"{self.base_url}/v3/order/status"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, json={"body": body, "head": head}, headers={"Content-Type": "application/json"})
            r.raise_for_status()
            return r.json()


def client_from_env() -> PaytmClient:
    return PaytmClient(
        merchant_id=os.environ.get("PAYTM_MERCHANT_ID", ""),
        merchant_key=os.environ.get("PAYTM_MERCHANT_KEY", ""),
        client_id=os.environ.get("PAYTM_CLIENT_ID", "C11"),
        environment=os.environ.get("PAYTM_ENVIRONMENT", "staging"),
    )
