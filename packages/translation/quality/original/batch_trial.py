"""Batch-size experiment: Santet's whole catalogue through Luna low with the v4 prompt, split four ways.

Usage: python3 batch_trial.py run [repeats]   then   python3 batch_trial.py report
"""

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trial  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "results-batch"
CATALOG = Path.home() / "workspace/worktrees/waitron-local-santet-data/local/square/snapshot/catalog.json"
PRICE = trial.PRICES["gpt-6-luna"]
SETUPS = {
    "batch-30": (30, False),
    "batch-30-context": (30, True),
    "batch-90": (90, False),
    "whole": (None, False),
}
FAMILIES = [
    ("bocadillo", r"\bBOCATA\b|\bBOCADILLO\b", "ca"),
    ("takeaway", r"TAKEAWAY", "ca"),
    ("cana", r"\bCANA\b", "ca"),
    ("pinta", r"\bPINTA\b", "ca"),
    ("fritas", r"\bFRITAS\b", "en"),
]


def split(items, size):
    if size is None:
        return [list(items)]
    return [list(items[i:i + size]) for i in range(0, len(items), size)]


def first_words(products, names, pattern, lang):
    counts = {}
    for p in products:
        if not re.search(pattern, p["internal"]):
            continue
        got = names.get(p["id"], {})
        text = "" if got.get("placeholder") else str(got.get(lang) or "").strip()
        word = text.split()[0].casefold() if text else "(blank)"
        counts[word] = counts.get(word, 0) + 1
    return counts


def phrase_share(products, names, pattern, lang, phrase):
    hits = [p for p in products if re.search(pattern, p["internal"])]
    with_phrase = sum(phrase in str(names.get(p["id"], {}).get(lang) or "").casefold() for p in hits)
    return with_phrase, len(hits)


def load_products():
    data = json.loads(CATALOG.read_text())
    objs = data if isinstance(data, list) else data.get("objects", data)
    cats = {o["id"]: o["category_data"]["name"] for o in objs if o.get("type") == "CATEGORY"}
    products = []
    for o in objs:
        if o.get("type") != "ITEM" or o.get("is_deleted"):
            continue
        item = o["item_data"]
        ids = [c.get("id") for c in (item.get("categories") or [])] or [item.get("category_id")]
        category = next((cats[i] for i in ids if i in cats), "")
        products.append({"id": f"s{len(products) + 1:03d}", "internal": item["name"], "category": category})
    return products


def context_block(products):
    lines = [f"{p['internal']} ({p['category']})" for p in products]
    return ("The venue's whole menu, for context only (internal name and category). Write names only for the "
            "products listed under Products below, but keep your wording consistent with the whole menu:\n"
            + "\n".join(lines) + "\n\n")


def run_setup(name, products, repeat):
    size, with_context = SETUPS[name]
    batches = split(products, size)
    prefix = context_block(products) if with_context else ""
    workdir = HERE / "work" / f"batch-{name}"
    workdir.mkdir(parents=True, exist_ok=True)

    def one(batch):
        prompt = prefix + trial.user_prompt(batch)
        try:
            answer = trial.call_openai("gpt-6-luna", "low", trial.SYSTEM_V4, prompt, workdir)
            by_id, problems = trial.normalise(trial.extract_json(answer["text"]), batch)
            return {"names": by_id, "problems": problems, "usage": answer["usage"], "seconds": answer["seconds_model"]}
        except Exception as error:
            return {"names": {}, "problems": [f"batch failed: {str(error)[:200]}"], "usage": {"input": 0, "output": 0},
                    "seconds": 0, "error": True}

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=len(batches)) as pool:
        parts = list(pool.map(one, batches))
    wall = time.monotonic() - started
    names = {}
    for part in parts:
        names.update(part["names"])
    record = {
        "setup": name, "repeat": repeat, "batches": len(batches), "wall_seconds": wall,
        "failed_batches": sum(bool(p.get("error")) for p in parts),
        "problems": [x for p in parts for x in p["problems"]],
        "input": sum(p["usage"]["input"] for p in parts), "output": sum(p["usage"]["output"] for p in parts),
        "names": names,
    }
    OUT.mkdir(exist_ok=True)
    (OUT / f"{name}-{repeat}.json").write_text(json.dumps(record, ensure_ascii=False, indent=1))
    print(f"{name} #{repeat}: {wall:.0f} s, {record['failed_batches']} failed batches, {len(record['problems'])} problems", flush=True)


def run(repeats):
    products = load_products()
    (HERE / "products-batch.json").write_text(json.dumps(products, ensure_ascii=False, indent=1))
    for repeat in range(1, repeats + 1):
        for name in SETUPS:
            run_setup(name, products, repeat)


def report():
    products = json.loads((HERE / "products-batch.json").read_text())
    print(f"{len(products)} products\n")
    print("| setup | run | batches | seconds | failed batches | missing or blank | placeholders | cost per 100 products |")
    print("|---|---|---|---|---|---|---|---|")
    records = [json.loads(f.read_text()) for f in sorted(OUT.glob("*.json"))]
    for r in records:
        cost = trial.cost_usd({"input": r["input"], "output": r["output"]}, PRICE) * 100 / len(products)
        placeholders = sum(bool(v.get("placeholder")) for v in r["names"].values())
        print(f"| {r['setup']} | {r['repeat']} | {r['batches']} | {r['wall_seconds']:.0f} | {r['failed_batches']}"
              f" | {len(r['problems'])} | {placeholders} | ${cost:.4f} |")
    print()
    for family, pattern, lang in FAMILIES:
        print(f"{family} ({lang} first word):")
        for r in records:
            print(f"  {r['setup']} #{r['repeat']}: {first_words(products, r['names'], pattern, lang)}")
    print()
    for r in records:
        hit, total = phrase_share(products, r["names"], r"TAKEAWAY", "ca", "emportar")
        print(f"takeaway says 'emportar': {r['setup']} #{r['repeat']}: {hit}/{total}")


if __name__ == "__main__":
    if sys.argv[1] == "run":
        run(int(sys.argv[2]) if len(sys.argv) > 2 else 2)
    elif sys.argv[1] == "report":
        report()
