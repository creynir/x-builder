/**
 * @x-builder/calibration
 *
 * Calibration scaffold for the reach-model upgrade. Pure functions over a
 * synthetic-or-developer-supplied corpus: a normalizer (raw export → rows), a
 * DI predictor-runner, a per-format fit, and a leave-one-account-out validator.
 * The CLI entrypoints under ./bin wire the real engine into these functions.
 */
export { CalibrationRowSchema } from "./schema.js";
export type { CalibrationRow } from "./schema.js";

export { normalizeExportToRows } from "./normalize.js";
export type {
  NormalizeOptions,
  RawEntities,
  RawExport,
  RawMediaEntity,
  RawPost,
  RawUrlEntity,
} from "./normalize.js";

export { runPredictor } from "./predictor.js";
export type { PredictedRow, PredictorOptions, RowEngine } from "./predictor.js";

export { fitReachConstants, geometricMedian1D } from "./fit.js";
export type { FormatReachWeights, ReachConstantsFile } from "./fit.js";

export { validateLeaveOneAccountOut } from "./validate.js";
export type { ValidationReport } from "./validate.js";
