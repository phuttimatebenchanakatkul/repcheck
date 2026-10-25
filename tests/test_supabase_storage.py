"""Two-user isolation tests for Supabase Storage (supabase/migrations/20261025100000_storage_buckets.sql).

Same method as test_supabase_rls.py: the REAL project, the same path the native app will
use (sign in, then call the Storage API with that user's JWT), never the owner's access.

What is being protected: progress photos and analysis clips, in two private buckets under
'<user id>/<file>'. The app may READ its own files and do nothing else; Flask (service role)
writes and deletes. Every refusal below is proved by its EFFECT (the bytes and the set of
keys are unchanged afterwards, read back with the service key), not by a status code,
because Storage answers a refused write with HTTP 400 and a 403/404 buried in the body, and
answers a refused bulk delete with 200 and an empty list.

A refusal test can pass for the wrong reason (a malformed request is refused whatever the
policy says), so test_the_write_requests_used_here_are_well_formed runs the very same
requests as the service role and requires every one to succeed.

Skipped, not failed, when SUPABASE_* is not configured. Mutation-check any change here
(CLAUDE.md): loosen the policy it guards and confirm the matching test goes red.
"""

import hashlib
import uuid

import pytest

from test_supabase_rls import ENV, HTTP, Person, _admin_delete_user, _url, needs_api, needs_db

BUCKETS = {
    # id -> (file_size_limit, allowed_mime_types, name of the one file each test user owns)
    "progress-photos": (12 * 1024 * 1024, {"image/jpeg", "image/png", "image/webp"}, "front.jpg"),
    "analyze-videos": (50 * 1024 * 1024, {"video/mp4", "video/quicktime", "video/x-m4v", "video/x-msvideo",
                                          "video/x-matroska", "video/webm"}, "clip.mp4"),
}
CONTENT_TYPE = {"progress-photos": "image/jpeg", "analyze-videos": "video/mp4"}
EXPECTED_POLICIES = {
    # (table, policy) -> bucket it guards. Nothing may write, and nothing is for anon.
    ("objects", "progress_photos_read_own"): "progress-photos",
    ("objects", "analyze_videos_read_own"): "analyze-videos",
}


class Storage:
    """One identity talking to the Storage API: anon, a signed-in user, or service."""

    def __init__(self, apikey, bearer=None):
        self.headers = {"apikey": apikey, "Authorization": "Bearer " + (bearer or apikey)}

    def _h(self, **extra):
        return dict(self.headers, **extra)

    def upload(self, bucket, key, data, content_type, upsert=False, method="post"):
        extra = {"Content-Type": content_type}
        if upsert:
            extra["x-upsert"] = "true"
        return getattr(HTTP, method)(_url(f"/storage/v1/object/{bucket}/{key}"), headers=self._h(**extra),
                                     data=data, timeout=120)

    def download(self, bucket, key):
        return HTTP.get(_url(f"/storage/v1/object/authenticated/{bucket}/{key}"), headers=self.headers, timeout=60)

    def public_url(self, bucket, key):
        return HTTP.get(_url(f"/storage/v1/object/public/{bucket}/{key}"), headers=self.headers, timeout=60)

    def list(self, bucket, prefix=""):
        r = HTTP.post(_url(f"/storage/v1/object/list/{bucket}"), headers=self._h(**{"Content-Type": "application/json"}),
                      json={"prefix": prefix, "limit": 100}, timeout=60)
        return r.json() if r.status_code == 200 and isinstance(r.json(), list) else []

    def remove(self, bucket, key):
        return HTTP.delete(_url(f"/storage/v1/object/{bucket}/{key}"), headers=self.headers, timeout=60)

    def remove_many(self, bucket, keys):
        return HTTP.delete(_url(f"/storage/v1/object/{bucket}"), headers=self._h(**{"Content-Type": "application/json"}),
                           json={"prefixes": list(keys)}, timeout=60)

    def move(self, bucket, source, destination):
        return HTTP.post(_url("/storage/v1/object/move"), headers=self._h(**{"Content-Type": "application/json"}),
                         json={"bucketId": bucket, "sourceKey": source, "destinationKey": destination}, timeout=60)

    def copy(self, bucket, source, destination):
        return HTTP.post(_url("/storage/v1/object/copy"), headers=self._h(**{"Content-Type": "application/json"}),
                         json={"bucketId": bucket, "sourceKey": source, "destinationKey": destination}, timeout=60)

    def sign(self, bucket, key):
        return HTTP.post(_url(f"/storage/v1/object/sign/{bucket}/{key}"), headers=self._h(**{"Content-Type": "application/json"}),
                         json={"expiresIn": 60}, timeout=60)

    def create_bucket(self, bucket, public=False):
        return HTTP.post(_url("/storage/v1/bucket"), headers=self._h(**{"Content-Type": "application/json"}),
                         json={"id": bucket, "name": bucket, "public": public}, timeout=60)

    def update_bucket(self, bucket, **fields):
        return HTTP.put(_url(f"/storage/v1/bucket/{bucket}"), headers=self._h(**{"Content-Type": "application/json"}),
                        json=fields, timeout=60)

    def delete_bucket(self, bucket):
        return HTTP.delete(_url(f"/storage/v1/bucket/{bucket}"), headers=self.headers, timeout=60)

    def empty_bucket(self, bucket):
        return HTTP.post(_url(f"/storage/v1/bucket/{bucket}/empty"), headers=self.headers, timeout=60)

    def get_bucket(self, bucket):
        return HTTP.get(_url(f"/storage/v1/bucket/{bucket}"), headers=self.headers, timeout=60)

    def list_buckets(self):
        r = HTTP.get(_url("/storage/v1/bucket"), headers=self.headers, timeout=60)
        return r.json() if r.status_code == 200 else None


