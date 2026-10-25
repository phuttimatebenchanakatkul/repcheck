"""The importer's file copy (photos and analysis clips -> Storage): planning, scanning, the Storage client,
copying, verifying and tidying. No network and no database: the Storage API and the connection are faked.
The orchestration inside main() is tested next to the rest of main() in test_sqlite_to_supabase_plan.py.

The names below are the old server's real shapes: a hex id plus an extension (app.py, api_checkin_photo_upload
and the analyze route), in DATA_DIR/progress_photos and DATA_DIR/analyze_videos.
"""

import hashlib
import re
import sys
import types
from pathlib import Path

import pytest

from importer_loader import imp

ROOT = Path(__file__).resolve().parent.parent
UID = imp.user_uuid(1)
OTHER = imp.user_uuid(2)


# -- planning ----------------------------------------------------------------------------------------

def rows(photos=(), analyses=()):
    return {"progress_photos": [{"user_id": u, "filename": n} for u, n in photos],
            "analyze_results": [{"user_id": u, "video_filename": n} for u, n in analyses]}


def test_files_are_planned_per_bucket_from_the_rows_and_a_file_shared_by_two_rows_is_planned_once():
    planned, unusable = imp.plan_files(rows(
        photos=[(UID, "a1.jpg"), (UID, "a1.jpg"), (UID, "b2.PNG"), (OTHER, "a1.jpg")],
        analyses=[(UID, "1_deadbeef.mp4"), (UID, None), (UID, "")]))
    assert planned == [("progress-photos", UID, "a1.jpg"), ("progress-photos", UID, "b2.PNG"),
                       ("progress-photos", OTHER, "a1.jpg"), ("analyze-videos", UID, "1_deadbeef.mp4")]
    assert unusable == []


@pytest.mark.parametrize("name", [
    "../x.jpg", "a/b.jpg", "a\\b.jpg", ".hidden.jpg", "a b.jpg", "x" * 201 + ".jpg", "noext", "x.exe", "x.jpg.exe", "..", "é.jpg",
    "a\x00.jpg"])
def test_a_name_the_old_server_could_not_have_generated_is_never_copied(name):
    """The name is joined to a directory and put in an object key: a tampered export must not reach either."""
    planned, unusable = imp.plan_files(rows(photos=[(UID, name)]))
    assert planned == [] and [u[2] for u in unusable] == [name]


def test_an_extension_that_belongs_to_the_other_bucket_is_not_allowed():
    planned, unusable = imp.plan_files(rows(photos=[(UID, "clip.mp4")], analyses=[(UID, "pic.jpg")]))
    assert planned == [] and [(u[0], u[2]) for u in unusable] == [("progress-photos", "clip.mp4"), ("analyze-videos", "pic.jpg")]
    assert all("not allowed" in u[3] for u in unusable)


def test_the_buckets_equal_the_migration_and_the_old_servers_folders():
    """Three places state the same facts. If they drift, files are refused (or accepted) for no visible reason."""
    sql = (ROOT / "supabase" / "migrations" / "20261025100000_storage_buckets.sql").read_text(encoding="utf-8")
    for bucket, spec in imp.BUCKETS.items():
        m = re.search(rf"\('{bucket}', '{bucket}', false, (\d+),\s*array\[([^\]]*)\]", sql)
        assert m, bucket
        assert int(m.group(1)) == spec["limit"]
        assert set(re.findall(r"'([^']+)'", m.group(2))) == set(spec["types"].values())
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    assert f'PROGRESS_PHOTOS_DIR = DATA_DIR / "{imp.BUCKETS["progress-photos"]["dir"]}"' in app
    assert f'ANALYZE_VIDEOS_DIR = DATA_DIR / "{imp.BUCKETS["analyze-videos"]["dir"]}"' in app
    assert imp.BUCKETS["progress-photos"]["limit"] == int(re.search(r"MAX_PHOTO_BYTES = (\d+) \* 1024 \* 1024", app).group(1)) * 1024 * 1024
    for ext in re.search(r"ALLOWED_PHOTO_EXTENSIONS = \{([^}]*)\}", app).group(1).replace('"', "").replace(" ", "").split(","):
        assert ext in imp.BUCKETS["progress-photos"]["types"]


