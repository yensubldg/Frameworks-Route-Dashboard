import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { MonorepoInfo } from "./NestParser";

export class MonorepoDetector {
  private rootPath: string;

  constructor() {
    const folders = vscode.workspace.workspaceFolders;
    this.rootPath = folders?.[0]?.uri.fsPath || "";
  }

  public detectMonorepo(): MonorepoInfo {
    const apps: string[] = [];
    const libs: string[] = [];

    // Check for apps directory
    const appsPath = path.join(this.rootPath, "apps");
    if (fs.existsSync(appsPath)) {
      try {
        const appDirs = fs
          .readdirSync(appsPath, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);
        apps.push(...appDirs);
      } catch (error) {
        console.warn("Error reading apps directory:", error);
      }
    }

    // Check for libs directory
    const libsPath = path.join(this.rootPath, "libs");
    if (fs.existsSync(libsPath)) {
      try {
        const libDirs = fs
          .readdirSync(libsPath, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);
        libs.push(...libDirs);
      } catch (error) {
        console.warn("Error reading libs directory:", error);
      }
    }

    return { apps, libs };
  }

  public isMonorepo(): boolean {
    const info = this.detectMonorepo();
    if (info.apps.length > 0 || info.libs.length > 0) {
      return true;
    }
    // Also treat as multi-project if we can detect multiple Python FastAPI apps
    const pyApps = this.findPythonApps();
    return pyApps.length > 0;
  }

  public getAppPackageInfo(
    appName: string
  ): { name: string; version: string; description?: string } | null {
    const packageJsonPath = path.join(
      this.rootPath,
      "apps",
      appName,
      "package.json"
    );

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageContent = fs.readFileSync(packageJsonPath, "utf8");
        const packageJson = JSON.parse(packageContent);
        return {
          name: packageJson.name || appName,
          version: packageJson.version || "1.0.0",
          description: packageJson.description,
        };
      } catch (error) {
        console.warn(`Error reading package.json for app ${appName}:`, error);
      }
    }

    return { name: appName, version: "1.0.0" };
  }

  public getLibPackageInfo(
    libName: string
  ): { name: string; version: string; description?: string } | null {
    const packageJsonPath = path.join(
      this.rootPath,
      "libs",
      libName,
      "package.json"
    );

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageContent = fs.readFileSync(packageJsonPath, "utf8");
        const packageJson = JSON.parse(packageContent);
        return {
          name: packageJson.name || libName,
          version: packageJson.version || "1.0.0",
          description: packageJson.description,
        };
      } catch (error) {
        console.warn(`Error reading package.json for lib ${libName}:`, error);
      }
    }

    return { name: libName, version: "1.0.0" };
  }

  public getSearchPatterns(selectedApp?: string): string[] {
    if (!this.isMonorepo()) {
      return ["src/**/*.ts"];
    }

    const patterns: string[] = [];

    if (selectedApp) {
      // Focus on specific app
      patterns.push(`apps/${selectedApp}/**/*.ts`);
      patterns.push("libs/**/*.ts"); // Always include libs for dependencies
    } else {
      // Include all apps and libs
      patterns.push("apps/**/*.ts");
      patterns.push("libs/**/*.ts");
      patterns.push("src/**/*.ts"); // Fallback for mixed structures
    }

    return patterns;
  }

  public getAvailableApps(): Array<{
    name: string;
    displayName: string;
    path: string;
  }> {
    const monorepoInfo = this.detectMonorepo();
    const tsApps = monorepoInfo.apps.map((appName) => {
      const packageInfo = this.getAppPackageInfo(appName);
      return {
        name: appName,
        displayName: packageInfo?.description
          ? `${appName} (${packageInfo.description})`
          : appName,
        path: path.join("apps", appName),
      };
    });

    const pyApps = this.findPythonApps();

    return [...tsApps, ...pyApps];
  }

  public getAvailableLibs(): Array<{
    name: string;
    displayName: string;
    path: string;
  }> {
    const monorepoInfo = this.detectMonorepo();

    return monorepoInfo.libs.map((libName) => {
      const packageInfo = this.getLibPackageInfo(libName);
      return {
        name: libName,
        displayName: packageInfo?.description
          ? `${libName} (${packageInfo.description})`
          : libName,
        path: path.join("libs", libName),
      };
    });
  }

  public async selectApp(): Promise<string | undefined> {
    const availableApps = this.getAvailableApps();

    if (availableApps.length === 0) {
      vscode.window.showInformationMessage(
        "No apps found in monorepo structure"
      );
      return undefined;
    }

    if (availableApps.length === 1) {
      return availableApps[0].name;
    }

    const items = [
      {
        label: "All Apps",
        description: "Show endpoints from all applications",
      },
      ...availableApps.map((app) => ({
        label: app.name,
        description: app.displayName,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select application to focus on",
    });

    return selected?.label === "All Apps" ? undefined : selected?.label;
  }

  private findPythonApps(): Array<{
    name: string;
    displayName: string;
    path: string;
  }> {
    const results: Array<{ name: string; displayName: string; path: string }> = [];
    try {
      const subdirs = fs
        .readdirSync(this.rootPath, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const dirent of subdirs) {
        const dirPath = path.join(this.rootPath, dirent.name);
        // Skip known non-project folders
        if (["node_modules", "libs", "apps", ".git", ".venv", "venv", "env"].includes(dirent.name)) {
          continue;
        }

        const candidates = [
          path.join(dirPath, "main.py"),
          path.join(dirPath, "app", "main.py"),
          path.join(dirPath, "src", "main.py"),
        ];

        let isFastAPIApp = false;
        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            try {
              const content = fs.readFileSync(cand, "utf-8");
              if (/from\s+fastapi\s+import\s+FastAPI|import\s+fastapi/i.test(content)) {
                isFastAPIApp = true;
                break;
              }
            } catch {}
          }
        }

        if (!isFastAPIApp) {
          // Heuristic: search a few files for route decorators
          try {
            const files = fs
              .readdirSync(dirPath)
              .filter((f) => f.endsWith(".py"))
              .slice(0, 10);
            for (const f of files) {
              const content = fs.readFileSync(path.join(dirPath, f), "utf-8");
              if (/@(app|router)\.(get|post|put|delete|patch)/i.test(content)) {
                isFastAPIApp = true;
                break;
              }
            }
          } catch {}
        }

        if (isFastAPIApp) {
          results.push({
            name: dirent.name,
            displayName: `${dirent.name} (FastAPI)`,
            path: dirent.name,
          });
        }
      }
    } catch {}

    return results;
  }
}
