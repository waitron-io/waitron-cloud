"""Trial: write and translate customer-facing menu names with several models, in one request per run.

Usage: python3 trial.py run <config> [repeats]   (configs: see CONFIGS)
       python3 trial.py report
"""

import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
FINAL = os.environ.get("TRIAL_SET") == "final"
PRODUCTS_FILE = HERE / ("products-final.json" if FINAL else "products.json")
RESULTS = HERE / ("results-final" if FINAL else "results")
LANGS = ("ca", "es", "en")

SYSTEM = """You write customer-facing names for a café-bar's menu in Spain.
The venue's default customer language is Catalan (ca). The other customer languages are Spanish (es) and English (en).

Each product has an internal name used by staff. Internal names are often in capitals, mix languages, contain typos,
abbreviations, prices or codes. Some products already have a customer-facing name in one or more languages.

Rules:
1. A customer-facing name that is already given is kept exactly as given, character for character.
2. If the Catalan name is missing, write it. Base it on the best existing customer-facing name if there is one
   (it carries detail the internal name may lack); otherwise base it on the internal name.
3. Write every other missing language from the existing customer-facing names (given or just written), never from
   the internal name alone when a customer-facing name exists.
4. Write natural menu names: sentence case, the local way a menu in that language would say it. Keep brand names and
   dish names that a menu would leave untranslated, spelled as the brand spells them. Correct obvious typos.
5. Drop prices, sizes that read like stock codes, and staff notes from customer-facing names.
6. Add a review entry for any name you are not sure about, or that a person should look at: an ambiguous internal
   name, a guess about what the dish is, a dropped price, a corrected brand, a name that may be a placeholder.
   Give the language and a short reason. A name you are confident in gets no entry.

Reply with JSON only, no prose, in exactly this shape:
{"products": [{"id": "p01", "ca": "...", "es": "...", "en": "...", "review": [{"language": "ca", "reason": "..."}]}]}
Every product appears once, with all three languages filled."""

SYSTEM_V2 = """You write customer-facing names for a café-bar's menu in Spain.
The venue's default customer language is Catalan (ca). The other customer languages are Spanish (es) and English (en).

Each product has an internal name typed quickly by staff: often in capitals, mixing languages, with typos,
abbreviations, prices or codes. Some products already have a customer-facing name in one or more languages.

Rules:
1. A customer-facing name that is already given is kept exactly as given, character for character.
2. A dish or drink that has a standard name in a language is called by that name in that language, the way a local
   menu would print it, even when an existing name in another language describes it in more detail. For example
   patates braves (ca) / patatas bravas (es) / patatas bravas (en); truita de patates (ca) / tortilla de patatas (es)
   / Spanish omelette (en).
3. Otherwise, write a missing language from the existing customer-facing names (given, or written by you for the
   default language), never from the internal name alone when a customer-facing name exists.
4. Write each language as a native speaker would. Catalan names use Catalan vocabulary, not Spanish words in Catalan
   spelling; Spanish names use Spanish vocabulary, not Catalan words.
5. Correct typos in dish names and in brand names, and spell a brand as the brand spells it.
6. Drop prices, sizes that read like stock codes, and staff notes. Use sentence case.
7. A placeholder product is one whose internal name does not say what the customer gets, such as a "special" sold
   at a price (SPECIAL 7, TAPA SPECIAL 3.00). Do not invent a name for it: set "placeholder": true and leave all
   three names empty.

Reply with JSON only, no prose, in exactly this shape:
{"products": [{"id": "p01", "ca": "...", "es": "...", "en": "...", "placeholder": false}]}
Every product appears once."""

SYSTEM_V3 = SYSTEM_V2.replace(
    """7. A placeholder product""",
    """7. Never change a customer-facing name that is already given, even to fix it. If it has a spelling mistake, list
   the fix under "corrections" with "field" set to its language.
8. When you correct a typo in the internal name (in a dish or a brand), list it under "corrections" with "field" set
   to "internal", so staff can fix the internal name too. List only real spelling fixes, not translations,
   capitalisation or dropped prices.
9. A placeholder product""",
).replace(
    """{"products": [{"id": "p01", "ca": "...", "es": "...", "en": "...", "placeholder": false}]}""",
    """{"products": [{"id": "p01", "ca": "...", "es": "...", "en": "...", "placeholder": false,
  "corrections": [{"field": "internal", "wrong": "...", "right": "..."}]}]}
"corrections" is an empty list when there is nothing to fix.""",
)
assert "9. A placeholder" in SYSTEM_V3 and '"corrections": [{' in SYSTEM_V3