# -- scanning ----------------------------------------------------------------------------------------

def disk(tmp_path, photos=(), videos=()):
    for folder, names in (("progress_photos", photos), ("analyze_videos", videos)):
        (tmp_path / folder).mkdir(exist_ok=True)
        for name, data in names:
            (tmp_path / folder / name).write_bytes(data)
    return tmp_path


def test_scan_sorts_the_planned_files_into_found_missing_and_not_copyable(tmp_path, monkeypatch):
    root = disk(tmp_path, photos=[("a.jpg", b"1234"), ("big.jpg", b"x" * 50)], videos=[("v.mp4", b"vid")])
    monkeypatch.setitem(imp.BUCKETS["progress-photos"], "limit", 10)
    planned = [("progress-photos", UID, "a.jpg"), ("progress-photos", UID, "big.jpg"),
               ("progress-photos", UID, "gone.jpg"), ("analyze-videos", UID, "v.mp4")]
    scan = imp.scan_files(planned, root)
    assert [(b, n, size) for b, _u, n, _p, size in scan.found] == [("progress-photos", "a.jpg", 4), ("analyze-videos", "v.mp4", 3)]
    assert scan.missing == [("progress-photos", UID, "gone.jpg")]
    assert [(r[2], "over the 10 byte limit" in r[3]) for r in scan.refused] == [("big.jpg", True)]
    assert scan.found[0][3] == tmp_path / "progress_photos" / "a.jpg"


def test_a_file_is_looked_for_in_its_own_buckets_folder_only(tmp_path):
    root = disk(tmp_path, videos=[("a.jpg", b"misfiled")])
    scan = imp.scan_files([("progress-photos", UID, "a.jpg")], root)
    assert scan.found == [] and scan.missing == [("progress-photos", UID, "a.jpg")]


def test_a_symbolic_link_is_refused_not_followed(tmp_path, monkeypatch):
    """A link in a copied folder could point anywhere on the machine that runs the import. (Simulated: creating
    a real one needs a privilege on Windows, and a skipped test guards nothing.)"""
    root = disk(tmp_path, photos=[("real.jpg", b"secret"), ("link.jpg", b"stands in for a link")])
    real_is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda self: self.name == "link.jpg" or real_is_symlink(self))
    scan = imp.scan_files([("progress-photos", UID, "link.jpg"), ("progress-photos", UID, "real.jpg")], root)
    assert [f[2] for f in scan.found] == ["real.jpg"]
    assert scan.refused == [("progress-photos", UID, "link.jpg", "is a symbolic link")]


def test_a_directory_with_a_file_name_is_missing_not_a_file(tmp_path):
    root = disk(tmp_path)
    (root / "progress_photos" / "dir.jpg").mkdir()
    assert imp.scan_files([("progress-photos", UID, "dir.jpg")], root).missing == [("progress-photos", UID, "dir.jpg")]


# -- the Storage client --------------------------------------------------------------------------------

class FakeResponse:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


class FakeSession:
    def __init__(self):
        self.calls, self.queue, self.next = [], [], FakeResponse(200, {})

    def _record(self, verb, url, **kw):
        if "data" in kw:
            kw = dict(kw, sent=kw["data"].read())          # the file is closed once the call returns
        self.calls.append((verb, url, kw))
        item = self.queue.pop(0) if self.queue else self.next
        if isinstance(item, Exception):
            raise item
        return item

    def post(self, url, **kw):
        return self._record("post", url, **kw)

    def delete(self, url, **kw):
        return self._record("delete", url, **kw)


@pytest.fixture
def store_and_session(monkeypatch):
    session, slept = FakeSession(), []
    fake = types.ModuleType("requests")
    fake.Session = lambda: session
    monkeypatch.setitem(sys.modules, "requests", fake)
    store = imp.Store({"SUPABASE_URL": "https://abc.supabase.co/", "SUPABASE_SERVICE_ROLE_KEY": "the-key"}, sleep=slept.append)
    store.slept = slept
    return store, session


