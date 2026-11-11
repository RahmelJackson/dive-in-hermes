"""SQLite evidence ledger and bounded research views."""
from collections import Counter
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import sqlite3
import json
from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from hashlib import sha256
from urllib.parse import urlsplit

from .feeds import digest, fetch, parse_feed, timestamp, url, utc
from .dossier import DOSSIER, PARTICIPANT_CONTEXT_FIELDS, QUESTION_ANSWER, validate

FIXTURES = Path(__file__).parent / "fixtures"
DEMO_TIME = datetime(2026, 10, 9, 12, tzinfo=timezone.utc)


class Atlas:
    def __init__(self, path, clock=lambda: datetime.now(timezone.utc), retrieve=fetch):
        self.path = Path(path)
        self.clock = clock
        self.retrieve = retrieve

    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS evidence (
                    id TEXT PRIMARY KEY, topic TEXT NOT NULL, source TEXT NOT NULL,
                    article_url TEXT NOT NULL, entry_key TEXT NOT NULL,
                    title TEXT NOT NULL, excerpt TEXT NOT NULL, date_field TEXT,
                    date_raw TEXT, date_utc TEXT, date_status TEXT NOT NULL,
                    first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS evidence_topic ON evidence(topic, article_url);
                CREATE TABLE IF NOT EXISTS evidence_visuals (
                    id TEXT PRIMARY KEY, evidence_id TEXT NOT NULL REFERENCES evidence(id),
                    kind TEXT NOT NULL, mime TEXT NOT NULL, body BLOB NOT NULL,
                    captured_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS visuals_evidence ON evidence_visuals(evidence_id, captured_at);
                CREATE TABLE IF NOT EXISTS reports (
                    evidence_id TEXT PRIMARY KEY REFERENCES evidence(id),
                    body TEXT NOT NULL,
                    saved_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS dossiers (
                    evidence_id TEXT PRIMARY KEY, body TEXT NOT NULL, saved_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS dossier_revisions (
                    id INTEGER PRIMARY KEY, evidence_id TEXT NOT NULL REFERENCES dossiers(evidence_id),
                    body TEXT NOT NULL, saved_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS revisions_story ON dossier_revisions(evidence_id, id);
                CREATE TABLE IF NOT EXISTS story_runs (
                    id TEXT PRIMARY KEY, stage TEXT NOT NULL, message TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS story_questions (
                    run_id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES dossiers(evidence_id),
                    question TEXT NOT NULL, context TEXT NOT NULL, asked_at TEXT NOT NULL, answer TEXT
                );
                CREATE INDEX IF NOT EXISTS story_questions_story ON story_questions(story_id, asked_at);
                CREATE TABLE IF NOT EXISTS exploration (
                    story_id TEXT PRIMARY KEY, chapter TEXT NOT NULL DEFAULT '',
                    style TEXT NOT NULL DEFAULT 'curated', pinned_id TEXT NOT NULL DEFAULT '',
                    question TEXT NOT NULL DEFAULT '', filter TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS findings (
                    story_id TEXT NOT NULL, claim TEXT NOT NULL, body TEXT NOT NULL,
                    saved_at TEXT NOT NULL, PRIMARY KEY(story_id, claim)
                );
                CREATE TABLE IF NOT EXISTS feeds (
                    topic TEXT NOT NULL, source TEXT NOT NULL,
                    last_success TEXT NOT NULL, entry_count INTEGER NOT NULL,
                    PRIMARY KEY(topic, source)
                );
            """)
            return db
        except Exception:
            db.close()
            raise

    def ingest(self, topic, feed_url):
        source = url(feed_url)
        return self.save(topic, source, self.retrieve(source))

    def save(self, topic, source, body):
        return self.record(topic, source, parse_feed(body, source), is_feed=True)

    @staticmethod
    def source_workspace(source_url):
        source = url(source_url.strip(), canonical=True)
        host = urlsplit(source).hostname[:65]
        return {"source_url": source, "topic": f"{host} / {digest(source)[:16]}"}

    def find_source(self, source_url, topic=None):
        workspace = self.source_workspace(source_url)
        topic = self.topic(topic) if topic and topic.strip() else None
        with closing(self.connect()) as db:
            record = db.execute("""
                SELECT topic, id AS evidence_id FROM evidence
                WHERE article_url=? AND (? IS NULL OR topic=?)
                ORDER BY (entry_key = 'public-preview'), last_seen DESC, id LIMIT 1
            """, (workspace["source_url"], topic, topic)).fetchone()
        if record:
            workspace.update(record)
        return workspace

    def save_report(self, evidence_id, report):
        record = self.inspect(evidence_id)
        body = report.strip()
        if not 1 <= len(body) <= 15000:
            raise ValueError("Report must contain 1 to 15,000 characters")
        saved_at = utc(self.clock())
        with closing(self.connect()) as db, db:
            db.execute("""
                INSERT INTO reports VALUES (?, ?, ?)
                ON CONFLICT(evidence_id) DO UPDATE SET body=excluded.body, saved_at=excluded.saved_at
            """, (record["id"], body, saved_at))
        return {"evidence_id": record["id"], "saved_at": saved_at}

    def source_report(self, source_url, topic=None, evidence_id=None):
        source = self.find_source(source_url, topic) if not evidence_id else None
        with closing(self.connect()) as db:
            db.execute("BEGIN")
            if source is not None:
                normalized_topic = self.topic(topic) if topic and topic.strip() else None
                saved = db.execute("""
                    SELECT d.evidence_id FROM dossiers d JOIN evidence e ON e.id=d.evidence_id
                    WHERE e.article_url=? AND (? IS NULL OR e.topic=?)
                    ORDER BY d.saved_at DESC, d.evidence_id LIMIT 1
                """, (source["source_url"], normalized_topic, normalized_topic)).fetchone()
                evidence_id = saved["evidence_id"] if saved else source.get("evidence_id")
            row = db.execute("SELECT * FROM reports WHERE evidence_id=?",
                             (evidence_id,)).fetchone()
            dossier = db.execute("SELECT * FROM dossiers WHERE evidence_id=?",
                                 (evidence_id,)).fetchone()
            revision = db.execute("SELECT id, saved_at FROM dossier_revisions WHERE evidence_id=? ORDER BY id DESC LIMIT 1",
                                  (evidence_id,)).fetchone()
        result = dict(row) if row else None
        if dossier:
            content = json.loads(dossier["body"])
            result = {"evidence_id": dossier["evidence_id"], "saved_at": dossier["saved_at"],
                      "revision_id": revision["id"] if revision else None,
                      "revision_at": revision["saved_at"] if revision else dossier["saved_at"],
                      "body": content["summary"], "dossier": content}
            keys = {dossier["evidence_id"], *self.dossier_refs(content)}
            result["sources"] = {key: self.inspect(key) for key in sorted(keys)}
        return {"report": result}

    def recent_stories(self):
        with closing(self.connect()) as db:
            rows = db.execute("""
                SELECT d.evidence_id, e.article_url AS source_url, e.topic,
                       json_extract(d.body, '$.title') AS title
                FROM dossiers d JOIN evidence e ON e.id=d.evidence_id
                LEFT JOIN exploration t ON t.story_id=d.evidence_id
                ORDER BY coalesce(t.updated_at, d.saved_at) DESC, d.evidence_id LIMIT 8
            """).fetchall()
        return {"stories": [dict(row) for row in rows]}

    def exploration_trail(self, story_id, *, changes=None, claim_index=None):
        limits = {"chapter": 150, "style": 10, "pinned_id": 64, "question": 1200, "filter": 150}
        if changes is not None:
            if (not isinstance(changes, dict) or not set(changes) <= limits.keys()
                    or any(not isinstance(value, str) or len(value) > limits[key]
                           for key, value in changes.items())):
                raise ValueError("Invalid exploration fields")
            if "style" in changes and changes["style"] not in {"guided", "curated", "open"}:
                raise ValueError("Unknown exploration style")
        with closing(self.connect()) as db, db:
            story = db.execute("SELECT body FROM dossiers WHERE evidence_id=?", (story_id,)).fetchone()
            if story is None:
                raise ValueError("Unknown story")
            if changes is not None or claim_index is not None:
                now = utc(self.clock())
                db.execute("""
                    INSERT INTO exploration(story_id, updated_at) VALUES (?, ?)
                    ON CONFLICT(story_id) DO UPDATE SET updated_at=excluded.updated_at
                """, (story_id, now))
                for key, value in (changes or {}).items():
                    if key == "pinned_id" and value and not db.execute(
                            "SELECT 1 FROM evidence WHERE id=?", (value,)).fetchone():
                        raise ValueError("Unknown pinned evidence")
                    db.execute(f"UPDATE exploration SET {key}=? WHERE story_id=?", (value, story_id))
                if claim_index is not None:
                    claims = json.loads(story["body"])["claims"]
                    if type(claim_index) is not int or not 0 <= claim_index < len(claims):
                        raise ValueError("Unknown claim")
                    claim = claims[claim_index]
                    db.execute("""
                        INSERT INTO findings VALUES (?, ?, ?, ?)
                        ON CONFLICT(story_id, claim) DO UPDATE
                        SET body=excluded.body, saved_at=excluded.saved_at
                    """, (story_id, claim["claim"], json.dumps(claim), now))
            state = db.execute("SELECT * FROM exploration WHERE story_id=?", (story_id,)).fetchone()
            findings = db.execute("SELECT body FROM findings WHERE story_id=? ORDER BY saved_at DESC, claim LIMIT 30",
                                  (story_id,)).fetchall()
        return {"trail": dict(state) if state else {}, "findings": [json.loads(row["body"]) for row in findings]}

    def story_progress(self, run_id, *, stage=None, message=None):
        if not re.fullmatch(r"[0-9a-f]{32}", run_id):
            raise ValueError("Invalid story run ID")
        with closing(self.connect()) as db, db:
            if stage is not None:
                if stage not in {"reading", "checking", "blocked", "answered"}:
                    raise ValueError("Invalid story stage")
                if not isinstance(message, str) or not 1 <= len(message.strip()) <= 6000:
                    raise ValueError("Supply a progress message of 1 to 6,000 characters")
                db.execute("""
                    INSERT INTO story_runs VALUES (?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET stage=excluded.stage, message=excluded.message
                    WHERE story_runs.stage NOT IN ('blocked', 'answered')
                """, (run_id, stage, message.strip()))
            row = db.execute("SELECT stage, message FROM story_runs WHERE id=?", (run_id,)).fetchone()
        return {"progress": dict(row) if row else None}

    def start_question(self, story_id, run_id, question, context=""):
        if not isinstance(run_id, str) or not re.fullmatch(r"[0-9a-f]{32}", run_id):
            raise ValueError("Invalid question ID")
        if not isinstance(question, str) or not 1 <= len(question.strip()) <= 1200:
            raise ValueError("Enter a question of 1 to 1,200 characters")
        if not isinstance(context, str) or len(context) > 500:
            raise ValueError("Question context must fit within 500 characters")
        with closing(self.connect()) as db, db:
            if not db.execute("SELECT 1 FROM dossiers WHERE evidence_id=?", (story_id,)).fetchone():
                raise ValueError("Unknown story")
            db.execute("""
                INSERT INTO story_questions(run_id, story_id, question, context, asked_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING
            """, (run_id, story_id, question.strip(), context, utc(self.clock())))
            saved = db.execute("""
                SELECT story_id, question, context FROM story_questions WHERE run_id=?
            """, (run_id,)).fetchone()
            if tuple(saved) != (story_id, question.strip(), context):
                raise ValueError("Question ID is already in use")
        return {"run_id": run_id}

    def save_question_answer(self, run_id, answer):
        validate(answer, QUESTION_ANSWER, "question answer")
        if not answer["answer"].strip():
            raise ValueError("Supply an answer or explain the evidence gap")
        refs = set(answer["evidence_ids"])
        for finding in answer["findings"]:
            if not finding["label"].strip() or not finding["detail"].strip() or not finding["evidence_ids"]:
                raise ValueError("A finding requires a label, explanation and evidence references")
            refs.update(finding["evidence_ids"])
        with closing(self.connect()) as db, db:
            story = db.execute("""
                SELECT d.body, e.topic, e.id FROM story_questions q
                JOIN dossiers d ON d.evidence_id=q.story_id JOIN evidence e ON e.id=q.story_id
                WHERE q.run_id=?
            """, (run_id,)).fetchone()
            if not story:
                raise ValueError("Unknown question")
            existing = {story["id"], *self.dossier_refs(json.loads(story["body"]))}
            for ref in refs:
                record = db.execute("SELECT topic FROM evidence WHERE id=?", (ref,)).fetchone()
                if not record or (ref not in existing and record["topic"] != story["topic"]):
                    raise ValueError("Answer references evidence outside this story")
            db.execute("UPDATE story_questions SET answer=? WHERE run_id=? AND answer IS NULL",
                       (json.dumps(answer), run_id))
        return {"run_id": run_id}

    def questions(self, story_id):
        with closing(self.connect()) as db:
            rows = db.execute("""
                SELECT q.run_id, q.question, q.context, q.asked_at, q.answer, r.stage, r.message
                FROM story_questions q LEFT JOIN story_runs r ON r.id=q.run_id
                WHERE q.story_id=? ORDER BY q.asked_at DESC, q.rowid DESC LIMIT 24
            """, (story_id,)).fetchall()
            items, refs = [], set()
            for row in rows:
                item = dict(row)
                if item["answer"]:
                    item["answer"] = json.loads(item["answer"])
                    refs.update(item["answer"]["evidence_ids"])
                    for finding in item["answer"]["findings"]:
                        refs.update(finding["evidence_ids"])
                items.append(item)
            records = {}
            for ref in refs:
                record = db.execute("SELECT * FROM evidence WHERE id=?", (ref,)).fetchone()
                if record:
                    records[ref] = dict(record)
        return {"questions": items, "sources": records}

    @staticmethod
    def dossier_items(content):
        groups = content["posts"] + content["claims"] + content["charts"] + content["comparisons"]
        groups.extend(content.get("learning_path", []))
        for person in content["participants"]:
            groups.extend(person["history"])
            groups.extend(person[field] for field in PARTICIPANT_CONTEXT_FIELDS if field in person)
        return groups

    @staticmethod
    def dossier_refs(content):
        return sorted({key for group in Atlas.dossier_items(content) for key in group["evidence_ids"]})

    def save_dossier(self, evidence_id, dossier, *, base_revision=None):
        self.inspect(evidence_id)
        validate(dossier, DOSSIER)
        for person in dossier["participants"]:
            url(person["profile_url"])
            for field in PARTICIPANT_CONTEXT_FIELDS:
                if field in person and not person[field]["evidence_ids"]:
                    raise ValueError("Participant context requires evidence references")
        claim_ids = set()
        for claim in dossier["claims"]:
            if claim["verdict"] != "unresolved" and not claim["evidence_ids"]:
                raise ValueError("A checked claim requires evidence references")
            key = claim.get("claim_id")
            if key is not None:
                if not re.fullmatch(r"[a-z0-9_-]{1,100}", key) or key in claim_ids:
                    raise ValueError("Claim IDs must be unique lowercase slugs")
                claim_ids.add(key)
            for item in claim.get("evidence", []):
                if (item["evidence_id"] not in claim["evidence_ids"] or
                        (item.get("origin_evidence_id") and item["origin_evidence_id"] not in claim["evidence_ids"])):
                    raise ValueError("Claim evidence must reference a record listed for that claim")
        for chart in dossier["charts"]:
            if not chart["evidence_ids"]:
                raise ValueError("A chart requires evidence references")
        for table in dossier["comparisons"]:
            if any(len(row) != len(table["columns"]) for row in table["rows"]):
                raise ValueError("Comparison row width must match its columns")
        for key in self.dossier_refs(dossier):
            self.inspect(key)
        saved_at = utc(self.clock())
        body = json.dumps(dossier, sort_keys=True)
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT body, saved_at FROM dossiers WHERE evidence_id=?", (evidence_id,)).fetchone()
            latest = db.execute("SELECT id FROM dossier_revisions WHERE evidence_id=? ORDER BY id DESC LIMIT 1",
                                (evidence_id,)).fetchone()
            revision_id = latest["id"] if latest else None
            if base_revision is not None and (type(base_revision) is not int or base_revision != (revision_id or 0)):
                raise ValueError("The story changed during this update. Read the latest report and retry.")
            changed = previous is None or json.loads(previous["body"]) != dossier
            if previous and revision_id is None:
                revision_id = db.execute("""
                    INSERT INTO dossier_revisions(evidence_id, body, saved_at) VALUES (?, ?, ?)
                """, (evidence_id, previous["body"], previous["saved_at"])).lastrowid
            db.execute("""
                INSERT INTO dossiers VALUES (?, ?, ?)
                ON CONFLICT(evidence_id) DO UPDATE SET body=excluded.body, saved_at=excluded.saved_at
            """, (evidence_id, body, saved_at))
            if changed:
                revision_id = db.execute("""
                    INSERT INTO dossier_revisions(evidence_id, body, saved_at) VALUES (?, ?, ?)
                """, (evidence_id, body, saved_at)).lastrowid
        return {"evidence_id": evidence_id, "saved_at": saved_at, "revision_id": revision_id, "changed": changed}

    def story_changes(self, evidence_id, revision_id=None):
        with closing(self.connect()) as db:
            db.execute("BEGIN")
            current = db.execute("SELECT body, saved_at FROM dossiers WHERE evidence_id=?", (evidence_id,)).fetchone()
            if current is None:
                raise ValueError("Unknown story")
            latest = db.execute("""
                SELECT id, body, saved_at FROM dossier_revisions WHERE evidence_id=? AND (? IS NULL OR id=?)
                ORDER BY id DESC LIMIT 1
            """, (evidence_id, revision_id, revision_id)).fetchone()
            if revision_id is not None and latest is None:
                raise ValueError("Unknown story revision")
            previous = db.execute("""
                SELECT id, body, saved_at FROM dossier_revisions WHERE evidence_id=? AND id<?
                ORDER BY id DESC LIMIT 1
            """, (evidence_id, latest["id"])).fetchone() if latest else None
            history = [dict(row) for row in db.execute("""
                SELECT id, saved_at FROM dossier_revisions WHERE evidence_id=? ORDER BY id DESC LIMIT 20
            """, (evidence_id,))]
        data = {"current": dict(latest or current), "previous": dict(previous) if previous else None, "history": history}
        after = json.loads(data["current"].pop("body"))
        before = json.loads(data["previous"].pop("body")) if previous else None
        data.update({"verdicts": [], "claim_evidence_updates": [], "added_claims": [], "removed_claims": [],
                     "added_sources": [], "removed_sources": [], "revised_sources": [], "sources": {}})
        if before is None:
            return data

        def claim_key(claim):
            return (claim["speaker"].casefold(), " ".join(claim["claim"].casefold().split()))

        old_claims = {claim_key(claim): claim for claim in before["claims"]}
        old_ids = {claim["claim_id"]: claim for claim in before["claims"] if claim.get("claim_id")}
        matched = set()
        for claim in after["claims"]:
            prior = old_ids.get(claim.get("claim_id")) or old_claims.get(claim_key(claim))
            if prior is None:
                data["added_claims"].append(claim)
                continue
            matched.add(claim_key(prior))
            if prior["verdict"] != claim["verdict"]:
                data["verdicts"].append({"before": prior, "after": claim})
            if (set(prior["evidence_ids"]) != set(claim["evidence_ids"]) or
                    prior.get("evidence", []) != claim.get("evidence", [])):
                data["claim_evidence_updates"].append(claim)
        data["removed_claims"] = [claim for key, claim in old_claims.items() if key not in matched]

        old_refs, new_refs = self.dossier_refs(before), self.dossier_refs(after)
        ledger = {}
        with closing(self.connect()) as db:
            for ref in set(old_refs) | set(new_refs):
                record = db.execute("SELECT * FROM evidence WHERE id=?", (ref,)).fetchone()
                ledger[ref] = dict(record)

        def sources(refs):
            by_url = {}
            for ref in refs:
                record = ledger[ref]
                item = by_url.setdefault(record["article_url"], {
                    "id": ref, "url": record["article_url"], "title": record["title"], "captures": [],
                })
                item["captures"].append(ref)
            return by_url

        old_sources, new_sources = sources(old_refs), sources(new_refs)
        data["added_sources"] = [record for url, record in new_sources.items() if url not in old_sources]
        data["removed_sources"] = [record for url, record in old_sources.items() if url not in new_sources]
        data["revised_sources"] = [record for url, record in new_sources.items()
                                   if url in old_sources and old_sources[url]["captures"] != record["captures"]]
        affected = [item["after"] for item in data["verdicts"]] + data["claim_evidence_updates"]
        for ref in {ref for claim in affected for ref in claim["evidence_ids"]}:
            record = ledger[ref]
            data["sources"][ref] = dict(record, excerpt=record["excerpt"][:800])
        return data

    def capture(self, topic=None, source_url="", text="", title="", date=None, provenance="user_supplied"):
        workspace = self.source_workspace(source_url)
        source = workspace["source_url"]
        topic = topic.strip() if topic else workspace["topic"]
        topic = topic or workspace["topic"]
        excerpt = text.strip()
        if not excerpt or len(excerpt) > 30_000:
            raise ValueError("Supply 1 to 30,000 characters of source text")
        if date and len(date) > 256:
            raise ValueError("Source date must be at most 256 characters")
        normalized, status = timestamp(date)
        if provenance not in {"user_supplied", "public_excerpt", "public_preview"}:
            raise ValueError("Unknown capture provenance")
        entry = dict(article_url=source, entry_key=provenance.replace("_", "-"), title=title.strip()[:300],
                     excerpt=excerpt, date_field="supplied" if date else None,
                     date_raw=date, date_utc=normalized, date_status=status)
        result = self.record(topic, source, [entry], is_feed=False)
        return dict(topic=result["topic"], source_url=source,
                    evidence_id=digest(result["topic"], source, entry),
                    provenance=provenance)

    def record(self, topic, source, entries, *, is_feed):
        topic = self.topic(topic)
        observed = utc(self.clock())
        with closing(self.connect()) as db, db:
            for entry in entries:
                evidence_id = digest(topic, source, entry)
                db.execute("""
                    INSERT INTO evidence VALUES (
                        :id, :topic, :source, :article_url, :entry_key, :title, :excerpt,
                        :date_field, :date_raw, :date_utc, :date_status, :seen, :seen
                    )
                    ON CONFLICT(id) DO UPDATE SET
                        first_seen = min(first_seen, excluded.first_seen),
                        last_seen = max(last_seen, excluded.last_seen)
                """, dict(entry, id=evidence_id, topic=topic, source=source, seen=observed))
            if is_feed:
                db.execute("""
                INSERT INTO feeds VALUES (?, ?, ?, ?)
                ON CONFLICT(topic, source) DO UPDATE SET
                    last_success=excluded.last_success, entry_count=excluded.entry_count
                WHERE excluded.last_success >= feeds.last_success
            """, (topic, source, observed, len(entries)))
        return dict(topic=topic, feed=source, accepted_entries=len(entries), observed_utc=observed)

    def demo(self):
        for name in ("city", "forum", "news"):
            self.save("cool roofs", f"https://{name}.example/feed", (FIXTURES / f"{name}.xml").read_bytes())
        return {"topic": "cool roofs", "synthetic": True, "as_of": utc(DEMO_TIME)}

    @staticmethod
    def topic(value):
        key = " ".join(value.casefold().split())
        if not 1 <= len(key) <= 100:
            raise ValueError("Topic must contain 1 to 100 characters")
        return key

    def inspect(self, evidence_id):
        with closing(self.connect()) as db:
            row = db.execute("SELECT * FROM evidence WHERE id=?", (evidence_id,)).fetchone()
        if row is None:
            raise ValueError("Unknown evidence ID")
        return dict(row)

    def save_visual(self, evidence_id, kind, mime, data):
        self.inspect(evidence_id)
        if not isinstance(data, str) or not data or len(data) > 800_000:
            raise ValueError("Capture is empty or too large")
        if kind == "post_text" and mime == "text/plain":
            if not 1 <= len(data.strip()) <= 4000:
                raise ValueError("Paste up to 4,000 characters of original text")
            body = data.strip().encode("utf-8")
        elif kind in {"screenshot", "profile", "media"}:
            try:
                body = b64decode(data, validate=True)
            except (ValueError, Base64Error) as error:
                raise ValueError("Image data is invalid") from error
            valid = {
                "image/png": body.startswith(b"\x89PNG\r\n\x1a\n"),
                "image/jpeg": body.startswith(b"\xff\xd8\xff"),
                "image/webp": body.startswith(b"RIFF") and body[8:12] == b"WEBP",
            }
            if not valid.get(mime):
                raise ValueError("Use a PNG, JPEG, or WebP image")
        else:
            raise ValueError("Unknown capture type")
        visual_id = digest(f"{evidence_id}|{kind}|{sha256(body).hexdigest()}")
        with closing(self.connect()) as db, db:
            db.execute("""
                INSERT INTO evidence_visuals VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING
            """, (visual_id, evidence_id, kind, mime, body, utc(self.clock())))
        return {"visual_id": visual_id}

    def source_visuals(self, evidence_id):
        self.inspect(evidence_id)
        with closing(self.connect()) as db:
            rows = db.execute("""
                SELECT id, kind, mime, captured_at FROM evidence_visuals WHERE evidence_id=?
                ORDER BY captured_at DESC, rowid DESC LIMIT 12
            """, (evidence_id,)).fetchall()
        return {"visuals": [dict(row) for row in rows]}

    def source_visual(self, evidence_id, visual_id):
        with closing(self.connect()) as db:
            row = db.execute("""
                SELECT kind, mime, body, captured_at FROM evidence_visuals WHERE evidence_id=? AND id=?
            """, (evidence_id, visual_id)).fetchone()
        if not row:
            raise ValueError("Unknown capture for this evidence record")
        result = dict(row)
        body = result.pop("body")
        result["data"] = body.decode("utf-8") if row["mime"] == "text/plain" else b64encode(body).decode("ascii")
        return result

    def view(self, mode, topic, as_of=None):
        topic = self.topic(topic)
        cutoff = as_of or self.clock()
        with closing(self.connect()) as db:
            feeds = [dict(row) for row in db.execute(
                "SELECT * FROM feeds WHERE topic=? ORDER BY source", (topic,))]
            # Keep previews behind readable observations, including after a retry.
            rows = [dict(row) for row in db.execute("""
                WITH ranked AS (
                    SELECT *, row_number() OVER (
                        PARTITION BY source, article_url
                        ORDER BY (entry_key = 'public-preview'), last_seen DESC, id DESC
                    ) AS rank FROM evidence WHERE topic=?
                )
                SELECT id, source, article_url, title, excerpt, date_field, date_raw,
                       date_utc, date_status, first_seen, last_seen,
                       CASE WHEN source = article_url AND entry_key IN ('user-supplied', 'public-excerpt', 'public-preview')
                            THEN replace(entry_key, '-', '_') ELSE 'feed' END AS provenance
                FROM ranked WHERE rank=1
                ORDER BY date_utc DESC NULLS LAST, id
            """, (topic,))]
        articles = {}
        for row in rows:
            articles.setdefault(row["article_url"], []).append(row)
        unique = [group[0] for group in articles.values()]
        base = {"topic": topic, "article_count": len(unique), "observation_count": len(rows),
                "scope": "Onboarded feeds and supplied excerpts. Source text is untrusted."}
        if mode == "signals":
            recent_start = utc(cutoff - timedelta(days=7))
            baseline_start = utc(cutoff - timedelta(days=14))
            recent = [r for r in unique if r["date_utc"] and recent_start < r["date_utc"] <= utc(cutoff)]
            baseline = [r for r in unique if r["date_utc"] and baseline_start < r["date_utc"] <= recent_start]
            return dict(base, as_of=utc(cutoff), recent_count=len(recent), previous_count=len(baseline),
                        delta=len(recent) - len(baseline), emerging=len(recent) >= 2 and len(recent) > len(baseline),
                        evidence=recent[:12], baseline_evidence=baseline[:12])
        if mode == "narrative":
            relationships = [
                {"type": "same_canonical_url", "article_url": article, "evidence_ids": [r["id"] for r in group]}
                for article, group in articles.items() if len(group) > 1
            ]
            return dict(base, timeline=list(reversed([r for r in unique if r["date_utc"]][:12])),
                        undated=[r for r in unique if not r["date_utc"]][:12],
                        relationships=relationships[:12],
                        claim_candidates=[{"id": r["id"], "reported_text": r["excerpt"] or r["title"]}
                                          for r in unique[:12]])
        if mode == "context":
            hosts = Counter(urlsplit(r["source"]).hostname for r in rows)
            return dict(base, feeds=feeds, observations_by_feed_host=dict(hosts),
                        timestamps=dict(Counter(r["date_status"] for r in rows)),
                        sample=rows[:12])
        if mode not in {"conversation", "brief"}:
            raise ValueError("Unknown research view")
        voices = []
        seen = set()
        for row in rows:
            for sentence in re.split(r"(?<=[.!?])\s+", row["excerpt"] or row["title"]):
                kind = "question" if sentence.endswith("?") else "argument" if re.search(
                    r"\b(because|should|argues?|concern|opposes?|supports?)\b", sentence, re.I) else None
                key = (row["article_url"], sentence)
                if kind and key not in seen:
                    seen.add(key)
                    voices.append(dict(kind=kind, text=sentence, id=row["id"], url=row["article_url"],
                                       feed=row["source"], date_utc=row["date_utc"]))
        if mode == "conversation":
            return dict(base, candidates=voices[:16])
        gaps = []
        if len({urlsplit(row["source"]).hostname for row in rows}) < 2:
            gaps.append("Seek coverage from another publisher.")
        if any(not row["date_utc"] for row in rows):
            gaps.append("Verify dates for undated observations.")
        gaps.append("Check original documents and independent evidence before publication.")
        return dict(base, opportunities=[
            {"angle": voice["text"], "format": "reader Q&A" if voice["kind"] == "question" else "evidence check",
             "evidence_ids": [voice["id"]], "source_urls": [voice["url"]]}
            for voice in voices[:5]
        ], background=unique[:5], reporting_tasks=gaps)

