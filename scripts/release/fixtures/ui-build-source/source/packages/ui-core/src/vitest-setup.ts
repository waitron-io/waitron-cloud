import { beforeEach } from "vitest";
import { forgetRemembered } from "./theme/derive.js";

// Under per-test mutation coverage, a test that reads an answer an earlier test remembered runs none
// of the derivation, so no mutant of it is tried against that test.
beforeEach(forgetRemembered);
