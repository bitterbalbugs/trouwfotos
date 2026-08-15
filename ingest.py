#!/usr/bin/env python3
"""
One-off photo ingestion script.

Usage:
    python ingest.py

Expects photos in:
    import/<category-name>/*.jpg  (or .jpeg, .png, .heic)

Generates thumbnails (long edge 1200px, JPEG quality 80) in:
    thumbnails/<category-name>/<filename>.jpg

Run this after dropping photos into the import/ directory.
Already-ingested photos are skipped (idempotent).
"""

import sys
import sqlite3
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "photos.db"
IMPORT_DIR = BASE_DIR / "import"
THUMBNAILS_DIR = BASE_DIR / "thumbnails"

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

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".tiff", ".tif"}
THUMB_MAX_EDGE = 1200
THUMB_QUALITY = 80


def make_thumbnail(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > THUMB_MAX_EDGE:
            if w >= h:
                new_w, new_h = THUMB_MAX_EDGE, int(h * THUMB_MAX_EDGE / w)
            else:
                new_w, new_h = int(w * THUMB_MAX_EDGE / h), THUMB_MAX_EDGE
            img = img.resize((new_w, new_h), Image.LANCZOS)
        img.save(str(dst), "JPEG", quality=THUMB_QUALITY, optimize=True)


def main():
    if not DB_PATH.exists():
        print("photos.db not found — start the app once first to initialise the database.")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    added = 0
    skipped = 0
    errors = 0

    for category in CATEGORIES:
        cat_dir = IMPORT_DIR / category
        if not cat_dir.exists():
            print(f"  [{category}] import directory not found, skipping")
            continue

        files = sorted(
            f for f in cat_dir.iterdir()
            if f.is_file() and f.suffix.lower() in IMAGE_EXTS
        )
        print(f"  [{category}] {len(files)} image(s) found")

        for src in files:
            original_path = f"{category}/{src.name}"

            if conn.execute(
                "SELECT id FROM photos WHERE original_path = ?", (original_path,)
            ).fetchone():
                skipped += 1
                continue

            thumb_rel = f"{category}/{src.stem}.jpg"
            thumb_dst = THUMBNAILS_DIR / thumb_rel

            try:
                make_thumbnail(src, thumb_dst)
            except Exception as exc:
                print(f"    ERROR thumbnailing {src.name}: {exc}")
                errors += 1
                continue

            conn.execute(
                "INSERT INTO photos (filename, category, original_path, thumbnail_path) VALUES (?, ?, ?, ?)",
                (src.name, category, original_path, thumb_rel),
            )
            print(f"    + {src.name}")
            added += 1

    conn.commit()
    conn.close()

    print(f"\nDone: {added} added, {skipped} already existed, {errors} errors.")


if __name__ == "__main__":
    main()
