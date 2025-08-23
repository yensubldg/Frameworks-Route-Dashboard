import * as vscode from "vscode";
import { Parser, EndpointInfo } from "./parser/Parser";

type ApiNode = FrameworkNode | ControllerNode | EndpointInfo;

interface FrameworkNode {
  type: "framework";
  name: string; // "NestJS" | "FastAPI"
  key: "nestjs" | "fastapi";
  controllers: ControllerNode[];
}

interface ControllerNode {
  type: "controller";
  name: string;
  endpoints: EndpointInfo[];
}

export class ApiTreeProvider implements vscode.TreeDataProvider<ApiNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    ApiNode | undefined | void
  > = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<ApiNode | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private parser: Parser) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ApiNode): vscode.TreeItem {
    if (this.isFrameworkNode(element)) {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = "framework";
      item.iconPath = new vscode.ThemeIcon(
        element.key === "nestjs" ? "server-environment" : "flame"
      );
      item.tooltip = `${element.name} (${element.controllers.reduce(
        (sum, c) => sum + c.endpoints.length,
        0
      )} endpoints)`;
      return item;
    } else if (this.isControllerNode(element)) {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = "controller";
      item.iconPath = new vscode.ThemeIcon(
        "symbol-class",
        new vscode.ThemeColor("symbolIcon.classForeground")
      );
      item.tooltip = `${element.name} (${element.endpoints.length} endpoints)`;

      return item;
    } else if (this.isEndpointNode(element)) {
      const label = `${element.method} ${element.path}`;
      const item = new vscode.TreeItem(
        label,
        vscode.TreeItemCollapsibleState.None
      );

      // Keep summary in description if it exists
      if (element.summary) {
        item.description = element.summary;
      }

      item.contextValue = "endpoint";
      item.tooltip = `${element.method} ${element.path}`;

      // Add command for click action
      item.command = {
        command: "frameworkRoutesDashboard.openEndpoint",
        title: "Open Endpoint",
        arguments: [element],
      };

      // Add method-specific icons
      switch (element.method.toUpperCase()) {
        case "GET":
          item.iconPath = new vscode.ThemeIcon(
            "arrow-down",
            new vscode.ThemeColor("charts.blue")
          );
          break;
        case "POST":
          item.iconPath = new vscode.ThemeIcon(
            "add",
            new vscode.ThemeColor("charts.green")
          );
          break;
        case "PUT":
          item.iconPath = new vscode.ThemeIcon(
            "edit",
            new vscode.ThemeColor("charts.orange")
          );
          break;
        case "PATCH":
          item.iconPath = new vscode.ThemeIcon(
            "diff-modified",
            new vscode.ThemeColor("charts.yellow")
          );
          break;
        case "DELETE":
          item.iconPath = new vscode.ThemeIcon(
            "trash",
            new vscode.ThemeColor("charts.red")
          );
          break;
        case "OPTIONS":
          item.iconPath = new vscode.ThemeIcon(
            "settings-gear",
            new vscode.ThemeColor("charts.purple")
          );
          break;
        case "HEAD":
          item.iconPath = new vscode.ThemeIcon(
            "info",
            new vscode.ThemeColor("charts.foreground")
          );
          break;
        default:
          item.iconPath = new vscode.ThemeIcon(
            "globe",
            new vscode.ThemeColor("charts.foreground")
          );
          break;
      }

      return item;
    } else {
      // Fallback for unknown node types
      return new vscode.TreeItem(
        "Unknown",
        vscode.TreeItemCollapsibleState.None
      );
    }
  }

  getChildren(element?: ApiNode): Thenable<ApiNode[]> {
    if (!element) {
      const endpoints = this.parser.parseEndpoints();

      // Group endpoints by framework and then by controller
      const byFramework = new Map<"nestjs" | "fastapi", Map<string, EndpointInfo[]>>();
      endpoints.forEach((ep: EndpointInfo) => {
        const fw = (ep.framework || "nestjs") as "nestjs" | "fastapi"; // default to nestjs for backward compat
        if (!byFramework.has(fw)) byFramework.set(fw, new Map());
        const controllers = byFramework.get(fw)!;
        const controller = ep.controller || "default";
        const list = controllers.get(controller) || [];
        list.push(ep);
        controllers.set(controller, list);
      });

      const frameworks: FrameworkNode[] = [];
      byFramework.forEach((controllers, fwKey) => {
        const controllerNodes: ControllerNode[] = [];
        controllers.forEach((eps, name) => {
          controllerNodes.push({ type: "controller", name, endpoints: eps });
        });
        frameworks.push({
          type: "framework",
          name: fwKey === "nestjs" ? "NestJS" : "FastAPI",
          key: fwKey,
          controllers: controllerNodes,
        });
      });

      if (frameworks.length > 1) {
        return Promise.resolve(frameworks);
      }

      // Single framework: return just controllers for a flatter tree
      if (frameworks.length === 1) {
        return Promise.resolve(frameworks[0].controllers);
      }

      return Promise.resolve([]);
    } else if (this.isFrameworkNode(element)) {
      return Promise.resolve(element.controllers);
    } else if (this.isControllerNode(element)) {
      return Promise.resolve(element.endpoints);
    } else {
      return Promise.resolve([]);
    }
  }

  private isFrameworkNode(element: ApiNode): element is FrameworkNode {
    return (element as any).type === "framework";
  }

  private isControllerNode(element: ApiNode): element is ControllerNode {
    return (element as any).type === "controller";
  }

  private isEndpointNode(element: ApiNode): element is EndpointInfo {
    return (
      (element as any).type !== "controller" &&
      (element as any).type !== "framework" &&
      Object.prototype.hasOwnProperty.call(element, "method")
    );
  }
}
