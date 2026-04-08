# Economic Parameter Atlas

Interactive PolicyEngine-style viewer for elicited economic-parameter response distributions across frontier models.

The app ships with a precomputed snapshot of the current elasticity panel and lets you:

- compare pooled, REML, and Bayesian intervals across models
- sort models by canonical order or point estimate
- inspect per-run responses, recalled literature anchors, and raw outputs
- browse the full static dataset without needing the original experiment repo at runtime

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Refresh the snapshot

The checked-in data lives in:

- `src/data/dashboard-summary.json`
- `public/data/runs/*.json`

To rebuild those files from a local `llm-econ-beliefs/results` directory:

```bash
npm run build:data
```

Or point at another results directory:

```bash
ATLAS_SOURCE_RESULTS=/absolute/path/to/results npm run build:data
```

## Production build

```bash
npm run build
```

## Data model

This tool is intentionally static at runtime. `scripts/build-snapshot.mjs` reads experiment artifacts, selects the preferred result for each `(model, quantity)` pair, and materializes a deployable snapshot for the frontend.