SYSTEM_V4 = SYSTEM_V3.replace(
    """2. A dish or drink that has a standard name in a language is called by that name in that language, the way a local
   menu would print it, even when an existing name in another language describes it in more detail. For example
   patates braves (ca) / patatas bravas (es) / patatas bravas (en); truita de patates (ca) / tortilla de patatas (es)
   / Spanish omelette (en).""",
    """2. A dish or drink that has a standard name in a language is called by that name in that language, the way a local
   menu would print it, not translated word for word from another language. For example patates braves (ca) /
   patatas bravas (es) / patatas bravas (en); truita de patates (ca) / tortilla de patatas (es) / Spanish omelette
   (en). Keep any detail the existing names add beyond the standard dish: "patatas bravas con alioli" becomes
   "patates braves amb allioli".
   Some names stay as they are on menus here in every language, such as a sandwich or bowl known by an English or
   brand-like name (brunch, poke bowl); do not translate those.""",
).replace(
    """6. Drop prices, sizes that read like stock codes, and staff notes. Use sentence case.""",
    """6. Keep everything the customer needs to know: what comes with it (with fries, with salad), the serving size
   (33 cl, 50 cl, half, double), and whether it is takeaway. Correct an obviously wrong unit (a 33 ml bottle is
   33 cl). Drop only prices, stock codes and staff notes. Use sentence case.""",
)
assert "patates braves amb allioli" in SYSTEM_V4 and "33 cl" in SYSTEM_V4

SYSTEM_V5 = SYSTEM_V4.replace(
    """spelling; Spanish names use Spanish vocabulary, not Catalan words.""",
    """spelling; Spanish names use Spanish vocabulary, not Catalan words. A drink sold in its container takes "de"
   (cerveza de botella, vi d'ampolla); food preserved in one takes "en" (sardinas en lata).""",
)
assert "vi d'ampolla" in SYSTEM_V5

PROMPTS = {"v1": SYSTEM, "v2": SYSTEM_V2, "v3": SYSTEM_V3, "v4": SYSTEM_V4, "v5": SYSTEM_V5}

PROBE_SYSTEM = "Reply with the single word OK."

# A one-off request gets no repeated-prompt discount, so every input token is priced at the full input rate.
# USD per million tokens. Sources are recorded in prices.md.
PRICES = {
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50},
    "claude-sonnet-5-5": {"input": 2.00, "output": 10.00},
    "gpt-6-luna": {"input": 0.10, "output": 0.50},
    "gpt-5.6-terra": {"input": 2.00, "output": 12.00},
}

CLAUDE_FLAGS = [
    "--tools", "", "--no-session-persistence", "--output-format", "json",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "",
]

CONFIGS = {
    "haiku-low": ("claude", "haiku", "low"),
    "haiku-medium": ("claude", "haiku", "medium"),
    "sonnet-low": ("claude", "sonnet", "low"),
    "sonnet-medium": ("claude", "sonnet", "medium"),
    "luna-low": ("codex", "gpt-6-luna", "low"),
    "luna-medium": ("codex", "gpt-6-luna", "medium"),
    "terra-low": ("codex", "gpt-5.6-terra", "low"),
    "terra-medium": ("codex", "gpt-5.6-terra", "medium"),
    "luna-low-api": ("openai", "gpt-6-luna", "low"),
    "luna-medium-api": ("openai", "gpt-6-luna", "medium"),
    "terra-low-api": ("openai", "gpt-5.6-terra", "low"),
    "terra-medium-api": ("openai", "gpt-5.6-terra", "medium"),
    "luna-low-v2": ("openai", "gpt-6-luna", "low", "v2"),
    "terra-low-v2": ("openai", "gpt-5.6-terra", "low", "v2"),
    "luna-low-v3": ("openai", "gpt-6-luna", "low", "v3"),
    "terra-low-v3": ("openai", "gpt-5.6-terra", "low", "v3"),
    "luna-low-v4": ("openai", "gpt-6-luna", "low", "v4"),
    "luna-low-v5": ("openai", "gpt-6-luna", "low", "v5"),
    "luna-low-v4+luna-medium": ("openai", "gpt-6-luna", "low", "v4"),
    "luna-low-v4+terra-low": ("openai", "gpt-5.6-terra", "low", "v4"),
}


