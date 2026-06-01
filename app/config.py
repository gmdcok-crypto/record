from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    soniox_api_key: str = ""
    soniox_model: str = "stt-async-v4"
    language_hints: str = "ko"

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "record"
    r2_voice_prefix: str = "voice/"
    r2_text_prefix: str = "text/"
    r2_presign_expires: int = 3600

    @property
    def language_hint_list(self) -> list[str]:
        return [lang.strip() for lang in self.language_hints.split(",") if lang.strip()]

    @property
    def r2_configured(self) -> bool:
        return bool(self.r2_account_id and self.r2_access_key_id and self.r2_secret_access_key)


settings = Settings()
