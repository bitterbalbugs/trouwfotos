from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import sqlite3
import urllib.parse
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "photos.db"
THUMBNAILS_DIR = BASE_DIR / "thumbnails"
IMPORT_DIR = BASE_DIR / "import"

CATEGORIES = [
    "1_Getting_ready",
    "2_First_look_grouppics",
    "3_Fotomoment",
    "4_Lunch_ontvangst",
    "5_Ceremonie",
    "6_Toast_taart",
    "7_Diner",
    "8_Lets_party",
]

VALID_USERS = {"martijn", "rosalie"}


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            category TEXT NOT NULL,
            original_path TEXT NOT NULL,
            thumbnail_path TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS selections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            photo_id INTEGER NOT NULL REFERENCES photos(id),
            user TEXT NOT NULL CHECK(user IN ('martijn', 'rosalie')),
            choice INTEGER NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(photo_id, user)
        );
        CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category);
        CREATE INDEX IF NOT EXISTS idx_sel_user ON selections(user);
        CREATE INDEX IF NOT EXISTS idx_sel_photo ON selections(photo_id);
    """)
    conn.commit()
    conn.close()


def photo_urls(row):
    return {
        "thumbnail_url": "thumbnails/" + urllib.parse.quote(row["thumbnail_path"], safe="/"),
        "original_url": "originals/" + urllib.parse.quote(row["original_path"], safe="/"),
    }


def validate_user(user: str):
    if user not in VALID_USERS:
        raise HTTPException(400, "user must be 'martijn' or 'rosalie'")


# Create directories at import time so StaticFiles mounts succeed
THUMBNAILS_DIR.mkdir(exist_ok=True)
IMPORT_DIR.mkdir(exist_ok=True)
init_db()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(lifespan=lifespan)

app.mount("/thumbnails", StaticFiles(directory=str(THUMBNAILS_DIR)), name="thumbnails")
app.mount("/originals", StaticFiles(directory=str(IMPORT_DIR)), name="originals")


@app.get("/")
async def root():
    return FileResponse(str(BASE_DIR / "index.html"), headers={"Cache-Control": "no-cache"})


@app.get("/style.css")
async def stylesheet():
    return FileResponse(str(BASE_DIR / "style.css"))


@app.get("/app.js")
async def javascript():
    return FileResponse(str(BASE_DIR / "app.js"))


# ── API ────────────────────────────────────────────────────────────────────

@app.get("/api/categories")
def get_categories(user: str = Query(...)):
    validate_user(user)
    conn = get_db()
    try:
        result = []
        for cat in CATEGORIES:
            total = conn.execute(
                "SELECT COUNT(*) FROM photos WHERE category = ?", (cat,)
            ).fetchone()[0]
            row = conn.execute("""
                SELECT
                    SUM(CASE WHEN s.choice = 1 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN s.choice = 0 THEN 1 ELSE 0 END)
                FROM selections s
                JOIN photos p ON s.photo_id = p.id
                WHERE p.category = ? AND s.user = ?
            """, (cat, user)).fetchone()
            kept     = row[0] or 0
            rejected = row[1] or 0
            swiped   = kept + rejected
            result.append({
                "name": cat,
                "total": total,
                "swiped": swiped,
                "kept": kept,
                "rejected": rejected,
                "remaining": total - swiped,
            })
        return result
    finally:
        conn.close()


@app.get("/api/photos")
def get_photos(category: str = Query(...)):
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT id, filename, category, original_path, thumbnail_path
            FROM photos
            WHERE category = ?
            ORDER BY id ASC
        """, (category,)).fetchall()
        return [
            {"id": r["id"], "filename": r["filename"], "category": r["category"], **photo_urls(r)}
            for r in rows
        ]
    finally:
        conn.close()


class SelectionIn(BaseModel):
    photo_id: int
    user: str
    choice: bool


