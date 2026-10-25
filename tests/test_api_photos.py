"""Progress photos through the native API, against the REAL Supabase project: real tokens, real Storage, real rows.

Every refusal is also checked for its EFFECT -- no row and no stored file left behind -- because a half-done upload (a
file nobody can delete, or a row pointing at nothing) is the failure that matters. Mutation-check any change here.
"""

import datetime as dt
import io
import threading

import pytest
from PIL import Image

from api import photos
from api.app import create_app
from api.supabase_admin import Refused, SupabaseError
from api_support import (  # noqa: F401 -- the fixtures are used by name
    bearer, client, db, forget, objects_of, person, settings, storage)
from test_supabase_rls import Person, needs_api, needs_db

pytestmark = [needs_api, needs_db]

TODAY = dt.datetime.now(dt.timezone.utc).date()


def image_bytes(fmt="JPEG", size=(8, 8)):
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buf, format=fmt)
    return buf.getvalue()


def upload(client, who, data=None, *, angle="front", day=None, filename="photo.jpg", fields=True):
    form = {}
    if angle is not None:
        form["angle"] = angle
    if day is not False:
        form["date"] = (day or TODAY).isoformat() if not isinstance(day, str) else day
    if data is not None:
        form["photo"] = (io.BytesIO(data), filename)
    return client.post("/api/checkin/photo", headers=bearer(who), data=form, content_type="multipart/form-data")


@pytest.fixture
def me(client, person):
    assert client.post("/api/profile", headers=bearer(person), json={"name": "Photo Tester"}).status_code == 201
    return person


def rows(db, uid):
    with db.connection() as conn:
        return conn.execute("select * from public.progress_photos where user_id = %s order by id", (uid,)).fetchall()


def assert_nothing_left(db, uid):
    assert rows(db, uid) == [] and objects_of(db, uid) == [], "a refused upload left a row or a file behind"


# -- a good upload -------------------------------------------------------------------------------------

@pytest.mark.parametrize("fmt,ext,mime", [("JPEG", ".jpg", "image/jpeg"), ("PNG", ".png", "image/png"), ("WEBP", ".webp", "image/webp")])
def test_a_photo_is_stored_under_the_callers_folder_with_the_type_its_bytes_have(client, me, db, storage, fmt, ext, mime):
    data = image_bytes(fmt)
    r = upload(client, me, data)
    assert r.status_code == 200 and r.get_json()["ok"] is True
    (row,) = rows(db, me.id)
    assert row["id"] == r.get_json()["id"] and row["angle"] == "front" and row["date"] == TODAY
    assert row["filename"].endswith(ext) and len(row["filename"]) == 32 + len(ext)
    assert objects_of(db, me.id) == [("progress-photos", f"{me.id}/{row['filename']}")]
    assert storage.download("progress-photos", f"{me.id}/{row['filename']}") == data
    with db.connection() as conn:
        stored = conn.execute("select metadata->>'mimetype' as m from storage.objects where name = %s", (f"{me.id}/{row['filename']}",)).fetchone()
    assert stored["m"] == mime


def test_the_type_comes_from_the_bytes_not_from_the_filename_the_caller_chose(client, me, db):
    assert upload(client, me, image_bytes("PNG"), filename="lies.jpg").status_code == 200
    assert upload(client, me, image_bytes("JPEG"), filename="no-extension").status_code == 200
    assert upload(client, me, image_bytes("WEBP"), filename="x.exe").status_code == 200
    assert sorted(r["filename"].rsplit(".", 1)[1] for r in rows(db, me.id)) == ["jpg", "png", "webp"]


