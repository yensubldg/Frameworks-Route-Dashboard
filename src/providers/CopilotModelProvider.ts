import * as vscode from "vscode";
import { ConfigurationManager } from "../ConfigurationManager";

interface ModelItem {
  type: "currentModel" | "changeModel";
  label: string;
  description?: string;
}

export class CopilotModelProvider
  implements vscode.TreeDataProvider<ModelItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ModelItem | undefined | void
  > = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<ModelItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private configManager: ConfigurationManager;

  constructor() {
    this.configManager = ConfigurationManager.getInstance();

    // Listen for configuration changes
    this.configManager.onConfigurationChanged(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ModelItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );

    if (element.type === "currentModel") {
      item.iconPath = new vscode.ThemeIcon("robot");
      item.description = element.description;
      item.contextValue = "currentModel";
      item.tooltip = `Current GitHub Copilot model: ${element.description}`;
    } else if (element.type === "changeModel") {
      item.iconPath = new vscode.ThemeIcon("settings-gear");
      item.contextValue = "changeModel";
      item.command = {
        command: "frameworkRoutesDashboard.selectCopilotModel",
        title: "Select Copilot Model",
        arguments: [],
      };
      item.tooltip = "Click to change GitHub Copilot model";
    }

    return item;
  }

  getChildren(element?: ModelItem): Thenable<ModelItem[]> {
    if (!element) {
      const currentModel = this.configManager.copilotModel;
      const isEnabled = this.configManager.useGitHubCopilot;

      if (!isEnabled) {
        return Promise.resolve([
          {
            type: "currentModel",
            label: "GitHub Copilot Disabled",
            description: "Enable in settings",
          },
        ]);
      }

      const items: ModelItem[] = [
        {
          type: "currentModel",
          label: "Current Model",
          description: currentModel,
        },
        {
          type: "changeModel",
          label: "Change Model",
          description: "Select different model",
        },
      ];

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }
}
