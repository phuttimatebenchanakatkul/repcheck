"""Postgres access: a small connection pool to Supabase's transaction pooler.

Flask connects as the `postgres` owner, which BYPASSES row-level security. That is the point (cross-user reads,
rate limits and moderation live here) and the risk: every query in this package must scope itself to the caller
(`where user_id = %s`) by hand, because nothing underneath will. Queries use %s placeholders only.

The transaction pooler (port 6543) hands a connection back after each transaction, so prepared statements are off
(`prepare_threshold=None`) and session state (SET, advisory locks, temp tables) must not be relied on.
"""

from contextlib import contextmanager

from psycopg.rows import dict_row


class Database:
    def __init__(self, url, max_size=5):
        self._url, self._max_size, self._pool = url, max_size, None

    def _open(self):
        if self._pool is None:
            from psycopg_pool import ConnectionPool
            self._pool = ConnectionPool(
                self._url, min_size=1, max_size=self._max_size, open=False, timeout=15,
                kwargs={"prepare_threshold": None, "row_factory": dict_row, "sslmode": "require"})
            self._pool.open()
        return self._pool

    @contextmanager
    def connection(self):
        """One transaction: committed when the block ends normally, rolled back if it raises."""
        with self._open().connection() as conn:
            yield conn

    def close(self):
        if self._pool is not None:
            self._pool.close()
            self._pool = None


def one(conn, sql, params=()):
    return conn.execute(sql, params).fetchone()


def all_rows(conn, sql, params=()):
    return conn.execute(sql, params).fetchall()


