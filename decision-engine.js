(function attachDecisionEngine(root, factory) {
  const engine = factory();
  if (typeof module === "object" && module.exports) module.exports = engine;
  root.DecisionEngine = engine;
}(typeof globalThis !== "undefined" ? globalThis : window, function createDecisionEngine() {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const knownAnswer = (value) => ["yes", "no", "unknown"].includes(value);
  const answerScore = (value) => value === "yes" ? 1 : value === "no" ? 0 : .5;

  function evidenceCompleteness(input) {
    const required = input.stage === "operating"
      ? ["monthlyRevenue", "variableCostRate", "rent", "labor", "otherFixed", "cashReserve", "avgTicket"]
      : ["variableCostRate", "rent", "labor", "otherFixed", "cashReserve", "avgTicket", "plannedCommitment"];
    const known = input.known || {};
    const numericScore = required.filter((key) => known[key]).length / required.length * 52;
    const answerScoreValue = ["trafficMatch", "visibility", "retention"]
      .filter((key) => knownAnswer(input[key])).length / 3 * 24;
    const locationScore = input.locationConfirmed ? 14 : 0;
    const mapScore = input.mapContextLoaded ? 5 : 0;
    const categoryScore = input.category ? 5 : 0;
    return Math.round(clamp(numericScore + answerScoreValue + locationScore + mapScore + categoryScore, 0, 100));
  }

  function pickAction(input, metrics) {
    if (!input.locationConfirmed) {
      return {
        action: "先到店铺现场定位，或者手动写下店铺的准确商圈。",
        stopLine: "没有具体位置，不判断客流，也不建议签约或追加投入。"
      };
    }
    if (input.trafficMatch === "unknown") {
      return {
        action: "午高峰和晚高峰各站 20 分钟：只数目标顾客经过、看见、进店和成交的人数。",
        stopLine: "两次测试都没有足够目标顾客经过，就停止为这个位置追加投入。"
      };
    }
    if (input.trafficMatch === "no") {
      return {
        action: "停止投流，先用摆摊、外卖或预售测试：目标顾客是否愿意为这个产品付钱。",
        stopLine: "如果换到目标顾客出现的地方仍无人购买，问题不在位置，而在产品。"
      };
    }
    if (input.visibility !== "yes") {
      return {
        action: "用 300 元以内做一个门头实验：让 5 个陌生人看 10 秒，说出卖什么、多少钱、为什么进店。",
        stopLine: "5 人中少于 4 人能说清，就先改门头和产品呈现，不追加装修或推广。"
      };
    }
    if (input.stage === "preopen") {
      return {
        action: `先完成 3 天真实销售测试，目标每天至少 ${Math.ceil(metrics.breakEvenOrders)} 单，再决定是否签约。`,
        stopLine: "测试没有达到保本订单的 70%，不把“以后会变好”当作签约依据。"
      };
    }
    if (input.retention !== "yes") {
      return {
        action: "联系最近 10 位真实顾客，只问两件事：为什么第一次来、为什么没有再来。",
        stopLine: "复购原因没有变清楚前，不通过打折和投流购买一次性营业额。"
      };
    }
    if (metrics.coverage < 1) {
      return {
        action: "只选一个变量做 7 天实验：提毛利、减班次、降固定成本或提高成交率，不要同时乱改。",
        stopLine: "7 天后保本缺口没有缩小至少 20%，停止该实验并进入缩店或退出预案。"
      };
    }
    return {
      action: "保持现有模型两周，只放大能带来重复毛利的渠道，并记录每一元新增支出的回报。",
      stopLine: "新增投入不能在约定周期内回收，就回到原有规模。"
    };
  }

  function assess(rawInput) {
    const input = {
      ...rawInput,
      stage: rawInput.stage === "preopen" ? "preopen" : "operating",
      category: String(rawInput.category || "").trim(),
      monthlyRevenue: finite(rawInput.monthlyRevenue),
      variableCostRate: clamp(finite(rawInput.variableCostRate), 1, 95),
      rent: finite(rawInput.rent),
      labor: finite(rawInput.labor),
      otherFixed: finite(rawInput.otherFixed),
      cashReserve: finite(rawInput.cashReserve),
      avgTicket: Math.max(1, finite(rawInput.avgTicket)),
      plannedCommitment: finite(rawInput.plannedCommitment),
      debt: finite(rawInput.debt)
    };

    const grossMargin = 1 - input.variableCostRate / 100;
    const fixedCosts = input.rent + input.labor + input.otherFixed;
    const breakEvenMonthly = grossMargin > 0 ? fixedCosts / grossMargin : Infinity;
    const breakEvenDaily = breakEvenMonthly / 30;
    const breakEvenOrders = breakEvenDaily / input.avgTicket;
    const monthlyProfit = input.stage === "operating"
      ? input.monthlyRevenue * grossMargin - fixedCosts
      : null;
    const coverage = input.stage !== "operating"
      ? 0
      : breakEvenMonthly > 0
        ? input.monthlyRevenue / breakEvenMonthly
        : input.monthlyRevenue > 0 ? Infinity : 1;
    const runway = monthlyProfit !== null && monthlyProfit < 0
      ? input.cashReserve / Math.abs(monthlyProfit)
      : Infinity;
    const commitmentRatio = input.stage === "preopen"
      ? (input.plannedCommitment + input.debt) / Math.max(input.cashReserve, 1)
      : input.debt / Math.max(input.cashReserve, 1);
    const qualitative = (
      answerScore(input.trafficMatch) +
      answerScore(input.visibility) +
      answerScore(input.retention)
    ) / 3;
    const completeness = evidenceCompleteness(input);

    let decision = "TEST";
    let title = "先做小测试，暂时不要追加投入";
    let reason = "先用一个便宜、可逆的实验验证关键假设，再决定下一笔钱。";

    if (completeness < 65) {
      decision = "EVIDENCE";
      title = "信息还不够，先别做决定";
      reason = "关键数字或现场证据缺失。现在给出肯定答案，只是在把猜测包装成专业。";
    } else if (input.stage === "preopen") {
      if (input.trafficMatch === "no" || input.visibility === "no" || commitmentRatio > 1) {
        decision = "STOP";
        title = "先停止签约和付款";
        reason = "位置、可见性或资金安全垫没有过闸门。不要用整店投入替代真实测试。";
      } else {
        decision = "TEST";
        title = "先试卖，再决定开不开";
        reason = "没有真实营业数据时，任何营业额预测都只是愿望。先证明每天能达到保本订单。";
      }
    } else if (monthlyProfit < 0 && runway < 3) {
      decision = "EXIT";
      title = "立即准备缩店或退出";
      reason = `保持现状只能再撑 ${runway.toFixed(1)} 个月。先保护现金，不要让过去的投入决定下一笔钱。`;
    } else if (coverage < .65) {
      decision = "STOP";
      title = "停止追加投入，基本模型还没成立";
      reason = "当前营业额离保本线太远。继续装修、打折或投流，大概率只是放大错误。";
    } else if (monthlyProfit < 0 || input.trafficMatch !== "yes" || input.visibility !== "yes" || input.retention !== "yes") {
      decision = "TEST";
      title = "先修一个断点，不要同时乱改";
      reason = "先确认问题发生在目标客流、门头理解、成交还是复购，再决定是否继续花钱。";
    } else if (coverage >= 1.1 && qualitative >= .8) {
      decision = "GO";
      title = "基本模型成立，可以小步放大";
      reason = "经营现金流已经越过保本线。扩张仍要分阶段进行，并提前写下停止线。";
    }

    const metrics = {
      grossMargin,
      fixedCosts,
      breakEvenMonthly,
      breakEvenDaily,
      breakEvenOrders,
      monthlyProfit,
      coverage,
      runway,
      commitmentRatio,
      qualitative,
      completeness
    };
    const next = pickAction(input, metrics);

    const risks = [
      {
        label: "保本压力",
        value: `${Math.ceil(breakEvenOrders)} 单/天`,
        level: breakEvenOrders > 120 ? "high" : breakEvenOrders > 60 ? "medium" : "low"
      },
      {
        label: "现场证据",
        value: `${Math.round(qualitative * 100)}%`,
        level: qualitative < .5 ? "high" : qualitative < .8 ? "medium" : "low"
      },
      {
        label: input.stage === "preopen" ? "投入 / 可用现金" : "债务 / 可用现金",
        value: `${commitmentRatio.toFixed(1)}×`,
        level: commitmentRatio > 1 ? "high" : commitmentRatio > .5 ? "medium" : "low"
      }
    ];
    if (input.stage === "operating") {
      risks.splice(1, 0, {
        label: "现金寿命",
        value: runway === Infinity ? "正现金流" : `${runway.toFixed(1)} 月`,
        level: runway < 3 ? "high" : runway < 6 ? "medium" : "low"
      });
    }

    const scenarios = input.stage === "operating"
      ? [
        { label: "营业额下降 30%", value: input.monthlyRevenue * .7 * grossMargin - fixedCosts },
        { label: "保持现状", value: monthlyProfit },
        { label: "营业额提高 15%", value: input.monthlyRevenue * 1.15 * grossMargin - fixedCosts }
      ]
      : [
        { label: "保本的月营业额", value: breakEvenMonthly },
        { label: "保本的日营业额", value: breakEvenDaily },
        { label: "保本的日订单", value: breakEvenOrders, unit: "orders" }
      ];

    return {
      decision,
      title,
      reason,
      nextAction: next.action,
      stopLine: next.stopLine,
      metrics,
      risks,
      scenarios
    };
  }

  return { assess };
}));
