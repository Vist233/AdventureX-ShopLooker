const assert = require("node:assert/strict");
const {
  MAX_TURNS,
  MAX_ATTEMPTS_PER_FIELD,
  FIELD_DEFINITIONS,
  getRequiredFields,
  getAllowedFields,
  evaluateInterviewCompleteness,
  isShortSingleQuestion,
  sanitizeAgentNextQuestion
} = require("./interview-policy.js");

for (const stage of ["operating", "preopen", "growth"]) {
  const required = getRequiredFields(stage);
  assert.ok(required.length <= MAX_TURNS);
  assert.deepEqual(getAllowedFields(stage), required);
  assert.equal(new Set(required).size, required.length);
}
assert.deepEqual(getRequiredFields("准备开店 / 接店"), getRequiredFields("preopen"));
assert.deepEqual(getRequiredFields("有利润，想增长"), getRequiredFields("growth"));

for (const variants of Object.values(FIELD_DEFINITIONS)) {
  assert.equal(variants.length, MAX_ATTEMPTS_PER_FIELD);
  for (const question of variants) {
    assert.ok(Array.from(question).length <= 30, question);
    assert.equal(isShortSingleQuestion(question), true, question);
  }
}

const locationBlocked = evaluateInterviewCompleteness({
  stage: "operating",
  locationConfirmed: false,
  facts: {},
  turns: []
});
assert.equal(locationBlocked.complete, false);
assert.equal(locationBlocked.reason, "LOCATION_REQUIRED");
assert.equal(locationBlocked.nextQuestion, null);

const firstQuestion = evaluateInterviewCompleteness({
  stage: "operating",
  locationConfirmed: true,
  facts: {},
  turns: []
});
assert.equal(firstQuestion.complete, false);
assert.equal(firstQuestion.nextQuestion.field, "goal");
assert.equal(firstQuestion.nextQuestion.attempt, 1);

const refusedEarlyCompletion = sanitizeAgentNextQuestion({
  complete: true,
  field: "",
  text: ""
}, {
  stage: "operating",
  locationConfirmed: true,
  facts: {},
  turns: []
});
assert.equal(refusedEarlyCompletion.complete, false);
assert.equal(refusedEarlyCompletion.field, "goal");
assert.equal(refusedEarlyCompletion.source, "program");

const refusedFieldSkipping = sanitizeAgentNextQuestion({
  complete: false,
  field: "monthlyRevenue",
  text: "一个月收入多少？"
}, {
  stage: "operating",
  locationConfirmed: true,
  facts: {},
  turns: []
});
assert.equal(refusedFieldSkipping.field, "goal");
assert.equal(refusedFieldSkipping.source, "program");

const validAgentQuestion = sanitizeAgentNextQuestion({
  complete: false,
  field: "goal",
  text: "这次你最想解决哪件事？"
}, {
  stage: "operating",
  locationConfirmed: true,
  facts: {},
  turns: []
});
assert.equal(validAgentQuestion.text, "这次你最想解决哪件事？");
assert.equal(validAgentQuestion.source, "agent");

const operatingFields = getRequiredFields("operating");
const allResolvedFacts = Object.fromEntries(operatingFields.map((field) => [field, {
  id: field,
  field,
  value: field === "trafficMatch" || field === "visibility" || field === "retention"
    ? "yes"
    : 1,
  status: "provisional"
}]));
const allResolved = evaluateInterviewCompleteness({
  stage: "operating",
  locationConfirmed: true,
  facts: allResolvedFacts,
  turns: []
});
assert.equal(allResolved.complete, true);
assert.equal(allResolved.reason, "REQUIRED_FIELDS_COVERED");

const oneUnknownFacts = structuredClone(allResolvedFacts);
oneUnknownFacts.monthlyRevenue = {
  id: "monthlyRevenue",
  field: "monthlyRevenue",
  value: null,
  status: "unknown"
};
const firstPassTurns = operatingFields.map((field, index) => ({
  id: `turn-${index}`,
  field
}));
const retryUnknown = evaluateInterviewCompleteness({
  stage: "operating",
  locationConfirmed: true,
  facts: oneUnknownFacts,
  turns: firstPassTurns
});
assert.equal(retryUnknown.complete, false);
assert.equal(retryUnknown.nextQuestion.field, "monthlyRevenue");
assert.equal(retryUnknown.nextQuestion.attempt, 2);

const exhaustedUnknown = evaluateInterviewCompleteness({
  stage: "operating",
  locationConfirmed: true,
  facts: oneUnknownFacts,
  turns: [...firstPassTurns, { id: "retry", field: "monthlyRevenue" }]
});
assert.equal(exhaustedUnknown.complete, true);
assert.equal(exhaustedUnknown.reason, "UNKNOWNS_EXHAUSTED");
assert.ok(exhaustedUnknown.exhausted.includes("monthlyRevenue"));

const turnLimit = evaluateInterviewCompleteness({
  stage: "preopen",
  locationConfirmed: true,
  facts: {},
  turns: Array.from({ length: MAX_TURNS }, (_, index) => ({
    id: `turn-${index}`,
    field: "goal"
  }))
});
assert.equal(turnLimit.complete, true);
assert.equal(turnLimit.reason, "MAX_TURNS");
assert.equal(turnLimit.remainingTurns, 0);

assert.equal(
  isShortSingleQuestion("营业额多少，房租多少？"),
  false
);
assert.equal(
  isShortSingleQuestion("这是一个超过三十个汉字而且包含很多没有必要内容的非常长的问题吗？"),
  false
);

console.log("interview policy: 11 scenarios passed");
