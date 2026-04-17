from pydantic import BaseModel
from typing import Optional


class LoginRequest(BaseModel):
    login: str
    password: str


class UserOut(BaseModel):
    id: int
    login: str
    role: str
    manager_id: Optional[int] = None
    chat_language: str = "RU"
    can_write_chat: int = 1
    can_cancel_order: int = 1
    can_edit_requisites: int = 1
    rating: Optional[int] = None
    active_limit: Optional[int] = None
    is_active: Optional[bool] = None

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    token: str
    user: UserOut


class TokenResponse(BaseModel):
    token: str


    
