import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseCsv } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_RESULTS_DIR = path.resolve(
  REPO_ROOT,
  "..",
  "..",
  "llm-econ-beliefs",
  "results",
);

const METHOD_DEFINITIONS = [
  {
    id: "pooled",
    label: "Pooled Mixture 90% Interval",
    shortLabel: "Pooled",
    kind: "mixture",
    description:
      "Mixture-style pooled interval using the elicited within-run distributions plus across-run variation.",
  },
  {
    id: "remlPredictive",
    label: "REML Predictive 90% Interval",
    shortLabel: "REML Predictive",
    kind: "predictive",
    description:
      "Random-effects predictive interval for a fresh run, using the REML-style meta-analytic approximation.",
  },
  {
    id: "remlLatent",
    label: "REML Latent 90% Interval",
    shortLabel: "REML Latent",
    kind: "latent",
    description:
      "Random-effects interval for the latent central belief rather than a fresh future run.",
  },
  {
    id: "bayesPredictive",
    label: "Bayesian Predictive 90% Interval",
    shortLabel: "Bayes Predictive",
    kind: "predictive",
    description:
      "Bayesian hierarchical predictive interval for a fresh run after pooling within-run and across-run uncertainty.",
  },
  {
    id: "bayesLatent",
    label: "Bayesian Latent 90% Interval",
    shortLabel: "Bayes Latent",
    kind: "latent",
    description:
      "Bayesian hierarchical interval for the latent central belief rather than a fresh future run.",
  },
];

const MODEL_ORDER = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "claude-opus-4.6",
  "claude-sonnet-4.6",
  "claude-haiku-4.5",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "grok-4.20",
  "grok-4.1-fast",
];

const runCache = new Map();

main();

