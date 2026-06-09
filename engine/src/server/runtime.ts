import { createEngineRuntimeConfig, startEngineServer } from "./server.js";

startEngineServer(createEngineRuntimeConfig()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
