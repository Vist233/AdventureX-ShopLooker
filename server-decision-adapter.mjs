import "./fact-store.js";
import "./decision-engine.js";
import "./interview-policy.js";

const decisionEngine = globalThis.DecisionEngine;
const interviewPolicy = globalThis.InterviewPolicy;

if (!decisionEngine || !interviewPolicy) {
  throw new Error("Server decision dependencies failed to initialize");
}

export function computeServerDecision(serverCase, overrides = {}) {
  return decisionEngine.toServerDeterministicResult(serverCase, overrides);
}

export function assessServerCase(serverCase, overrides = {}) {
  return decisionEngine.assessServerCase(serverCase, overrides);
}

export function assessServerFacts(facts, baseInput = {}) {
  return decisionEngine.assessServerFacts(facts, baseInput);
}

export function evaluateInterviewCompleteness(state) {
  return interviewPolicy.evaluateInterviewCompleteness(state);
}

export function sanitizeAgentNextQuestion(proposal, state) {
  return interviewPolicy.sanitizeAgentNextQuestion(proposal, state);
}

export function getRequiredInterviewFields(stage) {
  return interviewPolicy.getRequiredFields(stage);
}

export const INTERVIEW_LIMITS = Object.freeze({
  maxTurns: interviewPolicy.MAX_TURNS,
  maxAttemptsPerField: interviewPolicy.MAX_ATTEMPTS_PER_FIELD
});
