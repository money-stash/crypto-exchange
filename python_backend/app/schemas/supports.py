from pydantic import BaseModel
from typing import Optional
from decimal import Decimal


class SupportOut(BaseModel):
    id: int
    login: Optional[str] = None
    role: Optional[str] = None
    manager_id: Optional[int] = None
    chat_language: str = "RU"
    can_write_chat: int = 1
    can_cancel_order: int = 1
    can_edit_requisites: int = 1
    can_use_coupons: int = 0
    is_active: Optional[bool] = None
    active_limit: Optional[int] = None
    rate_percent: Optional[Decimal] = None
    rating: Optional[int] = None
    deposit: Optional[Decimal] = None
    deposit_paid: Optional[Decimal] = None
    deposit_work: Optional[Decimal] = None

    model_config = {"from_attributes": True}


class SupportCreateRequest(BaseModel):
    login: str
    password: str
    role: str
    deposit_paid: float = 0
    deposit_work: Optional[float] = None
    deposit: Optional[float] = None
    rate_percent: float = 0
    chat_language: str = "RU"
    can_write_chat: int = 1
    can_cancel_order: int = 1
    can_edit_requisites: int = 1
    can_use_coupons: int = 0


class SupportUpdateRequest(BaseModel):
    login: str
    role: str
    password: Optional[str] = None
    deposit_paid: float = 0
    deposit_work: Optional[float] = None
    deposit: Optional[float] = None
    rate_percent: Optional[float] = None
    chat_language: Optional[str] = None
    can_write_chat: Optional[int] = None
    can_cancel_order: Optional[int] = None
    can_edit_requisites: Optional[int] = None
    can_use_coupons: Optional[int] = None


class StatusUpdateRequest(BaseModel):
    status: str  # "active" | "offline"


class MaxOrdersUpdateRequest(BaseModel):
    maxOrders: int


class DepositUpdateRequest(BaseModel):
    deposit_paid: Optional[float] = None
    deposit_work: Optional[float] = None
    deposit: Optional[float] = None


    
