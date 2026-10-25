"""The API's Auth-admin and Storage clients: what they send, what they retry, how they read Storage's answers.
No network: the HTTP session is faked. (Their behaviour against the real services is covered, end to end, by
test_api_accounts.py and by tests/test_supabase_storage.py, which talks to the same API.)"""

import pytest

from api.settings import Settings
from api.supabase_admin import AuthAdmin, Refused, Storage, SupabaseError

SETTINGS = Settings(supabase_url="https://abc.supabase.co", service_key="the-secret", db_url="postgresql://x")


class Response:
    def __init__(self, status, body=None, content=b""):
        self.status_code, self._body, self.content = status, body, content

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class Session:
    def __init__(self):
        self.calls, self.queue, self.default = [], [], Response(200, {})

    def _do(self, verb, url, **kw):
        self.calls.append((verb, url, kw))
        item = self.queue.pop(0) if self.queue else self.default
        if isinstance(item, Exception):
            raise item
        return item

    def get(self, url, **kw):
        return self._do("get", url, **kw)

    def post(self, url, **kw):
        return self._do("post", url, **kw)

    def delete(self, url, **kw):
        return self._do("delete", url, **kw)


@pytest.fixture
def storage():
    session, slept = Session(), []
    s = Storage(SETTINGS, session=session, sleep=slept.append)
    s.session, s.slept = session, slept
    return s


@pytest.fixture
def admin():
    session, slept = Session(), []
    a = AuthAdmin(SETTINGS, session=session, sleep=slept.append)
    a.session, a.slept = session, slept
    return a


KEY = "11111111-2222-3333-4444-555555555555/photo.jpg"


# -- retries -------------------------------------------------------------------------------------------

def test_a_429_a_5xx_and_a_dropped_connection_are_retried_with_a_growing_wait(storage):
    storage.session.queue = [Response(429), Response(503), OSError("reset"), Response(200, {"signedURL": "/object/sign/x?token=t"})]
    assert storage.sign("progress-photos", KEY) == "https://abc.supabase.co/storage/v1/object/sign/x?token=t"
    assert len(storage.session.calls) == 4 and storage.slept == [1, 2, 4]


def test_it_gives_up_after_four_attempts_with_a_supabase_error_that_names_no_secret(storage):
    storage.session.default = Response(500)
    with pytest.raises(SupabaseError) as exc:
        storage.sign("progress-photos", KEY)
    assert len(storage.session.calls) == 4 and "the-secret" not in str(exc.value)


def test_a_real_refusal_is_returned_not_retried(storage):
    storage.session.default = Response(403, {"statusCode": "403"})
    with pytest.raises(SupabaseError):
        storage.upload("progress-photos", KEY, b"x", "image/jpeg")
    assert len(storage.session.calls) == 1


# -- upload --------------------------------------------------------------------------------------------

def test_upload_posts_the_bytes_to_the_object_with_its_type_and_the_service_key(storage):
    storage.upload("progress-photos", KEY, b"\xff\xd8data", "image/jpeg")
    (verb, url, kw), = storage.session.calls
    assert (verb, url) == ("post", f"https://abc.supabase.co/storage/v1/object/progress-photos/{KEY}")
    assert kw["data"] == b"\xff\xd8data" and kw["timeout"] == 300
    assert kw["headers"] == {"apikey": "the-secret", "Authorization": "Bearer the-secret",
                             "Content-Type": "image/jpeg", "x-upsert": "true"}


def test_upload_can_refuse_to_overwrite(storage):
    storage.upload("analyze-videos", KEY, b"v", "video/mp4", upsert=False)
    assert storage.session.calls[0][2]["headers"]["x-upsert"] == "false"


def test_a_key_is_percent_encoded_but_keeps_its_folder_slash(storage):
    storage.upload("progress-photos", "u/a b#c?.jpg", b"x", "image/jpeg")
    assert storage.session.calls[0][1].endswith("/object/progress-photos/u/a%20b%23c%3F.jpg")


