import test from "node:test";
import assert from "node:assert/strict";
import { decideNotification } from "./notification_decision.ts";

test("a resized appointment image can notify only inside the patient-safe size", () => {
  assert.equal(decideNotification(1600, 1200), "send");
  assert.equal(decideNotification(1800, 1200), "hold");
});
