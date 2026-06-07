from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    soniox_api_key: str = ""
    soniox_model: str = "stt-async-v4"
    soniox_enable_speaker_diarization: bool = True
    language_hints: str = "ko"

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "record"
    r2_voice_prefix: str = "voice/"
    r2_text_prefix: str = "text/"
    r2_presign_expires: int = 3600

    database_url: str = ""
    mysql_url: str = ""
    maintenance_reset_token: str = ""
    purge_db_on_startup: str = ""
    jwt_secret: str = ""
    # 0 = never expire (no exp claim). Set e.g. 10080 for 7 days.
    jwt_expire_minutes: int = 0

    @property
    def language_hint_list(self) -> list[str]:
        return [lang.strip() for lang in self.language_hints.split(",") if lang.strip()]

    @property
    def r2_configured(self) -> bool:
        return bool(self.r2_account_id and self.r2_access_key_id and self.r2_secret_access_key)

    @property
    def database_configured(self) -> bool:
        return bool(self.resolved_database_url)

    @property
    def jwt_configured(self) -> bool:
        return bool(self.jwt_secret.strip())

    @property
    def resolved_database_url(self) -> str:
        url = (self.database_url or self.mysql_url).strip()
        if not url:
            return ""
        if url.startswith("mysql://"):
            return url.replace("mysql://", "mysql+pymysql://", 1)
        return url


settings = Settings()
