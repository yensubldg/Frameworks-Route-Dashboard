import * as vscode from "vscode";
import { Parser, EndpointInfo, EntityInfo } from "../parser/Parser";

export interface StatisticsData {
  endpoints: {
    total: number;
    byMethod: Record<string, number>;
    byController: Record<string, number>;
    byModule: Record<string, number>;
    publicVsPrivate: { public: number; private: number };
  };
  entities: {
    total: number;
    totalProperties: number;
    byModule: Record<string, number>;
    mostUsedTypes: Record<string, number>;
    relationshipCount: number;
  };
  overview: {
    controllers: number;
    averageEndpointsPerController: number;
    averagePropertiesPerEntity: number;
    codebaseHealth: "Excellent" | "Good" | "Needs Attention";
  };
}

export class StatisticsWebview {
  private panel: vscode.WebviewPanel | undefined;
  private parser: Parser;

  constructor(private context: vscode.ExtensionContext, parser: Parser) {
    this.parser = parser;
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "frameworkStatistics",
      "Framework Statistics",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    // Use built-in VSCode graph icon for statistics
    this.panel.iconPath = vscode.Uri.parse(
      "data:image/svg+xml;base64," +
        Buffer.from(
          `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
        <path fill="#007ACC" d="M1 11l4-4 3 3 7-7v2l-7 7-3-3-4 4zm14-8v4h-1V4h-3V3h4z"/>
      </svg>
    `
        ).toString("base64")
    );

    this.updateWebviewContent();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "refresh":
          this.updateWebviewContent();
          break;
      }
    });
  }

  private generateStatistics(): StatisticsData {
    const endpoints = this.parser.parseEndpoints();
    const entities = this.parser.parseEntities ? this.parser.parseEntities() : [];

    // Endpoint statistics
    const endpointsByMethod: Record<string, number> = {};
    const endpointsByController: Record<string, number> = {};
    const endpointsByModule: Record<string, number> = {};
    let publicCount = 0;
    let privateCount = 0;

    endpoints.forEach((endpoint) => {
      // By method
      endpointsByMethod[endpoint.method] =
        (endpointsByMethod[endpoint.method] || 0) + 1;

      // By controller
      const controller = endpoint.controller || "default";
      endpointsByController[controller] =
        (endpointsByController[controller] || 0) + 1;

      // By module
      const module = (endpoint as any).module || "main";
      endpointsByModule[module] = (endpointsByModule[module] || 0) + 1;

      // Public vs Private
      if ((endpoint as any).isPublic) {
        publicCount++;
      } else {
        privateCount++;
      }
    });

    // Entity statistics
    const entitiesByModule: Record<string, number> = {};
    const propertyTypes: Record<string, number> = {};
    let totalProperties = 0;
    let relationshipCount = 0;

    entities.forEach((entity) => {
      const module = entity.module || "main";
      entitiesByModule[module] = (entitiesByModule[module] || 0) + 1;

      totalProperties += entity.properties.length;

      entity.properties.forEach((prop) => {
        // Count property types
        const type = prop.type.replace(/\[\]|\?/g, ""); // Clean array and optional markers
        propertyTypes[type] = (propertyTypes[type] || 0) + 1;

        // Count relationships
        if (
          prop.decorators.some(
            (d) => d.includes("ToMany") || d.includes("ToOne")
          )
        ) {
          relationshipCount++;
        }
      });
    });

    // Overview calculations
    const controllers = Object.keys(endpointsByController).length;
    const averageEndpointsPerController =
      controllers > 0 ? endpoints.length / controllers : 0;
    const averagePropertiesPerEntity =
      entities.length > 0 ? totalProperties / entities.length : 0;

    // Simple health metric based on various factors
    let healthScore = 100;
    if (averageEndpointsPerController > 20) healthScore -= 20; // Too many endpoints per controller
    if (averagePropertiesPerEntity > 30) healthScore -= 15; // Too many properties per entity
    if (endpoints.length > 0 && publicCount / endpoints.length > 0.8)
      healthScore -= 10; // Too many public endpoints

    const codebaseHealth: "Excellent" | "Good" | "Needs Attention" =
      healthScore >= 80
        ? "Excellent"
        : healthScore >= 60
        ? "Good"
        : "Needs Attention";

    return {
      endpoints: {
        total: endpoints.length,
        byMethod: endpointsByMethod,
        byController: endpointsByController,
        byModule: endpointsByModule,
        publicVsPrivate: { public: publicCount, private: privateCount },
      },
      entities: {
        total: entities.length,
        totalProperties,
        byModule: entitiesByModule,
        mostUsedTypes: propertyTypes,
        relationshipCount,
      },
      overview: {
        controllers,
        averageEndpointsPerController:
          Math.round(averageEndpointsPerController * 10) / 10,
        averagePropertiesPerEntity:
          Math.round(averagePropertiesPerEntity * 10) / 10,
        codebaseHealth,
      },
    };
  }

  private updateWebviewContent(): void {
    if (!this.panel) return;

    const stats = this.generateStatistics();
    this.panel.webview.html = this.getWebviewContent(stats);
  }

  private getWebviewContent(stats: StatisticsData): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Framework Statistics</title>
    <style>
        :root {
            --gradient-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --gradient-secondary: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            --gradient-success: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            --gradient-warning: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
            --shadow-light: 0 4px 6px rgba(0, 0, 0, 0.1);
            --shadow-medium: 0 8px 25px rgba(0, 0, 0, 0.15);
            --border-radius: 12px;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            color: var(--vscode-editor-foreground, #cccccc);
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, rgba(103, 126, 234, 0.05) 100%);
            margin: 0;
            padding: 0;
            line-height: 1.6;
            min-height: 100vh;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: var(--gradient-primary);
            color: white;
            padding: 30px;
            border-radius: var(--border-radius);
            margin-bottom: 30px;
            box-shadow: var(--shadow-medium);
            position: relative;
            overflow: hidden;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .header::before {
            content: '';
            position: absolute;
            top: -50%;
            right: -50%;
            width: 100%;
            height: 100%;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
            animation: float 6s ease-in-out infinite;
        }

        @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-20px) rotate(180deg); }
        }

        .header h1 {
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            position: relative;
            z-index: 1;
        }

        .refresh-btn {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: 2px solid rgba(255, 255, 255, 0.3);
            padding: 12px 24px;
            border-radius: 25px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
            position: relative;
            z-index: 1;
        }

        .refresh-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            border-color: rgba(255, 255, 255, 0.5);
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.2);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 25px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: var(--border-radius);
            padding: 25px;
            box-shadow: var(--shadow-light);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: var(--gradient-primary);
        }

        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-medium);
        }

        .stat-card h3 {
            margin: 0 0 20px 0;
            color: var(--vscode-textLink-foreground, #0078d4);
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 1.3em;
            font-weight: 600;
        }

        .card-icon {
            width: 32px;
            height: 32px;
            background: var(--gradient-primary);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 16px;
        }

        .stat-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 12px 0;
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            transition: all 0.2s ease;
        }

        .stat-item:hover {
            background: rgba(103, 126, 234, 0.05);
            margin: 12px -15px;
            padding: 8px 15px;
            border-radius: 6px;
            border-bottom: 1px solid transparent;
        }

        .stat-value {
            font-weight: bold;
            color: var(--vscode-textLink-activeForeground, #ffffff);
            font-size: 1.1em;
        }

        .chart-container {
            margin: 20px 0;
            height: 220px;
            display: flex;
            align-items: end;
            gap: 12px;
            padding: 20px;
            background: linear-gradient(135deg, var(--vscode-editor-inactiveSelectionBackground) 0%, rgba(103, 126, 234, 0.05) 100%);
            border-radius: var(--border-radius);
            position: relative;
            overflow: hidden;
        }

        .chart-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: repeating-linear-gradient(
                90deg,
                transparent,
                transparent 10px,
                rgba(255,255,255,0.02) 10px,
                rgba(255,255,255,0.02) 20px
            );
        }

        .chart-bar {
            min-width: 30px;
            border-radius: 6px 6px 0 0;
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            transition: all 0.3s ease;
            cursor: pointer;
        }

        .chart-bar:hover {
            transform: scale(1.05);
            filter: brightness(1.2);
        }

        .chart-bar.method-get { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
        .chart-bar.method-post { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); }
        .chart-bar.method-put { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); }
        .chart-bar.method-patch { background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); }
        .chart-bar.method-delete { background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%); }

        .chart-label {
            font-size: 11px;
            margin-top: 8px;
            text-align: center;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .chart-value {
            font-size: 10px;
            position: absolute;
            top: -20px;
            background: var(--vscode-editor-background);
            padding: 2px 8px;
            border-radius: 12px;
            border: 1px solid var(--vscode-panel-border);
            font-weight: bold;
            box-shadow: var(--shadow-light);
        }

        .health-indicator {
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .health-excellent { 
            background: linear-gradient(135deg, #28a745, #20c997);
            color: white;
        }
        .health-good { 
            background: linear-gradient(135deg, #ffc107, #fd7e14);
            color: white;
        }
        .health-attention { 
            background: linear-gradient(135deg, #dc3545, #e83e8c);
            color: white;
        }

        .overview-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 20px;
            margin-top: 25px;
        }

        .overview-item {
            text-align: center;
            padding: 25px 15px;
            background: var(--gradient-primary);
            border-radius: var(--border-radius);
            color: white;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .overview-item::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 50%);
            transition: all 0.3s ease;
            transform: scale(0);
        }

        .overview-item:hover::before {
            transform: scale(1);
        }

        .overview-item:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-medium);
        }

        .overview-number {
            font-size: 2.5em;
            font-weight: 300;
            display: block;
            margin-bottom: 5px;
            position: relative;
            z-index: 1;
        }

        .overview-label {
            font-size: 0.9em;
            opacity: 0.9;
            position: relative;
            z-index: 1;
        }

        .security-chart {
            display: flex;
            gap: 15px;
            height: 120px;
            align-items: end;
        }

        .pulse {
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Framework Dashboard Statistics</h1>
            <button class="refresh-btn" onclick="refresh()">🔄 Refresh</button>
        </div>

    <div class="stats-grid">
        <!-- Overview Card -->
        <div class="stat-card">
            <h3><span class="card-icon">🎯</span>Overview</h3>
            <div class="overview-grid">
                <div class="overview-item">
                    <span class="overview-number">${
                      stats.overview.controllers
                    }</span>
                    <div class="overview-label">Controllers</div>
                </div>
                <div class="overview-item">
                    <span class="overview-number">${
                      stats.endpoints.total
                    }</span>
                    <div class="overview-label">Endpoints</div>
                </div>
                <div class="overview-item">
                    <span class="overview-number">${stats.entities.total}</span>
                    <div class="overview-label">Entities</div>
                </div>
            </div>
            <div class="stat-item">
                <span>Avg Endpoints/Controller:</span>
                <span class="stat-value">${
                  stats.overview.averageEndpointsPerController
                }</span>
            </div>
            <div class="stat-item">
                <span>Avg Properties/Entity:</span>
                <span class="stat-value">${
                  stats.overview.averagePropertiesPerEntity
                }</span>
            </div>
            <div class="stat-item">
                <span>Codebase Health:</span>
                <span class="health-indicator health-${stats.overview.codebaseHealth
                  .toLowerCase()
                  .replace(" ", "")}">${stats.overview.codebaseHealth}</span>
            </div>
        </div>

        <!-- Endpoints by Method -->
        <div class="stat-card">
            <h3><span class="card-icon">🚀</span>Endpoints by Method</h3>
            <div class="chart-container">
                ${Object.entries(stats.endpoints.byMethod)
                  .map(([method, count]) => {
                    const maxCount = Math.max(
                      ...Object.values(stats.endpoints.byMethod)
                    );
                    const height = (count / maxCount) * 150;
                    return `
                    <div class="chart-bar method-${method.toLowerCase()}" style="height: ${height}px;">
                      <div class="chart-value">${count}</div>
                      <div class="chart-label">${method}</div>
                    </div>
                  `;
                  })
                  .join("")}
            </div>
        </div>

        <!-- Security Overview -->
        <div class="stat-card">
            <h3><span class="card-icon">🔒</span>Security Overview</h3>
            <div class="stat-item">
                <span>Public Endpoints:</span>
                <span class="stat-value">${
                  stats.endpoints.publicVsPrivate.public
                }</span>
            </div>
            <div class="stat-item">
                <span>Protected Endpoints:</span>
                <span class="stat-value">${
                  stats.endpoints.publicVsPrivate.private
                }</span>
            </div>
            <div class="security-chart">
                <div class="chart-bar" style="height: ${
                  (stats.endpoints.publicVsPrivate.public /
                    stats.endpoints.total) *
                  80
                }px; background: linear-gradient(135deg, #28a745, #20c997);">
                    <div class="chart-value">${
                      stats.endpoints.publicVsPrivate.public
                    }</div>
                    <div class="chart-label">Public</div>
                </div>
                <div class="chart-bar" style="height: ${
                  (stats.endpoints.publicVsPrivate.private /
                    stats.endpoints.total) *
                  80
                }px; background: linear-gradient(135deg, #dc3545, #e83e8c);">
                    <div class="chart-value">${
                      stats.endpoints.publicVsPrivate.private
                    }</div>
                    <div class="chart-label">Protected</div>
                </div>
            </div>
        </div>

        <!-- Entity Statistics -->
        <div class="stat-card">
            <h3><span class="card-icon">🗃️</span>Entity Statistics</h3>
            <div class="stat-item">
                <span>Total Entities:</span>
                <span class="stat-value">${stats.entities.total}</span>
            </div>
            <div class="stat-item">
                <span>Total Properties:</span>
                <span class="stat-value">${
                  stats.entities.totalProperties
                }</span>
            </div>
            <div class="stat-item">
                <span>Relationships:</span>
                <span class="stat-value">${
                  stats.entities.relationshipCount
                }</span>
            </div>
        </div>
    </div>
    </div>

    <script>
        function refresh() {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({ command: 'refresh' });
        }
    </script>
</body>
</html>`;
  }

  public dispose(): void {
    if (this.panel) {
      this.panel.dispose();
    }
  }
}
