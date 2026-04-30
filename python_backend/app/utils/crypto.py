import os

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

from app.config import settings


def _key() -> bytes:
    return bytes.fromhex(settings.AES_KEY_HEX)


def aes_encrypt(plaintext: str) -> bytes:
    """AES-256-CBC encrypt. Returns iv (16 bytes) + ciphertext."""
    key = _key()
    iv = os.urandom(16)
    data = plaintext.encode("utf-8")
    pad_len = 16 - (len(data) % 16)
    data += bytes([pad_len]) * pad_len
    enc = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend()).encryptor()
    ct = enc.update(data) + enc.finalize()
    return iv + ct


def aes_decrypt(ciphertext: bytes) -> str:
    """AES-256-CBC decrypt. Expects iv (16 bytes) prepended to ciphertext."""
    key = _key()
    iv = ciphertext[:16]
    ct = ciphertext[16:]
    dec = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend()).decryptor()
    data = dec.update(ct) + dec.finalize()
    pad_len = data[-1]
    return data[:-pad_len].decode("utf-8")
