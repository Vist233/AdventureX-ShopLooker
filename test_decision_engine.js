const assert = require("node:assert/strict");
const { assess } = require("./decision-engine.js");

const common = {
  category: "快餐",
  locationConfirmed: true,
  mapContextLoaded: true,
  variableCostRate: 45,
  rent: 12000,
  labor: 26000,
  otherFixed: 8000,
  cashReserve: 100000,
  avgTicket: 40,
  plannedCommitment: 0,
  debt: 0,
  trafficMatch: "yes",
  visibility: "yes",
  retention: "yes",
  known: {
    monthlyRevenue: true,
    variableCostRate: true,
    rent: true,
    labor: true,
    otherFixed: true,
    cashReserve: true,
    avgTicket: true,
    plannedCommitment: true,
    debt: true
  }
};

const profitable = assess({ ...common, stage: "operating", monthlyRevenue: 120000 });
assert.equal(profitable.decision, "GO");
assert.ok(profitable.metrics.monthlyProfit > 0);

const emergency = assess({ ...common, stage: "operating", monthlyRevenue: 50000, cashReserve: 20000 });
assert.equal(emergency.decision, "EXIT");
assert.ok(emergency.metrics.runway < 3);

const preopen = assess({
  ...common,
  stage: "preopen",
  monthlyRevenue: 0,
  plannedCommitment: 300000,
  cashReserve: 100000
});
assert.equal(preopen.decision, "STOP");
assert.equal(preopen.metrics.commitmentRatio, 3);

const missing = assess({
  ...common,
  stage: "operating",
  monthlyRevenue: 120000,
  locationConfirmed: false,
  known: {}
});
assert.equal(missing.decision, "EVIDENCE");

const noFixedCost = assess({
  ...common,
  stage: "operating",
  monthlyRevenue: 10000,
  rent: 0,
  labor: 0,
  otherFixed: 0
});
assert.equal(noFixedCost.decision, "GO");
assert.equal(noFixedCost.metrics.coverage, Infinity);

console.log("decision engine: 5 scenarios passed");
