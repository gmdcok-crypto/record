import secrets

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
SUFFIX_LENGTH = 10


def _generate_short_id(prefix: str, *, suffix_length: int = SUFFIX_LENGTH) -> str:
    suffix = "".join(secrets.choice(ALPHABET) for _ in range(suffix_length))
    return f"{prefix}-{suffix}"


def generate_job_id() -> str:
    return _generate_short_id("J")


def generate_project_id() -> str:
    return _generate_short_id("P")
