from __future__ import annotations

from config import config


def _bucket() -> str:
    return config.setting("AWS_S3_BUCKET")


def _region() -> str:
    return config.setting("AWS_REGION") or config.setting("AWS_DEFAULT_REGION")


def _public_url(*, bucket: str, key: str) -> str:
    region = _region()
    if region and region != "us-east-1":
        return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"
    return f"https://{bucket}.s3.amazonaws.com/{key}"


def upload_wav(*, wav_bytes: bytes, key: str) -> str:
    bucket = _bucket()
    access_key = config.setting("AWS_ACCESS_KEY_ID")
    secret_key = config.setting("AWS_SECRET_ACCESS_KEY")
    if not bucket or not access_key or not secret_key:
        raise RuntimeError("Missing AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, or AWS_S3_BUCKET")

    import boto3

    client_kwargs = {
        "aws_access_key_id": access_key,
        "aws_secret_access_key": secret_key,
    }
    region = _region()
    if region:
        client_kwargs["region_name"] = region

    client = boto3.client("s3", **client_kwargs)
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=wav_bytes,
        ContentType="audio/wav",
    )
    return _public_url(bucket=bucket, key=key)


def upload_call_wav(*, wav_bytes: bytes, call_id: str) -> str:
    return upload_wav(wav_bytes=wav_bytes, key=f"calls/{call_id}.wav")