def test_both_angles_and_several_days_are_kept_and_listed_newest_first_front_before_back(client, me):
    tomorrow = TODAY + dt.timedelta(days=1)       # a new account's window is today..tomorrow
    for day, angle in ((TODAY, "back"), (tomorrow, "back"), (tomorrow, "front"), (TODAY, "front")):
        assert upload(client, me, image_bytes(), angle=angle, day=day).status_code == 200
    listed = client.get("/api/checkin/photos", headers=bearer(me)).get_json()["photos"]
    assert [(p["date"], p["angle"]) for p in listed] == [
        (tomorrow.isoformat(), "back"), (tomorrow.isoformat(), "front"),
        (TODAY.isoformat(), "back"), (TODAY.isoformat(), "front")]


def test_the_list_holds_only_the_callers_own_photos(client, me, person):
    other = Person("other")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Other One"})
        upload(client, other, image_bytes())
        assert client.get("/api/checkin/photos", headers=bearer(me)).get_json() == {"ok": True, "photos": []}
        upload(client, me, image_bytes())
        assert len(client.get("/api/checkin/photos", headers=bearer(me)).get_json()["photos"]) == 1
        assert len(client.get("/api/checkin/photos", headers=bearer(other)).get_json()["photos"]) == 1
    finally:
        forget(other)


def test_there_is_nothing_to_upload_to_without_a_profile(client, person, db):
    r = upload(client, person, image_bytes())
    assert r.status_code == 404 and r.get_json()["ok"] is False
    assert objects_of(db, person.id) == []


# -- everything that must be refused, and leave nothing behind ----------------------------------------------

@pytest.mark.parametrize("angle", [None, "", "side", "FRONT", "front ", "up"])
def test_only_front_and_back_are_angles(client, me, db, angle):
    r = upload(client, me, image_bytes(), angle=angle)
    assert r.status_code == 400 and r.get_json()["error"] == "angle must be 'front' or 'back'."
    assert_nothing_left(db, me.id)


def other_shapes_of_today():
    """Forms Python's own date parser accepts but the API must not: the shape is part of the contract."""
    iso = TODAY.isocalendar()
    return [TODAY.strftime("%Y%m%d"), f"{iso.year}-W{iso.week:02d}-{iso.weekday}", f"{iso.year}W{iso.week:02d}{iso.weekday}",
            "".join(chr(0x0660 + int(c)) if c.isdigit() else c for c in TODAY.isoformat()),     # Arabic-Indic digits
            TODAY.isoformat() + "T10:00", TODAY.isoformat() + " 10:00", TODAY.isoformat() + "; drop table"]


@pytest.mark.parametrize("day", ["", "yesterday", "2026-13-01", "2026-02-30", "20261024", "2026-W43-1", "2026-1-5", "2026-10-24T10:00",
                                 " "] + other_shapes_of_today())
def test_the_date_must_be_a_real_calendar_day_in_exactly_the_expected_shape(client, me, db, day):
    r = upload(client, me, image_bytes(), day=day)
    assert r.status_code == 400 and r.get_json()["error"] == "Invalid date."
    assert_nothing_left(db, me.id)


def test_a_missing_date_is_invalid(client, me, db):
    r = upload(client, me, image_bytes(), day=False)
    assert r.status_code == 400 and r.get_json()["error"] == "Invalid date."
    assert_nothing_left(db, me.id)


def test_the_date_window_runs_from_the_day_the_account_was_made_to_tomorrow(client, me, db):
    created = photos.account_day(db_profile(db, me.id))
    assert upload(client, me, image_bytes(), day=TODAY + dt.timedelta(days=1)).status_code == 200, "the client's day can run a day ahead"
    assert upload(client, me, image_bytes(), day=created).status_code == 200, "the day the account was made is allowed"
    for bad in (TODAY + dt.timedelta(days=2), created - dt.timedelta(days=1), dt.date(2000, 1, 1), dt.date(9999, 12, 31)):
        r = upload(client, me, image_bytes(), day=bad)
        assert r.status_code == 400 and r.get_json()["error"] == "Invalid date.", bad
    assert len(rows(db, me.id)) == 2


