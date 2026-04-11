"""
EVE Online SSO – OAuth2 PKCE authentication flow.

Flow:
  1. GET /auth/login   → generates code_verifier + state, redirects to EVE SSO
  2. EVE SSO redirects to GET /auth/callback?code=…&state=…
  3. Backend exchanges code (+ code_verifier) for tokens
  4. Creates a signed session cookie, redirects to frontend dashboard
"""
import hashlib
import base64
import secrets
import time
import os
import urllib.parse
import httpx
from jose import jwt, JWTError
from fastapi import APIRouter, Cookie, HTTPException, Response
from fastapi.responses import RedirectResponse

from database import get_db, init_db

EVE_AUTHORIZE_URL = "https://login.eveonline.com/v2/oauth/authorize"
EVE_TOKEN_URL     = "https://login.eveonline.com/v2/oauth/token"

SCOPES = " ".join([
    "esi-characters.read_blueprints.v1",
    "esi-skills.read_skills.v1",
    "esi-industry.read_character_jobs.v1",
])

CLIENT_ID      = os.getenv("EVE_CLIENT_ID", "")
CLIENT_SECRET  = os.getenv("EVE_CLIENT_SECRET", "")   # empty = PKCE-only app
SECRET_KEY     = os.getenv("SECRET_KEY", "change-me")
CALLBACK_URL  = os.getenv("CALLBACK_URL", "http://localhost:8000/auth/callback")
FRONTEND_URL  = os.getenv("FRONTEND_URL", "http://localhost:5173")

PKCE_TTL     = 300   # 5 minutes
SESSION_TTL  = 86400 # 24 hours

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------

def _make_code_verifier() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()


def _make_code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


# ---------------------------------------------------------------------------
# Token request helpers
# ---------------------------------------------------------------------------

