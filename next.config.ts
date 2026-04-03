import type { NextConfig } from "next";
import { loadWorktreeEnv } from "./scripts/load-worktree-env";

loadWorktreeEnv();

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
