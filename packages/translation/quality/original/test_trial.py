import unittest

import trial

PRODUCTS = [
    {"id": "p01", "internal": "HAMBURGUESA CON FRITAS", "category": "X"},
    {"id": "p27", "internal": "HUEVOS ROTOS", "category": "X", "existing": {"en": "Broken eggs with chorizo"}},
]


class ExtractJson(unittest.TestCase):
    def test_reads_a_fenced_reply_with_prose_around_it(self):
        text = 'Here you go:\n```json\n{"products": []}\n```\nDone.'
        self.assertEqual(trial.extract_json(text), {"products": []})

    def test_reads_a_bare_reply(self):
        self.assertEqual(trial.extract_json('{"products": [1]}'), {"products": [1]})

    def test_refuses_a_reply_with_no_json(self):
        with self.assertRaises(ValueError):
            trial.extract_json("sorry, I cannot")


class Normalise(unittest.TestCase):
    def test_indexes_products_by_id_and_reports_missing_ones(self):
        reply = {"products": [{"id": "p01", "ca": "Hamburguesa", "es": "Hamburguesa", "en": "Burger", "review": []}]}
        got, problems = trial.normalise(reply, PRODUCTS)
        self.assertEqual(got["p01"]["en"], "Burger")
        self.assertEqual(problems, ["p27: missing from reply"])

    def test_reports_an_empty_language(self):
        reply = {"products": [
            {"id": "p01", "ca": "Hamburguesa", "es": "", "en": "Burger", "review": []},
            {"id": "p27", "ca": "a", "es": "b", "en": "c", "review": []},
        ]}
        _, problems = trial.normalise(reply, PRODUCTS)
        self.assertEqual(problems, ["p01: es is empty"])


class Placeholders(unittest.TestCase):
    def test_a_placeholder_may_leave_its_names_empty(self):
        reply = {"products": [
            {"id": "p01", "ca": "", "es": "", "en": "", "placeholder": True},
            {"id": "p27", "ca": "a", "es": "b", "en": "c"},
        ]}
        _, problems = trial.normalise(reply, PRODUCTS)
        self.assertEqual(problems, [])

    def test_a_placeholder_counts_as_flagged(self):
        self.assertTrue(trial.flagged()({"placeholder": True}))
        self.assertFalse(trial.flagged()({"placeholder": False, "review": []}))

    def test_a_placeholder_gives_no_names_to_grade(self):
        products = [{"id": "p01", "internal": "X", "category": "X"}]
        names = {"p01": {"ca": "", "es": "", "en": "", "placeholder": True}}
        got = trial.grade_run(names, products, {})
        self.assertEqual((got["names"], got["flagged"]), (0, 1))


class Corrections(unittest.TestCase):
    def test_finds_a_listed_correction_for_the_named_field(self):
        check = trial.corrected("internal", "Zurito")
        self.assertTrue(check({"corrections": [{"field": "internal", "wrong": "Zurrito", "right": "Zurito"}]}))
        self.assertFalse(check({"corrections": [{"field": "en", "wrong": "Zurrito", "right": "Zurito"}]}))
        self.assertFalse(check({}))

    def test_matches_the_right_spelling_ignoring_case_and_accents(self):
        check = trial.corrected("es", "Tarta de limón")
        self.assertTrue(check({"corrections": [{"field": "es", "wrong": "Tarta de limon", "right": "TARTA DE LIMÓN"}]}))
        self.assertFalse(check({"corrections": [{"field": "es", "wrong": "Tarta de limon", "right": "Tarta de limon"}]}))


class ReviewMerge(unittest.TestCase):
    def test_applies_a_change_and_keeps_given_names_and_unknown_ids_out(self):
        names = {"p01": {"ca": "A", "es": "B", "en": "C"}, "p27": {"ca": "D", "es": "E", "en": "Given"}}
        changes = [
            {"id": "p01", "language": "ca", "name": "A2"},
            {"id": "p27", "language": "en", "name": "Not allowed"},
            {"id": "p99", "language": "ca", "name": "Nobody"},
            {"id": "p01", "language": "xx", "name": "No such language"},
        ]
        got, applied = trial.apply_changes(names, changes, PRODUCTS)
        self.assertEqual(got["p01"]["ca"], "A2")
        self.assertEqual(got["p27"]["en"], "Given")
        self.assertEqual(names["p01"]["ca"], "A")
        self.assertEqual(applied, 1)


