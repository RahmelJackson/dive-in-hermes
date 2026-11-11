"""Shared evidence operations for the Codex and Hermes Studio hosts."""
from base64 import b64encode
import json
from pathlib import Path

from . import VIEWS, execute
from .atlas import Atlas
from .dossier import DOSSIER, PARTICIPANT_CONTEXT_FIELDS, QUESTION_ANSWER


ROOT = Path(__file__).resolve().parent
STUDIO_ACTION_SCHEMA = {"type": "object", "required": ["action"], "properties": {
             "action": {"type": "string", "enum": ["demo", "research_example", "source", "capture", "evidence", "source_visuals", "source_visual", "save_source_visual", "report", "story_changes", "save_report", "save_dossier", "progress", "set_progress", "recent_stories", "trail", "save_trail", "save_finding", "questions", "start_question", "save_question_answer", *VIEWS]},
             "topic": {"type": "string"}, "source_url": {"type": "string"},
             "text": {"type": "string"}, "title": {"type": "string"}, "date": {"type": "string"},
             "provenance": {"type": "string", "enum": ["user_supplied", "public_excerpt", "public_preview"]},
             "as_of": {"type": "string"}, "evidence_id": {"type": "string"},
             "visual_id": {"type": "string", "maxLength": 64},
             "visual_kind": {"type": "string", "enum": ["screenshot", "profile", "media", "post_text"]},
             "visual_mime": {"type": "string", "enum": ["image/png", "image/jpeg", "image/webp", "text/plain"]},
             "visual_data": {"type": "string", "maxLength": 800000},
             "report": {"type": "string", "maxLength": 15000},
             "dossier": DOSSIER,
             "base_revision": {"type": "integer", "minimum": 0},
             "revision_id": {"type": "integer", "minimum": 1},
             "question": {"type": "string", "maxLength": 1200},
             "question_context": {"type": "string", "maxLength": 500},
             "question_answer": QUESTION_ANSWER,
             "run_id": {"type": "string", "pattern": "^[0-9a-f]{32}$"},
             "stage": {"type": "string", "enum": ["reading", "checking", "blocked", "answered"]},
             "message": {"type": "string", "maxLength": 6000},
             "changes": {"type": "object", "properties": {
                 key: {"type": "string"} for key in ("chapter", "style", "pinned_id", "question", "filter")
             }, "additionalProperties": False},
             "claim_index": {"type": "integer", "minimum": 0},
             "demo_workspace": {"type": "boolean"},
         }, "additionalProperties": False}


def seed_example_visuals(atlas, sources, refs):
    for source in sources:
        evidence_id = refs.get(source["key"])
        if not evidence_id:
            continue
        if "profile_image" in source:
            image = (ROOT / "fixtures" / source["profile_image"]).read_bytes()
            atlas.save_visual(evidence_id, "profile", "image/jpeg", b64encode(image).decode("ascii"))
        if "post_excerpt" in source:
            atlas.save_visual(evidence_id, "post_text", "text/plain", source["post_excerpt"])


def example_claim_annotations(expected, refs):
    return [dict(item, evidence_id=refs.get(item["evidence_id"])) for item in expected.get("evidence", [])]