def db_profile(db, uid):
    with db.connection() as conn:
        return conn.execute("select * from public.profiles where id = %s", (uid,)).fetchone()


def test_no_file_is_a_400(client, me, db):
    for r in (upload(client, me, None), client.post("/api/checkin/photo", headers=bearer(me), data={"angle": "front", "date": TODAY.isoformat()})):
        assert r.status_code == 400 and r.get_json()["error"] == "No photo uploaded."
    assert upload(client, me, b"").get_json()["error"] == "No photo uploaded."
    assert_nothing_left(db, me.id)


@pytest.mark.parametrize("name,data", [
    ("garbage", b"\x00\x01\x02 not an image" * 50),
    ("text renamed", b"<html>hello</html>"),
    ("svg", b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
    ("truncated jpeg", image_bytes("JPEG")[:40]),
    ("jpeg header only", b"\xff\xd8\xff\xe0"),
    ("elf binary", b"\x7fELF" + b"\x00" * 200),
])
def test_bytes_that_are_not_an_image_are_refused_whatever_they_are_called(client, me, db, name, data):
    r = upload(client, me, data, filename="photo.jpg")
    assert r.status_code == 400 and r.get_json()["error"] == "That file isn't a readable image."
    assert_nothing_left(db, me.id)


def corrupt_png():
    data = bytearray(image_bytes("PNG"))
    data[data.index(b"IDAT") + 6] ^= 0xFF          # inside the compressed pixels: the header still parses, the checksum does not
    return bytes(data)


def test_a_file_with_a_valid_header_but_a_damaged_body_is_refused(client, me, db):
    """Pillow opens it lazily from the header alone; only verifying the structure notices the damage."""
    probe = Image.open(io.BytesIO(corrupt_png()))
    assert probe.format == "PNG", "the fixture must open fine"
    r = upload(client, me, corrupt_png())
    assert r.status_code == 400 and r.get_json()["error"] == "That file isn't a readable image."
    assert_nothing_left(db, me.id)


@pytest.mark.parametrize("fmt", ["GIF", "BMP", "TIFF"])
def test_a_real_image_in_a_format_the_app_does_not_take_is_refused(client, me, db, fmt):
    r = upload(client, me, image_bytes(fmt), filename="photo.jpg")
    assert r.status_code == 400 and r.get_json()["error"] == "Unsupported image format."
    assert_nothing_left(db, me.id)


def test_an_icon_file_is_refused_too_though_pillow_cannot_vouch_for_it(client, me, db):
    r = upload(client, me, image_bytes("ICO"), filename="photo.jpg")
    assert r.status_code == 400 and r.get_json()["ok"] is False
    assert_nothing_left(db, me.id)


def png_padded_to(size):
    base = image_bytes("PNG")
    return base + b"\x00" * (size - len(base))


def test_exactly_twelve_mib_is_accepted_and_one_byte_more_is_refused_before_it_is_stored(client, me, db):
    ok = upload(client, me, png_padded_to(photos.MAX_PHOTO_BYTES))
    assert ok.status_code == 200, ok.get_json()
    too_big = upload(client, me, png_padded_to(photos.MAX_PHOTO_BYTES + 1))
    assert too_big.status_code == 413 and too_big.get_json()["ok"] is False
    assert len(rows(db, me.id)) == 1 and len(objects_of(db, me.id)) == 1


def test_the_upload_body_limit_has_only_the_headroom_a_form_needs():
    from api.routes import photos as route
    assert photos.MAX_PHOTO_BYTES < route.UPLOAD_BODY_LIMIT <= photos.MAX_PHOTO_BYTES + 1024 * 1024,         "too low rejects a legal photo; too high buffers a huge body before refusing it"


def test_a_huge_body_is_a_413_without_being_read(client, me, db):
    r = upload(client, me, b"\x00" * (20 * 1024 * 1024))
    assert r.status_code == 413 and r.get_json()["ok"] is False
    assert_nothing_left(db, me.id)


def test_a_signed_out_or_forged_caller_cannot_upload(client, me, db):
    form = {"angle": "front", "date": TODAY.isoformat(), "photo": (io.BytesIO(image_bytes()), "p.jpg")}
    assert client.post("/api/checkin/photo", data=form, content_type="multipart/form-data").status_code == 401
    forged = {"Authorization": bearer(me)["Authorization"][:-5] + "AAAAA"}
    form["photo"] = (io.BytesIO(image_bytes()), "p.jpg")
    assert client.post("/api/checkin/photo", headers=forged, data=form, content_type="multipart/form-data").status_code == 401
    assert_nothing_left(db, me.id)


# -- the 500-photo ceiling -----------------------------------------------------------------------------

def seed_photos(db, uid, n):
    with db.connection() as conn:
        conn.execute(
            "insert into public.progress_photos (user_id, date, angle, filename) "
            "select %s, current_date, 'front', 'seed-' || g || '.jpg' from generate_series(1, %s) g", (uid, n))


def test_at_the_ceiling_a_new_photo_is_a_429_and_nothing_is_stored(client, me, db):
    seed_photos(db, me.id, photos.PHOTO_LIMIT)
    r = upload(client, me, image_bytes())
    assert r.status_code == 429
    assert r.get_json()["error"] == "You've reached the maximum of 500 saved items here. Delete some to add more."
    assert len(rows(db, me.id)) == 500 and objects_of(db, me.id) == []


def test_the_ceiling_is_the_websites(client):
    from pathlib import Path
    import re
    source = (Path(__file__).resolve().parent.parent / "app.py").read_text(encoding="utf-8")
    assert int(re.search(r'"progress_photos": (\d+)', source).group(1)) == photos.PHOTO_LIMIT
    assert int(re.search(r"MAX_PHOTO_BYTES = (\d+) \* 1024 \* 1024", source).group(1)) * 1024 * 1024 == photos.MAX_PHOTO_BYTES


def test_two_uploads_racing_for_the_last_place_cannot_both_win_and_the_loser_leaves_no_file(settings, db, me):
    seed_photos(db, me.id, photos.PHOTO_LIMIT - 1)
    app = create_app(settings, db=db, sweep=False)
    results, gate = [], threading.Barrier(4)

    def go():
        c = app.test_client()
        gate.wait()
        results.append(upload(c, me, image_bytes()).status_code)
    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join(120) for t in threads]
    assert sorted(results) == [200, 429, 429, 429]
    assert len(rows(db, me.id)) == 500 and len(objects_of(db, me.id)) == 1


