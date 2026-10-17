import unittest

import batch_trial


class Split(unittest.TestCase):
    def test_splits_into_batches_of_the_given_size_keeping_order(self):
        items = list(range(7))
        self.assertEqual(batch_trial.split(items, 3), [[0, 1, 2], [3, 4, 5], [6]])

    def test_a_size_of_none_keeps_everything_in_one_batch(self):
        self.assertEqual(batch_trial.split([1, 2], None), [[1, 2]])


class Renderings(unittest.TestCase):
    PRODUCTS = [
        {"id": "s1", "internal": "BOCATA DE POLLO"},
        {"id": "s2", "internal": "BOCADILLO DE ATUN"},
        {"id": "s3", "internal": "BOCATA ALBONDIGAS"},
        {"id": "s4", "internal": "CAFE"},
    ]

    def test_counts_distinct_first_words_across_a_family(self):
        names = {
            "s1": {"ca": "Entrepà de pollastre"},
            "s2": {"ca": "Entrepà de tonyina"},
            "s3": {"ca": "Bocata de mandonguilles"},
            "s4": {"ca": "Cafè"},
        }
        got = batch_trial.first_words(self.PRODUCTS, names, r"BOCATA|BOCADILLO", "ca")
        self.assertEqual(got, {"entrepà": 2, "bocata": 1})

    def test_a_missing_or_placeholder_name_is_counted_as_blank(self):
        names = {"s1": {"ca": ""}, "s2": {"placeholder": True}}
        got = batch_trial.first_words(self.PRODUCTS, names, r"BOCATA|BOCADILLO", "ca")
        self.assertEqual(got, {"(blank)": 3})


if __name__ == "__main__":
    unittest.main()
