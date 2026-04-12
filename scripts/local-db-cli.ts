import {
  getCommonRepoRoot,
  getGitTopLevel,
  isDockerPostgresRunning,
  resolveComposeDir,
  runDockerCompose,
} from "./local-db";

function main() {
  const command = process.argv[2];
  const composeDir = resolveComposeDir(getGitTopLevel(), getCommonRepoRoot());

  switch (command) {
    case "start":
      if (isDockerPostgresRunning(composeDir)) {
        console.log("Local Postgres is already running.");
        return;
      }

      runDockerCompose(["up", "-d", "postgres"], composeDir);
      console.log("Started shared local Postgres.");
      return;

    case "stop":
      if (!isDockerPostgresRunning(composeDir)) {
        console.log("Local Postgres is already stopped.");
        return;
      }

      runDockerCompose(["stop", "postgres"], composeDir);
      console.log("Stopped shared local Postgres.");
      return;

    default:
      console.error("Usage: pnpm db:local:start | pnpm db:local:stop");
      process.exit(1);
  }
}

main();