# ---- scoring ------------------------------------------------------------------------------------


def extract_json(text):
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    candidate = fenced.group(1) if fenced else text[text.find("{"): text.rfind("}") + 1]
    if not candidate:
        raise ValueError("no JSON object in reply")
    return json.loads(candidate)


def normalise(reply, products):
    by_id = {p.get("id"): p for p in reply.get("products", []) if isinstance(p, dict)}
    problems = []
    for product in products:
        got = by_id.get(product["id"])
        if got is None:
            problems.append(f"{product['id']}: missing from reply")
            continue
        if got.get("placeholder") is True:
            continue
        for lang in LANGS:
            if not str(got.get(lang) or "").strip():
                problems.append(f"{product['id']}: {lang} is empty")
    return by_id, problems


def _fold(text):
    text = re.sub(r"[´’`‘]", "'", str(text or ""))
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).casefold()


def kept_exact(lang, text):
    return lambda got: got.get(lang) == text


def contains_any(words_by_lang):
    return lambda got: all(any(_fold(w) in _fold(got.get(lang)) for w in words) for lang, words in words_by_lang.items())


def contains_none(words_by_lang):
    return lambda got: not any(_fold(w) in _fold(got.get(lang)) for lang, words in words_by_lang.items() for w in words)


def corrected(field, right):
    def check(got):
        return any(
            isinstance(c, dict) and c.get("field") == field and right.casefold() in str(c.get("right") or "").casefold()
            for c in got.get("corrections") or []
        )
    return check


def no_digits():
    return lambda got: not any(re.search(r"\d", str(got.get(lang) or "")) for lang in LANGS)


def is_flagged(got):
    return bool(got.get("review")) or got.get("placeholder") is True


def flagged():
    return is_flagged


def run_checks(checks, by_id):
    return [
        {"id": pid, "label": label, "passed": pid in by_id and bool(check(by_id[pid]))}
        for pid, label, check in checks
    ]


def net_usage(usage, overhead):
    return {"input": max(0, usage["input"] - overhead["input"]), "output": usage["output"]}


def cost_usd(usage, price):
    return (usage["input"] * price["input"] + usage["output"] * price["output"]) / 1_000_000


def consistency(runs, ids):
    same = total = 0
    for pid in ids:
        for lang in LANGS:
            total += 1
            values = [run.get(pid, {}).get(lang) for run in runs]
            same += values[0] is not None and all(v == values[0] for v in values)
    return same / total if total else 0


ALL3 = lambda w: {lang: w for lang in LANGS}  # noqa: E731

