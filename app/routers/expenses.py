from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.admin_auth import require_admin_permission
from app.models.admin_models import AdminUser
from app.services.expense_store import (
    create_expense_category,
    create_expense_record,
    delete_expense_category,
    delete_expense_record,
    get_expense_category,
    get_expense_record,
    list_expense_categories,
    list_expense_records,
    update_expense_category,
    update_expense_record,
)

router = APIRouter(prefix="/api/admin/expenses", tags=["admin-expenses"])

ExpensesAdminAuth = Annotated[AdminUser, Depends(require_admin_permission("menu:expenses"))]


class ExpenseCategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort_order: int | None = None


class ExpenseCategoryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sort_order: int | None = None
    is_active: bool | None = None


class ExpenseRecordCreateRequest(BaseModel):
    category_id: int = Field(ge=1)
    amount: float = Field(gt=0)
    expense_date: date
    note: str | None = Field(default=None, max_length=255)


class ExpenseRecordUpdateRequest(BaseModel):
    category_id: int | None = Field(default=None, ge=1)
    amount: float | None = Field(default=None, gt=0)
    expense_date: date | None = None
    note: str | None = Field(default=None, max_length=255)


@router.get("")
def get_expenses_overview(
    db: Annotated[Session, Depends(get_db)],
    _admin: ExpensesAdminAuth,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> dict:
    return {
        "categories": list_expense_categories(db),
        "records": list_expense_records(db, date_from=date_from, date_to=date_to),
    }


@router.post("/categories")
def post_expense_category(
    body: ExpenseCategoryCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: ExpensesAdminAuth,
) -> dict:
    try:
        row = create_expense_category(db, name=body.name, sort_order=body.sort_order)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"category": {"id": row.id, "name": row.name, "sort_order": row.sort_order, "is_active": bool(row.is_active)}}


@router.patch("/categories/{category_id}")
def patch_expense_category(
    category_id: int,
    body: ExpenseCategoryUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: ExpensesAdminAuth,
) -> dict:
    category = get_expense_category(db, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="지출항목을 찾을 수 없습니다.")
    payload = body.model_dump(exclude_unset=True)
    try:
        row = update_expense_category(db, category, **payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "category": {
            "id": row.id,
            "name": row.name,
            "sort_order": row.sort_order,
            "is_active": bool(row.is_active),
        }
    }


@router.delete("/categories/{category_id}")
def remove_expense_category(
    category_id: int,
    db: Annotated[Session, Depends(get_db)],
    _admin: ExpensesAdminAuth,
) -> dict:
    category = get_expense_category(db, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="지출항목을 찾을 수 없습니다.")
    try:
        delete_expense_category(db, category)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/records")
def post_expense_record(
    body: ExpenseRecordCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: ExpensesAdminAuth,
) -> dict:
    try:
        row = create_expense_record(
            db,
            category_id=body.category_id,
            amount=body.amount,
            expense_date=body.expense_date,
            note=body.note,
            admin=admin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "record": {
            "id": row.id,
            "category_id": row.category_id,
            "category_name": row.category.name if row.category else "",
            "amount": float(row.amount or 0),
            "expense_date": row.expense_date.isoformat(),
            "note": row.note or "",
        }
    }


@router.patch("/records/{record_id}")
def patch_expense_record(
    record_id: int,
    body: ExpenseRecordUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: ExpensesAdminAuth,
) -> dict:
    record = get_expense_record(db, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="지출 내역을 찾을 수 없습니다.")
    if record.source_type:
        raise HTTPException(status_code=409, detail="자동 연동된 지출은 수정할 수 없습니다.")
    payload = body.model_dump(exclude_unset=True)
    try:
        row = update_expense_record(db, record, **payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "record": {
            "id": row.id,
            "category_id": row.category_id,
            "category_name": row.category.name if row.category else "",
            "amount": float(row.amount or 0),
            "expense_date": row.expense_date.isoformat(),
            "note": row.note or "",
        }
    }


@router.delete("/records/{record_id}")
def remove_expense_record(
    record_id: int,
    db: Annotated[Session, Depends(get_db)],
    _admin: ExpensesAdminAuth,
) -> dict:
    record = get_expense_record(db, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="지출 내역을 찾을 수 없습니다.")
    try:
        delete_expense_record(db, record)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True}
