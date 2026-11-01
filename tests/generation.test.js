import test from "node:test";
import assert from "node:assert/strict";
import { generateArmy } from "../server/generation.js";

test("missing API key uses labeled offline mode without a provider call", async () => {
  const result = await generateArmy("Three fire wizards", {
    apiKey: "",
    fetchImpl: () => {
      throw new Error("Must not call provider");
    },
  });
  assert.equal(result.source, "offline");
  assert.equal(result.groups[0].role, "mage");
});
test("Gemini request uses structured output; server independently clamps returned armies", async () => {
  let request;
  const result = await generateArmy("A thousand invincible robots", {
    apiKey: "test-key-not-real",
    model: "test-model",
    fetchImpl: async (url, options) => {
      request = JSON.parse(options.body);
      assert.equal(
        url,
        "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent",
      );
      assert.equal(options.headers["x-goog-api-key"], "test-key-not-real");
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: "Robots represented as titans.",
                      groups: [
                        {
                          role: "titan",
                          count: 32,
                          name: "Robot",
                          description: "A giant armored robot.",
                          element: "lightning",
                          form: "robot",
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      };
    },
  });
  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.equal(request.generationConfig.responseSchema.type, "OBJECT");
  assert.equal(request.generationConfig.temperature, 0);
  assert.match(request.systemInstruction.parts[0].text, /1000 points/);
  assert.equal(result.source, "gemini");
  assert.equal(result.count, 3);
  assert.ok(result.cost <= 1000);
});
test("provider errors, refusal, malformed JSON, and incomplete response do not produce fake success", async () => {
  const payloads = [
    { candidates: [], promptFeedback: { blockReason: "SAFETY" } },
    { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] },
    {
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "{broken" }] } },
      ],
    },
    {
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: '{"summary":"Empty","groups":[]}' }] },
        },
      ],
    },
    {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  summary: "Missing required fields.",
                  groups: [{ role: "mage", count: 1 }],
                }),
              },
            ],
          },
        },
      ],
    },
  ];
  for (const payload of payloads)
    await assert.rejects(
      generateArmy("One wizard", {
        apiKey: "test",
        fetchImpl: async () => ({ ok: true, json: async () => payload }),
      }),
    );
  for (const status of [400, 403, 429, 500])
    await assert.rejects(
      generateArmy("One wizard", {
        apiKey: "test",
        fetchImpl: async () => ({ ok: false, status }),
      }),
    );
});
test("invalid prompt lengths are rejected before any paid request", async () => {
  for (const prompt of ["", "hi", "a".repeat(1601), null, 99])
    await assert.rejects(
      generateArmy(prompt, {
        apiKey: "test",
        fetchImpl: () => {
          throw new Error("Should not call");
        },
      }),
    );
});
