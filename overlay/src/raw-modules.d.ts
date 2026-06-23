// @x-builder/overlay — ambient declarations for Vite `?raw` imports (XOB-019)
//
// The design-token sheet raw-imports `product-tokens.css?raw`; Vite inlines the
// file contents as a default string export at build time. `tsc` (lint =
// typecheck) needs this declaration to type the import without pulling all of
// `vite/client` into the overlay's `types`.

declare module "*?raw" {
  const content: string;
  export default content;
}
