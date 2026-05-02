from aiogram.fsm.state import State, StatesGroup


class BuyStates(StatesGroup):
    choosing_coin = State()
    entering_amount = State()
    entering_address = State()
    entering_coupon = State()
    confirming = State()


class SellStates(StatesGroup):
    choosing_coin = State()
    entering_amount = State()
    entering_card = State()
    entering_bank = State()
    entering_fio = State()
    entering_coupon = State()
    confirming = State()


class OrderChatStates(StatesGroup):
    in_order_chat = State()