@app.post("/api/selections")
def upsert_selection(sel: SelectionIn):
    validate_user(sel.user)
    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO selections (photo_id, user, choice, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(photo_id, user) DO UPDATE SET
                choice = excluded.choice,
                updated_at = excluded.updated_at
        """, (sel.photo_id, sel.user, int(sel.choice)))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.get("/api/selections")
def get_selections(user: str = Query(...)):
    validate_user(user)
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT s.photo_id, s.choice, p.filename, p.category
            FROM selections s JOIN photos p ON s.photo_id = p.id
            WHERE s.user = ?
            ORDER BY s.updated_at DESC
        """, (user,)).fetchall()
        return [
            {"photo_id": r["photo_id"], "choice": bool(r["choice"]),
             "filename": r["filename"], "category": r["category"]}
            for r in rows
        ]
    finally:
        conn.close()


@app.delete("/api/selections/{photo_id}")
def delete_selection(photo_id: int, user: str = Query(...)):
    validate_user(user)
    conn = get_db()
    try:
        conn.execute(
            "DELETE FROM selections WHERE photo_id = ? AND user = ?",
            (photo_id, user)
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.get("/api/summary")
def get_summary():
    conn = get_db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM photos").fetchone()[0]

        both_yes = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT photo_id FROM selections WHERE user='martijn' AND choice=1
                INTERSECT
                SELECT photo_id FROM selections WHERE user='rosalie' AND choice=1
            )
        """).fetchone()[0]

        m_yes = conn.execute(
            "SELECT COUNT(*) FROM selections WHERE user='martijn' AND choice=1"
        ).fetchone()[0]

        r_yes = conn.execute(
            "SELECT COUNT(*) FROM selections WHERE user='rosalie' AND choice=1"
        ).fetchone()[0]

        swiped_m = conn.execute(
            "SELECT COUNT(*) FROM selections WHERE user='martijn'"
        ).fetchone()[0]

        swiped_r = conn.execute(
            "SELECT COUNT(*) FROM selections WHERE user='rosalie'"
        ).fetchone()[0]

        categories = []
        for cat in CATEGORIES:
            cat_total = conn.execute(
                "SELECT COUNT(*) FROM photos WHERE category=?", (cat,)
            ).fetchone()[0]
            cat_both = conn.execute("""
                SELECT COUNT(*) FROM (
                    SELECT photo_id FROM selections s JOIN photos p ON s.photo_id=p.id
                    WHERE s.user='martijn' AND s.choice=1 AND p.category=?
                    INTERSECT
                    SELECT photo_id FROM selections s JOIN photos p ON s.photo_id=p.id
                    WHERE s.user='rosalie' AND s.choice=1 AND p.category=?
                )
            """, (cat, cat)).fetchone()[0]
            categories.append({"name": cat, "total": cat_total, "both_yes": cat_both})

        return {
            "total_photos": total,
            "swiped_martijn": swiped_m,
            "swiped_rosalie": swiped_r,
            "both_yes": both_yes,
            "martijn_only_yes": m_yes - both_yes,
            "rosalie_only_yes": r_yes - both_yes,
            "target": 80,
            "categories": categories,
        }
    finally:
        conn.close()


@app.get("/api/review/both")
def review_both():
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT id, filename, category, original_path, thumbnail_path
            FROM photos
            WHERE id IN (
                SELECT photo_id FROM selections WHERE user='martijn' AND choice=1
                INTERSECT
                SELECT photo_id FROM selections WHERE user='rosalie' AND choice=1
            )
            ORDER BY category, id
        """).fetchall()
        return [
            {"id": r["id"], "filename": r["filename"], "category": r["category"], **photo_urls(r)}
            for r in rows
        ]
    finally:
        conn.close()


@app.get("/api/review/discuss")
def review_discuss():
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT p.id, p.filename, p.category, p.original_path, p.thumbnail_path,
                   MAX(CASE WHEN s.user='martijn' AND s.choice=1 THEN 1 ELSE 0 END) AS m_yes,
                   MAX(CASE WHEN s.user='rosalie' AND s.choice=1 THEN 1 ELSE 0 END) AS r_yes
            FROM photos p
            JOIN selections s ON s.photo_id = p.id
            GROUP BY p.id
            HAVING (m_yes + r_yes) = 1
            ORDER BY p.category, p.id
        """).fetchall()
        return [
            {
                "id": r["id"], "filename": r["filename"], "category": r["category"],
                "who": "martijn" if r["m_yes"] else "rosalie",
                **photo_urls(r),
            }
            for r in rows
        ]
    finally:
        conn.close()