def test_upload_sends_the_file_to_its_key_as_an_upsert_with_its_content_type(store_and_session, tmp_path):
    store, session = store_and_session
    f = tmp_path / "a.jpg"
    f.write_bytes(b"\xff\xd8bytes")
    assert store.upload("progress-photos", f"{UID}/a.jpg", f, "image/jpeg") == ("ok", None)
    (verb, url, kw), = session.calls
    assert (verb, url) == ("post", f"https://abc.supabase.co/storage/v1/object/progress-photos/{UID}/a.jpg")
    assert kw["sent"] == b"\xff\xd8bytes" and kw["timeout"] == 300
    assert kw["headers"] == {"apikey": "the-key", "Authorization": "Bearer the-key", "Content-Type": "image/jpeg", "x-upsert": "true"}


@pytest.mark.parametrize("code", ["413", 413, "415"])
def test_a_file_the_bucket_turns_away_is_refused_not_fatal(store_and_session, tmp_path, code):
    """Storage answers HTTP 400 and puts the real status in the body."""
    store, session = store_and_session
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    session.next = FakeResponse(400, {"statusCode": code, "error": "Payload too large", "message": "The object exceeded the maximum allowed size"})
    assert store.upload("progress-photos", "k", f, "image/jpeg") == ("refused", "The object exceeded the maximum allowed size")
    assert len(session.calls) == 1, "a refusal is final, not retried"


@pytest.mark.parametrize("status,body", [(400, {"statusCode": "400", "message": "bad"}), (401, {}), (403, {"statusCode": "403"}), (404, None)])
def test_any_other_refusal_stops_the_run(store_and_session, tmp_path, status, body):
    store, session = store_and_session
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    session.next = FakeResponse(status, body)
    with pytest.raises(imp.StoreError, match=f"answered {status}"):
        store.upload("progress-photos", "k", f, "image/jpeg")


def test_a_server_error_is_retried_with_the_file_reopened_each_time(store_and_session, tmp_path):
    store, session = store_and_session
    f = tmp_path / "a.jpg"
    f.write_bytes(b"whole file")
    session.queue = [FakeResponse(503), OSError("reset"), FakeResponse(200, {})]
    assert store.upload("progress-photos", "k", f, "image/jpeg") == ("ok", None)
    assert [c[2]["sent"] for c in session.calls] == [b"whole file"] * 3, "every attempt sends the whole file"
    assert store.slept == [1, 2]


def test_storage_gives_up_after_four_attempts_with_a_store_error(store_and_session, tmp_path):
    store, session = store_and_session
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    session.next = FakeResponse(500)
    with pytest.raises(imp.StoreError, match="kept failing: 500"):
        store.upload("progress-photos", "k", f, "image/jpeg")
    assert len(session.calls) == 4


def test_remove_asks_for_the_keys_as_prefixes_and_returns_the_status(store_and_session):
    store, session = store_and_session
    assert store.remove("analyze-videos", ["a/1.mp4", "a/2.mp4"]) == 200
    (verb, url, kw), = session.calls
    assert (verb, url) == ("delete", "https://abc.supabase.co/storage/v1/object/analyze-videos")
    assert kw["json"] == {"prefixes": ["a/1.mp4", "a/2.mp4"]}


# -- copying -------------------------------------------------------------------------------------------

class RecordingStore:
    def __init__(self, refuse=(), explode_on=None):
        self.uploads, self.refuse, self.explode_on = [], set(refuse), explode_on

    def upload(self, bucket, key, path, content_type):
        if key == self.explode_on:
            raise imp.StoreError("boom")
        self.uploads.append((bucket, key, content_type, Path(path).read_bytes()))
        return ("refused", "mime type") if key in self.refuse else ("ok", None)


def found(tmp_path, items):
    out = []
    for bucket, uid, name, data in items:
        p = tmp_path / name
        p.write_bytes(data)
        out.append((bucket, uid, name, p, len(data)))
    scan = imp.FileScan()
    scan.found = out
    return scan


