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

    const config = vscode.workspace.getConfiguration("frameworkRoutesDashboard");
    const monorepoMode = config.get<boolean>("monorepoMode", false);
    const selectedApp = config.get<string>("selectedApp", "");

    const candidates = new Set<string>();
    const patterns = monorepoMode && selectedApp
      ? [
          selectedApp + "/**/main.py",
          selectedApp + "/app/**/*.py",
          selectedApp + "/src/**/*.py",
          selectedApp + "/**/*.py",
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

    for (let i = 0; i < lines.length; i++) {
      const decorator = this.readRouteDecorator(lines, i);
      if (!decorator) continue;

      const defLineIndex = this.findHandlerLine(lines, decorator.endLine + 1);
      if (defLineIndex === -1) continue;

      const handlerMatch = lines[defLineIndex].match(/\b(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (!handlerMatch) continue;

      const method = decorator.method.toUpperCase();
      const handler = handlerMatch[1];
      const statusCode = this.extractStatusCode(decorator.text);
      const responseType = this.extractIdentifierOption(decorator.text, "response_model");

      endpoints.push({
        method,
        path: decorator.routePath,
        handler,
        filePath,
        lineNumber: defLineIndex + 1,
        controller: controllerLabel,
        framework: "fastapi",
        summary: this.extractStringOption(decorator.text, "summary"),
        description: this.extractStringOption(decorator.text, "description"),
        tags: this.extractTags(decorator.text),
        responseType,
        outputDto: responseType,
        statusCodes: statusCode ? [statusCode] : [],
        deprecated: this.extractBooleanOption(decorator.text, "deprecated"),
        operationId: controllerLabel + "_" + handler,
      });

      i = decorator.endLine;
    }

    return endpoints;
  }

  private readRouteDecorator(
    lines: string[],
    startLine: number
  ): { text: string; endLine: number; method: string; routePath: string } | null {
    const firstLine = lines[startLine];
    const routeStartMatch = firstLine.match(/@(app|router)\.(get|post|put|delete|patch|options|head)\s*\(/);
    if (!routeStartMatch) return null;

    const parts: string[] = [];
    let depth = 0;
    let hasOpened = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      parts.push(line);

      for (const char of line) {
        if (char === "(") {
          depth++;
          hasOpened = true;
        } else if (char === ")") {
          depth--;
        }
      }

      if (hasOpened && depth <= 0) {
        const text = parts.join("\n");
        const pathMatch = text.match(/@(app|router)\.(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']/);
        if (!pathMatch) return null;

        return {
          text,
          endLine: i,
          method: pathMatch[2],
          routePath: pathMatch[3],
        };
      }
    }

    return null;
  }

  private findHandlerLine(lines: string[], startLine: number): number {
    for (let i = startLine; i < Math.min(startLine + 8, lines.length); i++) {
      if (/\b(?:async\s+)?def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(lines[i])) {
        return i;
      }
    }
    return -1;
  }

  private extractStringOption(text: string, optionName: string): string | undefined {
    const match = text.match(new RegExp(optionName + "\\s*=\\s*[\'\"]([^\'\"]+)[\'\"]"));
    return match?.[1];
  }

  private extractIdentifierOption(text: string, optionName: string): string | undefined {
    const match = text.match(new RegExp(optionName + "\\s*=\\s*([A-Za-z_][A-Za-z0-9_.$]*)"));
    return match ? match[1].split(".").pop() : undefined;
  }

  private extractBooleanOption(text: string, optionName: string): boolean | undefined {
    const match = text.match(new RegExp(optionName + "\\s*=\\s*(True|False|true|false)"));
    if (!match) return undefined;
    return match[1].toLowerCase() === "true";
  }

  private extractStatusCode(text: string): number | undefined {
    const directMatch = text.match(/status_code\s*=\s*(\d+)/);
    if (directMatch) return Number(directMatch[1]);

    const constantMatch = text.match(/status_code\s*=\s*(?:status\.)?HTTP_(\d{3})/);
    return constantMatch ? Number(constantMatch[1]) : undefined;
  }

  private extractTags(text: string): string[] {
    const tagsMatch = text.match(/tags\s*=\s*\[([^\]]+)\]/s);
    if (!tagsMatch) return [];

    const tagMatches = tagsMatch[1].match(/["']([^"']+)["']/g) || [];
    return tagMatches.map((tag) => tag.slice(1, -1));
  }
}