CHECKS = [
    ("p03", "cauliflower typo corrected", contains_any({"ca": ["coliflor"], "es": ["coliflor"], "en": ["cauliflower"]})),
    ("p05", "sausage typo understood", contains_any({"ca": ["salsitx", "botifarr", "frankfurt"], "es": ["salchich"], "en": ["sausage"]})),
    ("p06", "gilda recognised", contains_any(ALL3(["gild"]))),
    ("p08", "takeaway said in each language", contains_any({"ca": ["emportar"], "es": ["llevar"], "en": ["takeaway", "take-away", "take away", "to go"]})),
    ("p13", "smoothie typo corrected", contains_any({"en": ["smoothie"]})),
    ("p16", "bikini not read as swimwear", contains_none({"en": ["swim"], "es": ["bañador"], "ca": ["banyador"]})),
    ("p17", "price dropped", no_digits()),
    ("p17", "price flagged", flagged()),
    ("p18", "price dropped", no_digits()),
    ("p18", "price flagged", flagged()),
    ("p19", "brand spelled Estrella Galicia", contains_any(ALL3(["estrella galicia"]))),
    ("p20", "brand spelled Alhambra", contains_any(ALL3(["alhambra"]))),
    ("p21", "brand spelled Hennessy", contains_any(ALL3(["hennessy"]))),
    ("p24", "toddy typo corrected", contains_any({"en": ["toddy"]})),
    ("p26", "rooibos typo corrected", contains_any(ALL3(["rooibos"]))),
    ("p27", "given English kept", kept_exact("en", "Broken eggs with chorizo")),
    ("p27", "chorizo carried from English", contains_any({"ca": ["xori", "chorizo"], "es": ["chorizo"]})),
    ("p28", "given English kept", kept_exact("en", "Toasted bread rubbed with tomato and olive oil")),
    ("p28", "olive oil carried from English", contains_any({"ca": ["oli"], "es": ["aceite"]})),
    ("p29", "given Catalan kept", kept_exact("ca", "Croquetes de vedella rostida")),
    ("p29", "roast carried from Catalan", contains_any({"es": ["asad"], "en": ["roast"]})),
    ("p30", "given Spanish kept", kept_exact("es", "Escalivada de pimiento y berenjena asados, para llevar")),
    ("p30", "peppers carried from Spanish", contains_any({"ca": ["pebrot"], "en": ["pepper"]})),
    ("p31", "given English kept", kept_exact("en", "Cesar salad")),
    ("p31", "Caesar suggested for the given English", corrected("en", "Caesar")),
    ("p32", "given Spanish kept", kept_exact("es", "Tarta de limon")),
    ("p32", "limón suggested for the given Spanish", corrected("es", "limón")),
    ("p22", "Zurito listed as an internal fix", corrected("internal", "Zurito")),
    ("p30", "takeaway carried from Spanish", contains_any({"ca": ["emportar"], "en": ["takeaway", "take-away", "take away", "to go"]})),
]


if FINAL:  # the hand-written checks name tuning-set products only
    CHECKS = []


# ---- running ------------------------------------------------------------------------------------


def user_prompt(products):
    rows = [
        {"id": p["id"], "internal": p["internal"], "category": p["category"], "existing": p.get("existing", {})}
        for p in products
    ]
    return "Products:\n" + json.dumps(rows, ensure_ascii=False, indent=1)


def call_claude(model, effort, system, prompt, workdir):
    cmd = ["claude", "-p", "--model", model, "--effort", effort, "--system-prompt", system, *CLAUDE_FLAGS, prompt]
    started = time.monotonic()
    out = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, timeout=900, stdin=subprocess.DEVNULL)
    wall = time.monotonic() - started
    if out.returncode != 0:
        raise RuntimeError(f"claude exited {out.returncode}: {out.stderr[-2000:]}")
    data = json.loads(out.stdout)
    u = data["usage"]
    return {
        "text": data["result"],
        "model": ",".join(data.get("modelUsage", {})),
        "seconds_model": data["duration_api_ms"] / 1000,
        "seconds_wall": wall,
        "usage": {
            "input": u["input_tokens"] + u["cache_creation_input_tokens"] + u["cache_read_input_tokens"],
            "output": u["output_tokens"],
        },
        "reasoning_tokens": u.get("output_tokens_details", {}).get("thinking_tokens", 0),
        "tool_cost_usd": data.get("total_cost_usd"),
    }


def codex_home():
    home = HERE / "codex-home"
    home.mkdir(exist_ok=True)
    link = home / "auth.json"
    if not link.exists():
        link.symlink_to(Path.home() / ".codex" / "auth.json")
    (home / "config.toml").write_text("")
    return home


def codex_disable_flags(env):
    listing = subprocess.run(["codex", "features", "list"], capture_output=True, text=True, env=env).stdout
    flags = []
    for line in listing.splitlines():
        parts = line.split()
        if parts and parts[-1] == "true":
            flags += ["--disable", parts[0]]
    return flags


