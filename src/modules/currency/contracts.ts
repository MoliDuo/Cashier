// Keep this file as the module boundary contract: it must not import/re-export
// application-layer types to avoid cross-layer coupling.
export interface ConvertCurrencyResult {
  converted: string;
}
