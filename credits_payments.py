import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import database as db


router = APIRouter(prefix="/api/credits", tags=["maya-credits"])

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "rzp_live_T0NA0F3UpQiZxl")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
MAYA_CREDIT_PACK_AMOUNT_INR = 99
MAYA_CREDIT_PACK_CREDITS = 300


class CreditOrderRequest(BaseModel):
    session_id: Optional[str] = None
    amount: Optional[int] = MAYA_CREDIT_PACK_AMOUNT_INR
    credits: Optional[int] = MAYA_CREDIT_PACK_CREDITS


class CreditVerifyRequest(BaseModel):
    session_id: Optional[str] = None
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


def _require_razorpay_secret() -> None:
    if not RAZORPAY_KEY_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Razorpay secret is not configured on the server.",
        )


def _razorpay_auth_header() -> str:
    token = f"{RAZORPAY_KEY_ID}:{RAZORPAY_KEY_SECRET}".encode("utf-8")
    return "Basic " + base64.b64encode(token).decode("ascii")


@router.post("/create-order")
def create_credit_order(req: CreditOrderRequest):
    _require_razorpay_secret()

    amount_inr = MAYA_CREDIT_PACK_AMOUNT_INR
    credits = MAYA_CREDIT_PACK_CREDITS
    receipt = f"maya-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    payload = {
        "amount": amount_inr * 100,
        "currency": "INR",
        "receipt": receipt,
        "notes": {
            "product": "Maya Credits",
            "credits": str(credits),
            "session_id": req.session_id or "",
        },
    }

    request = urllib.request.Request(
        "https://api.razorpay.com/v1/orders",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": _razorpay_auth_header(),
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=exc.code, detail=message or "Razorpay order creation failed.")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Razorpay order creation failed: {exc}")

    return {
        "ok": True,
        "key_id": RAZORPAY_KEY_ID,
        "order_id": data.get("id"),
        "amount": data.get("amount", amount_inr * 100),
        "currency": data.get("currency", "INR"),
        "credits": credits,
    }


@router.post("/verify")
def verify_credit_payment(req: CreditVerifyRequest):
    _require_razorpay_secret()

    signed_payload = f"{req.razorpay_order_id}|{req.razorpay_payment_id}".encode("utf-8")
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, req.razorpay_signature):
        raise HTTPException(status_code=400, detail="Payment verification failed.")

    # This previously verified the signature and told the browser "credits added"
    # without ever writing to the database -- credits only ever existed in the
    # browser's localStorage. A cleared cache, new device, or new browser meant a
    # paying customer silently lost what they paid for. Persist it for real now.
    if req.session_id:
        status = db.create_paid_credit_cycle(
            req.session_id,
            MAYA_CREDIT_PACK_AMOUNT_INR,
            credits_to_add=MAYA_CREDIT_PACK_CREDITS,
            razorpay_order_id=req.razorpay_order_id,
            razorpay_payment_id=req.razorpay_payment_id,
        )
        balance = status.get("credits", MAYA_CREDIT_PACK_CREDITS)
    else:
        balance = MAYA_CREDIT_PACK_CREDITS

    return {
        "ok": True,
        "credits": MAYA_CREDIT_PACK_CREDITS,
        "credits_after": balance,
        "paid_credits_balance": balance,
        "credit_status": status if req.session_id else None,
        "message": "300 Maya credits added.",
    }
