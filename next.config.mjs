import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  typedRoutes: true,
  output: "standalone",
  turbopack: {
    root: projectRoot
  },
  experimental: {
    // Next 16.3 enables the subprocess-based TypeScript CLI by default. The
    // stable compiler API is more reliable with the project's TypeScript 5.x.
    useTypeScriptCli: false
  }
};

export default nextConfig;