def call_codex(model, effort, system, prompt, workdir):
    env = {**os.environ, "CODEX_HOME": str(codex_home())}
    instructions = Path(workdir) / "instructions.md"
    instructions.write_text(system)
    cmd = [
        "codex", "exec", "--skip-git-repo-check", "-m", model, "-s", "read-only", "--json",
        "-c", f'model_reasoning_effort="{effort}"', "-c", f'model_instructions_file="{instructions}"',
        *codex_disable_flags(env), prompt,
    ]
    started = time.monotonic()
    out = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, timeout=900, env=env, stdin=subprocess.DEVNULL)
    wall = time.monotonic() - started
    if out.returncode != 0:
        raise RuntimeError(f"codex exited {out.returncode}: {out.stderr[-2000:]}")
    text, usage = "", None
    for line in out.stdout.splitlines():
        event = json.loads(line)
        item = event.get("item", {})
        if event.get("type") == "item.completed" and item.get("type") == "agent_message":
            text = item["text"]
        if event.get("type") == "turn.completed":
            usage = event["usage"]
    return {
        "text": text,
        "model": model,
        "seconds_model": None,
        "seconds_wall": wall,
        "usage": {"input": usage["input_tokens"], "output": usage["output_tokens"]},
        "reasoning_tokens": usage.get("reasoning_output_tokens", 0),
        "tool_cost_usd": None,
    }


def openai_key():
    for line in (Path.home() / ".llm-trial" / "env").read_text().splitlines():
        line = line.strip().removeprefix("export ").removeprefix("OPENAI_API_KEY=").strip()
        if line.startswith("sk-"):
            return line
    raise RuntimeError("no OpenAI key (a line starting sk-) in ~/.llm-trial/env")


def call_openai(model, effort, system, prompt, workdir):
    import urllib.error
    import urllib.request

    body = {
        "model": model,
        "instructions": system,
        "input": prompt,
        "reasoning": {"effort": effort},
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {openai_key()}", "Content-Type": "application/json"},
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"openai {error.code}: {error.read()[-2000:]!r}") from None
    wall = time.monotonic() - started
    text = "".join(
        part.get("text", "")
        for item in data.get("output", []) if item.get("type") == "message"
        for part in item.get("content", []) if part.get("type") == "output_text"
    )
    usage = data["usage"]
    return {
        "text": text,
        "model": data.get("model", model),
        "seconds_model": wall,
        "seconds_wall": wall,
        "usage": {"input": usage["input_tokens"], "output": usage["output_tokens"]},
        "reasoning_tokens": usage.get("output_tokens_details", {}).get("reasoning_tokens", 0),
        "tool_cost_usd": None,
    }


def run(config, repeats, first=1):
    tool, model, effort, *rest = CONFIGS[config]
    system = PROMPTS[rest[0] if rest else "v1"]
    call = {"claude": call_claude, "codex": call_codex, "openai": call_openai}[tool]
    products = json.loads(PRODUCTS_FILE.read_text())
    workdir = HERE / "work" / config
    workdir.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(exist_ok=True)
    if tool == "openai":  # a direct request carries nothing but our prompt
        probe = {"usage": {"input": 0, "output": 0}, "seconds_wall": 0.0}
    else:
        probe = call(model, effort, PROBE_SYSTEM, "ping", workdir)
        probe.pop("text")
    for n in range(first, repeats + 1):
        record = {"config": config, "tool": tool, "effort": effort, "repeat": n, "probe": probe,
                  "prompt": rest[0] if rest else "v1"}
        try:
            record.update(call(model, effort, system, user_prompt(products), workdir))
            by_id, problems = normalise(extract_json(record["text"]), products)
            record["problems"] = problems
            record["names"] = by_id
            record["checks"] = run_checks(CHECKS, by_id)
        except Exception as error:  # a failed run is a result too
            record["error"] = str(error)
        path = RESULTS / f"{config}-{n}.json"
        path.write_text(json.dumps(record, ensure_ascii=False, indent=1))
        passed = sum(c["passed"] for c in record.get("checks", []))
        print(f"{config} #{n}: {record.get('error') or f'{passed}/{len(CHECKS)} checks'}", flush=True)


