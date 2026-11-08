import { defineConfig } from "@trigger.dev/sdk"

export default defineConfig({
  project: "proj_unbfprpukfefqmorvetq",
  runtime: "node-24",
  logLevel: "log",
  maxDuration: 600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
})