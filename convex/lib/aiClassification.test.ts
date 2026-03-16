import { describe, expect, it } from "vitest";
import {
  buildClassificationPrompt,
  normalizeClassificationResult,
} from "./aiClassification";

describe("aiClassification helpers", () => {
  it("builds a classification prompt from transcript lines", () => {
    expect(
      buildClassificationPrompt([
        { role: "customer", content: "My router is blinking red." },
        { role: "assistant", content: "When did this start?" },
      ]),
    ).toContain("customer: My router is blinking red.");
  });

  it("normalizes valid model output", () => {
    expect(
      normalizeClassificationResult({
        category: "hardware",
        priority: "high",
        summary: "Router appears to be failing and disconnecting frequently.",
        isLegitimate: true,
      }),
    ).toEqual({
      category: "hardware",
      priority: "high",
      summary: "Router appears to be failing and disconnecting frequently.",
      isLegitimate: true,
    });
  });

  it("falls back to safe defaults when model output is malformed", () => {
    expect(
      normalizeClassificationResult({
        category: "wrong",
        priority: 99,
        summary: "",
        isLegitimate: "maybe",
      }),
    ).toEqual({
      category: "general",
      priority: "medium",
      summary:
        "Customer needs general support follow-up from the Neosolve team.",
      isLegitimate: true,
    });
  });
});