class Checks(unittest.TestCase):
    def test_kept_exact_fails_when_a_given_name_is_reworded(self):
        check = trial.kept_exact("en", "Broken eggs with chorizo")
        self.assertTrue(check({"en": "Broken eggs with chorizo"}))
        self.assertFalse(check({"en": "Broken eggs and chorizo"}))

    def test_contains_any_needs_a_word_in_every_named_language(self):
        check = trial.contains_any({"ca": ["xoriço", "chorizo"], "es": ["chorizo"]})
        self.assertTrue(check({"ca": "Ous estrellats amb xoriço", "es": "Huevos rotos con chorizo"}))
        self.assertFalse(check({"ca": "Ous estrellats", "es": "Huevos rotos con chorizo"}))

    def test_contains_any_ignores_case_and_accents(self):
        check = trial.contains_any({"ca": ["albergínia"]})
        self.assertTrue(check({"ca": "ESCALIVADA D'ALBERGINIA"}))

    def test_no_digits_fails_when_a_price_survives(self):
        check = trial.no_digits()
        self.assertTrue(check({"ca": "Especial de carn", "es": "Especial de carne", "en": "Meat special"}))
        self.assertFalse(check({"ca": "Especial de carn 2,50", "es": "x", "en": "y"}))

    def test_flagged_needs_a_review_entry(self):
        check = trial.flagged()
        self.assertTrue(check({"review": [{"language": "ca", "reason": "price in name"}]}))
        self.assertFalse(check({"review": []}))

    def test_run_checks_scores_a_missing_product_as_failed(self):
        checks = [("p27", "kept English", trial.kept_exact("en", "Broken eggs with chorizo"))]
        self.assertEqual(trial.run_checks(checks, {}), [{"id": "p27", "label": "kept English", "passed": False}])


class Costs(unittest.TestCase):
    def test_takes_the_tools_own_overhead_out_of_the_input(self):
        self.assertEqual(trial.net_usage({"input": 14000, "output": 2000}, {"input": 12500}), {"input": 1500, "output": 2000})

    def test_never_goes_below_zero(self):
        self.assertEqual(trial.net_usage({"input": 100, "output": 5}, {"input": 800}), {"input": 0, "output": 5})

    def test_prices_input_and_output_tokens_per_million(self):
        price = {"input": 1.0, "output": 5.0}
        self.assertAlmostEqual(trial.cost_usd({"input": 2_000_000, "output": 200_000}, price), 2.0 + 1.0)


class Consistency(unittest.TestCase):
    def test_counts_names_identical_across_every_run(self):
        runs = [
            {"p01": {"ca": "A", "es": "B", "en": "C"}},
            {"p01": {"ca": "A", "es": "B", "en": "D"}},
        ]
        self.assertAlmostEqual(trial.consistency(runs, ["p01"]), 2 / 3)

    def test_a_product_missing_from_one_run_counts_as_different(self):
        runs = [{"p01": {"ca": "A", "es": "B", "en": "C"}}, {}]
        self.assertEqual(trial.consistency(runs, ["p01"]), 0)


class Grading(unittest.TestCase):
    PRODUCTS = [
        {"id": "p01", "internal": "X", "category": "X"},
        {"id": "p27", "internal": "Y", "category": "X", "existing": {"en": "Given"}},
    ]
    NAMES = {
        "p01": {"ca": "A", "es": "B", "en": "C", "review": [{"language": "ca", "reason": "r"}]},
        "p27": {"ca": "D", "es": "E", "en": "Given", "review": []},
    }

    def test_counts_marks_and_skips_a_kept_given_name(self):
        grades = {("p01", "en", "C"): "wrong", ("p27", "es", "E"): "fix"}
        got = trial.grade_run(self.NAMES, self.PRODUCTS, grades)
        self.assertEqual(got["names"], 5)
        self.assertEqual((got["fix"], got["wrong"]), (1, 1))

    def test_matches_flags_to_marked_products(self):
        grades = {("p27", "es", "E"): "fix"}
        got = trial.grade_run(self.NAMES, self.PRODUCTS, grades)
        self.assertEqual((got["flagged"], got["flagged_and_marked"], got["marked_products"]), (1, 0, 1))


if __name__ == "__main__":
    unittest.main()