@pytest.mark.parametrize("code", ["413", "415"])
def test_a_file_the_bucket_turns_away_raises_refused_with_storages_reason(storage, code):
    storage.session.default = Response(400, {"statusCode": code, "message": "The object exceeded the maximum allowed size"})
    with pytest.raises(Refused, match="exceeded the maximum"):
        storage.upload("progress-photos", KEY, b"x", "image/jpeg")
    assert len(storage.session.calls) == 1


@pytest.mark.parametrize("status,body", [(400, {"statusCode": "403", "message": "RLS"}), (400, {}), (401, None), (404, {}), (409, {})])
def test_any_other_upload_failure_is_a_plain_supabase_error(storage, status, body):
    storage.session.default = Response(status, body)
    with pytest.raises(SupabaseError) as exc:
        storage.upload("progress-photos", KEY, b"x", "image/jpeg")
    assert not isinstance(exc.value, Refused)


# -- download and sign ---------------------------------------------------------------------------------

def test_download_returns_the_bytes_and_none_for_a_missing_object(storage):
    storage.session.default = Response(200, None, b"the bytes")
    assert storage.download("progress-photos", KEY) == b"the bytes"
    assert storage.session.calls[0][1] == f"https://abc.supabase.co/storage/v1/object/authenticated/progress-photos/{KEY}"
    for missing in (Response(400, {"statusCode": "404", "error": "not_found"}), Response(404, {})):
        storage.session.default = missing
        assert storage.download("progress-photos", KEY) is None


def test_download_raises_on_anything_else(storage):
    storage.session.default = Response(403, {"statusCode": "403"})
    with pytest.raises(SupabaseError):
        storage.download("progress-photos", KEY)


def test_sign_asks_for_an_expiry_and_returns_a_full_url_or_none(storage):
    storage.session.default = Response(200, {"signedURL": "/object/sign/progress-photos/k?token=abc"})
    assert storage.sign("progress-photos", KEY, expires=60) == "https://abc.supabase.co/storage/v1/object/sign/progress-photos/k?token=abc"
    verb, url, kw = storage.session.calls[0]
    assert (verb, url) == ("post", f"https://abc.supabase.co/storage/v1/object/sign/progress-photos/{KEY}") and kw["json"] == {"expiresIn": 60}
    storage.session.default = Response(400, {"statusCode": "404"})
    assert storage.sign("progress-photos", KEY) is None
    storage.session.default = Response(500)
    with pytest.raises(SupabaseError):
        storage.sign("progress-photos", KEY)


def test_a_200_without_a_signed_url_is_not_mistaken_for_success(storage):
    storage.session.default = Response(200, {})
    with pytest.raises(SupabaseError):
        storage.sign("progress-photos", KEY)


# -- remove --------------------------------------------------------------------------------------------

def test_remove_deletes_in_batches_of_a_hundred_and_reports_the_keys_it_could_not(storage):
    keys = [f"u/{i}.jpg" for i in range(250)]
    storage.session.queue = [Response(200, []), Response(500), Response(500), Response(500), Response(500), Response(200, [])]
    failed = storage.remove("progress-photos", keys)
    sent = [c[2]["json"]["prefixes"] for c in storage.session.calls if c[0] == "delete"]
    assert [len(b) for b in sent[:2]] == [100, 100] and failed == keys[100:200]
    assert all(c[1] == "https://abc.supabase.co/storage/v1/object/progress-photos" for c in storage.session.calls)


def test_remove_with_nothing_to_remove_makes_no_call(storage):
    assert storage.remove("progress-photos", []) == [] and storage.session.calls == []


def test_a_key_that_does_not_exist_is_not_a_failed_removal(storage):
    storage.session.default = Response(200, [])
    assert storage.remove("progress-photos", ["u/never-existed.jpg"]) == []


# -- Auth admin ----------------------------------------------------------------------------------------

def test_deleting_an_auth_user_treats_gone_as_done_and_anything_odd_as_an_error(admin):
    for status in (200, 404):
        admin.session.default = Response(status, {})
        assert admin.delete_user("uid") is True
    (verb, url, kw), = admin.session.calls[:1]
    assert (verb, url) == ("delete", "https://abc.supabase.co/auth/v1/admin/users/uid") and kw["headers"]["apikey"] == "the-secret"
    admin.session.default = Response(403, {})
    with pytest.raises(SupabaseError, match="403"):
        admin.delete_user("uid")
