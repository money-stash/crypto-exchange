from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24 hours
    AES_KEY_HEX: str
    OPENAI_API_KEY: str = ""
    ORDER_LOG_BOT_TOKEN: str = ""
    OPERATOR_ALERT_BOT_TOKEN: str = ""
    MANAGER_ALERT_BOT_TOKEN: str = ""
    ACTIVATION_ALERT_BOT_TOKEN: str = ""
    BYBIT_API_BASE: str = "https://api.bybit.com"
    BYBIT_P2P_API_URL: str = "https://api2.bybit.com/fiat/otc/item/online"
    KRAKEN_API_URL: str = "https://api.kraken.com/0/public/Ticker"
    RAPIRA_API_URL: str = "https://api.rapira.net/open/market/rates"
    CRON_RATES: str = "*/5 * * * *"
    SLA_MINUTES: int = 30
    PORT: int = 8080

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
