import type { NextConfig } from "next";
import { loadWorktreeEnv } from "./scripts/load-worktree-env";

loadWorktreeEnv();

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
