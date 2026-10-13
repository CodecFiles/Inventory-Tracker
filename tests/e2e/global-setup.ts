import { execFileSync } from "node:child_process";

// A fresh demo database for every run: the migrations, then the demo data.
export default function setup() {
  execFileSync("scripts/db-build.sh", ["mrd_e2e"], { stdio: "inherit" });
  execFileSync("psql", ["-q", "-o", "/dev/null", "-d", "mrd_e2e", "-f", "scripts/dev-seed.sql"], { stdio: "inherit" });
}
