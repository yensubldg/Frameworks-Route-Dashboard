import * as vscode from "vscode";
import { Parser, EndpointInfo } from "../parser/Parser";
import { ConfigurationManager } from "../ConfigurationManager";

export class EndpointHoverProvider implements vscode.HoverProvider {
  private parser: Parser;
  private config: ConfigurationManager;
  private endpointsCache: EndpointInfo[] = [];
  private lastCacheUpdate: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  constructor(parser: Parser) {
    this.parser = parser;
    this.config = ConfigurationManager.getInstance();
  }

  private getEndpoints(): EndpointInfo[] {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.CACHE_DURATION) {
      this.endpointsCache = this.parser.parseEndpoints();
      this.lastCacheUpdate = now;
    }
    return this.endpointsCache;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    if (!this.config.enableHoverTooltips) {
      return null;
    }

    const endpoints = this.getEndpoints();
    const currentFilePath = document.uri.fsPath;

    // Find endpoints in current file
    const fileEndpoints = endpoints.filter(
      (ep) => ep.filePath === currentFilePath
    );

    if (fileEndpoints.length === 0) {
      return null;
    }

    // Find endpoint at current position
    const currentLine = position.line + 1; // Convert to 1-indexed
    const endpoint = fileEndpoints.find(
      (ep) => Math.abs(ep.lineNumber - currentLine) <= 2 // Allow some tolerance
    );

    if (!endpoint) {
      return null;
    }

    return this.createHoverContent(endpoint);
  }

  private createHoverContent(endpoint: EndpointInfo): vscode.Hover {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;
    markdown.supportHtml = true;

    // Header
    markdown.appendMarkdown(`### 🚀 ${endpoint.method} ${endpoint.path}\n\n`);

    // Controller and Handler
    markdown.appendMarkdown(`**Controller:** \`${endpoint.controller}\`  \n`);
    markdown.appendMarkdown(`**Handler:** \`${endpoint.handler}\`  \n\n`);

    // Description
    if (endpoint.summary) {
      markdown.appendMarkdown(`**Description:** ${endpoint.summary}  \n\n`);
    }

    // DTOs
    if ((endpoint as any).inputDto || (endpoint as any).outputDto) {
      markdown.appendMarkdown(`#### 📋 Data Transfer Objects\n`);
      if ((endpoint as any).inputDto) {
        markdown.appendMarkdown(`**Input:** \`${(endpoint as any).inputDto}\`  \n`);
      }
      if ((endpoint as any).outputDto) {
        markdown.appendMarkdown(`**Output:** \`${(endpoint as any).outputDto}\`  \n`);
      }
      markdown.appendMarkdown(`\n`);
    }

    // Security & Middleware
    if ((endpoint as any).guards && (endpoint as any).guards.length > 0) {
      markdown.appendMarkdown(`#### 🔒 Guards\n`);
      (endpoint as any).guards.forEach((guard: string) => {
        markdown.appendMarkdown(`- \`${guard}\`  \n`);
      });
      markdown.appendMarkdown(`\n`);
    }

    if ((endpoint as any).pipes && (endpoint as any).pipes.length > 0) {
      markdown.appendMarkdown(`#### 🔧 Pipes\n`);
      (endpoint as any).pipes.forEach((pipe: string) => {
        markdown.appendMarkdown(`- \`${pipe}\`  \n`);
      });
      markdown.appendMarkdown(`\n`);
    }

    if ((endpoint as any).interceptors && (endpoint as any).interceptors.length > 0) {
      markdown.appendMarkdown(`#### ⚡ Interceptors\n`);
      (endpoint as any).interceptors.forEach((interceptor: string) => {
        markdown.appendMarkdown(`- \`${interceptor}\`  \n`);
      });
      markdown.appendMarkdown(`\n`);
    }

    // Tags
    if ((endpoint as any).tags && (endpoint as any).tags.length > 0) {
      markdown.appendMarkdown(`#### 🏷️ Tags\n`);
      (endpoint as any).tags.forEach((tag: string) => {
        markdown.appendMarkdown(`- \`${tag}\`  \n`);
      });
      markdown.appendMarkdown(`\n`);
    }

    // Access Level
    const accessLevel = (endpoint as any).isPublic ? "🌐 Public" : "🔐 Protected";
    markdown.appendMarkdown(`**Access:** ${accessLevel}  \n`);

    // Module (for monorepo)
    if ((endpoint as any).module && (endpoint as any).module !== "main") {
      markdown.appendMarkdown(`**Module:** \`${(endpoint as any).module}\`  \n`);
    }

    return new vscode.Hover(markdown);
  }

  public refreshCache(): void {
    this.lastCacheUpdate = 0; // Force cache refresh
  }
}
