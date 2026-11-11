"""Validated research dossiers."""
import math

def text(limit=3000):
    return {"type": "string", "maxLength": limit}

def array(items, limit=30):
    return {"type": "array", "items": items, "maxItems": limit}

def obj(properties):
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}

REFS = array(text(64), 12)
DOSSIER = obj({
    "title": text(200), "summary": text(), "research_topic": text(200),
    "participants": array(obj({
        "handle": text(100), "profile_url": text(2048), "position": text(),
        "history": array(obj({"summary": text(), "evidence_ids": REFS}), 10),
    }), 20),
    "posts": array(obj({"author": text(100), "relationship": text(200), "summary": text(), "evidence_ids": REFS})),
    "claims": array(obj({
        "claim": text(), "speaker": text(100),
        "verdict": {"type": "string", "enum": ["supported", "partly supported", "contradicted", "unresolved"]},
        "reason": text(), "evidence_ids": REFS,
    }), 20),
    "charts": array(obj({
        "title": text(200), "unit": text(80), "period": text(100), "caveat": text(),
        "values": array(obj({"label": text(100), "value": {"type": "number"}}), 20), "evidence_ids": REFS,
    }), 5),
    "comparisons": array(obj({
        "title": text(200), "columns": array(text(150), 8),
        "rows": array(array(text(1000), 8), 20), "evidence_ids": REFS,
    }), 5),
    "gaps": array(text(), 15), "opportunities": array(text(), 10),
})

CHART = DOSSIER["properties"]["charts"]["items"]
CHART["properties"]["reference"] = obj({"label": text(150), "value": {"type": "number"}})
CLAIM = DOSSIER["properties"]["claims"]["items"]
CLAIM["properties"]["claim_id"] = text(100)
CLAIM["properties"]["attribution"] = {"type": "string", "enum": ["stated", "inferred"]}
CLAIM_EVIDENCE = obj({
    "evidence_id": text(64),
    "role": {"type": "string", "enum": ["statement", "supports", "challenges", "context"]},
    "note": text(600),
})
CLAIM_EVIDENCE["properties"]["origin_evidence_id"] = text(64)
CLAIM["properties"]["evidence"] = array(CLAIM_EVIDENCE, 24)
LEARNING_STEP = obj({
    "focus": {"type": "string", "enum": [
        "story", "perspectives", "measurements", "comparison", "claims", "sources", "open", "synthesis",
    ]},
    "question": text(180), "answer": text(1200), "why_it_matters": text(1200), "evidence_ids": REFS,
})
LEARNING_STEP["properties"]["concepts"] = array(obj({
    "label": text(80), "explanation": text(450),
}), 4)
DOSSIER["properties"]["learning_path"] = array(LEARNING_STEP, 8)
PARTICIPANT_CONTEXT_FIELDS = ("role_in_story", "public_context")
PARTICIPANT = DOSSIER["properties"]["participants"]["items"]
for field in PARTICIPANT_CONTEXT_FIELDS:
    PARTICIPANT["properties"][field] = obj({"summary": text(1200), "evidence_ids": REFS})
QUESTION_ANSWER = obj({
    "answer": text(6000),
    "evidence_ids": REFS,
    "findings": array(obj({"label": text(150), "detail": text(), "evidence_ids": REFS}), 5),
})

def validate(value, schema, path="dossier"):
    kind = schema["type"]
    matches = {"object": isinstance(value, dict), "array": isinstance(value, list),
               "string": isinstance(value, str),
               "number": isinstance(value, (int, float)) and not isinstance(value, bool)}
    if not matches[kind]:
        raise ValueError(f"{path} must be {kind}")
    if kind == "object":
        if not set(schema["required"]) <= set(value) <= set(schema["properties"]):
            raise ValueError(f"{path} requires {schema['required']} and accepts {list(schema['properties'])}")
        for key, item in value.items():
            validate(item, schema["properties"][key], f"{path}.{key}")
    elif kind == "array":
        if len(value) > schema["maxItems"]:
            raise ValueError(f"{path} has too many entries")
        for index, item in enumerate(value):
            validate(item, schema["items"], f"{path}[{index}]")
    elif kind == "string":
        if len(value) > schema.get("maxLength", 3000) or ("enum" in schema and value not in schema["enum"]):
            raise ValueError(f"Invalid {path}")
    elif not math.isfinite(value) or value < 0:
        raise ValueError(f"{path} must be finite and nonnegative")
