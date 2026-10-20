#!/usr/bin/env python3
"""Достаёт промпты из блюпринтов Make (Social3.0-SC-*) в worker/prompts.json.

  python3 -I tools/extract_prompts.py ~/Downloads/Portfolio/Social3.0-SC-blueprints

prompts.json не коммитим (репо публичный) — он нужен только Worker'у.
"""
import json, sys
from pathlib import Path

src = Path(sys.argv[1]).expanduser()
out = Path(__file__).resolve().parent.parent / "worker" / "prompts.json"


def modules(flow):
    for m in flow:
        yield m
        for r in m.get("routes") or []:
            yield from modules(r.get("flow", []))


def blueprint(step):
    f = next(src.glob(f"Social3.0-SC-{step}-v*.blueprint.json"))
    return list(modules(json.loads(f.read_text("utf-8"))["flow"]))


def name(m):
    return m.get("metadata", {}).get("designer", {}).get("name") or ""


def texts(body):
    return "\n".join(p["text"] for c in body["contents"] for p in c["parts"] if "text" in p)


val = next(m for m in blueprint("step1.0") if name(m).startswith("GEMINI detect face"))
validate_prompt = texts(json.loads(val["mapper"]["jsonStringBodyContent"]))

restyle = next(m for m in blueprint("step2.1") if "Restyle" in name(m))
body = json.loads(restyle["mapper"]["jsonStringBodyContent"])
restyle_prompt = body["contents"][0]["parts"][0]["text"].replace("{{62.gender}}", "{gender}")

emo = next(m for m in blueprint("step2.0") if m.get("module") == "json:ParseJSON")
emotions = json.loads(emo["mapper"]["json"])["prompts"]

qa = next(m for m in blueprint("step2.2.1") if name(m) == "GEMINI QA")
qa_prompt = json.loads(qa["mapper"]["jsonStringBodyContent"])["systemInstruction"]["parts"][0]["text"]

# QA по одной картинке (только стикер): без критерия 3 (сходство с исходником) — второго изображения нет
qa_single = qa_prompt.split("3. **CRITICAL: Content Preservation")[0].rstrip()
qa_single = (qa_single
    .replace(' based on the identity in a "SOURCE REFERENCE PHOTO" (Image 1) against', " against")
    .replace("(Image 2, which may feature a different emotion or artistic elements)", "(the attached image)"))
qa_single = "\n".join(l for l in qa_single.split("\n") if "Failure - Likeness" not in l)
assert "Image 1" not in qa_single and "Likeness" not in qa_single, "qa_single: адаптация не сработала"

out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({
    "validate": validate_prompt,
    "restyle": restyle_prompt,
    "emotions": [{"id": e["name"], "prompt": e["prompt"]} for e in emotions],
    "qa": qa_prompt,
    "qa_single": qa_single,
}, ensure_ascii=False, indent=2), "utf-8")
print(f"{out}: validate + restyle + {len(emotions)} emotions + qa + qa_single")
