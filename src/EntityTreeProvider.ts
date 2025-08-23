import * as vscode from "vscode";
import { Parser, EntityInfo, PropertyInfo } from "./parser/Parser";

type EntityNode = FrameworkNode | EntityInfo | PropertyInfo;

interface FrameworkNode {
  type: "framework";
  name: string; // "NestJS" | "FastAPI"
  key: "nestjs" | "fastapi";
  entities: EntityInfo[];
}

export class EntityTreeProvider implements vscode.TreeDataProvider<EntityNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    EntityNode | undefined | void
  > = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<EntityNode | undefined | void> =
    this._onDidChangeTreeData.event;

  private expandedEntities: Set<string> = new Set();

  constructor(private parser: Parser) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: EntityNode): vscode.TreeItem {
    if (this.isFrameworkNode(element)) {
      const totalProps = element.entities.reduce(
        (sum, e) => sum + (e.properties?.length || 0),
        0
      );
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = "framework";
      item.iconPath = new vscode.ThemeIcon(
        element.key === "nestjs" ? "server-environment" : "flame"
      );
      item.tooltip = `${element.name} (${element.entities.length} entities, ${totalProps} properties)`;
      return item;
    }

    if (this.isEntityInfo(element)) {
      const label = element.tableName
        ? `${element.name} (${element.tableName})`
        : element.name;

      // Check if this entity should be expanded
      const isExpanded = this.expandedEntities.has(element.name);
      const item = new vscode.TreeItem(
        label,
        isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = "entity";
      item.iconPath = new vscode.ThemeIcon(
        "symbol-class",
        new vscode.ThemeColor("symbolIcon.classForeground")
      );
      item.command = {
        command: "frameworkRoutesDashboard.expandAndOpenEntity",
        title: "Expand and Open Entity",
        arguments: [element],
      };
      item.tooltip = `Entity: ${element.name}${
        element.tableName ? ` (Table: ${element.tableName})` : ""
      }`;
      return item;
    } else {
      // PropertyInfo
      const decoratorText =
        element.decorators.length > 0
          ? ` @${element.decorators.join(", @")}`
          : "";
      const item = new vscode.TreeItem(
        `${element.name}: ${element.type}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = decoratorText;
      item.contextValue = "property";

      // Add property-specific icons based on decorators
      if (
        element.decorators.includes("PrimaryGeneratedColumn") ||
        element.decorators.includes("PrimaryColumn")
      ) {
        item.iconPath = new vscode.ThemeIcon(
          "key",
          new vscode.ThemeColor("charts.yellow")
        );
      } else if (element.decorators.includes("Column")) {
        item.iconPath = new vscode.ThemeIcon(
          "symbol-field",
          new vscode.ThemeColor("symbolIcon.fieldForeground")
        );
      } else if (
        element.decorators.includes("OneToMany") ||
        element.decorators.includes("ManyToOne") ||
        element.decorators.includes("OneToOne") ||
        element.decorators.includes("ManyToMany")
      ) {
        item.iconPath = new vscode.ThemeIcon(
          "references",
          new vscode.ThemeColor("charts.blue")
        );
      } else {
        item.iconPath = new vscode.ThemeIcon(
          "symbol-property",
          new vscode.ThemeColor("symbolIcon.propertyForeground")
        );
      }

      return item;
    }
  }

  getChildren(element?: EntityNode): Thenable<EntityNode[]> {
    if (!element) {
      const entities = this.parser.parseEntities ? this.parser.parseEntities() : [];

      // Group by framework
      const byFramework = new Map<"nestjs" | "fastapi", EntityInfo[]>();
      entities.forEach((e) => {
        const fw = (e.framework || "nestjs") as "nestjs" | "fastapi"; // default nestjs
        const list = byFramework.get(fw) || [];
        list.push(e);
        byFramework.set(fw, list);
      });

      const frameworks: FrameworkNode[] = [];
      byFramework.forEach((ents, fwKey) => {
        frameworks.push({
          type: "framework",
          name: fwKey === "nestjs" ? "NestJS" : "FastAPI",
          key: fwKey,
          entities: ents,
        });
      });

      if (frameworks.length > 1) {
        return Promise.resolve(frameworks);
      }
      if (frameworks.length === 1) {
        return Promise.resolve(frameworks[0].entities);
      }
      return Promise.resolve([]);
    } else if (this.isFrameworkNode(element)) {
      return Promise.resolve(element.entities);
    } else if (this.isEntityInfo(element)) {
      return Promise.resolve(element.properties);
    } else {
      return Promise.resolve([]);
    }
  }

  private isFrameworkNode(element: EntityNode): element is FrameworkNode {
    return (element as any).type === "framework";
  }

  private isEntityInfo(element: EntityNode): element is EntityInfo {
    return (element as EntityInfo).properties !== undefined;
  }

  expandAndOpenEntity(entity: EntityInfo): void {
    // Add to expanded entities set
    this.expandedEntities.add(entity.name);
    // Refresh the tree to show the expanded state
    this.refresh();
  }
}
