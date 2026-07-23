(function attachInterviewPolicy(root, factory) {
  const policy = factory();
  if (typeof module === "object" && module.exports) module.exports = policy;
  root.InterviewPolicy = policy;
}(typeof globalThis !== "undefined" ? globalThis : window, function createInterviewPolicy() {
  const MAX_TURNS = 30;
  const MAX_ATTEMPTS_PER_FIELD = 2;

  const FIELD_DEFINITIONS = Object.freeze({
    goal: ["你现在最想开店、止损、增长还是退出？", "这次只选一个目标，最想解决哪个？"],
    category: ["你卖的主要是什么品类？", "顾客通常把你这家店叫成什么店？"],
    targetCustomer: ["最常来买单的是哪一类人？", "今天最可能买单的人是谁？"],
    avgTicket: ["顾客平均一单大约花多少钱？", "看昨天，收款除以订单大约多少？"],
    locationEntrance: ["顾客从哪个入口最容易看到店？", "站在店外，顾客从哪边走过来？"],
    trafficMatch: ["经过的人大多会买你这类产品吗？", "高峰期经过的目标顾客多不多？"],
    visibility: ["路过的人能马上看懂你卖什么吗？", "陌生人看门头能说出品类和价格吗？"],
    purchaseFunnelBreak: ["顾客最常在哪一步放弃购买？", "是没看见、不进店，还是进店不买？"],

    monthlyRevenue: ["这家店一个月大约收多少钱？", "按最近一个完整月，收款大约多少？"],
    dailyOrders: ["普通工作日一天大约有多少单？", "看昨天，一共出了多少单？"],
    channelMix: ["堂食、外卖哪个收入占得最多？", "每十单里，大约几单来自外卖？"],
    variableCostRate: ["每收一百元，食材包装平台花多少？", "卖一百元，直接成本大约几十元？"],
    rent: ["房租和物业平均每月多少钱？", "一年租金除以十二，大约多少钱？"],
    labor: ["员工工资社保每月一共多少钱？", "上个月给员工总共发了多少钱？"],
    employeeCount: ["现在每天实际有多少员工上班？", "高峰时店里一共有几个人干活？"],
    staffSchedule: ["哪些时段有人闲着或明显忙不过来？", "昨天人力浪费最明显是哪个班次？"],
    ownerReplacementWage: ["请人替代老板家人每月要多少钱？", "同样工时请店员，一个月要多少钱？"],
    otherFixed: ["水电推广等每月固定支出多少？", "除房租人工外，每月还固定花多少？"],
    cashReserve: ["现在能继续投入的现金有多少？", "不借新钱，账户里还能动用多少？"],
    debt: ["这家店现在还有多少债务要还？", "贷款欠款和供应商账一共多少？"],
    operatingMonths: ["这家店已经经营了多少个月？", "从正式营业到现在大约多久？"],
    trend: ["近三个月营业额在涨、持平还是降？", "上个月比前三个月平均更高还是更低？"],
    leaseRemaining: ["租约还剩多久，最早何时能退出？", "不续租的话，最早哪月能退场？"],
    transferFee: ["接店或退出涉及多少转让费？", "现在转出去预计能收回多少钱？"],
    franchiseFee: ["加盟费和持续抽成分别是多少？", "品牌每月还固定或按比例收多少钱？"],
    exitCost: ["今天关店还要额外付多少钱？", "解约清场和欠款一共还要多少？"],
    retention: ["老顾客会在一个月内再次购买吗？", "最近十位顾客里大约几位会复购？"],
    staffCapacity: ["现在人手最多一天能稳定做多少单？", "不加人时，出餐上限大约多少单？"],

    deposit: ["押金一共要交多少钱？", "签约当天押金和预付租金共多少？"],
    equipmentCost: ["必须买的设备一共要多少钱？", "最低配设备总共要多少钱？"],
    renovationCost: ["达到开业条件最少装修多少钱？", "不做形象升级，只开业要花多少？"],
    mandatoryPurchase: ["加盟方是否要求固定采购或抽成？", "哪些原料设备必须向品牌方购买？"],
    plannedCommitment: ["签约到开业全部计划投入多少钱？", "押金装修设备加盟加起来多少钱？"],
    trialSale: ["你做过真实试卖并收到钱了吗？", "没租店前，真实试卖共卖了多少单？"],
    safetyRunway: ["开店失败后生活费还能撑几个月？", "亏完计划投入后，还剩几个月生活费？"],

    growthBottleneck: ["增长最卡曝光、进店、成交还是产能？", "订单再多时，最先卡住哪一步？"],
    incrementalEconomics: ["多卖一百元最终能多留下多少钱？", "新增十单会增加多少收入和成本？"],
    reversibleInvestment: ["下一笔投入能否小额测试并随时停？", "不用签长约，最小怎么试这件事？"]
  });

  const COMMON_FIELDS = Object.freeze([
    "goal",
    "category",
    "targetCustomer",
    "avgTicket",
    "locationEntrance",
    "trafficMatch",
    "visibility",
    "purchaseFunnelBreak"
  ]);

  const STAGE_FIELDS = Object.freeze({
    operating: [
      "monthlyRevenue",
      "dailyOrders",
      "channelMix",
      "variableCostRate",
      "rent",
      "labor",
      "employeeCount",
      "staffSchedule",
      "ownerReplacementWage",
      "otherFixed",
      "cashReserve",
      "debt",
      "operatingMonths",
      "trend",
      "leaseRemaining",
      "transferFee",
      "franchiseFee",
      "exitCost",
      "retention",
      "staffCapacity"
    ],
    preopen: [
      "variableCostRate",
      "rent",
      "deposit",
      "leaseRemaining",
      "transferFee",
      "franchiseFee",
      "equipmentCost",
      "renovationCost",
      "mandatoryPurchase",
      "plannedCommitment",
      "ownerReplacementWage",
      "cashReserve",
      "debt",
      "trialSale",
      "safetyRunway"
    ],
    growth: [
      "monthlyRevenue",
      "dailyOrders",
      "channelMix",
      "variableCostRate",
      "rent",
      "labor",
      "employeeCount",
      "staffSchedule",
      "ownerReplacementWage",
      "otherFixed",
      "cashReserve",
      "debt",
      "retention",
      "staffCapacity",
      "growthBottleneck",
      "incrementalEconomics",
      "reversibleInvestment"
    ]
  });

  function normalizeStage(stage) {
    const value = String(stage || "").trim().toLowerCase();
    if (
      value === "preopen" ||
      ["准备开店", "准备开店 / 接店", "接店", "加盟"].some((item) => value.includes(item))
    ) return "preopen";
    if (
      value === "growth" ||
      ["增长", "扩大", "扩张"].some((item) => value.includes(item))
    ) return "growth";
    return "operating";
  }

  function getRequiredFields(stage) {
    return [...COMMON_FIELDS, ...STAGE_FIELDS[normalizeStage(stage)]];
  }

  function getAllowedFields(stage) {
    return getRequiredFields(stage);
  }

  function factsByField(rawFacts) {
    if (Array.isArray(rawFacts)) {
      return Object.fromEntries(rawFacts
        .filter((fact) => fact && typeof fact === "object")
        .map((fact) => [String(fact.field || fact.id || ""), fact])
        .filter(([field]) => field));
    }
    return rawFacts && typeof rawFacts === "object" ? rawFacts : {};
  }

  function isResolvedFact(fact) {
    if (!fact || typeof fact !== "object") return false;
    if (fact.status === "unknown" || fact.status === "conflict") return false;
    if (fact.range && Number.isFinite(Number(fact.range.min)) &&
      Number.isFinite(Number(fact.range.max))) return true;
    return fact.value !== null && fact.value !== undefined && fact.value !== "";
  }

  function attemptCounts(turns = []) {
    const counts = {};
    for (const turn of Array.isArray(turns) ? turns : []) {
      const field = String(turn?.field || "").trim();
      if (field) counts[field] = (counts[field] || 0) + 1;
    }
    return counts;
  }

  function questionFor(field, attempt = 0) {
    const variants = FIELD_DEFINITIONS[field];
    if (!variants) return null;
    const text = variants[Math.min(Math.max(attempt, 0), variants.length - 1)];
    return { field, text, complete: false, attempt: attempt + 1 };
  }

  function evaluateInterviewCompleteness(state = {}) {
    const stage = normalizeStage(state.stage);
    const requiredFields = getRequiredFields(stage);
    const facts = factsByField(state.facts);
    const counts = attemptCounts(state.turns);
    const totalTurns = Array.isArray(state.turns) ? state.turns.length : 0;
    const resolved = requiredFields.filter((field) => isResolvedFact(facts[field]));
    const unresolved = requiredFields.filter((field) => !isResolvedFact(facts[field]));
    const missing = unresolved.filter((field) => !counts[field]);
    const retryable = unresolved.filter((field) =>
      (counts[field] || 0) > 0 && (counts[field] || 0) < MAX_ATTEMPTS_PER_FIELD);
    const exhausted = unresolved.filter((field) =>
      (counts[field] || 0) >= MAX_ATTEMPTS_PER_FIELD);

    if (state.locationConfirmed !== true) {
      return {
        complete: false,
        reason: "LOCATION_REQUIRED",
        nextQuestion: null,
        stage,
        requiredFields,
        resolved,
        missing,
        retryable,
        exhausted,
        remainingTurns: Math.max(0, MAX_TURNS - totalTurns)
      };
    }

    if (totalTurns >= MAX_TURNS) {
      return {
        complete: true,
        reason: "MAX_TURNS",
        nextQuestion: null,
        stage,
        requiredFields,
        resolved,
        missing,
        retryable,
        exhausted,
        remainingTurns: 0
      };
    }

    const nextField = missing[0] || retryable[0] || null;
    if (!nextField) {
      return {
        complete: true,
        reason: unresolved.length ? "UNKNOWNS_EXHAUSTED" : "REQUIRED_FIELDS_COVERED",
        nextQuestion: null,
        stage,
        requiredFields,
        resolved,
        missing,
        retryable,
        exhausted,
        remainingTurns: Math.max(0, MAX_TURNS - totalTurns)
      };
    }

    return {
      complete: false,
      reason: missing.length ? "MISSING_REQUIRED_FIELD" : "RETRY_UNRESOLVED_FIELD",
      nextQuestion: questionFor(nextField, counts[nextField] || 0),
      stage,
      requiredFields,
      resolved,
      missing,
      retryable,
      exhausted,
      remainingTurns: Math.max(0, MAX_TURNS - totalTurns)
    };
  }

  function isShortSingleQuestion(text) {
    const value = String(text || "").trim();
    if (!value || Array.from(value).length > 30 || /[\r\n]/.test(value)) return false;
    if ((value.match(/[？?]/g) || []).length > 1) return false;
    const interrogatives = value.match(/多少|是否|有没有|几|哪|吗/g) || [];
    if (interrogatives.length > 1) return false;
    return true;
  }

  function sanitizeAgentNextQuestion(proposal, state = {}) {
    const program = evaluateInterviewCompleteness(state);
    if (program.complete) {
      return { field: "", text: "", complete: true, source: "program" };
    }
    if (!program.nextQuestion) {
      return { field: "", text: "", complete: false, source: "program" };
    }
    const proposedField = String(proposal?.field || "").trim();
    const proposedText = String(proposal?.text || "").trim();
    if (
      proposal?.complete !== true &&
      proposedField === program.nextQuestion.field &&
      getAllowedFields(program.stage).includes(proposedField) &&
      isShortSingleQuestion(proposedText)
    ) {
      return {
        field: proposedField,
        text: proposedText,
        complete: false,
        attempt: program.nextQuestion.attempt,
        source: "agent"
      };
    }
    return { ...program.nextQuestion, source: "program" };
  }

  return {
    MAX_TURNS,
    MAX_ATTEMPTS_PER_FIELD,
    FIELD_DEFINITIONS,
    normalizeStage,
    getRequiredFields,
    getAllowedFields,
    isResolvedFact,
    questionFor,
    evaluateInterviewCompleteness,
    isShortSingleQuestion,
    sanitizeAgentNextQuestion
  };
}));