def _token_request(data: dict) -> httpx.Response:
    """
    POST to the EVE token endpoint.
    - Web Application (secret set): credentials go in Basic Auth header only.
    - Native/PKCE app (no secret):  client_id goes in the body only.
    EVE rejects requests that supply credentials in both places.
    """
    if CLIENT_SECRET:
        # Confidential client: Basic Auth carries client_id + secret;
        # body must NOT repeat client_id.
        auth = (CLIENT_ID, CLIENT_SECRET)
    else:
        # Public client: no secret, client_id in body.
        data = {**data, "client_id": CLIENT_ID}
        auth = None

    with httpx.Client() as client:
        return client.post(
            EVE_TOKEN_URL,
            data=data,
            auth=auth,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def create_session_token(character_id: int, character_name: str) -> str:
    payload = {
        "sub": str(character_id),
        "name": character_name,
        "iat": int(time.time()),
        "exp": int(time.time()) + SESSION_TTL,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def decode_session_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Invalid session") from e


def get_current_character(session: str | None = Cookie(None)) -> dict:
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_session_token(session)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/login")
def login():
    """Redirect the browser to EVE SSO."""
    verifier = _make_code_verifier()
    challenge = _make_code_challenge(verifier)
    state = secrets.token_urlsafe(16)

    # Persist PKCE state so we can retrieve verifier on callback
    db = get_db()
    db.execute(
        "DELETE FROM pkce_state WHERE expires_at < ?", (time.time(),)
    )
    db.execute(
        "INSERT INTO pkce_state (state, code_verifier, expires_at) VALUES (?,?,?)",
        (state, verifier, time.time() + PKCE_TTL),
    )
    db.commit()
    db.close()

    url = EVE_AUTHORIZE_URL + "?" + urllib.parse.urlencode({
        "response_type":         "code",
        "client_id":             CLIENT_ID,
        "redirect_uri":          CALLBACK_URL,
        "scope":                 SCOPES,
        "state":                 state,
        "code_challenge":        challenge,
        "code_challenge_method": "S256",
    })
    return RedirectResponse(url, status_code=302)


@router.get("/callback")
def callback(code: str, state: str, response: Response):
    """Exchange authorization code for tokens, create session."""
    db = get_db()
    row = db.execute(
        "SELECT code_verifier FROM pkce_state WHERE state = ? AND expires_at > ?",
        (state, time.time()),
    ).fetchone()

    if not row:
        db.close()
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    code_verifier = row["code_verifier"]
    db.execute("DELETE FROM pkce_state WHERE state = ?", (state,))
    db.commit()

    # Exchange code for tokens
    token_resp = _token_request({
        "grant_type":    "authorization_code",
        "code":          code,
        "code_verifier": code_verifier,
        "redirect_uri":  CALLBACK_URL,
    })
    if not token_resp.is_success:
        db.close()
        raise HTTPException(
            status_code=400,
            detail=f"Token exchange failed [{token_resp.status_code}]: {token_resp.text}",
        )

    tokens = token_resp.json()
    access_token  = tokens["access_token"]
    refresh_token = tokens.get("refresh_token", "")
    expires_in    = tokens.get("expires_in", 1200)

    # SSO v2: the access_token is itself a signed JWT.
    # Decode it (no signature verification needed – we just received it directly
    # from EVE's token endpoint over TLS, so we already trust the source).
    # sub  = "CHARACTER:EVE:12345678"
    # name = "Character Name"
    try:
        token_claims = jwt.decode(
            access_token,
            key="",
            options={
                "verify_signature": False,
                "verify_exp":       False,
                "verify_aud":       False,
            },
            algorithms=["RS256"],
        )
        subject      = token_claims.get("sub", "")          # "CHARACTER:EVE:12345678"
        character_id = int(subject.split(":")[-1])
        char_name    = token_claims.get("name", "Unknown Pilot")
    except Exception as exc:
        db.close()
        raise HTTPException(status_code=400, detail=f"Could not parse SSO token: {exc}") from exc

    # Persist session
    session_id = secrets.token_urlsafe(32)
    now = time.time()
    db.execute(
        """
        INSERT OR REPLACE INTO sessions
            (session_id, character_id, character_name,
             access_token, refresh_token, expires_at, created_at)
        VALUES (?,?,?,?,?,?,?)
        """,
        (session_id, character_id, char_name,
         access_token, refresh_token, now + expires_in, now),
    )
    db.commit()
    db.close()

    session_token = create_session_token(character_id, char_name)

    # Redirect to frontend, set cookie
    redirect = RedirectResponse(f"{FRONTEND_URL}/dashboard", status_code=302)
    redirect.set_cookie(
        key="session",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_TTL,
        path="/",
    )
    return redirect


@router.get("/logout")
def logout(response: Response):
    response.delete_cookie("session")
    response.delete_cookie("character_id")
    return RedirectResponse(f"{FRONTEND_URL}/", status_code=302)


def get_access_token(character_id: int) -> str:
    """Retrieve a valid access token for character_id, refreshing if needed."""
    db = get_db()
    row = db.execute(
        """
        SELECT access_token, refresh_token, expires_at
        FROM   sessions
        WHERE  character_id = ?
        ORDER  BY created_at DESC
        LIMIT  1
        """,
        (character_id,),
    ).fetchone()

    if not row:
        db.close()
        raise HTTPException(status_code=401, detail="No session for character")

    if row["expires_at"] > time.time() + 60:
        db.close()
        return row["access_token"]

    # Refresh the token
    token_resp = _token_request({
        "grant_type":    "refresh_token",
        "refresh_token": row["refresh_token"],
    })
    if not token_resp.is_success:
        db.close()
        raise HTTPException(status_code=401, detail="Token refresh failed – please log in again")

    tokens = token_resp.json()
    db.execute(
        """
        UPDATE sessions
        SET    access_token = ?, refresh_token = ?, expires_at = ?
        WHERE  character_id = ?
        """,
        (
            tokens["access_token"],
            tokens.get("refresh_token", row["refresh_token"]),
            time.time() + tokens.get("expires_in", 1200),
            character_id,
        ),
    )
    db.commit()
    db.close()
    return tokens["access_token"]
