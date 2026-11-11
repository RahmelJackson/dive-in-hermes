"""Run Signal Atlas independently of Hermes."""
import argparse
import json
from pathlib import Path

from . import VIEWS, execute
from .atlas import Atlas, DEMO_TIME


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("demo")
    commands.add_parser("evidence").add_argument("evidence_id")
    capture = commands.add_parser("capture")
    capture.add_argument("topic")
    capture.add_argument("source_url")
    capture.add_argument("text_file", type=Path)
    capture.add_argument("--title", default="")
    capture.add_argument("--date")
    for mode in ["ingest", *VIEWS]:
        command = commands.add_parser(mode)
        command.add_argument("topic")
        if mode == "ingest":
            command.add_argument("feed_url")
        if mode == "signals":
            command.add_argument("--as-of")
    args = parser.parse_args()
    atlas = Atlas(args.db)
    if args.action == "demo":
        atlas = Atlas(args.db, clock=lambda: DEMO_TIME)
        result = atlas.demo()
        result["views"] = {mode: atlas.view(mode, result["topic"], DEMO_TIME) for mode in VIEWS}
    elif args.action == "capture":
        result = atlas.capture(args.topic, args.source_url,
                               args.text_file.read_text(encoding="utf-8-sig"),
                               args.title, args.date)
    else:
        result = execute(atlas, args.action, vars(args))
    print(json.dumps(result, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()