def test_copy_uploads_every_file_under_its_key_with_its_type_and_remembers_what_it_sent(tmp_path):
    scan = found(tmp_path, [("progress-photos", UID, "a.JPG", b"photo"), ("analyze-videos", UID, "v.webm", b"video")])
    store, result = RecordingStore(), imp.FileCopy()
    imp.copy_files(scan, store, set(), result)
    assert [(b, k, t) for b, k, t, _d in store.uploads] == [
        ("progress-photos", f"{UID}/a.JPG", "image/jpeg"), ("analyze-videos", f"{UID}/v.webm", "video/webm")]
    assert result.expected == {("progress-photos", f"{UID}/a.JPG"): (hashlib.md5(b"photo").hexdigest(), 5),
                               ("analyze-videos", f"{UID}/v.webm"): (hashlib.md5(b"video").hexdigest(), 5)}
    assert result.created == list(result.expected)


def test_an_object_that_was_already_there_is_not_recorded_as_created_so_a_failed_run_leaves_it(tmp_path):
    scan = found(tmp_path, [("progress-photos", UID, "a.jpg", b"1"), ("progress-photos", UID, "b.jpg", b"2")])
    result = imp.FileCopy()
    imp.copy_files(scan, RecordingStore(), {("progress-photos", f"{UID}/a.jpg")}, result)
    assert result.created == [("progress-photos", f"{UID}/b.jpg")] and len(result.expected) == 2


def test_a_file_the_bucket_refuses_is_reported_and_not_expected_in_storage(tmp_path):
    scan = found(tmp_path, [("progress-photos", UID, "a.jpg", b"1"), ("progress-photos", UID, "b.jpg", b"2")])
    result = imp.FileCopy()
    imp.copy_files(scan, RecordingStore(refuse={f"{UID}/b.jpg"}), set(), result)
    assert result.refused == [("progress-photos", UID, "b.jpg", "mime type")]
    assert list(result.expected) == [("progress-photos", f"{UID}/a.jpg")]


def test_an_object_is_marked_created_before_its_upload_so_a_crash_mid_upload_is_undone_too(tmp_path):
    scan = found(tmp_path, [("progress-photos", UID, "a.jpg", b"1"), ("progress-photos", UID, "b.jpg", b"2")])
    result = imp.FileCopy()
    with pytest.raises(imp.StoreError):
        imp.copy_files(scan, RecordingStore(explode_on=f"{UID}/b.jpg"), set(), result)
    assert result.created == [("progress-photos", f"{UID}/a.jpg"), ("progress-photos", f"{UID}/b.jpg")]
    assert list(result.expected) == [("progress-photos", f"{UID}/a.jpg")]


def test_progress_is_reported_every_hundred_files(tmp_path):
    p = tmp_path / "a.jpg"
    p.write_bytes(b"x")
    scan = imp.FileScan()
    scan.found = [("progress-photos", UID, f"{i}.jpg", p, 1) for i in range(250)]
    said = []
    imp.copy_files(scan, RecordingStore(), set(), imp.FileCopy(), say=said.append)
    assert said == ["  copied 100 of 250 files", "  copied 200 of 250 files"]


# -- verifying against Storage's own record ----------------------------------------------------------------

class StorageCursor:
    def __init__(self, tables, log):
        self.tables, self.log, self.rows = tables, log, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.log.append((sql, params))
        self.rows = self.tables.get(params[0], []) if params else []

    def fetchall(self):
        return self.rows


class StorageConn:
    def __init__(self, tables):
        self.tables, self.log = tables, []

    def cursor(self):
        return StorageCursor(self.tables, self.log)


def expected_one(data=b"photo", bucket="progress-photos", key=f"{UID}/a.jpg"):
    result = imp.FileCopy()
    result.expected[(bucket, key)] = (hashlib.md5(data).hexdigest(), len(data))
    return result


def test_verify_files_accepts_an_object_whose_etag_is_the_md5_and_whose_size_matches():
    conn = StorageConn({"progress-photos": [(f"{UID}/a.jpg", '"' + hashlib.md5(b"photo").hexdigest() + '"', 5)]})
    assert imp.verify_files(expected_one(), conn) == []
    sql, params = conn.log[0]
    assert "from storage.objects" in sql and "bucket_id = %s" in sql and params == ("progress-photos", [f"{UID}/a.jpg"])


