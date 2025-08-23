import * as vscode from "vscode";
import * as path from "path";
import { glob } from "glob";
import * as fs from "fs";
import { Parser, EndpointInfo } from "./Parser";

export class FastAPIParser implements Parser {
  public parseEndpoints(): EndpointInfo[] {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) {
      return [];
    }

    // Determine selection if monorepo mode is enabled
    const config = vscode.workspace.getConfiguration("frameworkRoutesDashboard");
    const monorepoMode = config.get<boolean>("monorepoMode", false);
    const selectedApp = config.get<string>("selectedApp", "");

    // Search common FastAPI locations with safe ignores
    const candidates = new Set<string>();
    const patterns = monorepoMode && selectedApp
      ? [
          `${selectedApp}/**/main.py`,
          `${selectedApp}/app/**/*.py`,
          `${selectedApp}/src/**/*.py`,
          `${selectedApp}/**/*.py`,
        ]
      : ["**/main.py", "app/**/*.py", "src/**/*.py", "**/*.py"];
    const ignore = [
      "**/venv/**",
      "**/.venv/**",
      "**/env/**",
      "**/.tox/**",
      "**/__pycache__/**",
      "**/site-packages/**",
      "**/node_modules/**",
    ];
    for (const pattern of patterns) {
      glob
        .sync(pattern, { cwd: rootPath, ignore })
        .forEach((rel) => candidates.add(path.join(rootPath, rel)));
    }

    const endpoints: EndpointInfo[] = [];
    for (const filePath of candidates) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const controllerLabel = this.getControllerLabel(filePath, rootPath);
        endpoints.push(...this.parseContent(content, filePath, controllerLabel));
      } catch {
        // skip unreadable files
      }
    }

    return endpoints;
  }

  private getControllerLabel(filePath: string, rootPath: string): string {
    const base = path.basename(filePath);
    if (base.toLowerCase() === "main.py") {
      return path.basename(path.dirname(filePath));
    }
    return base.endsWith(".py") ? base.slice(0, -3) : base;
  }

  private parseContent(
    content: string,
    filePath: string,
    controllerLabel: string
  ): EndpointInfo[] {
    const endpoints: EndpointInfo[] = [];
    const lines = content.split("\n");

    // Support @app.get('/path') or @router.post("/path") etc., with ' or " (use two regexes)
    const routeRegexDouble = /@(app|router)\.(get|post|put|delete|patch|options|head)\(\s*"([^"]+)"/;
    const routeRegexSingle = /@(app|router)\.(get|post|put|delete|patch|options|head)\(\s*'([^']+)'/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match = line.match(routeRegexDouble) || line.match(routeRegexSingle);
      if (!match) continue;

      const method = match[2].toUpperCase();
      const routePath = match[3];

      // Find the def line within a few lines below the decorator
      let handler = "";
      let defLineIndex = -1;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const defMatch = lines[j].match(/\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
        if (defMatch) {
          handler = defMatch[1];
          defLineIndex = j;
          break;
        }
      }

      if (!handler) continue;

      endpoints.push({
        method,
        path: routePath,
        handler,
        filePath,
        lineNumber: defLineIndex >= 0 ? defLineIndex + 1 : i + 1,
        controller: controllerLabel,
        framework: "fastapi",
      });
    }

    return endpoints;
  }
}
