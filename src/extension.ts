import * as vscode from "vscode";
import { ApiTreeProvider } from "./ApiTreeProvider";
import { ConfigurationManager } from "./ConfigurationManager";
import { EntityTreeProvider } from "./EntityTreeProvider";
import { FastAPIParser } from "./parser/FastAPIParser";
import { FrameworkDetector } from "./parser/FrameworkDetector";
import { MonorepoDetector } from "./parser/MonorepoDetector";
import { NestParser } from "./parser/NestParser";
import { CombinedParser, Parser } from "./parser/Parser";
import { SwaggerParser } from "./parser/SwaggerParser";
import { EndpointHoverProvider } from "./providers/EndpointHoverProvider";
import { StatisticsWebview } from "./views/StatisticsWebview";

let hasInitialized = false;

export function activate(context: vscode.ExtensionContext) {
  if (hasInitialized) {
    return;
  }
  hasInitialized = true;
  const config = ConfigurationManager.getInstance();
  const frameworks = FrameworkDetector.detectAllFrameworks();

  let parser: Parser;
  let languages: string[] = [];

  if (frameworks.length === 0) {
    vscode.window.showInformationMessage(
      "No supported framework detected (NestJS or FastAPI). The dashboard will be shown but may be empty until a supported project is opened."
    );
    parser = new CombinedParser([new NestParser(), new FastAPIParser()]);
    languages = ["typescript", "python"];
  } else if (frameworks.length === 1) {
    if (frameworks[0] === "nestjs") {
      parser = new NestParser();
      languages = ["typescript"];
    } else {
      parser = new FastAPIParser();
      languages = ["python"];
    }
  } else {
    // Multiple frameworks detected, combine parsers
    const parsers = [] as Parser[];
    if (frameworks.includes("nestjs")) parsers.push(new NestParser());
    if (frameworks.includes("fastapi")) parsers.push(new FastAPIParser());
    parser = new CombinedParser(parsers);
    languages = ["typescript", "python"];
  }

  const monorepoDetector = new MonorepoDetector();
  const apiTreeDataProvider = new ApiTreeProvider(parser);
  const entityTreeDataProvider = new EntityTreeProvider(parser);
  const hoverProvider = new EndpointHoverProvider(parser);
  const statisticsWebview = new StatisticsWebview(context, parser);
  const swaggerParser = new SwaggerParser();

  // Register tree views using createTreeView for better control
  const apiTreeView = vscode.window.createTreeView("apiEndpoints", {
    treeDataProvider: apiTreeDataProvider,
    showCollapseAll: true,
  });

  const entityTreeView = vscode.window.createTreeView("entities", {
    treeDataProvider: entityTreeDataProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(apiTreeView, entityTreeView);

  const hovers = languages.map((lang) =>
    vscode.languages.registerHoverProvider({ scheme: "file", language: lang }, hoverProvider)
  );
  context.subscriptions.push(...hovers);

  context.subscriptions.push(
    vscode.commands.registerCommand("frameworkRoutesDashboard.refresh", () => {
      apiTreeDataProvider.refresh();
      entityTreeDataProvider.refresh();
      hoverProvider.refreshCache();
    }),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.openEndpoint",
      (endpoint) => {
        if (endpoint && endpoint.filePath && endpoint.lineNumber) {
          const uri = vscode.Uri.file(endpoint.filePath);
          vscode.window.showTextDocument(uri).then((editor) => {
            const position = new vscode.Position(endpoint.lineNumber - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
          });
        }
      }
    ),
    vscode.commands.registerCommand("frameworkRoutesDashboard.openEntity", (entity) => {
      if (entity && entity.filePath && entity.lineNumber) {
        const uri = vscode.Uri.file(entity.filePath);
        vscode.window.showTextDocument(uri).then((editor) => {
          const position = new vscode.Position(entity.lineNumber - 1, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position));
        });
      }
    }),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.expandAndOpenEntity",
      async (entity) => {
        if (entity && entity.filePath && entity.lineNumber) {
          entityTreeDataProvider.expandAndOpenEntity(entity);

          const uri = vscode.Uri.file(entity.filePath);
          await vscode.window.showTextDocument(uri).then((editor) => {
            const position = new vscode.Position(entity.lineNumber - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
          });
        }
      }
    ),
    vscode.commands.registerCommand("frameworkRoutesDashboard.showStatistics", () => {
      statisticsWebview.show();
    }),
    vscode.commands.registerCommand("frameworkRoutesDashboard.selectApp", async () => {
      if (monorepoDetector.isMonorepo()) {
        const selectedApp = await monorepoDetector.selectApp();
        if (selectedApp !== undefined) {
          await config.updateSelectedApp(selectedApp);
          apiTreeDataProvider.refresh();
          entityTreeDataProvider.refresh();
          hoverProvider.refreshCache();
          vscode.window.showInformationMessage(
            selectedApp ? `Switched to app: ${selectedApp}` : "Showing all apps"
          );
        }
      } else {
        vscode.window.showInformationMessage("This is not a monorepo project");
      }
    }),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.toggleMonorepoMode",
      async () => {
        const currentMode = config.monorepoMode;
        await config.updateMonorepoMode(!currentMode);
        apiTreeDataProvider.refresh();
        entityTreeDataProvider.refresh();
        vscode.window.showInformationMessage(
          `Monorepo mode ${!currentMode ? "enabled" : "disabled"}`
        );
      }
    ),
    vscode.commands.registerCommand("frameworkRoutesDashboard.openSwagger", async () => {
      if (config.enableSwaggerIntegration) {
        await swaggerParser.openSwaggerUI();
      } else {
        vscode.window.showErrorMessage(
          "Swagger integration is disabled in settings"
        );
      }
    }),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.createSwaggerSetup",
      async () => {
        await swaggerParser.createSwaggerSetup();
      }
    ),
  );

  const configWatcher = config.onConfigurationChanged(() => {
    apiTreeDataProvider.refresh();
    entityTreeDataProvider.refresh();
    hoverProvider.refreshCache();
  });
  context.subscriptions.push(configWatcher);

  const watcher = vscode.workspace.createFileSystemWatcher(
    `**/*.{ts,py}`
  );
  const refreshAll = () => {
    apiTreeDataProvider.refresh();
    entityTreeDataProvider.refresh();
    hoverProvider.refreshCache();
  };

  watcher.onDidChange(refreshAll);
  watcher.onDidCreate(refreshAll);
  watcher.onDidDelete(refreshAll);
  context.subscriptions.push(watcher);

  console.log(
    'Congratulations, your extension "framework-routes-dashboard" is now active!'
  );
}

export function deactivate() {}