def _names(listing):
    return {item["name"] for item in listing}


def _token(person):
    return person.client.headers["Authorization"].split(" ", 1)[1]


@pytest.fixture(scope="module")
def service():
    return Storage(ENV["SUPABASE_SERVICE_ROLE_KEY"])


@pytest.fixture(scope="module")
def anon():
    return Storage(ENV["SUPABASE_ANON_KEY"])


@pytest.fixture(scope="module")
def vault(service):
    """Users A and B who each own one photo and one clip (put there by the service role), and C
    who owns nothing. Everything under their folders is removed at the end, through the API:
    deleting an Auth user does not delete its files."""
    people = {k: Person(k) for k in ("sa", "sb", "sc")}
    for person in people.values():
        person.storage = Storage(ENV["SUPABASE_ANON_KEY"], _token(person))
    a, b, c = people["sa"], people["sb"], people["sc"]
    content = {}
    try:
        for tag, person in (("A", a), ("B", b)):
            for bucket, (_limit, _mimes, name) in BUCKETS.items():
                data = b"\xff\xd8secret-" + tag.encode() + b"-" + bucket.encode() + b"-" * 40
                r = service.upload(bucket, f"{person.id}/{name}", data, CONTENT_TYPE[bucket])
                assert r.status_code == 200, f"seeding {bucket}: {r.status_code} {r.text}"
                content[(tag, bucket)] = data
        yield {"a": a, "b": b, "c": c, "content": content}
    finally:
        for person in people.values():
            for bucket in BUCKETS:
                names = _names(service.list(bucket, person.id))
                if names:
                    service.remove_many(bucket, [f"{person.id}/{n}" for n in names])
            _admin_delete_user(person.id)


def _truth(service, person, bucket):
    """What is really stored under a person's folder: {name: bytes}, read with the service key."""
    out = {}
    for name in _names(service.list(bucket, person.id)):
        r = service.download(bucket, f"{person.id}/{name}")
        assert r.status_code == 200, f"ground-truth read of {name} failed: {r.status_code}"
        out[name] = r.content
    return out


def _expected_folder(vault, tag, bucket):
    return {BUCKETS[bucket][2]: vault["content"][(tag, bucket)]}


# ---------------------------------------------------------------------------
# The contract itself (catalog level)
# ---------------------------------------------------------------------------

@needs_db
def test_the_storage_buckets_are_exactly_the_reviewed_ones_and_all_private():
    import psycopg

    with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
        found = {r[0]: r for r in conn.execute("select id, public, file_size_limit, allowed_mime_types from storage.buckets")}
    assert set(found) == set(BUCKETS), f"unreviewed bucket(s) {sorted(set(found) ^ set(BUCKETS))}: decide who may do what, then add them here"
    for bucket, (limit, mimes, _name) in BUCKETS.items():
        _id, public, size_limit, allowed = found[bucket]
        assert public is False, f"{bucket} is PUBLIC: anyone with a URL can read every file in it"
        assert size_limit == limit, f"{bucket}: file_size_limit is {size_limit}, expected {limit}"
        assert set(allowed or []) == mimes, f"{bucket}: allowed_mime_types is {allowed}"