def grade_run(names, products, grades):
    out = {"names": 0, "fix": 0, "wrong": 0, "flagged": 0, "flagged_and_marked": 0, "marked_products": 0}
    for p in products:
        got = names.get(p["id"], {})
        given = p.get("existing", {})
        marked = False
        for lang in LANGS:
            text = str(got.get(lang) or "").strip()
            if not text or text == given.get(lang):
                continue
            out["names"] += 1
            verdict = grades.get((p["id"], lang, text))
            if verdict:
                out[verdict] += 1
                marked = True
        flagged = is_flagged(got)
        out["flagged"] += flagged
        out["marked_products"] += marked
        out["flagged_and_marked"] += flagged and marked
    return out


def score():
    products = json.loads(PRODUCTS_FILE.read_text())
    grades = {}
    for f in (HERE / ("owner-grades-final" if FINAL else "owner-grades") / "grades").glob("*.json"):
        d = json.loads(f.read_text())
        body = d.get("data", d)
        grades[(body["pid"], body["lang"], body["text"])] = body["verdict"]
    head = "| config | runs | names | needs work | wrong | marked | flagged | flags on marked products | marked products flagged |"
    print(head)
    print("|" + "---|" * 9)
    for config in CONFIGS:
        records = [json.loads(f.read_text()) for f in sorted(RESULTS.glob(f"{config}-[0-9]*.json"))]
        runs = [grade_run(r["names"], products, grades) for r in records if "names" in r]
        if not runs:
            continue
        t = {k: sum(r[k] for r in runs) for k in runs[0]}
        pct = lambda a, b: f"{a / b:.0%}" if b else "-"  # noqa: E731
        print(f"| {config} | {len(runs)} | {t['names'] / len(runs):.0f} | {pct(t['fix'], t['names'])} | {pct(t['wrong'], t['names'])}"
              f" | {pct(t['fix'] + t['wrong'], t['names'])} | {t['flagged'] / len(runs):.1f}"
              f" | {pct(t['flagged_and_marked'], t['flagged'])} | {pct(t['flagged_and_marked'], t['marked_products'])} |")


REVIEW_SYSTEM = """You review customer-facing names that someone else wrote for a café-bar's menu.
The venue's customer languages are: {languages}.

For every name in every language, ask: is this exactly how a native speaker writing this venue's menu in that
language would print it? Check that it uses that language's own vocabulary and grammar, the standard local name of
the dish or drink where one exists, no word-for-word copy of another language's phrasing, and that nothing the
customer needs (what comes with it, the serving size, takeaway) has been lost compared with the internal name and
the other languages.

Names marked "given" were entered by the venue and are never changed. Leave a name alone when it is already right.

Reply with JSON only, no prose, listing only the names you would change:
{{"changes": [{{"id": "p01", "language": "ca", "name": "...", "reason": "..."}}]}}
"changes" is an empty list when every name is right. Write reasons in English."""

LANGUAGE_LABELS = "ca (Catalan, the default), es (Spanish), en (English)"


def apply_changes(names, changes, products):
    given = {p["id"]: p.get("existing", {}) for p in products}
    merged = json.loads(json.dumps(names))
    applied = 0
    for c in changes:
        pid, lang, text = c.get("id"), c.get("language"), str(c.get("name") or "").strip()
        if pid not in merged or lang not in LANGS or not text or lang in given.get(pid, {}):
            continue
        merged[pid][lang] = text
        applied += 1
    return merged, applied


def review(base, reviewer, model, effort):
    products = json.loads(PRODUCTS_FILE.read_text())
    workdir = HERE / "work" / f"review-{reviewer}"
    workdir.mkdir(parents=True, exist_ok=True)
    system = REVIEW_SYSTEM.format(languages=LANGUAGE_LABELS)
    for f in sorted(RESULTS.glob(f"{base}-[0-9]*.json")):
        first = json.loads(f.read_text())
        rows = []
        for p in products:
            got = first["names"].get(p["id"], {})
            if got.get("placeholder"):
                continue
            rows.append({
                "id": p["id"], "internal": p["internal"], "category": p["category"],
                "names": {lang: got.get(lang, "") for lang in LANGS},
                "given": sorted(p.get("existing", {})),
            })
        record = {"config": f"{base}+{reviewer}", "repeat": first["repeat"], "base_usage": first["usage"],
                  "base_seconds": first["seconds_model"], "probe": {"usage": {"input": 0, "output": 0}}}
        try:
            answer = call_openai(model, effort, system, "Names:\n" + json.dumps(rows, ensure_ascii=False, indent=1), workdir)
            changes = extract_json(answer["text"]).get("changes", [])
            names, applied = apply_changes(first["names"], changes, products)
            record.update({"names": names, "changes": changes, "applied": applied, "review_usage": answer["usage"],
                           "review_seconds": answer["seconds_model"], "problems": [],
                           "checks": run_checks(CHECKS, names)})
        except Exception as error:
            record["error"] = str(error)
        out = RESULTS / f"{base}+{reviewer}-{first['repeat']}.json"
        out.write_text(json.dumps(record, ensure_ascii=False, indent=1))
        print(f"{out.name}: {record.get('error') or str(record['applied']) + ' changes applied'}", flush=True)