def test_one_users_full_quota_does_not_block_another_user(client, me, db):
    other = Person("crowded")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Crowded"})
        seed_photos(db, other.id, photos.PHOTO_LIMIT)
        assert upload(client, me, image_bytes()).status_code == 200
        assert upload(client, other, image_bytes()).status_code == 429
    finally:
        forget(other)


def test_a_second_upload_waits_for_the_first_to_finish_recording_so_the_count_cannot_be_raced(db, me):
    """Deterministic: hold the user's lock on one connection and show that recording a photo on another cannot proceed."""
    outcome = {}

    def second():
        with db.connection() as conn:
            outcome["id"] = photos.insert_if_room(conn, me.id, TODAY, "front", "second.jpg")

    with db.connection() as first:
        photos.lock_user(first, me.id)
        worker = threading.Thread(target=second)
        worker.start()
        worker.join(2.5)
        assert worker.is_alive() and "id" not in outcome, "the second recording did not wait for the lock"
    worker.join(30)
    assert outcome["id"] is not None and not worker.is_alive()


def test_another_users_lock_does_not_hold_this_user_up(db, me):
    other = Person("lockless")
    try:
        done = threading.Event()

        def mine():
            with db.connection() as conn:
                photos.insert_if_room(conn, me.id, TODAY, "front", "mine.jpg")
            done.set()
        with db.connection() as theirs:
            photos.lock_user(theirs, other.id)
            threading.Thread(target=mine).start()
            assert done.wait(20), "one user's lock blocked a different user"
    finally:
        forget(other)


