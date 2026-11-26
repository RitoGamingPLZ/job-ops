import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("extractor deployment config", () => {
  it("ships the BambooHR career board package in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain(
      "COPY career-boards/bamboohr/package*.json ./career-boards/bamboohr/",
    );
    expect(dockerfile).toContain("COPY career-boards/bamboohr ./career-boards/bamboohr");
  });

  it("ships the Workday career board package in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain(
      "COPY career-boards/workday/package*.json ./career-boards/workday/",
    );
    expect(dockerfile).toContain("COPY career-boards/workday ./career-boards/workday");
  });

  it("ships the Hiring Cafe extractor in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain(
      "COPY extractors/hiringcafe/package*.json ./extractors/hiringcafe/",
    );
    expect(dockerfile).toContain("COPY extractors/hiringcafe ./extractors/hiringcafe");
  });

  it("ships kept extractors and JobSpy Python deps in the Cloudflare Dockerfile", async () => {
    const cfDockerfile = await readFile(resolve(process.cwd(), "../cloudflare/Dockerfile"), {
      encoding: "utf8",
    });

    for (const id of ["adzuna", "hiringcafe", "jobindex", "freehire", "browser-utils"]) {
      expect(cfDockerfile).toContain(`COPY extractors/${id}/package*.json ./extractors/${id}/`);
      expect(cfDockerfile).toContain(`COPY extractors/${id} ./extractors/${id}`);
    }
    expect(cfDockerfile).toContain("COPY extractors/jobspy/requirements.txt ./extractors/jobspy/");
    expect(cfDockerfile).toContain("pip3 install --no-cache-dir --break-system-packages -r ./extractors/jobspy/requirements.txt");
    expect(cfDockerfile).toContain("COPY extractors/jobspy ./extractors/jobspy");
    for (const removed of [
      "fiveamsat",
      "wazzuf",
      "golangjobs",
      "ukvisajobs",
      "gradcracker",
      "naukri",
      "seek",
      "startupjobs",
      "workingnomads",
    ]) {
      expect(cfDockerfile).not.toContain(`extractors/${removed}`);
    }
  });

  it("ships the Jobindex extractor in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain("COPY extractors/jobindex/package*.json ./extractors/jobindex/");
    expect(dockerfile).toContain("COPY extractors/jobindex ./extractors/jobindex");
  });

  it("ships the FreeHire extractor in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain("COPY extractors/freehire/package*.json ./extractors/freehire/");
    expect(dockerfile).toContain("COPY extractors/freehire ./extractors/freehire");
  });

  it("does not install a vanilla Node Playwright Firefox binary", async () => {
    // Camoufox is the only supported browser in production. The vanilla Firefox
    // fallback was removed so that a missing Camoufox binary surfaces as a hard
    // failure rather than silently degrading anti-detection. Keeping this
    // assertion prevents the fallback from being accidentally reintroduced.
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).not.toContain("./node_modules/.bin/playwright install firefox");
  });

  it("bakes Camoufox GeoLite data during Docker builds", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });
    const fetchScript = await readFile(resolve(process.cwd(), "../scripts/camoufox-fetch.mjs"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain("node ./scripts/camoufox-fetch.mjs");
    expect(fetchScript).toContain(
      'import { downloadMmdb } from "@camoufox/camoufox/dist/geolocation.js";',
    );
    expect(fetchScript).toContain("await downloadMmdb();");
  });

  it("syncs the JobSpy extractor in compose development mode", async () => {
    const composeFile = await readFile(resolve(process.cwd(), "../docker-compose.yml"), {
      encoding: "utf8",
    });

    expect(composeFile).toContain("path: ./extractors/jobspy");
    expect(composeFile).toContain("target: /app/extractors/jobspy");
  });

  it("syncs the Jobindex extractor in compose development mode", async () => {
    const composeFile = await readFile(resolve(process.cwd(), "../docker-compose.yml"), {
      encoding: "utf8",
    });

    expect(composeFile).toContain("path: ./extractors/jobindex/src");
    expect(composeFile).toContain("target: /app/extractors/jobindex/src");
  });

  it("syncs the FreeHire extractor in compose development mode", async () => {
    const composeFile = await readFile(resolve(process.cwd(), "../docker-compose.yml"), {
      encoding: "utf8",
    });

    expect(composeFile).toContain("path: ./extractors/freehire/src");
    expect(composeFile).toContain("target: /app/extractors/freehire/src");
  });

  it("syncs the Workday career board package in compose development mode", async () => {
    const composeFile = await readFile(resolve(process.cwd(), "../docker-compose.yml"), {
      encoding: "utf8",
    });

    expect(composeFile).toContain("path: ./career-boards/workday/src");
    expect(composeFile).toContain("target: /app/career-boards/workday/src");
  });

  it("syncs the BambooHR career board package in compose development mode", async () => {
    const composeFile = await readFile(resolve(process.cwd(), "../docker-compose.yml"), {
      encoding: "utf8",
    });

    expect(composeFile).toContain("path: ./career-boards/bamboohr/src");
    expect(composeFile).toContain("target: /app/career-boards/bamboohr/src");
  });
});
