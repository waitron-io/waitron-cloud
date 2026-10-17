"""Build the blind grading page from results/, and the key map that ties each name back to its runs."""

import hashlib
import os
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
FINAL = os.environ.get("TRIAL_SET") == "final"
SUFFIX = "-final" if FINAL else ""
LANGS = ("ca", "es", "en")


def key(pid, lang, text):
    return hashlib.sha1(f"{pid}\x1f{lang}\x1f{text}".encode()).hexdigest()[:16]


def main():
    products = json.loads((HERE / f"products{SUFFIX}.json").read_text())
    records = [json.loads(f.read_text()) for f in sorted((HERE / f"results{SUFFIX}").glob("*.json"))]
    records = [r for r in records if "names" in r]
    owners = {}
    for r in records:
        for pid, names in r["names"].items():
            for lang in LANGS:
                text = str(names.get(lang) or "").strip()
                if text and not names.get("placeholder"):
                    owners.setdefault(key(pid, lang, text), {"pid": pid, "lang": lang, "text": text, "runs": []})
                    owners[key(pid, lang, text)]["runs"].append(f"{r['config']}#{r['repeat']}")
    for r in records:
        for pid, names in r["names"].items():
            for c in names.get("corrections") or []:
                if not isinstance(c, dict):
                    continue
                field = {"internal": "Internal name", "ca": "Catalan name", "es": "Spanish name", "en": "English name"}.get(c.get("field"), str(c.get("field")))
                text = f"{field}: {str(c.get('wrong') or '').strip()} → {str(c.get('right') or '').strip()}"
                k = key(pid, "fix", text.casefold())
                owners.setdefault(k, {"pid": pid, "lang": "fix", "text": text, "runs": []})
                owners[k]["runs"].append(f"{r['config']}#{r['repeat']}")
    (HERE / f"grading-keys{SUFFIX}.json").write_text(json.dumps(owners, ensure_ascii=False, indent=1))
    shown_path = HERE / f"shown-keys{SUFFIX}.json"
    shown = set(json.loads(shown_path.read_text())) if shown_path.exists() else set(owners)

    rng = random.Random(20261014)
    page = []
    for p in products:
        given = p.get("existing", {})
        cells = {}
        for lang in LANGS:
            names = [o for o in owners.values() if o["pid"] == p["id"] and o["lang"] == lang and o["text"] != given.get(lang)]
            names.sort(key=lambda o: o["text"])
            rng.shuffle(names)
            cells[lang] = [
                {"k": key(p["id"], lang, o["text"]), "t": o["text"], "new": key(p["id"], lang, o["text"]) not in shown}
                for o in names
            ]
        fixes = sorted((k, o) for k, o in owners.items() if o["pid"] == p["id"] and o["lang"] == "fix")
        cells["fix"] = [{"k": k, "t": o["text"], "new": k not in shown} for k, o in fixes]
        page.append({"id": p["id"], "internal": p["internal"], "category": p["category"], "given": given, "names": cells})

    template = (HERE / "grading.template.html").read_text()
    data = json.dumps(page, ensure_ascii=False).replace("</", "<\\/")
    round_name = (HERE / f"round{SUFFIX}.txt").read_text().strip() if (HERE / f"round{SUFFIX}.txt").exists() else "r1"
    (HERE / f"grading{SUFFIX}.html").write_text(template.replace("/*DATA*/[]", data).replace("/*ROUND*/", round_name))
    total = sum(len(c) for p in page for c in p["names"].values())
    fresh = sum(n["new"] for p in page for c in p["names"].values() for n in c)
    print(f"{len(records)} runs, {total} names, {fresh} new -> grading.html")


if __name__ == "__main__":
    main()
