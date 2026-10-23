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
    if value == "aws":
        return value
    require(isinstance(value, str) and re.fullmatch(r"\$\{aws(?:\.[a-zA-Z_][\w-]*)?\}", value), "unsupported provider binding")
    return value[2:-1]


def provider_name(body):
    return "aws" + ("." + literal(body["alias"]) if "alias" in body else "")


def provider_map(value):
    require(isinstance(value, dict), "unsupported provider map")
    result = {}
    for key, target in value.items():
        # Dotted object keys are reference expressions in the pinned HCL parser.
        address = reference(key) if key.startswith("${") else key
        require(re.fullmatch(r"aws(?:\.[a-zA-Z_][\w-]*)?", address), "unsupported provider map key")
        result[address] = reference(target)
    return result


def module_path(body, caller, configs):
    source = literal(body.get("source"))
    require(source.startswith(("./", "../")), "module source must be a relative local path")
    target = (caller / source).resolve()
    # Only canonical directories parsed inside this source tree can be selected.
    require(target in configs, "module execution is not qualified: source has no configuration")
    return target


def requirements(documents):
    required, declared = set(), set()
    for doc in documents:
        for terraform in doc.get("terraform", []):
            for declaration in terraform.get("required_providers", []):
                if "aws" in declaration:
                    declared.add("aws")
                    required.update(reference(x) for x in declaration["aws"].get("configuration_aliases", []))
        for name, body in blocks(doc, "provider"):
            required.add(provider_name(body))
    require("aws" in declared, "undeclared AWS provider source")
    declared.update(required)
    for doc in documents:
        for kind in ("resource", "data"):
            for _, entries in blocks(doc, kind):
                for body in entries.values():
                    if isinstance(body, dict):
                        address = reference(body["provider"]) if "provider" in body else "aws"
                        require(address in declared, f"{address}: undeclared resource provider")
                        required.add(address)
    return required, declared


def module_requirements(directory, configs, ancestors=()):
    require(directory not in ancestors, "local module cycle is forbidden")
    documents = configs[directory]
    required, declared = requirements(documents)
    for doc in documents:
        for name, body in blocks(doc, "module"):
            target = module_path(body, directory, configs)
            child, child_declared = module_requirements(target, configs, (*ancestors, directory))
            mapping = provider_map(body.get("providers", {}))
            for address in child:
                require(address in mapping, f"{address}: missing module provider binding in {name}")
            for address, parent in mapping.items():
                require(address in child_declared, f"{address}: undeclared child provider in {name}")
                require(parent in declared, f"{parent}: undeclared parent provider in {name}")
                required.add(parent)
    return required, declared


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
        if name == ".terraform.lock.hcl":
            lock = parse(path)
            providers = list(blocks(lock, "provider"))
            require(set(lock) == {"provider"} and len(providers) == 1, "provider lock must contain only the AWS provider")
            address, body = providers[0]
            require(address == "registry.opentofu.org/hashicorp/aws", "provider lock source is not pinned AWS")
            require(literal(body.get("version")) == "6.70.0", "provider lock version is not pinned AWS")
            require(set(body) <= {"version", "constraints", "hashes", "__is_block__"}, "provider lock contains unsupported fields")
            if "constraints" in body:
                require(literal(body["constraints"]) == "6.70.0", "provider lock constraints are not pinned AWS")
            hashes = body.get("hashes")
            require(isinstance(hashes, list) and hashes and all(
                re.fullmatch(r"(?:zh:[a-f0-9]{64}|h1:[A-Za-z0-9+/]{43}=)", literal(value)) for value in hashes
            ), "provider lock needs valid checksums")
            continue
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
                                and literal(declaration.get("version")) == "6.70.0", "undeclared or unpinned provider source")
                for backend in terraform.get("backend", []):
                    require(set(backend) == {'"s3"'} and set(backend['"s3"']) <= {"__is_block__"}, "backend settings are forbidden")
            for kind in ("resource", "data"):
                for name, entries in blocks(doc, kind):
                    require(name.startswith("aws_"), f"{name}: external or undeclared provider is forbidden")
            for name, body in blocks(doc, "provider"):
                require(name == "aws", "undeclared provider source")
                provider_name(body)
    # Check every module, including modules that no test happens to select.
    for directory in configs:
        module_requirements(directory, configs)
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
        runs = list(blocks(test, "run"))
        require(runs, f"{path.name}: no plan run")
        for name, run in runs:
            require(run.get("command") == "plan", f"{name}: command must be explicit keyword plan")
            selected = test_root
            if "module" in run:
                require(isinstance(run["module"], list) and len(run["module"]) == 1, "unsupported test module selection")
                selected = module_path(run["module"][0], test_root, configs)
            required, declared = module_requirements(selected, configs)
            resolved = provider_map(run.get("providers", {}))
            for address in resolved:
                require(address in declared, f"{address}: undeclared run provider in {name}")
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
