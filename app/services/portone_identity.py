from __future__ import annotations

from fastapi import HTTPException


def parse_portone_identity_verification(verification: dict) -> dict:
    if verification.get("status") != "VERIFIED":
        raise HTTPException(status_code=409, detail="본인인증이 아직 완료되지 않았습니다.")

    verified_customer = verification.get("verifiedCustomer") or {}
    phone = str(verified_customer.get("phoneNumber") or "").strip() or None
    name = str(verified_customer.get("name") or "").strip() or None

    return {
        "name": name,
        "phone": phone,
        "verified_customer": {
            "name": verified_customer.get("name"),
            "phoneNumber": verified_customer.get("phoneNumber"),
            "birthDate": verified_customer.get("birthDate"),
            "gender": verified_customer.get("gender"),
            "ci": verified_customer.get("ci"),
            "di": verified_customer.get("di"),
        },
    }
