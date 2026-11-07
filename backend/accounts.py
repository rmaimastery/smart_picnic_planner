"""Email-link sessions, private saved plans, and verified group invitations."""
import hashlib
import ipaddress
import json
import math
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

router = APIRouter()
COOKIE = 'bb_session'
LINK_TTL = 15 * 60
INVITE_TTL = 48 * 3600
SESSION_TTL = 7 * 24 * 3600
TOKEN = re.compile(r'^[A-Za-z0-9_-]{43}$')
THREAD = re.compile(r'^[A-Za-z0-9_-]{32}$')


@contextmanager
def database():
    path = Path(os.getenv('PICNIC_DB_PATH', Path(__file__).resolve().parents[1] / 'data' / 'picnics.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS bb_accounts (email TEXT PRIMARY KEY, created_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS bb_sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS bb_plans (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, thread TEXT UNIQUE NOT NULL,
            snapshot TEXT NOT NULL, saved_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bb_members (
            plan_id TEXT NOT NULL REFERENCES bb_plans(id), email TEXT NOT NULL,
            accepted_at REAL, PRIMARY KEY(plan_id,email));
        CREATE TABLE IF NOT EXISTS bb_links (
            hash TEXT PRIMARY KEY, email TEXT NOT NULL, plan_id TEXT,
            expires REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS bb_limits (scope TEXT NOT NULL, key TEXT NOT NULL, created_at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS bb_limits_lookup ON bb_limits(scope,key,created_at);
        CREATE TABLE IF NOT EXISTS bb_feedback (
            id INTEGER PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES bb_plans(id),
            email TEXT NOT NULL, response TEXT NOT NULL, comment TEXT NOT NULL, created_at TEXT NOT NULL);
    ''')
    try:
        yield db
    finally:
        db.close()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def normalize_email(value):
    value = value.strip().lower()
    if len(value) > 254 or value.count('@') != 1 or not value.isascii():
        raise ValueError('Enter a valid email address.')
    local, domain = value.rsplit('@', 1)
    if (not 1 <= len(local) <= 64 or local.startswith('.') or local.endswith('.') or '..' in local
            or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+", local)):
        raise ValueError('Enter a valid email address.')
    labels = domain.split('.')
    if len(labels) < 2 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels):
        raise ValueError('Enter a valid email address.')
    return value


def local_preview(request):
    if os.getenv('AUTH_EMAIL_MODE', '').lower() != 'local':
        return False
    try:
        client_local = ipaddress.ip_address(request.client.host).is_loopback
    except (ValueError, AttributeError):
        return False
    host_local = request.url.hostname in ('localhost', '127.0.0.1', '::1')
    configured = os.getenv('APP_BASE_URL', '')
    return client_local and host_local and (not configured or urlsplit(configured).hostname in ('localhost', '127.0.0.1', '::1'))


def base_url(request):
    if local_preview(request):
        return str(request.base_url).rstrip('/')
    value = os.getenv('APP_BASE_URL', '').rstrip('/')
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment):
        raise HTTPException(503, 'Configure APP_BASE_URL with your public HTTPS address before sending email links.')
    return value


def same_origin(request: Request):
    # Custom headers cannot be submitted by cross-origin HTML forms. No CORS is enabled.
    if request.headers.get('x-bb-request') != '1' or request.headers.get('sec-fetch-site') in ('cross-site', 'same-site'):
        raise HTTPException(403, 'Open this action from Blanket & Bites.')
    origin = request.headers.get('origin')
    expected = os.getenv('APP_BASE_URL', '').rstrip('/') or str(request.base_url).rstrip('/')
    if origin and origin != expected:
        raise HTTPException(403, 'Open this action from Blanket & Bites.')


def current_email(request):
    token = request.cookies.get(COOKIE, '')
    if not TOKEN.fullmatch(token):
        return None
    with database() as db:
        row = db.execute('SELECT email FROM bb_sessions WHERE hash=? AND expires>?', (digest(token), time.time())).fetchone()
    return row['email'] if row else None


def require_email(request: Request):
    email = current_email(request)
    if not email:
        raise HTTPException(401, 'Sign in with your email link to open your picnics.')
    return email


def authorize_workflow(thread_id, request):
    """Legacy guest workflows remain capabilities; account-owned ones require their owner."""
    with database() as db:
        row = db.execute('SELECT owner FROM bb_plans WHERE thread=?', (thread_id,)).fetchone()
    if row:
        if not request or current_email(request) != row['owner']:
            raise HTTPException(403, 'Only the organizer can edit this picnic. Open My picnics to view your group plan.')
        if request.method not in ('GET', 'HEAD'):
            same_origin(request)


def rate_limit(entries):
    now = time.time()
    with database() as db, db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM bb_limits WHERE created_at<?', (now-86400,))
        waits = []
        for scope, key, limit, window in entries:
            usage = db.execute('SELECT COUNT(*), MIN(created_at) FROM bb_limits WHERE scope=? AND key=? AND created_at>?',
                               (scope, digest(key), now-window)).fetchone()
            if usage[0] >= limit:
                waits.append(max(1, math.ceil(usage[1]+window-now)))
        if waits:
            retry_after = max(waits)
            raise HTTPException(429, f'Too many requests. Try again in {retry_after} seconds.', headers={'Retry-After': str(retry_after)})
        db.executemany('INSERT INTO bb_limits VALUES (?,?,?)', [(scope, digest(key), now) for scope, key, _, _ in entries])


def deliver_link(request, email, token, plan_id=None):
    link = f'{base_url(request)}/login.html#{token}'
    subject = 'Your B&B picnic invitation' if plan_id else 'Your Blanket & Bites sign-in link'
    message = EmailMessage()
    message['Subject'] = subject
    message['To'] = email
    message.set_content(('You are invited to view a picnic and leave feedback.\n\n' if plan_id else 'Your picnic is one click away.\n\n')
                        + f'Open this link, then confirm your email to sign in:\n{link}\n\n'
                        + ('This invitation expires in 48 hours.' if plan_id else 'This sign-in link expires in 15 minutes.')
                        + '\nIf you did not request this, you can ignore this message.\nBlanket & Bites — LOVE LIFE ♥')
    mode = os.getenv('AUTH_EMAIL_MODE', '').lower()
    if mode == 'local' and local_preview(request):
        # Local testing only: explicit opt-in plus loopback client and host checks.
        return {'preview_url': link, 'email': email}
    if mode != 'smtp':
        raise HTTPException(503, 'Email delivery is not configured. Use local preview on localhost or configure SMTP.')
    host, sender = os.getenv('SMTP_HOST'), os.getenv('SMTP_FROM')
    if not host or not sender:
        raise HTTPException(503, 'Configure SMTP_HOST and SMTP_FROM to send email links.')
    try:
        normalize_email(sender)
        message['From'] = sender
        transport = os.getenv('SMTP_TLS', 'starttls').lower()
        if transport not in ('starttls', 'ssl'):
            raise ValueError('Encrypted SMTP is required.')
        port = int(os.getenv('SMTP_PORT', '465' if transport == 'ssl' else '587'))
        context = ssl.create_default_context()
        smtp = smtplib.SMTP_SSL(host, port, timeout=15, context=context) if transport == 'ssl' else smtplib.SMTP(host, port, timeout=15)
        with smtp:
            if transport == 'starttls':
                smtp.starttls(context=context)
            user = os.getenv('SMTP_USER')
            if user:
                smtp.login(user, os.getenv('SMTP_PASSWORD', ''))
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError) as exc:
        raise HTTPException(503, 'The email could not be sent. Please retry or check the email delivery settings.') from exc
    return None


def issue_link(request, email, plan_id=None):
    token = secrets.token_urlsafe(32)
    with database() as db, db:
        db.execute('DELETE FROM bb_links WHERE expires<=?', (time.time(),))
        db.execute('INSERT INTO bb_links(hash,email,plan_id,expires) VALUES (?,?,?,?)',
                   (digest(token), email, plan_id, time.time()+(INVITE_TTL if plan_id else LINK_TTL)))
    try:
        return deliver_link(request, email, token, plan_id)
    except HTTPException:
        with database() as db, db:
            db.execute('DELETE FROM bb_links WHERE hash=?', (digest(token),))
        raise


class EmailRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    _email = field_validator('email')(normalize_email)


class TokenRequest(BaseModel):
    token: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$')


class SaveRequest(BaseModel):
    thread_id: str = Field(pattern=r'^[A-Za-z0-9_-]{32}$')


class InviteRequest(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=25)

    @field_validator('emails')
    @classmethod
    def emails_valid(cls, values):
        return list(dict.fromkeys(normalize_email(value) for value in values))


class FeedbackRequest(BaseModel):
    response: str = Field(pattern=r'^(Looks good|Suggest a change|Cannot make it)$')
    comment: str = Field(default='', max_length=2000)


@router.get('/api/auth/config')
def auth_config(request: Request):
    return {'local_preview': local_preview(request), 'email_configured': local_preview(request) or os.getenv('AUTH_EMAIL_MODE') == 'smtp'}


@router.get('/api/auth/me')
def me(request: Request):
    email = current_email(request)
    role = None
    if email:
        with database() as db:
            own = db.execute('SELECT 1 FROM bb_plans WHERE owner=? LIMIT 1', (email,)).fetchone()
            invited = db.execute('SELECT 1 FROM bb_members WHERE email=? AND accepted_at IS NOT NULL LIMIT 1', (email,)).fetchone()
        role = 'guest' if invited and not own else 'organizer'
    return {'email': email, 'nav_role': role}


@router.post('/api/auth/link', dependencies=[Depends(same_origin)])
def send_link(body: EmailRequest, request: Request):
    if local_preview(request):
        # No email is sent in local preview. Separate buckets also avoid stale
        # production-sized limits blocking ordinary localhost testing.
        rate_limit([('preview-login-ip', request.client.host, 60, 60), ('preview-login-email', body.email, 30, 60)])
    else:
        rate_limit([('login-ip', request.client.host, 15, 900), ('login-email', body.email, 3, 900), ('mail-global', 'all', 200, 3600)])
    preview = issue_link(request, body.email)
    result = {'message': 'Check your email for a sign-in link. It expires in 15 minutes.'}
    if preview:
        result['preview'] = preview
    return result


def usable_link(db, token):
    row = db.execute('SELECT * FROM bb_links WHERE hash=? AND expires>? AND used=0', (digest(token), time.time())).fetchone()
    if row and row['plan_id']:
        member = db.execute('SELECT 1 FROM bb_members WHERE plan_id=? AND email=?', (row['plan_id'], row['email'])).fetchone()
        if not member:
            row = None
    if not row:
        raise HTTPException(400, 'This link has expired or has already been used. Request a new email link.')
    return row


@router.post('/api/auth/inspect', dependencies=[Depends(same_origin)])
def inspect_link(body: TokenRequest, request: Request):
    rate_limit([('inspect-ip', request.client.host, 60, 900)])
    with database() as db:
        row = usable_link(db, body.token)
    return {'email': row['email'], 'invitation': bool(row['plan_id'])}


@router.post('/api/auth/verify', dependencies=[Depends(same_origin)])
def verify(body: TokenRequest, request: Request, response: Response):
    rate_limit([('verify-ip', request.client.host, 30, 900)])
    # Require a configured trusted origin for cookie security, including reverse proxies.
    secure = urlsplit(base_url(request)).scheme == 'https'
    session = secrets.token_urlsafe(32)
    with database() as db, db:
        db.execute('BEGIN IMMEDIATE')
        row = usable_link(db, body.token)
        db.execute('UPDATE bb_links SET used=1 WHERE hash=?', (digest(body.token),))
        db.execute('INSERT OR IGNORE INTO bb_accounts VALUES (?,?)', (row['email'], time.time()))
        db.execute('DELETE FROM bb_sessions WHERE hash=? OR expires<=?', (digest(request.cookies.get(COOKIE, '')), time.time()))
        db.execute('INSERT INTO bb_sessions VALUES (?,?,?)', (digest(session), row['email'], time.time()+SESSION_TTL))
        if row['plan_id']:
            db.execute('UPDATE bb_members SET accepted_at=? WHERE plan_id=? AND email=?', (time.time(), row['plan_id'], row['email']))
    response.set_cookie(COOKIE, session, max_age=SESSION_TTL, httponly=True, secure=secure, samesite='lax', path='/')
    return {'email': row['email'], 'path': '/account.html'+(f'?plan={row["plan_id"]}' if row['plan_id'] else '')}


@router.post('/api/auth/logout', dependencies=[Depends(same_origin)])
def logout(request: Request, response: Response):
    with database() as db, db:
        db.execute('DELETE FROM bb_sessions WHERE hash=?', (digest(request.cookies.get(COOKIE, '')),))
    response.delete_cookie(COOKIE, path='/', httponly=True, samesite='lax')
    return {'status': 'signed_out'}


def visible_plan(db, plan_id, email, owner_only=False):
    row = db.execute('SELECT * FROM bb_plans WHERE id=?', (plan_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Picnic not found.')
    if row['owner'] != email:
        member = db.execute('SELECT 1 FROM bb_members WHERE plan_id=? AND email=? AND accepted_at IS NOT NULL', (plan_id, email)).fetchone()
        if owner_only or not member:
            raise HTTPException(404, 'Picnic not found.')
    return row


def summary(row, email):
    plan = json.loads(row['snapshot'])
    venue = next((v for v in plan['venues'] if v['id'] == plan['selected_venue']), plan['venues'][0])
    result = {'id': row['id'], 'role': 'organizer' if row['owner'] == email else 'guest', 'saved_at': row['saved_at'],
              'venue': venue['name'], 'date': plan['request']['date'], 'guests': plan['request']['guests'], 'status': plan['status']}
    if row['owner'] == email:
        result['thread_id'] = row['thread']
    return result


@router.post('/api/account/plans', dependencies=[Depends(same_origin)])
def save_plan(body: SaveRequest, request: Request, email: str = Depends(require_email)):
    from backend.workflow import run
    authorize_workflow(body.thread_id, request)
    try:
        current = run(body.thread_id, read_only=True)
    except KeyError as exc:
        raise HTTPException(404, 'Picnic not found.') from exc
    if not current.get('plan'):
        raise HTTPException(409, 'Choose your picnic place before saving a plan to your account.')
    stamp = datetime.now(timezone.utc).isoformat()
    with database() as db, db:
        db.execute('BEGIN IMMEDIATE')
        previous = db.execute('SELECT id,owner FROM bb_plans WHERE thread=?', (body.thread_id,)).fetchone()
        if previous and previous['owner'] != email:
            raise HTTPException(403, 'Only the organizer can save this picnic.')
        plan_id = previous['id'] if previous else secrets.token_urlsafe(24)
        db.execute('''INSERT INTO bb_plans VALUES (?,?,?,?,?) ON CONFLICT(thread)
            DO UPDATE SET snapshot=excluded.snapshot,saved_at=excluded.saved_at''',
                   (plan_id, email, body.thread_id, json.dumps(current['plan']), stamp))
    return {'id': plan_id, 'saved_at': stamp}


@router.get('/api/account/plans')
def list_plans(email: str = Depends(require_email)):
    with database() as db:
        rows = db.execute('''SELECT p.* FROM bb_plans p WHERE p.owner=? OR EXISTS
            (SELECT 1 FROM bb_members m WHERE m.plan_id=p.id AND m.email=? AND m.accepted_at IS NOT NULL)
            ORDER BY p.saved_at DESC LIMIT 100''', (email, email)).fetchall()
    return {'plans': [summary(row, email) for row in rows]}


@router.get('/api/account/workflows/{thread_id}/feedback')
def workflow_feedback(thread_id: str, email: str = Depends(require_email)):
    with database() as db:
        row = db.execute('SELECT id FROM bb_plans WHERE thread=? AND owner=?', (thread_id, email)).fetchone()
        if not row:
            raise HTTPException(404, 'No saved account picnic found for this organizer.')
        responses = [dict(item) for item in db.execute(
            'SELECT email,response,comment,created_at FROM bb_feedback WHERE plan_id=? AND email<>? ORDER BY id',
            (row['id'], email))]
    return {'id': row['id'], 'feedback': responses}


@router.get('/api/account/plans/{plan_id}')
def read_plan(plan_id: str, email: str = Depends(require_email)):
    with database() as db:
        row = visible_plan(db, plan_id, email)
        plan = json.loads(row['snapshot'])
        result = summary(row, email)
        if row['owner'] == email:
            result['thread_id'] = row['thread']
            result['members'] = [dict(item) for item in db.execute('SELECT email,accepted_at FROM bb_members WHERE plan_id=? ORDER BY email', (plan_id,))]
        else:
            for key in ('notes', 'request', 'participants'):
                plan['request'].pop(key, None)
            plan['venues'] = [v for v in plan['venues'] if v['id'] == plan['selected_venue']]
        result['plan'] = plan
        result['feedback'] = [dict(item) for item in db.execute('SELECT email,response,comment,created_at FROM bb_feedback WHERE plan_id=? ORDER BY id', (plan_id,))]
    return result


@router.post('/api/account/plans/{plan_id}/invitations', dependencies=[Depends(same_origin)])
def invite(plan_id: str, body: InviteRequest, request: Request, email: str = Depends(require_email)):
    with database() as db:
        visible_plan(db, plan_id, email, owner_only=True)
    recipients = [value for value in body.emails if value != email]
    if not recipients:
        raise HTTPException(422, 'Add at least one guest email other than your own.')
    delivered, failed, previews = [], [], []
    for recipient in recipients:
        try:
            rate_limit([('invites-owner', email, 100, 3600), ('mail-global', 'all', 200, 3600), ('invites-recipient', recipient, 5, 3600)])
            with database() as db, db:
                db.execute('INSERT OR IGNORE INTO bb_members(plan_id,email) VALUES (?,?)', (plan_id, recipient))
            preview = issue_link(request, recipient, plan_id)
            delivered.append(recipient)
            if preview:
                previews.append(preview)
        except HTTPException as exc:
            failed.append({'email': recipient, 'message': exc.detail})
    return {'delivered': delivered, 'failed': failed, 'previews': previews}


@router.delete('/api/account/plans/{plan_id}/members/{guest_email}', dependencies=[Depends(same_origin)])
def revoke(plan_id: str, guest_email: str, email: str = Depends(require_email)):
    with database() as db, db:
        visible_plan(db, plan_id, email, owner_only=True)
        db.execute('DELETE FROM bb_members WHERE plan_id=? AND email=?', (plan_id, guest_email))
        db.execute('DELETE FROM bb_links WHERE plan_id=? AND email=?', (plan_id, guest_email))
    return {'status': 'removed'}


@router.post('/api/account/plans/{plan_id}/feedback', status_code=201, dependencies=[Depends(same_origin)])
def feedback(plan_id: str, body: FeedbackRequest, request: Request, email: str = Depends(require_email)):
    rate_limit([('feedback', email, 30, 3600)])
    with database() as db, db:
        row = visible_plan(db, plan_id, email)
        if row['owner'] == email:
            raise HTTPException(403, 'Organizers review crew feedback. Only invited guests can submit a response.')
        db.execute('INSERT INTO bb_feedback(plan_id,email,response,comment,created_at) VALUES (?,?,?,?,?)',
                   (plan_id, email, body.response, body.comment.strip(), datetime.now(timezone.utc).isoformat()))
    return {'status': 'received'}
