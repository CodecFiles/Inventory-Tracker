import { execFileSync } from "node:child_process";

// Builds a fresh test database from the migrations before the backend tests run.
export default function setup() {
  execFileSync("scripts/db-build.sh", ["mrd_app_test"], { stdio: "inherit" });
}