@pytest.mark.parametrize("stored,message", [
    ([], "missing from Storage"),
    ([(f"{UID}/a.jpg", '"' + hashlib.md5(b"photo").hexdigest() + '"', 6)], "6 bytes in Storage, 5 on disk"),
    ([(f"{UID}/a.jpg", '"' + hashlib.md5(b"other").hexdigest() + '"', 5)], "content differs"),
    ([(f"{UID}/a.jpg", None, 5)], "content differs"),
])
def test_verify_files_reports_a_missing_a_resized_and_a_different_object_without_naming_anyone(stored, message):
    problems = imp.verify_files(expected_one(), StorageConn({"progress-photos": stored}))
    assert len(problems) == 1 and message in problems[0]
    assert UID not in problems[0] and "a.jpg" not in problems[0]


def test_a_multipart_etag_is_not_an_md5_so_such_an_object_is_checked_by_size_alone_and_counted():
    result = expected_one()
    assert imp.verify_files(result, StorageConn({"progress-photos": [(f"{UID}/a.jpg", '"abc123-2"', 5)]})) == []
    assert result.size_only == 1
    assert imp.verify_files(expected_one(), StorageConn({"progress-photos": [(f"{UID}/a.jpg", '"abc123-2"', 9)]})) != []


def test_verify_files_asks_only_about_buckets_it_sent_something_to():
    conn = StorageConn({})
    imp.verify_files(expected_one(), conn)
    assert [p[0] for _s, p in conn.log] == ["progress-photos"]


# -- tidying: Storage must end up holding exactly the plan ------------------------------------------------------

def test_storage_extras_are_the_objects_in_these_users_folders_that_the_plan_does_not_call_for():
    class Cur(StorageCursor):
        def execute(self, sql, params=None):
            self.log.append((sql, params))
            self.rows = [("progress-photos", f"{UID}/keep.jpg"), ("progress-photos", f"{UID}/old.jpg"),
                         ("analyze-videos", f"{OTHER}/gone.mp4")]

    class Conn(StorageConn):
        def cursor(self):
            return Cur({}, self.log)
    conn = Conn({})
    wanted = {("progress-photos", f"{UID}/keep.jpg")}
    assert imp.storage_extras(conn, wanted, [UID, OTHER]) == [("analyze-videos", f"{OTHER}/gone.mp4"), ("progress-photos", f"{UID}/old.jpg")]
    sql, params = conn.log[0]
    assert "split_part(name, '/', 1) = any(%s)" in sql and params == (["progress-photos", "analyze-videos"], [UID, OTHER])


class RemovingStore:
    def __init__(self, status=200, error=None):
        self.calls, self.status, self.error = [], status, error

    def remove(self, bucket, keys):
        self.calls.append((bucket, list(keys)))
        if self.error:
            raise self.error
        return self.status


def test_delete_goes_through_the_api_in_batches_of_a_hundred_per_bucket():
    store = RemovingStore()
    items = [("progress-photos", f"u/{i}.jpg") for i in range(250)] + [("analyze-videos", "u/1.mp4")]
    assert imp.delete_objects(store, items) == []
    assert [(b, len(k)) for b, k in store.calls] == [("progress-photos", 100), ("progress-photos", 100), ("progress-photos", 50), ("analyze-videos", 1)]


@pytest.mark.parametrize("store", [RemovingStore(status=500), RemovingStore(error=RuntimeError("down"))])
def test_objects_that_will_not_delete_are_returned_not_raised(store):
    assert imp.delete_objects(store, [("progress-photos", "u/1.jpg")]) == [("progress-photos", "u/1.jpg")]


def test_undo_removes_what_the_run_created_and_says_so_when_it_cannot(capsys):
    store = RemovingStore(status=500)
    assert imp.undo_files(store, [("progress-photos", "u/1.jpg")]) == [("progress-photos", "u/1.jpg")]
    assert "could not remove 1 stored files" in capsys.readouterr().err
    quiet = RemovingStore()
    assert imp.undo_files(quiet, []) == [] and quiet.calls == []
