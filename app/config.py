from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    soniox_api_key: str = ""
    soniox_model: str = "stt-async-v4"
    language_hints: str = "ko"

    @property
    def language_hint_list(self) -> list[str]:
        return [lang.strip() for lang in self.language_hints.split(",") if lang.strip()]


settings = Settings()