def test_a_delete_makes_room_again(client, me, db):
    seed_photos(db, me.id, photos.PHOTO_LIMIT - 1)
    first = upload(client, me, image_bytes()).get_json()["id"]
    assert upload(client, me, image_bytes()).status_code == 429
    assert client.delete(f"/api/checkin/photo/{first}", headers=bearer(me)).status_code == 200
    assert upload(client, me, image_bytes()).status_code == 200


# -- storage and database failures ---------------------------------------------------------------------

class SpyStorage:
    """The real Storage, except where told to fail; records what it was asked."""

    def __init__(self, real, fail_upload=None, fail_remove=False):
        self.real, self.fail_upload, self.fail_remove, self.removed = real, fail_upload, fail_remove, []

    def upload(self, *a, **k):
        if self.fail_upload:
            raise self.fail_upload
        return self.real.upload(*a, **k)

    def remove(self, bucket, keys):
        self.removed += list(keys)
        return list(keys) if self.fail_remove else self.real.remove(bucket, keys)

    def sign(self, *a, **k):
        return self.real.sign(*a, **k)


def app_with(settings, db, storage_double):
    return create_app(settings, db=db, storage=storage_double, sweep=False).test_client()


def test_a_storage_outage_is_a_502_with_no_row(settings, db, storage, me):
    c = app_with(settings, db, SpyStorage(storage, fail_upload=SupabaseError("down")))
    r = upload(c, me, image_bytes())
    assert r.status_code == 502 and "try again" in r.get_json()["error"]
    assert_nothing_left(db, me.id)


def test_a_file_the_bucket_itself_refuses_is_a_400_with_no_row(settings, db, storage, me):
    c = app_with(settings, db, SpyStorage(storage, fail_upload=Refused("mime type not supported")))
    r = upload(c, me, image_bytes())
    assert r.status_code == 400 and "mime" not in r.get_json()["error"]
    assert_nothing_left(db, me.id)