def rescore(pattern="*"):
    for f in sorted(RESULTS.glob(f"{pattern}.json")):
        r = json.loads(f.read_text())
        if "names" in r:
            r["checks"] = run_checks(CHECKS, r["names"])
            f.write_text(json.dumps(r, ensure_ascii=False, indent=1))


def report():
    products = json.loads(PRODUCTS_FILE.read_text())
    ids = [p["id"] for p in products]
    rows = []
    for config, (tool, model, effort, *_) in CONFIGS.items():
        records = [json.loads(f.read_text()) for f in sorted(RESULTS.glob(f"{config}-[0-9]*.json"))]
        if not records:
            continue
        good = [r for r in records if "checks" in r]
        def mean(values):
            values = list(values)
            return sum(values) / len(values) if values else float("nan")
        price = PRICES[{"haiku": "claude-haiku-5-5", "sonnet": "claude-sonnet-5-5"}.get(model, model)]
        nets = [net_usage(r["usage"], r["probe"]["usage"]) for r in good]
        if tool == "codex":
            seconds = [r["seconds_wall"] - r["probe"]["seconds_wall"] for r in good]
        else:
            seconds = [r["seconds_model"] for r in good]
        rows.append({
            "config": config,
            "runs": f"{len(good)}/{len(records)}",
            "checks": mean(sum(c["passed"] for c in r["checks"]) for r in good),
            "problems": mean(len(r["problems"]) for r in good),
            "flagged_products": mean(sum(bool(v.get("review")) for v in r["names"].values()) for r in good),
            "consistency": consistency([r["names"] for r in good], ids) if len(good) > 1 else float("nan"),
            "seconds": mean(seconds),
            "input": mean(n["input"] for n in nets),
            "output": mean(n["output"] for n in nets),
            "reasoning": mean(r.get("reasoning_tokens", 0) for r in good),
            "usd_per_100": mean(cost_usd(n, price) for n in nets) * 100 / len(products),
        })
    head = ["config", "runs", "checks", "problems", "flagged_products", "consistency", "seconds", "input", "output", "reasoning", "usd_per_100"]
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    for row in rows:
        cells = []
        for h in head:
            v = row[h]
            cells.append(f"{v:.4f}" if h == "usd_per_100" else f"{v:.0%}" if h == "consistency" else f"{v:.1f}" if isinstance(v, float) else str(v))
        print("| " + " | ".join(cells) + " |")
    (HERE / "summary.json").write_text(json.dumps(rows, indent=1))
    failures = {}
    for f in sorted(RESULTS.glob("*.json")):
        r = json.loads(f.read_text())
        for c in r.get("checks", []):
            if not c["passed"]:
                failures.setdefault(r["config"], {}).setdefault(f"{c['id']} {c['label']}", 0)
                failures[r["config"]][f"{c['id']} {c['label']}"] += 1
    print()
    for config, items in failures.items():
        print(f"{config}: " + "; ".join(f"{k} x{v}" for k, v in sorted(items.items())))


if __name__ == "__main__":
    if sys.argv[1] == "run":
        run(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 3, int(sys.argv[4]) if len(sys.argv) > 4 else 1)
    elif sys.argv[1] == "review":
        review(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif sys.argv[1] == "score":
        score()
    elif sys.argv[1] == "rescore":
        rescore(sys.argv[2] if len(sys.argv) > 2 else "*")
    elif sys.argv[1] == "report":
        report()
