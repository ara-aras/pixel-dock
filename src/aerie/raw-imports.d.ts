// Vite's `?raw` suffix imports a file's text. The project does not load
// `vite/client` types, so declare the one form Aerie uses.
declare module "*.svg?raw" {
  const content: string;
  export default content;
}
