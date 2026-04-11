"""
EVE Online SSO – OAuth2 PKCE authentication flow.

Flow (new login):
  1. GET /auth/login   → generates code_verifier + state, redirects to EVE SSO
  2. EVE SSO redirects to GET /auth/callback?code=…&state=…
  3. Backend exchanges code for tokens, creates session, redirects to dashboard

Flow (add character to existing account):
  1. GET /auth/add-character (requires session cookie)
  2. After callback: new character linked to current user, no cookie change
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
EVE_REVOKE_URL    = "https://login.eveonline.com/v2/oauth/revoke"

SCOPES = " ".join([
    "esi-characters.read_blueprints.v1",
    "esi-skills.read_skills.v1",
    "esi-industry.read_character_jobs.v1",
    "esi-assets.read_assets.v1",
])

CLIENT_ID     = os.getenv("EVE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("EVE_CLIENT_SECRET", "")
SECRET_KEY    = os.getenv("SECRET_KEY", "change-me")
CALLBACK_URL  = os.getenv("CALLBACK_URL", "http://localhost:8000/auth/callback")
FRONTEND_URL  = os.getenv("FRONTEND_URL", "http://localhost:5173")

PKCE_TTL    = 300
SESSION_TTL = 86400

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
# Token helpers
# ---------------------------------------------------------------------------

def _token_request(data: dict) -> httpx.Response:
    if CLIENT_SECRET:
        auth = (CLIENT_ID, CLIENT_SECRET)
    else:
        data = {**data, "client_id": CLIENT_ID}
        auth = None
    with httpx.Client() as client:
        return client.post(
            EVE_TOKEN_URL, data=data, auth=auth,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )


def _revoke_token(token: str) -> None:
    """Best-effort EVE SSO refresh-token revocation."""
    try:
        data = {"token": token, "token_type_hint": "refresh_token"}
        if CLIENT_SECRET:
            auth = (CLIENT_ID, CLIENT_SECRET)
        else:
            data["client_id"] = CLIENT_ID
            auth = None
        with httpx.Client(timeout=5) as client:
            client.post(EVE_REVOKE_URL, data=data, auth=auth,
                        headers={"Content-Type": "application/x-www-form-urlencoded"})
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def create_session_token(
    character_id: int,
    character_name: str,
    primary_character_id: int,
) -> str:
    payload = {
        "sub":  str(character_id),
        "uid":  str(primary_character_id),
        "name": character_name,
        "iat":  int(time.time()),
        "exp":  int(time.time()) + SESSION_TTL,
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
    claims = decode_session_token(session)
    if "uid" not in claims:
        claims["uid"] = claims["sub"]
    return claims


def get_primary_id(session: str | None) -> int:
    return int(get_current_character(session)["uid"])


# ---------------------------------------------------------------------------
# PKCE state helpers
# ---------------------------------------------------------------------------

def _store_pkce(state: str, verifier: str, link_to: int | None) -> None:
    db = get_db()
    db.execute("DELETE FROM pkce_state WHERE expires_at < ?", (time.time(),))
    db.execute(
        "INSERT INTO pkce_state (state, code_verifier, expires_at, link_to_primary_id) VALUES (?,?,?,?)",
        (state, verifier, time.time() + PKCE_TTL, link_to),
    )
    db.commit()
    db.close()


def _pop_pkce(state: str) -> dict | None:
    db = get_db()
    row = db.execute(
        "SELECT code_verifier, link_to_primary_id FROM pkce_state "
        "WHERE state = ? AND expires_at > ?",
        (state, time.time()),
    ).fetchone()
    if row:
        db.execute("DELETE FROM pkce_state WHERE state = ?", (state,))
        db.commit()
    db.close()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/login")
def login():
    verifier  = _make_code_verifier()
    challenge = _make_code_challenge(verifier)
    state     = secrets.token_urlsafe(16)
    _store_pkce(state, verifier, link_to=None)
    url = EVE_AUTHORIZE_URL + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": CLIENT_ID,
        "redirect_uri": CALLBACK_URL, "scope": SCOPES, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    return RedirectResponse(url, status_code=302)


@router.get("/add-character")
def add_character(session: str | None = Cookie(None)):
    """Start OAuth flow to link a new character to the current account."""
    primary_id = get_primary_id(session)
    verifier   = _make_code_verifier()
    challenge  = _make_code_challenge(verifier)
    state      = secrets.token_urlsafe(16)
    _store_pkce(state, verifier, link_to=primary_id)
    url = EVE_AUTHORIZE_URL + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": CLIENT_ID,
        "redirect_uri": CALLBACK_URL, "scope": SCOPES, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    return RedirectResponse(url, status_code=302)


@router.get("/callback")
def callback(code: str, state: str, response: Response):
    pkce = _pop_pkce(state)
    if not pkce:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    code_verifier      = pkce["code_verifier"]
    link_to_primary_id = pkce["link_to_primary_id"]

    token_resp = _token_request({
        "grant_type": "authorization_code", "code": code,
        "code_verifier": code_verifier, "redirect_uri": CALLBACK_URL,
    })
    if not token_resp.is_success:
        raise HTTPException(
            status_code=400,
            detail=f"Token exchange failed [{token_resp.status_code}]: {token_resp.text}",
        )

    tokens        = token_resp.json()
    access_token  = tokens["access_token"]
    refresh_token = tokens.get("refresh_token", "")
    expires_in    = tokens.get("expires_in", 1200)

    try:
        claims       = jwt.decode(access_token, key="", algorithms=["RS256"],
                                  options={"verify_signature": False, "verify_exp": False,
                                           "verify_aud": False})
        character_id = int(claims.get("sub", "").split(":")[-1])
        char_name    = claims.get("name", "Unknown Pilot")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse SSO token: {exc}") from exc

    db  = get_db()
    now = time.time()

    if link_to_primary_id is not None:
        # Link new character to existing account
        primary_id = link_to_primary_id
        db.execute(
            "INSERT OR IGNORE INTO character_groups "
            "(primary_character_id, member_character_id, joined_at) VALUES (?,?,?)",
            (primary_id, character_id, now),
        )
        db.execute(
            """
            INSERT OR REPLACE INTO sessions
                (session_id, character_id, character_name, primary_character_id,
                 access_token, refresh_token, expires_at, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (secrets.token_urlsafe(32), character_id, char_name, primary_id,
             access_token, refresh_token, now + expires_in, now),
        )
        db.commit()
        db.close()
        return RedirectResponse(
            f"{FRONTEND_URL}/dashboard?added={urllib.parse.quote(char_name)}", status_code=302
        )

    else:
        # New login — character is its own primary
        session_id = secrets.token_urlsafe(32)
        db.execute(
            "INSERT OR IGNORE INTO character_groups "
            "(primary_character_id, member_character_id, joined_at) VALUES (?,?,?)",
            (character_id, character_id, now),
        )
        db.execute(
            """
            INSERT OR REPLACE INTO sessions
                (session_id, character_id, character_name, primary_character_id,
                 access_token, refresh_token, expires_at, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (session_id, character_id, char_name, character_id,
             access_token, refresh_token, now + expires_in, now),
        )
        db.commit()
        db.close()

        token = create_session_token(character_id, char_name, character_id)
        redirect = RedirectResponse(f"{FRONTEND_URL}/dashboard", status_code=302)
        redirect.set_cookie(key="session", value=token, httponly=True,
                            samesite="lax", max_age=SESSION_TTL, path="/")
        return redirect


@router.get("/logout")
def logout(session: str | None = Cookie(None)):
    resp = RedirectResponse(f"{FRONTEND_URL}/", status_code=302)
    resp.delete_cookie("session")
    if session:
        try:
            claims       = decode_session_token(session)
            character_id = int(claims["sub"])
            db  = get_db()
            row = db.execute(
                "SELECT refresh_token FROM sessions WHERE character_id = ? "
                "ORDER BY created_at DESC LIMIT 1",
                (character_id,),
            ).fetchone()
            if row and row["refresh_token"]:
                _revoke_token(row["refresh_token"])
            db.execute("DELETE FROM sessions WHERE character_id = ?", (character_id,))
            db.commit()
            db.close()
        except Exception:
            pass
    return resp


# ---------------------------------------------------------------------------
# Token access helper
# ---------------------------------------------------------------------------

def get_access_token(character_id: int) -> str:
    """Return a valid access token, refreshing if needed."""
    db  = get_db()
    row = db.execute(
        "SELECT access_token, refresh_token, expires_at FROM sessions "
        "WHERE character_id = ? ORDER BY created_at DESC LIMIT 1",
        (character_id,),
    ).fetchone()

    if not row:
        db.close()
        raise HTTPException(status_code=401, detail="No session for character")

    if row["expires_at"] > time.time() + 60:
        db.close()
        return row["access_token"]

    token_resp = _token_request({
        "grant_type": "refresh_token", "refresh_token": row["refresh_token"],
    })
    if not token_resp.is_success:
        db.close()
        raise HTTPException(status_code=401, detail="Token refresh failed – please log in again")

    tokens = token_resp.json()
    db.execute(
        "UPDATE sessions SET access_token=?, refresh_token=?, expires_at=? WHERE character_id=?",
        (tokens["access_token"],
         tokens.get("refresh_token", row["refresh_token"]),
         time.time() + tokens.get("expires_in", 1200),
         character_id),
    )
    db.commit()
    db.close()
    return tokens["access_token"]
