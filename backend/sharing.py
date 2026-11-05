"""Persistent, immutable plan snapshots and feedback for possession-based review links."""
import json
import os
import secrets
import sqlite3
from pathlib import Path


def connect():
    path = Path(os.environ.get('PICNIC_DB_PATH', Path(__file__).resolve().parents[1] / 'data' / 'picnics.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, plan TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, token TEXT NOT NULL, name TEXT NOT NULL, response TEXT NOT NULL, comment TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)')
    return db


def create_share(plan, token=None):
    token = token or secrets.token_urlsafe(24)
    with connect() as db:
        db.execute('INSERT OR IGNORE INTO shares VALUES (?, ?)', (token, json.dumps(plan)))
    return token


def read_share(token):
    with connect() as db:
        row = db.execute('SELECT plan FROM shares WHERE token = ?', (token,)).fetchone()
        if not row:
            return None
        reviews = db.execute('SELECT name, response, comment, created_at FROM feedback WHERE token = ? ORDER BY id', (token,)).fetchall()
    return {'plan': json.loads(row[0]), 'reviews': [dict(zip(('name', 'response', 'comment', 'created_at'), r)) for r in reviews]}


def add_review(token, name, response, comment):
    with connect() as db:
        if not db.execute('SELECT 1 FROM shares WHERE token = ?', (token,)).fetchone():
            return False
        db.execute('INSERT INTO feedback (token, name, response, comment) VALUES (?, ?, ?, ?)', (token, name, response, comment))
    return True
