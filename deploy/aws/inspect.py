"""Inspect literal HCL without evaluating expressions or launching OpenTofu."""
import json
import re
import sys
from pathlib import Path

import hcl2


class Refusal(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refusal(message)


def literal(value):
    require(isinstance(value, str) and value.startswith('"'), "expected a literal quoted string")
    result = json.loads(value)
    require(isinstance(result, str) and "${" not in result and "%{" not in result, "dynamic string is unsupported")
    return result


def blocks(document, kind):
    for entry in document.get(kind, []):
        require(isinstance(entry, dict), f"unsupported {kind} block")
        for label, body in entry.items():
            if label != "__is_block__":
                yield literal(label), body


def reference(value):
    require(isinstance(value, str) and re.fullmatch(r"\$\{aws(?:\.[a-zA-Z_][\w-]*)?\}", value), "unsupported provider binding")
    return value[2:-1]


def provider_name(body):
    return "aws" + ("." + literal(body["alias"]) if "alias" in body else "")


def parse(path):
    text = path.read_text(encoding="utf-8")
    tree = hcl2.parses_to_tree(text)
    # Look at syntax nodes, never words embedded in comments, strings or heredocs.
    for block in tree.find_data("block"):
        kind = str(block.children[0].children[0])
        require(kind != "provisioner", f"{path.name}: provisioner is forbidden")
    return hcl2.loads(text, serialization_options=hcl2.SerializationOptions(with_comments=False))


def inspect(directory):
    root = Path(directory).resolve(strict=True)
    configs, tests = {}, []
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), f"{path.name}: symlink is forbidden")
        if path.is_dir():
            continue
        name = path.name
        require(not (name.endswith((".tofu", ".json", ".tfvars", ".tfvars.json", ".tofutest.hcl"))
                     or name in {"override.tf", "override.tf.json"} or name.endswith("_override.tf")),
                f"{name}: unsupported alternative input file")
        if name.endswith(".tftest.hcl"):
            tests.append((path, parse(path)))
        elif name.endswith(".tf"):
            configs.setdefault(path.parent, []).append(parse(path))
        else:
            raise Refusal(f"{name}: unsupported source file")
    require(tests, "no plan-only test file found")
    for documents in configs.values():
        for doc in documents:
            require(set(doc) <= {"terraform", "provider", "resource", "data", "module", "variable", "locals", "output", "check"},
                    "unsupported configuration block")
            for terraform in doc.get("terraform", []):
                for declarations in terraform.get("required_providers", []):
                    for name, declaration in declarations.items():
                        if name == "__is_block__":
                            continue
                        require(name == "aws" and literal(declaration.get("source")) == "hashicorp/aws"
                                and literal(declaration.get("version")) == "6.42.0", "undeclared or unpinned provider source")
                for backend in terraform.get("backend", []):
                    require(set(backend) == {'"s3"'} and set(backend['"s3"']) <= {"__is_block__"}, "backend settings are forbidden")
            for kind in ("resource", "data"):
                for name, entries in blocks(doc, kind):
                    require(name.startswith("aws_"), f"{name}: external or undeclared provider is forbidden")
            # Unresolved module bindings cannot prove that every provider is mocked.
            require(not doc.get("module"), "module execution is not qualified yet")
            for name, body in blocks(doc, "provider"):
                require(name == "aws", "undeclared provider source")
                provider_name(body)
    for path, test in tests:
        require(set(test) <= {"mock_provider", "run", "variables"}, f"{path.name}: test provider block or unsupported block")
        mocked = set()
        for name, body in blocks(test, "mock_provider"):
            require(name == "aws" and "source" not in body, "mock provider source is forbidden")
            address = provider_name(body)
            require(address not in mocked, f"{address}: duplicate mock")
            mocked.add(address)
        test_root = path.parent.parent if path.parent.name == "tests" else path.parent
        documents = configs.get(test_root, [])
        require(documents, f"{path.name}: no configuration")
        required = set()
        declared = False
        for doc in documents:
            for terraform in doc.get("terraform", []):
                for declaration in terraform.get("required_providers", []):
                    if "aws" in declaration:
                        declared = True
                        required.update(reference(x) for x in declaration["aws"].get("configuration_aliases", []))
            for name, body in blocks(doc, "provider"):
                required.add(provider_name(body))
            for kind in ("resource", "data"):
                for _, entries in blocks(doc, kind):
                    for body in entries.values():
                        if isinstance(body, dict):
                            required.add(reference(body["provider"]) if "provider" in body else "aws")
        require(declared, f"{path.name}: undeclared AWS provider source")
        runs = list(blocks(test, "run"))
        require(runs, f"{path.name}: no plan run")
        for name, run in runs:
            require(run.get("command") == "plan", f"{name}: command must be explicit keyword plan")
            require(not run.get("module"), f"{name}: test module execution is not qualified yet")
            mapping = run.get("providers", {})
            require(isinstance(mapping, dict), f"{name}: unsupported provider map")
            resolved = {}
            for key, value in mapping.items():
                require(re.fullmatch(r"aws(?:\.[a-zA-Z_][\w-]*)?", key), f"{name}: unsupported provider map key")
                resolved[key] = reference(value)
            for address in required:
                target = resolved.get(address, address)
                require(target in mocked, f"{address}: missing mock in run {name}")
            for address in resolved.values():
                require(address in mocked, f"{address}: provider map must bind a mock")
    print(json.dumps({"status": "inspected", "files": sum(map(len, configs.values())) + len(tests), "tests": len(tests)}))


if __name__ == "__main__":
    try:
        inspect(sys.argv[1])
    except Exception as error:
        # Syntax errors reveal their exception type without dumping the source document.
        if isinstance(error, Refusal):
            print(f"Source refused: {error}", file=sys.stderr)
        else:
            print(f"Source refused: invalid HCL or unsupported syntax ({type(error).__name__})", file=sys.stderr)
        sys.exit(1)
