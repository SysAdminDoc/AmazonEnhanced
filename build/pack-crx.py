#!/usr/bin/env python3
"""
Pack AmazonEnhanced into a signed CRX3 file.

CRX3 format:
  magic      : b"Cr24"
  version    : LE32 = 3
  header_size: LE32 (bytes of CrxFileHeader protobuf that follow)
  CrxFileHeader:
    field 2 (AsymmetricKeyProof, repeated): RSA SHA-256 proof
      field 1: DER SubjectPublicKeyInfo of RSA public key
      field 2: RSA-SHA256 signature over signed payload
    field 10000 (signed_header_data): SignedData protobuf
      field 1: crx_id = first 16 bytes of SHA-256(DER pubkey)
  ZIP payload follows header.

Signed payload = b"CRX3 SignedData\x00" + LE32(len(signed_header_data))
               + signed_header_data + zip_bytes

Reuses build/amazonenhanced.pem to preserve extension ID across releases.
"""
import hashlib
import io
import json
import os
import struct
import sys
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


REPO = Path(__file__).resolve().parent.parent
KEY_PATH = REPO / "build" / "amazonenhanced.pem"

INCLUDE_FILES = [
    "manifest.json",
    "early-inject.js",
    "theme.css",
    "content.js",
    "background.js",
    "popup.html",
    "popup.css",
    "popup.js",
]
INCLUDE_DIRS = ["icons"]


def _read_version() -> str:
    with open(REPO / "manifest.json", "r", encoding="utf-8") as f:
        return json.load(f)["version"]


def varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def length_delimited(field_number: int, data: bytes) -> bytes:
    tag = (field_number << 3) | 2  # wire type 2 (length-delimited)
    return varint(tag) + varint(len(data)) + data


def load_or_create_key() -> rsa.RSAPrivateKey:
    if KEY_PATH.exists():
        with open(KEY_PATH, "rb") as f:
            return serialization.load_pem_private_key(f.read(), password=None)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(KEY_PATH, "wb") as f:
        f.write(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
    print(f"generated new key: {KEY_PATH}")
    return key


def zip_extension() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in INCLUDE_FILES:
            p = REPO / name
            if not p.exists():
                print(f"WARN: missing {p}")
                continue
            zf.write(p, name)
        for d in INCLUDE_DIRS:
            root = REPO / d
            if not root.exists():
                continue
            for sub in sorted(root.rglob("*")):
                if sub.is_file():
                    rel = sub.relative_to(REPO).as_posix()
                    zf.write(sub, rel)
    return buf.getvalue()


def main() -> int:
    version = _read_version()
    out_crx = REPO / f"AmazonEnhanced-v{version}.crx"

    key = load_or_create_key()
    pub_der = key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    crx_id = hashlib.sha256(pub_der).digest()[:16]

    zip_bytes = zip_extension()

    signed_header_data = length_delimited(1, crx_id)

    signed_payload = (
        b"CRX3 SignedData\x00"
        + struct.pack("<I", len(signed_header_data))
        + signed_header_data
        + zip_bytes
    )

    signature = key.sign(
        signed_payload,
        padding.PKCS1v15(),
        hashes.SHA256(),
    )

    proof = length_delimited(1, pub_der) + length_delimited(2, signature)

    # Field 10000 wire type 2: tag = (10000 << 3) | 2 = 80002 = varint 82 F1 04
    header = (
        length_delimited(2, proof)
        + b"\x82\xf1\x04"
        + varint(len(signed_header_data))
        + signed_header_data
    )

    with open(out_crx, "wb") as f:
        f.write(b"Cr24")
        f.write(struct.pack("<I", 3))
        f.write(struct.pack("<I", len(header)))
        f.write(header)
        f.write(zip_bytes)

    size = out_crx.stat().st_size
    with open(out_crx, "rb") as f:
        magic = f.read(4)
        ver = struct.unpack("<I", f.read(4))[0]
        header_size = struct.unpack("<I", f.read(4))[0]

    print(f"wrote {out_crx} ({size:,} bytes)")
    print(f"  magic       : {magic!r}")
    print(f"  version     : {ver}")
    print(f"  header_size : {header_size:,}")
    print(f"  crx_id      : {crx_id.hex()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
