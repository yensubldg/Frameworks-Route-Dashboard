import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export type Framework = "nestjs" | "fastapi" | "unknown";

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  ".git",
  "venv",
  ".venv",
  "env",
  "__pycache__",
  ".tox",
  ".pytest_cache",
  "build",
]);

function safeRead(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function looksLikeNestPackage(packageJsonPath: string): boolean {
  const content = safeRead(packageJsonPath);
  if (!content) return false;
  try {
    const pkg = JSON.parse(content);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return Boolean(deps["@nestjs/common"] || deps["@nestjs/core"]);
  } catch {
    return false;
  }
}

function looksLikeFastAPIRequirements(reqPath: string): boolean {
  const content = safeRead(reqPath);
  if (!content) return false;
  return /(^|\n)\s*fastapi(==|>=|\s|$)/m.test(content);
}

function looksLikeFastAPIPyProject(pyprojectPath: string): boolean {
  const content = safeRead(pyprojectPath);
  if (!content) return false;
  return /\bfastapi\b/i.test(content);
}

function looksLikeFastAPIPipfile(pipfilePath: string): boolean {
  const content = safeRead(pipfilePath);
  if (!content) return false;
  return /\bfastapi\b/i.test(content);
}

function looksLikeFastAPIMain(pyPath: string): boolean {
  const content = safeRead(pyPath);
  if (!content) return false;
  return /(from\s+fastapi\s+import\s+FastAPI|import\s+fastapi)/i.test(content);
}

function scanForFrameworks(rootPath: string, maxDepth = 3): { nest: boolean; fastapi: boolean } {
  const result = { nest: false, fastapi: false };

  function walk(current: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return;
    }

    // File checks in current directory
    if (!result.nest) {
      if (fs.existsSync(path.join(current, "nest-cli.json"))) result.nest = true;
      const pkgPath = path.join(current, "package.json");
      if (!result.nest && fs.existsSync(pkgPath) && looksLikeNestPackage(pkgPath)) {
        result.nest = true;
      }
    }
    if (!result.fastapi) {
      const req = path.join(current, "requirements.txt");
      if (fs.existsSync(req) && looksLikeFastAPIRequirements(req)) result.fastapi = true;
      const pyproj = path.join(current, "pyproject.toml");
      if (!result.fastapi && fs.existsSync(pyproj) && looksLikeFastAPIPyProject(pyproj)) result.fastapi = true;
      const pipfile = path.join(current, "Pipfile");
      if (!result.fastapi && fs.existsSync(pipfile) && looksLikeFastAPIPipfile(pipfile)) result.fastapi = true;
      // common main files
      ["main.py", path.join("app", "main.py"), path.join("src", "main.py")].forEach((rel) => {
        if (result.fastapi) return;
        const p = path.join(current, rel);
        if (fs.existsSync(p) && looksLikeFastAPIMain(p)) result.fastapi = true;
      });
    }

    if (result.nest && result.fastapi) return; // early stop

    for (const name of entries) {
      const full = path.join(current, name);
      let stat: fs.Stats | undefined;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue;
        walk(full, depth + 1);
        if (result.nest && result.fastapi) return;
      }
    }
  }

  walk(rootPath, 0);
  return result;
}

export class FrameworkDetector {
  public static detectFramework(): Framework {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) {
      return "unknown";
    }

    const { nest, fastapi } = scanForFrameworks(rootPath);
    if (nest && fastapi) return "unknown"; // ambiguous, prefer detectAllFrameworks
    if (nest) return "nestjs";
    if (fastapi) return "fastapi";
    return "unknown";
  }

  public static detectAllFrameworks(): Framework[] {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) return [];
    const { nest, fastapi } = scanForFrameworks(rootPath);
    const arr: Framework[] = [];
    if (nest) arr.push("nestjs");
    if (fastapi) arr.push("fastapi");
    return arr;
  }
}
