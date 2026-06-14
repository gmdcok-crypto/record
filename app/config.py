from pydantic import Field
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
    public_client_url: str = "https://record-user.netlify.app"
    public_admin_url: str = ""
    public_transcriber_url: str = ""
    channel_talk_plugin_key: str = Field(default="", validation_alias="VITE_CHANNEL_TALK_PLUGIN_KEY")
    channel_talk_notifications_enabled: bool = False
    channel_talk_access_token: str = ""
    channel_talk_api_key: str = ""
    channel_talk_api_secret: str = ""
    channel_talk_admin_inbox_id: str = ""
    channel_talk_admin_user_id: str = ""
    channel_talk_admin_tag: str = "inquiry-alert"
    channel_talk_message_preview_limit: int = 120
    channel_talk_debounce_seconds: int = 60
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
