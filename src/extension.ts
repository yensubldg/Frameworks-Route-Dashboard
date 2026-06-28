import * as vscode from "vscode";
import { ApiTreeProvider } from "./ApiTreeProvider";
import { ConfigurationManager } from "./ConfigurationManager";
import { EntityTreeProvider } from "./EntityTreeProvider";
import { FastAPIParser } from "./parser/FastAPIParser";
import { FrameworkDetector } from "./parser/FrameworkDetector";
import { MonorepoDetector } from "./parser/MonorepoDetector";
import { NestParser } from "./parser/NestParser";
import { CombinedParser, EndpointInfo, Parser } from "./parser/Parser";
import { SwaggerParser } from "./parser/SwaggerParser";
import { EndpointHoverProvider } from "./providers/EndpointHoverProvider";
import { TestGenerator } from "./generators/TestGenerator";
import { OpenApiGenerator } from "./generators/OpenApiGenerator";
import { StatisticsWebview } from "./views/StatisticsWebview";

let hasInitialized = false;

type ControllerCommandNode = {
  type: "controller";
  name: string;
  endpoints: EndpointInfo[];
};

function isEndpointInfo(value: unknown): value is EndpointInfo {
  const endpoint = value as Partial<EndpointInfo> | undefined;
  return !!endpoint && typeof endpoint.method === "string" && typeof endpoint.path === "string";
}

function isControllerCommandNode(value: unknown): value is ControllerCommandNode {
  const node = value as Partial<ControllerCommandNode> | undefined;
  return !!node && node.type === "controller" && Array.isArray(node.endpoints);
}

function buildEndpointCurl(endpoint: EndpointInfo): string {
  const method = endpoint.method.toUpperCase();
  const normalizedPath = endpoint.path.startsWith("/") ? endpoint.path : "/" + endpoint.path;
  const parts = [
    "curl",
    "-X",
    method,
    JSON.stringify("http://localhost:3000" + normalizedPath),
  ];

  if (!endpoint.isPublic) {
    parts.push("-H", JSON.stringify("Authorization: Bearer <token>"));
  }

  if (["POST", "PUT", "PATCH"].includes(method)) {
    parts.push("-H", JSON.stringify("Content-Type: application/json"));
    const dtoHint = endpoint.inputDto ? "replace with " + endpoint.inputDto : "replace with request payload";
    parts.push("-d", JSON.stringify(JSON.stringify({ sample: dtoHint })));
  }

  return parts.join(" ");
}


function createOpenApiGenerator(
  parser: Parser,
  config: ConfigurationManager
): OpenApiGenerator {
  return new OpenApiGenerator(parser, {
    title: config.openApiTitle,
    version: config.openApiVersion,
    serverUrl: config.openApiServerUrl,
  });
}

function generateOpenApiJson(
  parser: Parser,
  config: ConfigurationManager
): string | undefined {
  const generator = createOpenApiGenerator(parser, config);
  const document = generator.generate();
  const paths = document.paths as Record<string, unknown> | undefined;

  if (!paths || Object.keys(paths).length === 0) {
    vscode.window.showWarningMessage(
      "No endpoints detected. Open a supported NestJS/FastAPI workspace or refresh the dashboard first."
    );
    return undefined;
  }

  return JSON.stringify(document, null, 2);
}
function buildEndpointMarkdown(endpoint: EndpointInfo): string {
  const lines = [
    "### " + endpoint.method.toUpperCase() + " " + endpoint.path,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Framework | " + (endpoint.framework || "unknown") + " |",
    "| Controller | " + (endpoint.controller || "default") + " |",
    "| Handler | " + endpoint.handler + " |",
    "| Access | " + (endpoint.isPublic ? "Public" : "Protected") + " |",
  ];

  if (endpoint.summary) lines.push("| Summary | " + endpoint.summary.replace(/\|/g, "\\|") + " |");
  if (endpoint.inputDto) lines.push("| Input DTO | " + endpoint.inputDto + " |");
  if (endpoint.outputDto) lines.push("| Output DTO | " + endpoint.outputDto + " |");
  if (endpoint.guards?.length) lines.push("| Guards | " + endpoint.guards.join(", ") + " |");
  if (endpoint.tags?.length) lines.push("| Tags | " + endpoint.tags.join(", ") + " |");

  return lines.join("\n");
}

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
  const testGenerator = new TestGenerator();

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
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.generateOpenApiSpec",
      async () => {
        const json = generateOpenApiJson(parser, config);
        if (!json) return;

        const defaultUri = vscode.workspace.workspaceFolders?.[0]
          ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, "openapi.json")
          : undefined;
        const target = await vscode.window.showSaveDialog({
          defaultUri,
          filters: {
            "OpenAPI JSON": ["json"],
          },
          saveLabel: "Generate OpenAPI Spec",
        });

        if (!target) return;

        await vscode.workspace.fs.writeFile(target, Buffer.from(json, "utf8"));
        const openChoice = await vscode.window.showInformationMessage(
          "OpenAPI spec generated successfully.",
          "Open File"
        );
        if (openChoice === "Open File") {
          const doc = await vscode.workspace.openTextDocument(target);
          await vscode.window.showTextDocument(doc);
        }
      }
    ),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.previewOpenApiSpec",
      async () => {
        const json = generateOpenApiJson(parser, config);
        if (!json) return;

        const doc = await vscode.workspace.openTextDocument({
          content: json,
          language: "json",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    ),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.copyOpenApiSpec",
      async () => {
        const json = generateOpenApiJson(parser, config);
        if (!json) return;

        await vscode.env.clipboard.writeText(json);
        vscode.window.showInformationMessage("OpenAPI spec copied to clipboard.");
      }
    ),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.generateTestForEndpoint",
      async (endpoint) => {
        if (!isEndpointInfo(endpoint)) {
          vscode.window.showErrorMessage("Select an endpoint from the API Endpoints tree first.");
          return;
        }
        if (!config.enableTestGeneration) {
          vscode.window.showInformationMessage("Test generation is disabled in Framework Routes Dashboard settings.");
          return;
        }
        await testGenerator.generateTestForEndpoint(endpoint);
      }
    ),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.generateTestsForController",
      async (controllerNode) => {
        if (!isControllerCommandNode(controllerNode) || controllerNode.endpoints.length === 0) {
          vscode.window.showErrorMessage("Select a controller from the API Endpoints tree first.");
          return;
        }
        if (!config.enableTestGeneration) {
          vscode.window.showInformationMessage("Test generation is disabled in Framework Routes Dashboard settings.");
          return;
        }
        await testGenerator.generateTestsForController(controllerNode.endpoints);
      }
    ),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.copyEndpointCurl",
      async (endpoint) => {
        if (!isEndpointInfo(endpoint)) {
          vscode.window.showErrorMessage("Select an endpoint from the API Endpoints tree first.");
          return;
        }
        await vscode.env.clipboard.writeText(buildEndpointCurl(endpoint));
        vscode.window.showInformationMessage("Endpoint cURL copied to clipboard.");
      }
    ),
    vscode.commands.registerCommand(
      "frameworkRoutesDashboard.copyEndpointMarkdown",
      async (endpoint) => {
        if (!isEndpointInfo(endpoint)) {
          vscode.window.showErrorMessage("Select an endpoint from the API Endpoints tree first.");
          return;
        }
        await vscode.env.clipboard.writeText(buildEndpointMarkdown(endpoint));
        vscode.window.showInformationMessage("Endpoint Markdown copied to clipboard.");
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