@needs_db
def test_storage_policies_are_exactly_the_reviewed_ones_and_each_is_scoped_to_the_caller():
    import psycopg

    with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
        rows = conn.execute("select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies "
                            "where schemaname = 'storage'").fetchall()
    assert {(t, p) for t, p, *_ in rows} == set(EXPECTED_POLICIES), f"policies on storage tables: {[(t, p) for t, p, *_ in rows]}"
    for table, policy, cmd, roles, qual, check in rows:
        bucket = EXPECTED_POLICIES[(table, policy)]
        assert cmd == "SELECT", f"{policy}: the app may only READ files, found {cmd}"
        assert roles == "{authenticated}", f"{policy}: roles are {roles}"
        assert check is None
        # the clause must name its bucket AND tie the first path segment to the caller
        assert f"'{bucket}'" in qual and "bucket_id" in qual, f"{policy}: not limited to {bucket}: {qual!r}"
        assert "foldername" in qual and "auth.uid()" in qual, f"{policy}: not scoped to the caller: {qual!r}"


@needs_db
def test_row_level_security_is_on_for_every_storage_table():
    import psycopg

    with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
        off = [r[0] for r in conn.execute(
            "select relname from pg_class where relnamespace = 'storage'::regnamespace and relkind in ('r', 'p') "
            "and not relrowsecurity")]
    assert not off, f"row level security is OFF on storage.{off}"


@needs_db
def test_direct_sql_cannot_delete_a_stored_file_so_account_deletion_must_use_the_api(service):
    """Why Flask has to remove a user's files through the Storage API before deleting the account."""
    import psycopg

    owner = str(uuid.uuid4())
    key = f"{owner}/sqlprobe.jpg"
    assert service.upload("progress-photos", key, b"\xff\xd8x", "image/jpeg").status_code == 200
    try:
        with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None, autocommit=True) as conn:
            with pytest.raises(Exception, match="Direct deletion from storage tables is not allowed"):
                conn.execute("delete from storage.objects where bucket_id = 'progress-photos' and name = %s", (key,))
        assert service.download("progress-photos", key).status_code == 200
    finally:
        service.remove("progress-photos", key)


@needs_db
def test_the_stored_etag_is_the_md5_of_the_bytes_which_is_how_the_importer_verifies_a_copy(service):
    import psycopg

    owner = str(uuid.uuid4())
    key = f"{owner}/etag.jpg"
    data = b"\xff\xd8" + uuid.uuid4().bytes * 1000
    assert service.upload("progress-photos", key, data, "image/jpeg").status_code == 200
    try:
        with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
            etag, size = conn.execute(
                "select metadata->>'eTag', (metadata->>'size')::bigint from storage.objects "
                "where bucket_id = 'progress-photos' and name = %s", (key,)).fetchone()
        assert etag.strip('"') == hashlib.md5(data).hexdigest() and size == len(data)
    finally:
        service.remove("progress-photos", key)


# ---------------------------------------------------------------------------
# Reading: only your own files
# ---------------------------------------------------------------------------

@needs_api
@pytest.mark.parametrize("bucket", sorted(BUCKETS))
def test_a_user_can_read_their_own_files(vault, bucket):
    for tag, key in (("A", "a"), ("B", "b")):
        person = vault[key]
        r = person.storage.download(bucket, f"{person.id}/{BUCKETS[bucket][2]}")
        assert r.status_code == 200 and r.content == vault["content"][(tag, bucket)]


CROSS_PATHS = [
    "{other}/{name}",
    "{me}/../{other}/{name}",
    "{me}/%2e%2e/{other}/{name}",
    "/{other}/{name}",
    "{other}/./{name}",
    "{other}//{name}",
]


@needs_api
@pytest.mark.parametrize("bucket", sorted(BUCKETS))
@pytest.mark.parametrize("path", CROSS_PATHS)
@pytest.mark.parametrize("reader,owner", [("a", "b"), ("b", "a"), ("c", "a")])
def test_a_user_cannot_read_another_users_file(vault, bucket, path, reader, owner):
    me, other = vault[reader], vault[owner]
    secret = vault["content"][(owner.upper(), bucket)]
    key = path.format(me=me.id, other=other.id, name=BUCKETS[bucket][2])
    r = me.storage.download(bucket, key)
    assert r.status_code != 200 and secret not in r.content, f"{reader} read {owner}'s {bucket} file via {path}"


@needs_api
@pytest.mark.parametrize("bucket", sorted(BUCKETS))
def test_nobody_signed_out_can_read_a_file_even_with_its_exact_name(vault, anon, bucket):
    me = vault["a"]
    key = f"{me.id}/{BUCKETS[bucket][2]}"
    secret = vault["content"][("A", bucket)]
    for r in (anon.download(bucket, key), anon.public_url(bucket, key)):
        assert r.status_code != 200 and secret not in r.content