function main() {
  const resultsDir = path.resolve(
    process.argv[2] || process.env.ATLAS_SOURCE_RESULTS || DEFAULT_RESULTS_DIR,
  );

  if (!fs.existsSync(resultsDir)) {
    throw new Error(`Results directory not found: ${resultsDir}`);
  }

  const summaryRows = selectPreferredSummaries(loadSummaryRows(resultsDir));
  const grouped = new Map();

  for (const row of summaryRows) {
    const group = grouped.get(row.quantityId) ?? [];
    group.push(row);
    grouped.set(row.quantityId, group);
  }

  const runsOutputDir = path.join(REPO_ROOT, "public", "data", "runs");
  fs.rmSync(runsOutputDir, { recursive: true, force: true });
  fs.mkdirSync(runsOutputDir, { recursive: true });

  const quantities = Array.from(grouped.values())
    .map((quantityRows) => buildQuantitySummary(quantityRows, runsOutputDir))
    .sort((left, right) => left.quantityName.localeCompare(right.quantityName));

  const selectedModelNames = Array.from(
    new Set(quantities.flatMap((quantity) => quantity.availableModels)),
  ).sort(compareModelNames);

  const totalCostUsd = sumNullable(
    quantities.flatMap((quantity) =>
      quantity.modelSummaries.map((summary) => summary.totalCostUsd),
    ),
  );

  const summaryPayload = {
    generatedAt: new Date().toISOString(),
    methods: METHOD_DEFINITIONS,
    modelNames: selectedModelNames,
    quantities,
    stats: {
      quantityCount: quantities.length,
      modelCount: selectedModelNames.length,
      selectedResultCount: quantities.reduce(
        (count, quantity) => count + quantity.modelSummaries.length,
        0,
      ),
      totalCostUsd,
    },
  };

  const summaryPath = path.join(REPO_ROOT, "src", "data", "dashboard-summary.json");
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summaryPayload, null, 2)}\n`);

  console.log(`Wrote summary snapshot to ${summaryPath}`);
  console.log(`Wrote run payloads to ${runsOutputDir}`);
}

function buildQuantitySummary(quantityRows, runsOutputDir) {
  const modelSummaries = quantityRows
    .map((row) => buildModelSummary(row, runsOutputDir))
    .sort((left, right) => compareModelNames(left.modelName, right.modelName));

  return {
    quantityId: quantityRows[0].quantityId,
    quantityName: quantityRows[0].quantityName,
    domain: quantityRows[0].domain,
    availableModels: modelSummaries.map((summary) => summary.modelName),
    modelSummaries,
  };
}

function buildModelSummary(row, runsOutputDir) {
  const runs = loadRunsForExperiment(row.experimentDir).filter(
    (run) =>
      run.quantity_id === row.quantityId &&
      run.model_name === row.modelName &&
      run.parsed_ok,
  );

  const payloadFilename = `${encodeURIComponent(row.quantityId)}--${encodeURIComponent(
    row.modelName,
  )}.json`;
  const payloadPath = path.join(runsOutputDir, payloadFilename);
  const runPayloadPath = `/data/runs/${payloadFilename}`;

  const runPayload = {
    quantityId: row.quantityId,
    modelName: row.modelName,
    experimentDir: path.basename(row.experimentDir),
    experimentUpdatedAt: new Date(row.experimentUpdatedAt).toISOString(),
    runs: loadRunsForExperiment(row.experimentDir)
      .filter(
        (run) =>
          run.quantity_id === row.quantityId && run.model_name === row.modelName,
      )
      .sort((left, right) => left.run_index - right.run_index)
      .map((run) => ({
        runIndex: run.run_index,
        promptVersion: run.prompt_version,
        parsedOk: run.parsed_ok,
        pointEstimate: run.point_estimate,
        lowerBound: run.lower_bound,
        upperBound: run.upper_bound,
        confidenceLevel: run.confidence_level,
        quantiles: run.quantiles ?? {},
        interpretation: run.interpretation,
        citations: run.citations ?? [],
        reasoningSummary: run.reasoning_summary,
        rawResponse: run.raw_response,
        prompt: run.prompt,
        error: run.error,
      })),
  };

  fs.writeFileSync(payloadPath, `${JSON.stringify(runPayload, null, 2)}\n`);

  return {
    modelName: row.modelName,
    experimentDir: path.basename(row.experimentDir),
    experimentUpdatedAt: new Date(row.experimentUpdatedAt).toISOString(),
    runPayloadPath,
    nSuccessfulRuns: row.nSuccessfulRuns,
    totalCostUsd: row.usageEstimatedTotalCostUsdTotal,
    costPerRunUsd: row.usageEstimatedTotalCostUsdPerSuccessfulRun,
    totalTokens: row.usageTotalTokensTotal,
    tokensPerRun: row.usageTotalTokensPerSuccessfulRun,
    intervals: {
      pooled: {
        center: row.pooledPointEstimate,
        lower: row.pooledLowerBound,
        upper: row.pooledUpperBound,
      },
      remlPredictive: {
        center: row.remlLatentLocation,
        lower: row.remlPredictiveLower,
        upper: row.remlPredictiveUpper,
      },
      remlLatent: {
        center: row.remlLatentLocation,
        lower: row.remlLatentLower,
        upper: row.remlLatentUpper,
      },
      bayesPredictive: {
        center: row.bayesLatentLocation,
        lower: row.bayesPredictiveLower,
        upper: row.bayesPredictiveUpper,
      },
      bayesLatent: {
        center: row.bayesLatentLocation,
        lower: row.bayesLatentLower,
        upper: row.bayesLatentUpper,
      },
    },
    sourceSummary: summarizeSources(runs),
  };
}

function summarizeSources(runs) {
  const counter = new Map();

  for (const run of runs) {
    for (const citation of run.citations ?? []) {
      counter.set(citation, (counter.get(citation) ?? 0) + 1);
    }
  }

  const total = Array.from(counter.values()).reduce((sum, value) => sum + value, 0);
  const topAnchors = Array.from(counter.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([citation, count]) => ({
      citation,
      count,
      share: total > 0 ? count / total : 0,
    }));

  return {
    uniqueCitations: counter.size,
    top1Share: topAnchors[0] ? topAnchors[0].share : null,
    top3Share:
      total > 0
        ? topAnchors.slice(0, 3).reduce((sum, anchor) => sum + anchor.count, 0) /
          total
        : null,
    topAnchors,
  };
}

function compareSummaryRows(left, right) {
  return (
    right.nSuccessfulRuns - left.nSuccessfulRuns ||
    right.experimentUpdatedAt - left.experimentUpdatedAt ||
    (right.usageTotalTokensTotal ?? -1) - (left.usageTotalTokensTotal ?? -1) ||
    right.experimentDir.localeCompare(left.experimentDir)
  );
}

function loadSummaryRows(resultsDir) {
  const experimentDirs = fs
    .readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(resultsDir, entry.name));

  const rows = [];

  for (const experimentDir of experimentDirs) {
    const experimentName = path.basename(experimentDir);
    if (!experimentName.includes("elasticities")) {
      continue;
    }

    const summaryPath = path.join(experimentDir, "summary.csv");
    if (!fs.existsSync(summaryPath)) {
      continue;
    }

    const experimentUpdatedAt = fs.statSync(summaryPath).mtimeMs;
    const raw = fs.readFileSync(summaryPath, "utf8");
    const parsed = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
    });

    for (const row of parsed) {
      const quantityId = row.quantity_id;
      rows.push({
        modelName: row.model_name,
        quantityId,
        quantityName: row.quantity_name,
        domain: quantityId.split(".")[0] ?? "other",
        nSuccessfulRuns: parseInteger(row.n_successful_runs) ?? 0,
        pooledPointEstimate: parseNumber(row.pooled_point_estimate),
        pooledLowerBound: parseNumber(row.pooled_lower_bound),
        pooledUpperBound: parseNumber(row.pooled_upper_bound),
        remlLatentLocation: parseNumber(row.reml_latent_location),
        remlLatentLower: parseNumber(row.reml_latent_lower),
        remlLatentUpper: parseNumber(row.reml_latent_upper),
        remlPredictiveLower: parseNumber(row.reml_predictive_lower),
        remlPredictiveUpper: parseNumber(row.reml_predictive_upper),
        bayesLatentLocation: parseNumber(row.bayes_latent_location),
        bayesLatentLower: parseNumber(row.bayes_latent_lower),
        bayesLatentUpper: parseNumber(row.bayes_latent_upper),
        bayesPredictiveLower: parseNumber(row.bayes_predictive_lower),
        bayesPredictiveUpper: parseNumber(row.bayes_predictive_upper),
        usageEstimatedTotalCostUsdTotal: parseNumber(
          row.usage_estimated_total_cost_usd_total,
        ),
        usageEstimatedTotalCostUsdPerSuccessfulRun: parseNumber(
          row.usage_estimated_total_cost_usd_per_successful_run,
        ),
        usageTotalTokensTotal: parseNumber(row.usage_total_tokens_total),
        usageTotalTokensPerSuccessfulRun: parseNumber(
          row.usage_total_tokens_per_successful_run,
        ),
        experimentDir,
        experimentUpdatedAt,
      });
    }
  }

  return rows;
}

function selectPreferredSummaries(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = `${row.modelName}::${row.quantityId}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  return Array.from(grouped.values()).map((group) =>
    [...group].sort(compareSummaryRows)[0],
  );
}

function loadRunsForExperiment(experimentDir) {
  const cached = runCache.get(experimentDir);
  if (cached) {
    return cached;
  }

  const runsPath = path.join(experimentDir, "runs.jsonl");
  if (!fs.existsSync(runsPath)) {
    runCache.set(experimentDir, []);
    return [];
  }

  const parsed = fs
    .readFileSync(runsPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  runCache.set(experimentDir, parsed);
  return parsed;
}

function compareModelNames(left, right) {
  const leftIndex = MODEL_ORDER.indexOf(left);
  const rightIndex = MODEL_ORDER.indexOf(right);

  if (leftIndex >= 0 || rightIndex >= 0) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }

  return left.localeCompare(right);
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value) {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumNullable(values) {
  const observed = values.filter((value) => value !== null);
  if (!observed.length) {
    return null;
  }
  return observed.reduce((sum, value) => sum + value, 0);
}