def studio_action(data_path, arguments):
    demo_path = data_path.with_name(data_path.stem + "-demo.sqlite3")
    args = arguments.copy()
    action = args.pop("action")
    demo = args.pop("demo_workspace", False)
    if action == "research_example":
        atlas = Atlas(data_path)
        example = json.loads((ROOT / "fixtures/gpu-research.json").read_text(encoding="utf-8"))
        topic = "PC GPUs versus Switch 2"
        existing = atlas.source_report(example["source_url"], topic)["report"]
        if existing and existing.get("dossier"):
            changed = False
            ids = {item["article_url"]: item["id"] for item in existing["sources"].values()}
            refs = {source["key"]: ids.get(source["url"]) for source in example["sources"]}
            # Add the reference line to earlier copies of the bundled chart.
            expected = example["dossier"]["charts"][0]
            reply = next(source for source in example["sources"] if source["key"] == "reply")
            reply_id = atlas.find_source(reply["url"], topic).get("evidence_id")
            for chart in existing["dossier"]["charts"]:
                if (reply_id and "reference" not in chart and
                        all(chart[key] == expected[key] for key in ("title", "period", "unit", "values"))):
                    chart["reference"] = expected["reference"]
                    if reply_id not in chart["evidence_ids"]:
                        chart["evidence_ids"].append(reply_id)
                    changed = True
                    break
            people = {person["handle"]: person for person in example["dossier"]["participants"]}
            for person in existing["dossier"]["participants"]:
                expected = people.get(person["handle"])
                if not expected or person["position"] != expected["position"]:
                    continue
                for field in PARTICIPANT_CONTEXT_FIELDS:
                    context = expected.get(field)
                    if field in person or not context:
                        continue
                    evidence_ids = [refs.get(key) for key in context["evidence_ids"]]
                    if all(evidence_ids):
                        person[field] = dict(context, evidence_ids=evidence_ids)
                        changed = True
            claims = {(claim["speaker"], claim["claim"]): claim for claim in example["dossier"]["claims"]}
            for claim in existing["dossier"]["claims"]:
                expected_claim = claims.get((claim["speaker"], claim["claim"]))
                if not expected_claim or claim["reason"] != expected_claim["reason"]:
                    continue
                if "claim_id" not in claim:
                    claim["claim_id"] = expected_claim["claim_id"]
                    changed = True
                if "attribution" not in claim:
                    claim["attribution"] = expected_claim["attribution"]
                    changed = True
                annotations = example_claim_annotations(expected_claim, refs)
                if "evidence" not in claim and all(item["evidence_id"] in claim["evidence_ids"] for item in annotations):
                    claim["evidence"] = annotations
                    changed = True
            if ("learning_path" not in existing["dossier"] and
                    all(refs.get(key) for step in example["dossier"]["learning_path"] for key in step["evidence_ids"]) and
                    all(any(claim["claim"] == expected["claim"] and claim["reason"] == expected["reason"]
                            for claim in existing["dossier"]["claims"]) for expected in claims.values())):
                existing["dossier"]["learning_path"] = [
                    dict(step, evidence_ids=[refs[key] for key in step["evidence_ids"]])
                    for step in example["dossier"]["learning_path"]
                ]
                changed = True
            if changed:
                atlas.save_dossier(existing["evidence_id"], existing["dossier"],
                                  base_revision=existing["revision_id"] or 0)
            seed_example_visuals(atlas, example["sources"], refs)
            return {"topic": topic, "source_url": example["source_url"]}
        refs = {}
        for source in example["sources"]:
            item = atlas.capture(topic=topic, source_url=source["url"], title=source["title"],
                                 text=source["text"], provenance="public_excerpt")
            refs[source["key"]] = item["evidence_id"]
        dossier = example["dossier"]
        for group in atlas.dossier_items(dossier):
            group["evidence_ids"] = [refs[key] for key in group["evidence_ids"]]
        for claim in dossier["claims"]:
            claim["evidence"] = example_claim_annotations(claim, refs)
        atlas.save_dossier(refs["post"], dossier)
        seed_example_visuals(atlas, example["sources"], refs)
        data = {"topic": topic, "source_url": example["source_url"]}
    elif action == "source":
        data = Atlas(data_path).find_source(args["source_url"], args.get("topic"))
    elif action in {"source_visuals", "source_visual", "save_source_visual"}:
        atlas = Atlas(demo_path if demo else data_path)
        if action == "source_visuals":
            data = atlas.source_visuals(args["evidence_id"])
        elif action == "source_visual":
            data = atlas.source_visual(args["evidence_id"], args["visual_id"])
            return data
        else:
            data = atlas.save_visual(args["evidence_id"], args["visual_kind"], args["visual_mime"], args["visual_data"])
    elif action == "report":
        data = Atlas(data_path).source_report(args["source_url"], args.get("topic"), args.get("evidence_id"))
    elif action == "story_changes":
        data = Atlas(data_path).story_changes(args["evidence_id"], args.get("revision_id"))
    elif action == "recent_stories":
        data = Atlas(data_path).recent_stories()
    elif action in {"trail", "save_trail", "save_finding"}:
        data = Atlas(data_path).exploration_trail(
            args["evidence_id"], changes=args["changes"] if action == "save_trail" else None,
            claim_index=args["claim_index"] if action == "save_finding" else None)
    elif action == "save_report":
        data = Atlas(data_path).save_report(args["evidence_id"], args["report"])
    elif action == "save_dossier":
        data = Atlas(data_path).save_dossier(args["evidence_id"], args["dossier"],
                                            base_revision=args.get("base_revision"))
    elif action == "progress":
        data = Atlas(data_path).story_progress(args["run_id"])
    elif action == "set_progress":
        data = Atlas(data_path).story_progress(args["run_id"], stage=args["stage"], message=args["message"])
    elif action == "questions":
        data = Atlas(data_path).questions(args["evidence_id"])
    elif action == "start_question":
        data = Atlas(data_path).start_question(
            args["evidence_id"], args["run_id"], args["question"], args.get("question_context", ""))
    elif action == "save_question_answer":
        data = Atlas(data_path).save_question_answer(args["run_id"], args["question_answer"])
    elif action == "capture":
        data = Atlas(data_path).capture(**args)
    elif action in {"demo", "evidence", *VIEWS}:
        atlas = Atlas(demo_path if demo or action == "demo" else data_path)
        data = execute(atlas, action, args)
    else:
        raise ValueError("Unknown Studio action")
    return data