@needs_api
@pytest.mark.parametrize("bucket", sorted(BUCKETS))
def test_listing_shows_only_your_own_files_and_folder(vault, bucket):
    a, b, c = vault["a"], vault["b"], vault["c"]
    assert _names(a.storage.list(bucket, a.id)) == {BUCKETS[bucket][2]}
    assert _names(a.storage.list(bucket, b.id)) == set(), "A listed B's folder"
    root = _names(a.storage.list(bucket, ""))
    assert root <= {a.id}, f"A's bucket root also shows other folders: {root - {a.id}}"
    assert b.id not in root and c.id not in root
    assert _names(c.storage.list(bucket, "")) == set() and _names(c.storage.list(bucket, a.id)) == set()


@needs_api
@pytest.mark.parametrize("bucket", sorted(BUCKETS))
def test_a_signed_link_can_be_made_only_for_your_own_file(vault, bucket):
    a, b = vault["a"], vault["b"]
    name = BUCKETS[bucket][2]
    own = a.storage.sign(bucket, f"{a.id}/{name}")
    assert own.status_code == 200 and own.json().get("signedURL")
    fetched = HTTP.get(_url("/storage/v1" + own.json()["signedURL"]), timeout=60)   # a signed link needs no login
    assert fetched.status_code == 200 and fetched.content == vault["content"][("A", bucket)]
    theirs = a.storage.sign(bucket, f"{b.id}/{name}")
    assert theirs.status_code != 200 and not theirs.json().get("signedURL")


# ---------------------------------------------------------------------------
# Writing: not from the app
# ---------------------------------------------------------------------------

def _forge_everything(me, other, bucket):
    """Every write the Storage API offers, aimed at the caller's own folder and at someone else's."""
    name, ctype = BUCKETS[bucket][2], CONTENT_TYPE[bucket]
    s = me.storage
    own, theirs = f"{me.id}/{name}", f"{other.id}/{name}"
    return [
        ("upload a new file into own folder", s.upload(bucket, f"{me.id}/new.bin", b"\xff\xd8planted", ctype)),
        ("upload a new file into another folder", s.upload(bucket, f"{other.id}/new.bin", b"\xff\xd8planted", ctype)),
        ("upsert over own file", s.upload(bucket, own, b"\xff\xd8overwritten", ctype, upsert=True)),
        ("PUT over own file", s.upload(bucket, own, b"\xff\xd8overwritten", ctype, method="put")),
        ("upsert over another's file", s.upload(bucket, theirs, b"\xff\xd8overwritten", ctype, upsert=True)),
        ("delete own file", s.remove(bucket, own)),
        ("delete another's file", s.remove(bucket, theirs)),
        ("bulk delete both", s.remove_many(bucket, [own, theirs])),
        ("move own file away", s.move(bucket, own, f"{me.id}/moved.bin")),
        ("move own file into another folder", s.move(bucket, own, f"{other.id}/moved.bin")),
        ("move another's file", s.move(bucket, theirs, f"{me.id}/moved.bin")),
        ("copy another's file into own folder", s.copy(bucket, theirs, f"{me.id}/stolen.bin")),
        ("copy own file next to itself", s.copy(bucket, own, f"{me.id}/copy.bin")),
    ]


@needs_api
@pytest.mark.parametrize("bucket", sorted(BUCKETS))
def test_a_user_cannot_add_change_move_copy_or_delete_any_file(vault, service, bucket):
    a, b = vault["a"], vault["b"]
    for label, response in _forge_everything(a, b, bucket):
        refused = response.status_code >= 400 or response.json() == []   # a refused bulk delete answers 200 []
        assert refused, f"{label}: the API reported success ({response.status_code} {response.text[:120]})"
    # the effect is what matters: not one byte or key changed, in either folder
    assert _truth(service, a, bucket) == _expected_folder(vault, "A", bucket)
    assert _truth(service, b, bucket) == _expected_folder(vault, "B", bucket)