def test_if_recording_the_photo_fails_the_stored_file_is_removed(settings, db, storage, me, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("database fell over")
    monkeypatch.setattr(photos, "insert_if_room", boom)
    spy = SpyStorage(storage)
    r = upload(app_with(settings, db, spy), me, image_bytes())
    assert r.status_code == 500 and "fell over" not in r.get_data(as_text=True)
    assert len(spy.removed) == 1 and spy.removed[0].startswith(me.id + "/")
    assert_nothing_left(db, me.id)


# -- reading a photo -----------------------------------------------------------------------------------

def test_a_signed_link_serves_the_callers_own_photo_to_whoever_holds_it_for_a_few_minutes(client, me):
    from test_supabase_rls import HTTP
    data = image_bytes("PNG")
    photo_id = upload(client, me, data).get_json()["id"]
    r = client.get(f"/api/checkin/photo/{photo_id}", headers=bearer(me))
    body = r.get_json()
    assert r.status_code == 200 and body["expires_in"] == 300 and body["url"].startswith("https://")
    fetched = HTTP.get(body["url"], timeout=60)
    assert fetched.status_code == 200 and fetched.content == data


def test_nobody_gets_a_link_to_someone_elses_photo_or_to_one_that_does_not_exist(client, me):
    other = Person("snoop")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Snoop"})
        photo_id = upload(client, me, image_bytes()).get_json()["id"]
        for who, pid in ((other, photo_id), (me, photo_id + 100000), (me, 0)):
            r = client.get(f"/api/checkin/photo/{pid}", headers=bearer(who))
            assert r.status_code == 404 and "url" not in r.get_json(), (who.id == me.id, pid)
    finally:
        forget(other)


def test_a_row_whose_file_has_gone_is_a_404_not_a_dead_link(client, me, db, storage):
    photo_id = upload(client, me, image_bytes()).get_json()["id"]
    (row,) = rows(db, me.id)
    storage.remove("progress-photos", [f"{me.id}/{row['filename']}"])
    assert client.get(f"/api/checkin/photo/{photo_id}", headers=bearer(me)).status_code == 404


# -- deleting ------------------------------------------------------------------------------------------

def test_deleting_removes_the_file_and_the_row_and_only_that_photo(client, me, db):
    keep = upload(client, me, image_bytes("PNG"), angle="back").get_json()["id"]
    gone = upload(client, me, image_bytes("JPEG")).get_json()["id"]
    assert len(objects_of(db, me.id)) == 2
    assert client.delete(f"/api/checkin/photo/{gone}", headers=bearer(me)).get_json() == {"ok": True}
    assert [r["id"] for r in rows(db, me.id)] == [keep] and len(objects_of(db, me.id)) == 1
    assert client.delete(f"/api/checkin/photo/{gone}", headers=bearer(me)).status_code == 404, "deleting twice"


def test_nobody_can_delete_someone_elses_photo(client, me, db):
    other = Person("thief")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Thief"})
        photo_id = upload(client, me, image_bytes()).get_json()["id"]
        r = client.delete(f"/api/checkin/photo/{photo_id}", headers=bearer(other))
        assert r.status_code == 404
        assert len(rows(db, me.id)) == 1 and len(objects_of(db, me.id)) == 1
    finally:
        forget(other)


def test_if_the_file_will_not_go_the_photo_stays_listed_so_the_delete_can_be_retried(settings, db, storage, me):
    c = app_with(settings, db, SpyStorage(storage, fail_remove=True))
    photo_id = upload(c, me, image_bytes()).get_json()["id"]
    r = c.delete(f"/api/checkin/photo/{photo_id}", headers=bearer(me))
    assert r.status_code == 502 and "try again" in r.get_json()["error"]
    assert len(rows(db, me.id)) == 1 and len(objects_of(db, me.id)) == 1
    assert app_with(settings, db, storage).delete(f"/api/checkin/photo/{photo_id}", headers=bearer(me)).status_code == 200
    assert_nothing_left(db, me.id)


def test_deleting_when_the_file_is_already_gone_still_clears_the_row(client, me, db, storage):
    photo_id = upload(client, me, image_bytes()).get_json()["id"]
    (row,) = rows(db, me.id)
    storage.remove("progress-photos", [f"{me.id}/{row['filename']}"])
    assert client.delete(f"/api/checkin/photo/{photo_id}", headers=bearer(me)).status_code == 200
    assert rows(db, me.id) == []


def test_the_app_can_read_its_own_photo_rows_and_files_directly_but_not_anyone_elses(client, me, db):
    """The design: Flask writes, the app reads. Prove the other half of that contract against the same data."""
    from test_supabase_rls import ENV, HTTP, _url
    other = Person("reader")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Reader"})
        photo_id = upload(client, me, image_bytes()).get_json()["id"]
        (row,) = rows(db, me.id)
        mine = me.client.get("progress_photos", select="id,filename").json()
        assert [r["id"] for r in mine] == [photo_id]
        assert other.client.get("progress_photos", select="id").json() == []
        got = HTTP.get(_url(f"/storage/v1/object/authenticated/progress-photos/{me.id}/{row['filename']}"),
                       headers={"apikey": ENV["SUPABASE_ANON_KEY"], "Authorization": me.client.headers["Authorization"]}, timeout=60)
        denied = HTTP.get(_url(f"/storage/v1/object/authenticated/progress-photos/{me.id}/{row['filename']}"),
                          headers={"apikey": ENV["SUPABASE_ANON_KEY"], "Authorization": other.client.headers["Authorization"]}, timeout=60)
        assert got.status_code == 200 and denied.status_code != 200
    finally:
        forget(other)
