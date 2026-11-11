import importlib
import json
from pathlib import Path
import socket
import sys
from tempfile import TemporaryDirectory
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
plugin = importlib.import_module("signal-atlas")
core = importlib.import_module("signal-atlas.atlas")
feeds = importlib.import_module("signal-atlas.feeds")
studio = importlib.import_module("signal-atlas.studio_actions")


class AtlasTest(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.atlas = core.Atlas(self.root / "atlas.db", clock=lambda: core.DEMO_TIME)

    def test_studio_example_reads_the_same_evidence_store(self):
        request = {"action": "research_example"}
        example = studio.studio_action(self.atlas.path, request)
        report = studio.studio_action(self.atlas.path, {"action": "report", **example})["report"]
        self.assertEqual(request, {"action": "research_example"})
        self.assertEqual(studio.studio_action(self.atlas.path, request), example)
        self.assertTrue(report["dossier"]["charts"])
        self.assertTrue(report["sources"])
        self.assertTrue(self.atlas.inspect(report["evidence_id"])["article_url"])

    def test_demo_repeat_and_cross_view_provenance(self):
        self.atlas.demo()
        first = {mode: self.atlas.view(mode, " Cool   ROOFS ") for mode in plugin.VIEWS}
        self.atlas.demo()
        reopened = core.Atlas(self.atlas.path, clock=lambda: core.DEMO_TIME)
        self.assertEqual(first, {mode: reopened.view(mode, "cool roofs") for mode in plugin.VIEWS})
        signals = first["signals"]
        self.assertEqual((signals["article_count"], signals["observation_count"]), (5, 6))
        self.assertEqual((signals["recent_count"], signals["previous_count"]), (3, 1))
        self.assertTrue(signals["emerging"])
        relation, = first["narrative"]["relationships"]
        records = [reopened.inspect(key) for key in relation["evidence_ids"]]
        self.assertEqual({r["date_utc"] for r in records}, {"2026-10-06T13:00:00.000000+00:00"})
        self.assertEqual(len({r["date_raw"] for r in records}), 2)
        self.assertEqual(first["context"]["timestamps"], {"normalized": 5, "timezone_missing": 1})
        self.assertEqual({v["kind"] for v in first["conversation"]["candidates"]}, {"question", "argument"})
        for opportunity in first["brief"]["opportunities"]:
            record = reopened.inspect(opportunity["evidence_ids"][0])
            self.assertEqual(opportunity["source_urls"], [record["article_url"]])
            self.assertIn(opportunity["angle"], record["excerpt"])

    def test_revision_keeps_old_citation(self):
        source = "https://city.example/feed"
        body = (core.FIXTURES / "city.xml").read_bytes()
        self.atlas.save("roofs", source, body)
        old = next(row for row in self.atlas.view("context", "roofs")["sample"] if "pilot results" in row["title"])
        later = core.Atlas(self.atlas.path, clock=lambda: core.DEMO_TIME + core.timedelta(days=1))
        later.save("roofs", source, body.replace(b"three pilot buildings", b"four pilot buildings"))
        newest = later.view("context", "roofs")["sample"][0]
        self.assertIn("four pilot buildings", newest["excerpt"])
        self.assertIn("three pilot buildings", later.inspect(old["id"])["excerpt"])

    def test_source_first_capture_uses_stable_workspace_and_shows_undated_text(self):
        link = "https://example.org/post?utm_source=share"
        workspace = self.atlas.source_workspace(link)
        captured = self.atlas.capture(source_url=link, text="What changed?")
        self.assertEqual(workspace["topic"], captured["topic"])
        self.assertEqual(workspace["source_url"], "https://example.org/post")
        view = self.atlas.view("context", captured["topic"])
        self.assertEqual(view["sample"][0]["excerpt"], "What changed?")
        self.assertEqual(view["sample"][0]["provenance"], "user_supplied")
        self.assertEqual(view["timestamps"], {"missing": 1})
        self.assertEqual(self.atlas.find_source(link)["evidence_id"], captured["evidence_id"])
        fetched = self.atlas.capture(source_url=workspace["source_url"], text="A public excerpt.",
                                     provenance="public_excerpt")
        self.assertEqual(fetched["topic"], captured["topic"])
        self.assertNotEqual(fetched["evidence_id"], captured["evidence_id"])

    def test_retrieval_rejects_private_resolution(self):
        addr = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))
        with patch.object(feeds.socket, "getaddrinfo", return_value=[addr]), self.assertRaises(ValueError):
            feeds.fetch("https://example.org/feed")

    def test_report_can_be_reopened_by_source(self):
        link = "https://example.org/post"
        item = self.atlas.capture(source_url=link, text="What changed?")
        self.assertIsNone(self.atlas.source_report(link)["report"])
        with self.assertRaises(ValueError):
            self.atlas.save_report("unknown", "Unsupported report")
        self.atlas.save_report(item["evidence_id"], "Summary\nThe source asks a question.")
        report = self.atlas.source_report(link, item["topic"])["report"]
        self.assertEqual(report["evidence_id"], item["evidence_id"])
        self.assertEqual(report["body"], "Summary\nThe source asks a question.")

    def test_public_preview_can_be_replaced_without_masking_readable_evidence(self):
        link = "https://example.org/video"
        preview = self.atlas.capture(source_url=link, text="Title only", provenance="public_preview")
        self.assertEqual(self.atlas.find_source(link)["evidence_id"], preview["evidence_id"])
        full = self.atlas.capture(source_url=link, text="00:00:02 A supplied caption")
        self.atlas.capture(source_url=link, text="Updated title", provenance="public_preview")
        self.assertEqual(self.atlas.find_source(link)["evidence_id"], full["evidence_id"])
        self.assertEqual(self.atlas.view("context", full["topic"])["sample"][0]["provenance"], "user_supplied")
        self.assertEqual(self.atlas.inspect(preview["evidence_id"])["entry_key"], "public-preview")

    def test_story_runs_keep_independent_results_and_terminal_status(self):
        blocked, answered = "a" * 32, "b" * 32
        self.assertIsNone(self.atlas.story_progress(blocked)["progress"])
        self.atlas.story_progress(blocked, stage="reading", message="Opening the source")
        self.atlas.story_progress(blocked, stage="blocked", message="Paste an excerpt")
        self.atlas.story_progress(answered, stage="answered", message="The cited source explains it")
        self.atlas.story_progress(blocked, stage="checking", message="Late progress")
        self.assertEqual(self.atlas.story_progress(blocked)["progress"], {
            "stage": "blocked", "message": "Paste an excerpt"
        })
        self.assertEqual(self.atlas.story_progress(answered)["progress"]["stage"], "answered")

    def test_dossier_citations_validation_and_roundtrip(self):
        from copy import deepcopy
        example = json.loads((core.FIXTURES / "gpu-research.json").read_text(encoding="utf-8"))
        refs = {}
        for source in example["sources"]:
            refs[source["key"]] = self.atlas.capture(
                source_url=source["url"], text=source["text"])["evidence_id"]
        dossier = example["dossier"]
        for group in self.atlas.dossier_items(dossier):
            group["evidence_ids"] = [refs[key] for key in group["evidence_ids"]]
        for claim in dossier["claims"]:
            for entry in claim.get("evidence", []):
                entry["evidence_id"] = refs[entry["evidence_id"]]
        self.atlas.save_dossier(refs["post"], dossier)
        saved = self.atlas.source_report(example["source_url"])["report"]
        self.assertEqual(saved["dossier"], dossier)
        self.assertEqual(saved["sources"][refs["steam"]]["article_url"], example["sources"][3]["url"])
        broken = deepcopy(dossier)
        broken["claims"][0]["evidence_ids"] = ["missing"]
        with self.assertRaises(ValueError):
            self.atlas.save_dossier(refs["post"], broken)
        broken = deepcopy(dossier)
        broken["participants"][0]["role_in_story"]["evidence_ids"] = []
        with self.assertRaisesRegex(ValueError, "Participant context"):
            self.atlas.save_dossier(refs["post"], broken)
        self.assertEqual(self.atlas.source_report(example["source_url"])["report"]["dossier"], dossier)
        story_id = refs["post"]
        self.atlas.exploration_trail(story_id, changes={
            "style": "open", "chapter": "The numbers behind the story", "pinned_id": refs["steam"]
        })
        self.atlas.exploration_trail(story_id, changes={"question": "What does this measure?", "filter": "RTX"})
        self.atlas.exploration_trail(story_id, claim_index=0)
        reopened = core.Atlas(self.atlas.path)
        trail = reopened.exploration_trail(story_id)
        self.assertEqual(trail["trail"]["style"], "open")
        self.assertEqual(trail["trail"]["pinned_id"], refs["steam"])
        self.assertEqual(trail["trail"]["filter"], "RTX")
        self.assertEqual(trail["trail"]["question"], "What does this measure?")
        self.assertEqual(trail["trail"]["chapter"], "The numbers behind the story")
        self.assertEqual(trail["findings"], [dossier["claims"][0]])
        self.assertEqual(reopened.recent_stories()["stories"][0]["evidence_id"], story_id)
        with self.assertRaises(ValueError):
            reopened.exploration_trail(story_id, changes={"style": "guided", "pinned_id": "missing"})
        self.assertEqual(reopened.exploration_trail(story_id)["trail"]["style"], "open")

    def test_feed_rejects_html_and_dtd_without_saving(self):
        for body in (b"<html/>", b"<!DOCTYPE rss><rss/>"):
            with self.assertRaises(ValueError):
                self.atlas.save("roof", "https://example.org/feed", body)
        self.assertEqual(self.atlas.view("context", "roof")["feeds"], [])
        self.assertEqual(feeds.timestamp("2026-10-08"), (None, "timezone_missing"))
        self.assertEqual(feeds.timestamp("bad date"), (None, "invalid"))

    def test_questions_reopen_with_cited_findings(self):
        anchor = self.atlas.capture("GPUs", "https://example.org/post", "Is the GPU common?")
        story_id = anchor["evidence_id"]
        report = {"title": "GPU adoption", "summary": "A claim about ownership.", "research_topic": "GPUs"}
        for key in ("participants", "posts", "claims", "charts", "comparisons", "gaps", "opportunities"):
            report[key] = []
        self.atlas.save_dossier(story_id, report)
        source = self.atlas.capture("GPUs", "https://example.org/survey", "A measured survey result.")
        other = self.atlas.capture("Other", "https://example.org/other", "Unrelated evidence.")
        run = "e" * 32
        self.atlas.start_question(story_id, run, "How was this measured?", "GPU adoption")
        self.atlas.start_question(story_id, run, "How was this measured?", "GPU adoption")
        with self.assertRaises(ValueError):
            self.atlas.start_question(story_id, run, "A different question")
        answer = {
            "answer": "The survey provides a measured result.",
            "evidence_ids": [],
            "findings": [{"label": "Survey result", "detail": "The result comes from a survey.",
                          "evidence_ids": [other["evidence_id"]]}],
        }
        with self.assertRaisesRegex(ValueError, "outside this story"):
            self.atlas.save_question_answer(run, answer)
        answer["findings"][0]["evidence_ids"] = [source["evidence_id"]]
        self.atlas.save_question_answer(run, answer)
        self.atlas.save_question_answer(run, {"answer": "Another attempt", "evidence_ids": [], "findings": []})
        reopened = core.Atlas(self.atlas.path).questions(story_id)
        self.assertEqual(len(reopened["questions"]), 1)
        self.assertEqual(reopened["questions"][0]["answer"], answer)
        self.assertEqual(reopened["sources"][source["evidence_id"]]["article_url"], "https://example.org/survey")

    def test_source_captures_roundtrip_and_stay_scoped_to_evidence(self):
        from base64 import b64encode

        source = self.atlas.capture(source_url="https://example.org/post", text="A saved summary.")
        other = self.atlas.capture(source_url="https://example.org/reply", text="A separate reply.")
        evidence_id = source["evidence_id"]
        path = core.FIXTURES / "gpu-post-profile.jpg"
        image = b64encode(path.read_bytes()).decode("ascii")
        saved = self.atlas.save_visual(evidence_id, "profile", "image/jpeg", image)
        self.assertEqual(self.atlas.save_visual(evidence_id, "profile", "image/jpeg", image), saved)
        self.atlas.save_visual(evidence_id, "post_text", "text/plain", "Exact source wording")
        reopened = core.Atlas(self.atlas.path)
        visuals = reopened.source_visuals(evidence_id)["visuals"]
        self.assertEqual({visual["kind"] for visual in visuals}, {"profile", "post_text"})
        self.assertEqual(reopened.source_visual(evidence_id, saved["visual_id"])["data"], image)
        with self.assertRaisesRegex(ValueError, "Unknown capture"):
            reopened.source_visual(other["evidence_id"], saved["visual_id"])
        with self.assertRaisesRegex(ValueError, "PNG, JPEG, or WebP"):
            reopened.save_visual(evidence_id, "screenshot", "image/png", image)

    def test_story_revisions_preserve_verdicts_and_captures(self):
        story = self.atlas.capture("test", "https://example.org/post", "Initial claim.")
        data = self.atlas.capture("test", "https://example.org/survey", "Initial table.")
        key, original = story["evidence_id"], data["evidence_id"]
        dossier = {"title": "Survey", "summary": "A disputed figure.", "research_topic": "test"}
        for field in ("participants", "posts", "charts", "comparisons", "gaps", "opportunities"):
            dossier[field] = []
        claim = {"claim": "The share is 1%.", "speaker": "Author", "claim_id": "survey-share",
                 "verdict": "unresolved", "reason": "No verified value yet.", "evidence_ids": [original]}
        dossier["claims"] = [claim]
        first = self.atlas.save_dossier(key, dossier)["revision_id"]
        self.assertIsNone(self.atlas.story_changes(key)["previous"])
        self.assertEqual(self.atlas.save_dossier(key, dossier)["revision_id"], first)
        revised = self.atlas.capture("test", data["source_url"], "Corrected table.")["evidence_id"]
        claim.update(claim="The desktop share is 1%.", verdict="contradicted", evidence_ids=[revised],
                     evidence=[{"evidence_id": revised, "role": "challenges", "note": "The table differs."}])
        second = self.atlas.save_dossier(key, dossier, base_revision=first)["revision_id"]
        self.assertGreater(second, first)
        with self.assertRaisesRegex(ValueError, "changed during"):
            self.atlas.save_dossier(key, dossier, base_revision=first)
        changes = self.atlas.story_changes(key)
        self.assertEqual(changes["previous"]["id"], first)
        self.assertEqual(changes["verdicts"][0]["before"]["verdict"], "unresolved")
        self.assertEqual(changes["verdicts"][0]["after"]["verdict"], "contradicted")
        self.assertEqual(changes["added_claims"], [])
        self.assertEqual(changes["revised_sources"][0]["id"], revised)
        self.assertEqual(changes["claim_evidence_updates"][0]["evidence_ids"], [revised])
        self.assertEqual(self.atlas.story_changes(key, first)["current"]["id"], first)
        self.atlas.capture("test", story["source_url"], "New capture of the original post.")
        self.assertEqual(self.atlas.source_report(story["source_url"], "test")["report"]["evidence_id"], key)
        claim["evidence"][0]["evidence_id"] = original
        with self.assertRaisesRegex(ValueError, "listed for that claim"):
            self.atlas.save_dossier(key, dossier)

    def test_hermes_registration_contract(self):
        storage = ModuleType("plugins.plugin_storage")
        storage.plugin_data_dir = lambda name: self.root / name
        ctx = Mock()
        with patch.dict(sys.modules, {"plugins.plugin_storage": storage}):
            plugin.register(ctx)
        calls = {call.kwargs["name"]: call.kwargs for call in ctx.register_tool.call_args_list}
        self.assertEqual(len(calls), 9)
        demo = json.loads(calls["signal_atlas_demo"]["handler"]({}, task_id="test"))
        result = json.loads(calls["signal_atlas_signals"]["handler"]({
            "topic": demo["topic"], "as_of": demo["as_of"],
        }))
        self.assertEqual(result["recent_count"], 3)
        self.assertIn("error", json.loads(calls["signal_atlas_evidence"]["handler"]({"evidence_id": "bad"})))
        self.assertTrue(ctx.register_skill.call_args.args[1].is_file())