@needs_api
@pytest.mark.parametrize("bucket", sorted(BUCKETS))
def test_the_write_requests_used_here_are_well_formed(vault, service, bucket):
    """The same requests, from the service role, must all work. Otherwise the refusals above
    would hold for any policy at all (a malformed request is refused whatever the policy says)."""
    a, b = vault["a"], vault["b"]
    name, ctype = BUCKETS[bucket][2], CONTENT_TYPE[bucket]
    s = service
    steps = [
        ("upload a new file", s.upload(bucket, f"{a.id}/ctl-1.bin", b"\xff\xd8one", ctype)),
        ("upsert over it", s.upload(bucket, f"{a.id}/ctl-1.bin", b"\xff\xd8two", ctype, upsert=True)),
        ("PUT over it", s.upload(bucket, f"{a.id}/ctl-1.bin", b"\xff\xd8three", ctype, method="put")),
        ("copy it", s.copy(bucket, f"{a.id}/ctl-1.bin", f"{a.id}/ctl-2.bin")),
        ("move it", s.move(bucket, f"{a.id}/ctl-2.bin", f"{a.id}/ctl-3.bin")),
        ("delete one", s.remove(bucket, f"{a.id}/ctl-3.bin")),
        ("bulk delete", s.remove_many(bucket, [f"{a.id}/ctl-1.bin"])),
    ]
    try:
        for label, response in steps:
            assert response.status_code == 200, f"{label}: {response.status_code} {response.text[:160]}"
        assert _names(service.list(bucket, a.id)) == {name}
        assert _truth(service, b, bucket) == _expected_folder(vault, "B", bucket)
    finally:
        service.remove_many(bucket, [f"{a.id}/ctl-{i}.bin" for i in (1, 2, 3)])


@needs_api
def test_a_user_cannot_create_change_or_delete_a_bucket(vault, service):
    a = vault["a"]
    scratch = f"rls-scratch-{uuid.uuid4().hex[:8]}"
    try:   # from the first line: a user who CAN create a bucket must not leave one behind when this fails
        assert a.storage.create_bucket(scratch).status_code >= 400
        assert service.get_bucket(scratch).status_code >= 400, "the user created a bucket"
        assert service.create_bucket(scratch).status_code == 200      # an EMPTY bucket: nothing but the policy stops a delete
        for label, r in (("make public", a.storage.update_bucket(scratch, public=True)),
                         ("delete", a.storage.delete_bucket(scratch)),
                         ("empty", a.storage.empty_bucket(scratch)),
                         ("make a real bucket public", a.storage.update_bucket("progress-photos", public=True)),
                         ("delete a real bucket", a.storage.delete_bucket("progress-photos"))):
            assert r.status_code >= 400, f"{label}: {r.status_code} {r.text[:120]}"
        assert service.get_bucket(scratch).json().get("public") is False
        for bucket in BUCKETS:
            assert service.get_bucket(bucket).json().get("public") is False
        assert a.storage.list_buckets() == [], "a user can see the bucket list"
    finally:
        service.delete_bucket(scratch)
        # If the policies were ever loosened, the attacks above ran for real: do not leave a real bucket public.
        for bucket in BUCKETS:
            service.update_bucket(bucket, public=False)


# ---------------------------------------------------------------------------
# The bucket limits (what Flask used to check, as a seat belt)
# ---------------------------------------------------------------------------

@needs_api
@pytest.mark.parametrize("bucket", sorted(BUCKETS))
def test_a_file_of_the_wrong_type_is_refused_even_from_the_service_role(vault, service, bucket):
    a = vault["a"]
    key = f"{a.id}/not-allowed.txt"
    r = service.upload(bucket, key, b"hello", "text/plain")
    try:
        assert r.status_code >= 400
        assert key.split("/", 1)[1] not in _names(service.list(bucket, a.id))
    finally:
        service.remove(bucket, key)


@needs_api
def test_a_photo_over_twelve_mib_is_refused_even_from_the_service_role(vault, service):
    a = vault["a"]
    key = f"{a.id}/too-big.jpg"
    r = service.upload("progress-photos", key, b"\xff" * (12 * 1024 * 1024 + 1), "image/jpeg")
    try:
        assert r.status_code >= 400
        assert "too-big.jpg" not in _names(service.list("progress-photos", a.id))
    finally:
        service.remove("progress-photos", key)


# ---------------------------------------------------------------------------
# Account deletion
# ---------------------------------------------------------------------------

@needs_api
def test_deleting_an_account_does_not_delete_its_files_so_flask_must_remove_them_first(service):
    """Documents the platform's behaviour the design depends on. If this ever starts passing the other
    way (files cascade), the plan's account-deletion step can be simplified."""
    ghost = Person("sd")
    key = f"{ghost.id}/left-behind.jpg"
    assert service.upload("progress-photos", key, b"\xff\xd8x", "image/jpeg").status_code == 200
    try:
        _admin_delete_user(ghost.id)
        assert "left-behind.jpg" in _names(service.list("progress-photos", ghost.id))
    finally:
        service.remove("progress-photos", key)
        assert _names(service.list("progress-photos", ghost.id)) == set()
