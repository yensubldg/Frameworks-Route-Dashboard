import * as vscode from "vscode";
import { ApiTreeProvider } from "./ApiTreeProvider";
import { EntityTreeProvider } from "./EntityTreeProvider";
import { NestParser } from "./parser/NestParser";
import { FastAPIParser } from "./parser/FastAPIParser";
import { ConfigurationManager } from "./ConfigurationManager";
import { EndpointHoverProvider } from "./providers/EndpointHoverProvider";
import { CopilotModelProvider } from "./providers/CopilotModelProvider";
import { StatisticsWebview } from "./views/StatisticsWebview";
import { MonorepoDetector } from "./parser/MonorepoDetector";
import { SwaggerParser } from "./parser/SwaggerParser";
import { Framework, FrameworkDetector } from "./parser/FrameworkDetector";
import { CombinedParser, Parser } from "./parser/Parser";

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
  const copilotModelProvider = new CopilotModelProvider();
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

  const copilotModelTreeView = vscode.window.createTreeView("copilotModel", {
    treeDataProvider: copilotModelProvider,
  });

  context.subscriptions.push(apiTreeView, entityTreeView, copilotModelTreeView);

  const hovers = languages.map((lang) =>
    vscode.languages.registerHoverProvider({ scheme: "file", language: lang }, hoverProvider)
  );
  context.subscriptions.push(...hovers);

  context.subscriptions.push(
    vscode.commands.registerCommand("frameworkRoutesDashboard.refresh", () => {
      apiTreeDataProvider.refresh();
      entityTreeDataProvider.refresh();
      copilotModelProvider.refresh();
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
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.configureCopilot",
      async () => {
        const items = [
          {
            label: "$(settings-gear) Open Extension Settings",
            description: "Configure GitHub Copilot integration",
            action: "settings",
          },
          {
            label: "$(extensions) Install GitHub Copilot",
            description: "Install the GitHub Copilot extension",
            action: "install",
          },
          {
            label: "$(question) Learn About GitHub Copilot",
            description: "Learn how GitHub Copilot enhances test generation",
            action: "learn",
          },
        ];

        const selection = await vscode.window.showQuickPick(items, {
          placeHolder:
            "Configure GitHub Copilot for intelligent test generation",
        });

        if (selection) {
          switch (selection.action) {
            case "settings":
              await vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "frameworkRoutesDashboard.useGitHubCopilot"
              );
              break;
            case "install":
              await vscode.commands.executeCommand(
                "workbench.extensions.search",
                "GitHub.copilot"
              );
              break;
            case "learn":
              await vscode.env.openExternal(
                vscode.Uri.parse("https://github.com/features/copilot")
              );
              break;
          }
        }
      }
    ),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.selectCopilotModel",
      async () => {
        try {
          if (!vscode.lm || !vscode.lm.selectChatModels) {
            vscode.window.showErrorMessage(
              "Language Model API is not available. Please update to VSCode 1.85.0 or higher and ensure GitHub Copilot extension is installed."
            );
            return;
          }

          let availableModels: any[] = [];

          try {
            availableModels = await vscode.lm.selectChatModels({
              vendor: "copilot",
            });
          } catch (initialError) {
            const choice = await vscode.window.showWarningMessage(
              "GitHub Copilot models not available. This might be because:\n" +
                "• GitHub Copilot extension is not installed\n" +
                "• You're not authenticated with GitHub Copilot\n" +
                "• GitHub Copilot is loading\n\n" +
                "Would you like to try again or configure GitHub Copilot?",
              "Try Again",
              "Configure Copilot",
              "Cancel"
            );

            if (choice === "Try Again") {
              try {
                await vscode.window.withProgress(
                  {
                    location: vscode.ProgressLocation.Notification,
                    title: "Checking GitHub Copilot models...",
                    cancellable: false,
                  },
                  async () => {
                    availableModels = await vscode.lm.selectChatModels({
                      vendor: "copilot",
                    });
                  }
                );
              } catch (retryError) {
                vscode.window.showErrorMessage(
                  "Still unable to access GitHub Copilot models. Please ensure GitHub Copilot extension is installed and you're authenticated."
                );
                return;
              }
            } else if (choice === "Configure Copilot") {
              await vscode.commands.executeCommand(
                "frameworkRoutesDashboard.configureCopilot"
              );
              return;
            } else {
              return;
            }
          }

          if (availableModels.length === 0) {
            vscode.window.showWarningMessage(
              "No GitHub Copilot models available. Please ensure GitHub Copilot extension is installed and authenticated."
            );
            return;
          }

          const currentModel = config.copilotModel;
          interface ModelQuickPickItem extends vscode.QuickPickItem {
            modelName?: string;
          }

          const modelOptions: ModelQuickPickItem[] = [
            {
              label: currentModel === "gpt-4o" ? "$(check) gpt-4o" : "gpt-4o",
              description: "Latest and most capable model (recommended)",
              detail: availableModels.some(
                (m) =>
                  m.id?.includes("gpt-4o") ||
                  m.family === "gpt-4o" ||
                  m.name?.includes("gpt-4o")
              )
                ? "✅ Available"
                : "❌ Not available",
              modelName: "gpt-4o",
            },
            {
              label: currentModel === "gpt-4" ? "$(check) gpt-4" : "gpt-4",
              description: "High quality, good for complex tasks",
              detail: availableModels.some(
                (m) =>
                  m.id?.includes("gpt-4") ||
                  m.family === "gpt-4" ||
                  m.name?.includes("gpt-4")
              )
                ? "✅ Available"
                : "❌ Not available",
              modelName: "gpt-4",
            },
            {
              label:
                currentModel === "gpt-3.5-turbo"
                  ? "$(check) gpt-3.5-turbo"
                  : "gpt-3.5-turbo",
              description: "Faster but less capable",
              detail: availableModels.some(
                (m) =>
                  m.id?.includes("gpt-3.5") ||
                  m.family === "gpt-3.5" ||
                  m.name?.includes("gpt-3.5")
              )
                ? "✅ Available"
                : "❌ Not available",
              modelName: "gpt-3.5-turbo",
            },
          ];

          const separators: ModelQuickPickItem[] = [
            { label: "", kind: vscode.QuickPickItemKind.Separator },
            {
              label: "Available Models:",
              kind: vscode.QuickPickItemKind.Separator,
            },
          ];

          const availableModelsList: ModelQuickPickItem[] = availableModels.map(
            (model) => ({
              label: `📋 ${
                model.id || model.family || model.name || "Unknown"
              }`,
              description: `Available model (info only)`,
              detail: `Family: ${model.family || "Unknown"}, Max tokens: ${
                model.maxInputTokens || "Unknown"
              }`,
            })
          );

          const allOptions: ModelQuickPickItem[] = [
            ...modelOptions,
            ...separators,
            ...availableModelsList,
          ];

          const selection = await vscode.window.showQuickPick(allOptions, {
            placeHolder: `Current model: ${currentModel}. Select a new model.`,
            ignoreFocusOut: true,
          });

          if (selection && selection.modelName) {
            await vscode.workspace
              .getConfiguration("frameworkRoutesDashboard")
              .update(
                "copilotModel",
                selection.modelName,
                vscode.ConfigurationTarget.Workspace
              );

            await vscode.workspace
              .getConfiguration("frameworkRoutesDashboard")
              .update(
                "copilotModel",
                selection.modelName,
                vscode.ConfigurationTarget.Global
              );

            copilotModelProvider.refresh();

            vscode.window.showInformationMessage(
              `GitHub Copilot model changed to: ${selection.modelName}`
            );
          }
        } catch (error) {
          console.error("Error in selectCopilotModel:", error);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to access GitHub Copilot: ${errorMessage}. Please ensure GitHub Copilot extension is installed and you're authenticated.`
          );
        }
      }
    )
  );

  const configWatcher = config.onConfigurationChanged(() => {
    apiTreeDataProvider.refresh();
    entityTreeDataProvider.refresh();
    copilotModelProvider.refresh();
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
