import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { EndpointInfo } from "../parser/Parser";
import { ConfigurationManager } from "../ConfigurationManager";

export class TestGenerator {
  private workspaceRoot: string;
  private configManager: ConfigurationManager;

  constructor() {
    const folders = vscode.workspace.workspaceFolders;
    this.workspaceRoot = folders?.[0]?.uri.fsPath || "";
    this.configManager = ConfigurationManager.getInstance();
  }

  private async isLanguageModelAvailable(): Promise<boolean> {
    // Check if GitHub Copilot is enabled in settings
    if (!this.configManager.useGitHubCopilot) {
      return false;
    }

    try {
      const selectedModel = this.configManager.copilotModel;
      const models = await this.getAvailableModels();
      return models.some(
        (model) =>
          model.id.includes(selectedModel) || model.family === selectedModel
      );
    } catch (error) {
      return false;
    }
  }

  private async getAvailableModels() {
    try {
      // Get all available Copilot models
      const models = await vscode.lm.selectChatModels({
        vendor: "copilot",
      });
      return models;
    } catch (error) {
      console.error("Error getting available models:", error);
      return [];
    }
  }

  private async selectBestAvailableModel() {
    const selectedModel = this.configManager.copilotModel;
    const availableModels = await this.getAvailableModels();

    // Try to find exact match first
    let model = availableModels.find(
      (m) =>
        m.id.includes(selectedModel) ||
        m.family === selectedModel ||
        m.name?.toLowerCase().includes(selectedModel.toLowerCase())
    );

    // Fallback to any GPT-4 model if preferred model not available
    if (!model && selectedModel === "gpt-4o") {
      model = availableModels.find(
        (m) => m.family === "gpt-4" || m.id.includes("gpt-4")
      );
    }

    // Final fallback to first available model
    if (!model && availableModels.length > 0) {
      model = availableModels[0];
    }

    return model;
  }

  private async generateWithCopilot(
    endpoint: EndpointInfo
  ): Promise<string | null> {
    try {
      const model = await this.selectBestAvailableModel();

      if (!model) {
        return null;
      }
      const context = this.buildTestContext(endpoint);

      const messages = [
        vscode.LanguageModelChatMessage
          .User(`Generate a comprehensive Jest test suite for a NestJS endpoint with complete context analysis.

ENDPOINT DETAILS:
- Controller: ${endpoint.controller}
- Method: ${endpoint.handlerName}
- HTTP Method: ${endpoint.method}
- Route: ${endpoint.path}
- Description: ${endpoint.description || "No description"}
- Input DTO: ${endpoint.inputDto || "None specified"}
- Output DTO: ${endpoint.outputDto || "None specified"}
- Guards: ${
          endpoint.guards && endpoint.guards.length > 0
            ? endpoint.guards.join(", ")
            : "None"
        }
- Pipes: ${
          endpoint.pipes && endpoint.pipes.length > 0
            ? endpoint.pipes.join(", ")
            : "None"
        }
- Interceptors: ${
          endpoint.interceptors && endpoint.interceptors.length > 0
            ? endpoint.interceptors.join(", ")
            : "None"
        }
- Access Level: ${endpoint.isPublic ? "Public" : "Protected"}
- Tags: ${
          endpoint.tags && endpoint.tags.length > 0
            ? endpoint.tags.join(", ")
            : "None"
        }

COMPREHENSIVE CODEBASE CONTEXT:
${context}

GENERATE REQUIREMENTS:
Please analyze ALL the provided context (controller, services, DTOs, entities, base entities) and generate a complete Jest test file that:

1. **Smart Mock Generation**: 
   - Create realistic mock data based on actual DTO structures and entity schemas
   - Include proper validation test cases based on DTO constraints
   - Mock all injected services with their actual method signatures

2. **Comprehensive Test Coverage**:
   - Success scenarios with valid data
   - Validation error scenarios (400 responses)
   - Authentication/authorization tests based on guards
   - Edge cases based on entity relationships and constraints
   - Database error handling scenarios

3. **Realistic Data**:
   - Use actual property names and types from entities/DTOs
   - Respect optional vs required fields
   - Include relationship data where applicable
   - Handle base entity inheritance properly

4. **Proper Test Structure**:
   - Complete NestJS testing module setup with all dependencies
   - Supertest for HTTP endpoint testing
   - Proper beforeEach/afterEach setup and cleanup
   - Organized test groups with clear descriptions

5. **Production-Ready Code**:
   - Include all necessary imports based on the codebase
   - Follow NestJS testing best practices
   - Proper error assertions and status code checks
   - Mock repository methods based on actual usage

The generated test should demonstrate deep understanding of the codebase structure and create meaningful test scenarios based on the actual business logic and data models.

FORMATTING REQUIREMENTS:
- Use proper TypeScript formatting with consistent indentation (2 spaces)
- Include proper line breaks and spacing for readability
- Use consistent naming conventions (camelCase for variables, PascalCase for classes)
- Format code blocks with proper alignment
- Include proper imports with organized import statements
- Use semicolons consistently
- Format test descriptions as clear, readable sentences
- Organize code with proper sections and comments

The final output should be production-ready, well-formatted TypeScript code that passes linting and follows NestJS best practices.`),
      ];

      const request = await model.sendRequest(
        messages,
        {},
        new vscode.CancellationTokenSource().token
      );

      let response = "";
      for await (const fragment of request.text) {
        response += fragment;
      }

      return response || null;
    } catch (error) {
      console.error("Error generating test with Copilot:", error);
      return null;
    }
  }

  private buildTestContext(endpoint: EndpointInfo): string {
    try {
      const context = this.collectComprehensiveContext(endpoint);
      return context;
    } catch (error) {
      return `// Could not collect context: ${error}`;
    }
  }

  private collectComprehensiveContext(endpoint: EndpointInfo): string {
    const contextParts: string[] = [];

    // 1. Controller file content
    const controllerContent = this.getControllerContent(endpoint);
    contextParts.push("=== CONTROLLER ===");
    contextParts.push(controllerContent);

    // 2. Related services (injected dependencies)
    const serviceContent = this.getRelatedServices(endpoint);
    if (serviceContent) {
      contextParts.push("\n=== RELATED SERVICES ===");
      contextParts.push(serviceContent);
    }

    // 3. Related DTOs (input/output)
    const dtoContent = this.getRelatedDTOs(endpoint);
    if (dtoContent) {
      contextParts.push("\n=== RELATED DTOs ===");
      contextParts.push(dtoContent);
    }

    // 4. Related entities (from services or DTOs)
    const entityContent = this.getRelatedEntities(endpoint);
    if (entityContent) {
      contextParts.push("\n=== RELATED ENTITIES ===");
      contextParts.push(entityContent);
    }

    // 5. Base entities (extended entities)
    const baseEntityContent = this.getBaseEntities(endpoint);
    if (baseEntityContent) {
      contextParts.push("\n=== BASE ENTITIES ===");
      contextParts.push(baseEntityContent);
    }

    return contextParts.join("\n");
  }

  private getControllerContent(endpoint: EndpointInfo): string {
    try {
      const controllerContent = fs.readFileSync(endpoint.filePath, "utf8");

      // Return full controller content for better context (limit to reasonable size)
      return controllerContent.length > 3000
        ? controllerContent.substring(0, 3000) + "\n// ... (truncated)"
        : controllerContent;
    } catch (error) {
      return `// Could not read controller file: ${error}`;
    }
  }

  private getRelatedServices(endpoint: EndpointInfo): string | null {
    try {
      const controllerContent = fs.readFileSync(endpoint.filePath, "utf8");
      const serviceFiles: string[] = [];

      // Extract imported services from constructor injection
      const constructorMatch = controllerContent.match(
        /constructor[\s\S]*?\([^)]+\)/
      );
      if (constructorMatch) {
        const constructorParams = constructorMatch[0];
        const serviceMatches = constructorParams.match(
          /private\s+\w+:\s*(\w+Service)/g
        );

        if (serviceMatches) {
          serviceMatches.forEach((match) => {
            const serviceName = match.match(/:\s*(\w+Service)/)?.[1];
            if (serviceName) {
              const serviceFile = this.findServiceFile(serviceName);
              if (serviceFile) {
                serviceFiles.push(serviceFile);
              }
            }
          });
        }
      }

      // Read service files content
      if (serviceFiles.length > 0) {
        return serviceFiles
          .map((file) => {
            try {
              const content = fs.readFileSync(file, "utf8");
              return `// ${path.basename(file)}\n${content.substring(0, 2000)}`;
            } catch (error) {
              return `// Could not read ${file}: ${error}`;
            }
          })
          .join("\n\n");
      }

      return null;
    } catch (error) {
      return `// Error getting services: ${error}`;
    }
  }

  private getRelatedDTOs(endpoint: EndpointInfo): string | null {
    try {
      const dtoFiles: string[] = [];

      // Find DTOs from endpoint info
      if (endpoint.inputDto) {
        const dtoFile = this.findDTOFile(endpoint.inputDto);
        if (dtoFile) dtoFiles.push(dtoFile);
      }

      if (endpoint.outputDto) {
        const dtoFile = this.findDTOFile(endpoint.outputDto);
        if (dtoFile) dtoFiles.push(dtoFile);
      }

      // Also search for DTOs mentioned in controller file
      const controllerContent = fs.readFileSync(endpoint.filePath, "utf8");
      const dtoMatches = controllerContent.match(
        /(\w+Dto|\w+CreateDto|\w+UpdateDto)/g
      );
      if (dtoMatches) {
        dtoMatches.forEach((dtoName) => {
          const dtoFile = this.findDTOFile(dtoName);
          if (dtoFile && !dtoFiles.includes(dtoFile)) {
            dtoFiles.push(dtoFile);
          }
        });
      }

      if (dtoFiles.length > 0) {
        return dtoFiles
          .map((file) => {
            try {
              const content = fs.readFileSync(file, "utf8");
              return `// ${path.basename(file)}\n${content}`;
            } catch (error) {
              return `// Could not read ${file}: ${error}`;
            }
          })
          .join("\n\n");
      }

      return null;
    } catch (error) {
      return `// Error getting DTOs: ${error}`;
    }
  }

  private getRelatedEntities(endpoint: EndpointInfo): string | null {
    try {
      const entityFiles: string[] = [];

      // Find entities from controller and services
      const searchFiles = [endpoint.filePath];

      // Add related service files
      const serviceContent = this.getRelatedServices(endpoint);
      if (serviceContent) {
        // Extract entity references from services
        const entityMatches = serviceContent.match(/(\w+Entity|\w+\.entity)/g);
        if (entityMatches) {
          entityMatches.forEach((entityRef) => {
            const entityName = entityRef
              .replace(/\.entity$/, "")
              .replace(/Entity$/, "");
            const entityFile = this.findEntityFile(entityName);
            if (entityFile && !entityFiles.includes(entityFile)) {
              entityFiles.push(entityFile);
            }
          });
        }
      }

      if (entityFiles.length > 0) {
        return entityFiles
          .map((file) => {
            try {
              const content = fs.readFileSync(file, "utf8");
              return `// ${path.basename(file)}\n${content}`;
            } catch (error) {
              return `// Could not read ${file}: ${error}`;
            }
          })
          .join("\n\n");
      }

      return null;
    } catch (error) {
      return `// Error getting entities: ${error}`;
    }
  }

  private getBaseEntities(endpoint: EndpointInfo): string | null {
    try {
      const baseEntityFiles: string[] = [];

      // Get related entities first
      const entityContent = this.getRelatedEntities(endpoint);
      if (entityContent) {
        // Look for extends patterns in entity files
        const extendsMatches = entityContent.match(/extends\s+(\w+)/g);
        if (extendsMatches) {
          extendsMatches.forEach((match) => {
            const baseEntityName = match.replace(/extends\s+/, "");
            const baseEntityFile = this.findEntityFile(baseEntityName);
            if (baseEntityFile && !baseEntityFiles.includes(baseEntityFile)) {
              baseEntityFiles.push(baseEntityFile);
            }
          });
        }
      }

      if (baseEntityFiles.length > 0) {
        return baseEntityFiles
          .map((file) => {
            try {
              const content = fs.readFileSync(file, "utf8");
              return `// ${path.basename(file)}\n${content}`;
            } catch (error) {
              return `// Could not read ${file}: ${error}`;
            }
          })
          .join("\n\n");
      }

      return null;
    } catch (error) {
      return `// Error getting base entities: ${error}`;
    }
  }

  private findServiceFile(serviceName: string): string | null {
    return this.findFileByPattern(serviceName, [".service.ts", ".service.js"]);
  }

  private findDTOFile(dtoName: string): string | null {
    const cleanDtoName = dtoName.replace(/Dto$/, "");
    return this.findFileByPattern(cleanDtoName, [".dto.ts", ".dto.js"]);
  }

  private findEntityFile(entityName: string): string | null {
    const cleanEntityName = entityName.replace(/Entity$/, "");
    return this.findFileByPattern(cleanEntityName, [
      ".entity.ts",
      ".entity.js",
    ]);
  }

  private findFileByPattern(
    baseName: string,
    extensions: string[]
  ): string | null {
    const searchDirs = ["src", "apps", "libs"];

    for (const dir of searchDirs) {
      for (const ext of extensions) {
        const patterns = [
          `${baseName}${ext}`,
          `${baseName.toLowerCase()}${ext}`,
          `${this.toKebabCase(baseName)}${ext}`,
        ];

        for (const pattern of patterns) {
          try {
            const files = this.globSearch(
              path.join(this.workspaceRoot, dir, "**", pattern)
            );
            if (files.length > 0) {
              return files[0];
            }
          } catch (error) {
            // Continue searching
          }
        }
      }
    }

    return null;
  }

  private toKebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  }

  private globSearch(pattern: string): string[] {
    try {
      const glob = require("glob");
      return glob.sync(pattern);
    } catch (error) {
      // Fallback to simple file system search if glob is not available
      return [];
    }
  }

  private async generateControllerWithCopilot(
    endpoints: EndpointInfo[]
  ): Promise<string | null> {
    try {
      const model = await this.selectBestAvailableModel();

      if (!model) {
        return null;
      }
      const controller = endpoints[0].controller || "Controller";
      const controllerContext = this.buildControllerContext(endpoints[0]);

      const endpointSummary = endpoints
        .map(
          (ep) =>
            `- ${ep.method} ${ep.path} (${ep.handlerName}${
              ep.description ? ` - ${ep.description}` : ""
            })`
        )
        .join("\n");

      const messages = [
        vscode.LanguageModelChatMessage
          .User(`Generate a comprehensive Jest test suite for a complete NestJS controller with comprehensive context analysis.

CONTROLLER DETAILS:
- Controller: ${controller}
- Total Endpoints: ${endpoints.length}
- Endpoints:
${endpointSummary}

COMPREHENSIVE CONTROLLER CONTEXT:
${controllerContext}

GENERATE REQUIREMENTS:
Please analyze ALL the provided context and generate a complete Jest test file that:

1. **Complete Controller Testing**:
   - Tests all ${endpoints.length} endpoints in the controller
   - Shared beforeEach/afterEach setup for the entire controller
   - Mock all injected services with their actual method signatures
   - Include comprehensive test module setup

2. **Smart Test Generation**:
   - Create realistic mock data based on actual DTO and entity structures
   - Test success scenarios with valid data for all endpoints
   - Test validation error scenarios (400 responses)
   - Test authentication/authorization based on guards
   - Test edge cases based on business logic

3. **Production-Ready Structure**:
   - Proper imports based on the codebase
   - Use supertest for HTTP endpoint testing
   - Comprehensive assertions and expectations
   - Organized test groups by endpoint
   - Proper error handling and status code checks

4. **Realistic Data Handling**:
   - Generate test data that matches actual DTO schemas
   - Handle relationships and nested objects properly
   - Respect required vs optional fields
   - Include proper mock repository methods

FORMATTING REQUIREMENTS:
- Use proper TypeScript formatting with consistent indentation (2 spaces)
- Include proper line breaks and spacing for readability
- Use consistent naming conventions (camelCase for variables, PascalCase for classes)
- Format code blocks with proper alignment
- Include proper imports with organized import statements
- Use semicolons consistently
- Format test descriptions as clear, readable sentences
- Organize code with proper sections and comments

The final output should be production-ready, well-formatted TypeScript code that passes linting and follows NestJS best practices.`),
      ];

      const request = await model.sendRequest(
        messages,
        {},
        new vscode.CancellationTokenSource().token
      );

      let response = "";
      for await (const fragment of request.text) {
        response += fragment;
      }

      return response || null;
    } catch (error) {
      console.error("Error generating controller test with Copilot:", error);
      return null;
    }
  }

  private buildControllerContext(endpoint: EndpointInfo): string {
    try {
      // Use the same comprehensive context collection as individual endpoints
      const context = this.collectComprehensiveContext(endpoint);
      return context;
    } catch (error) {
      return `// Could not collect controller context: ${error}`;
    }
  }

  private cleanCopilotResponse(response: string): string {
    // Remove markdown code block markers if present
    let cleaned = response
      .replace(/```typescript\n?/g, "")
      .replace(/```\n?/g, "");

    // Remove any extra leading/trailing whitespace
    cleaned = cleaned.trim();

    // Ensure proper import statements are present
    if (!cleaned.includes("import { Test, TestingModule }")) {
      const importBlock = `import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

`;
      cleaned = importBlock + cleaned;
    }

    return cleaned;
  }

  public async generateTestForEndpoint(endpoint: EndpointInfo): Promise<void> {
    // Show progress indicator
    const progress = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating Test with GitHub Copilot...",
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({
          increment: 0,
          message: "Checking Copilot availability...",
        });

        let testContent: string;
        const isLMAvailable = await this.isLanguageModelAvailable();

        if (isLMAvailable && !token.isCancellationRequested) {
          const selectedModel = this.configManager.copilotModel;
          progress.report({
            increment: 30,
            message: `🤖 Generating intelligent test with GitHub Copilot (${selectedModel})...`,
          });

          const copilotContent = await this.generateWithCopilot(endpoint);
          if (copilotContent && !token.isCancellationRequested) {
            testContent = this.cleanCopilotResponse(copilotContent);
            progress.report({
              increment: 70,
              message: `✨ AI-powered test generated successfully with ${selectedModel}!`,
            });
          } else {
            progress.report({
              increment: 50,
              message: "⚠️ Copilot unavailable, using template generation...",
            });
            testContent = this.generateTestContent(endpoint);
          }
        } else {
          const reason = !this.configManager.useGitHubCopilot
            ? "Copilot disabled in settings"
            : "Copilot not available";
          progress.report({
            increment: 50,
            message: `📝 ${reason}, using template generation...`,
          });
          testContent = this.generateTestContent(endpoint);
        }

        progress.report({ increment: 100, message: "Complete!" });
        return testContent;
      }
    );

    if (!progress) {
      vscode.window.showInformationMessage("Test generation cancelled");
      return;
    }

    const testContent = progress;
    const testFilePath = this.getTestFilePath(endpoint);

    try {
      // Ensure directory exists
      const testDir = path.dirname(testFilePath);
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      // Check if test file already exists
      if (fs.existsSync(testFilePath)) {
        const choice = await vscode.window.showWarningMessage(
          `Test file already exists: ${path.basename(testFilePath)}`,
          "Overwrite",
          "Cancel"
        );
        if (choice !== "Overwrite") {
          return;
        }
      }

      // Write test file
      fs.writeFileSync(testFilePath, testContent, "utf8");

      // Open the generated test file
      const uri = vscode.Uri.file(testFilePath);
      await vscode.window.showTextDocument(uri);

      vscode.window.showInformationMessage(
        `Test file generated: ${path.basename(testFilePath)}`
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to generate test: ${error}`);
    }
  }

  public async generateTestsForController(
    endpoints: EndpointInfo[]
  ): Promise<void> {
    if (endpoints.length === 0) return;

    const controller = endpoints[0].controller || "Controller";

    // Show progress indicator
    const progress = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating Controller Tests with GitHub Copilot...",
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({
          increment: 0,
          message: "Checking Copilot availability...",
        });

        let testContent: string;
        const isLMAvailable = await this.isLanguageModelAvailable();

        if (isLMAvailable && !token.isCancellationRequested) {
          const selectedModel = this.configManager.copilotModel;
          progress.report({
            increment: 30,
            message: `🤖 Generating intelligent controller tests with GitHub Copilot (${selectedModel})...`,
          });

          const copilotContent = await this.generateControllerWithCopilot(
            endpoints
          );
          if (copilotContent && !token.isCancellationRequested) {
            testContent = this.cleanCopilotResponse(copilotContent);
            progress.report({
              increment: 70,
              message: `✨ AI-powered controller tests generated successfully with ${selectedModel}!`,
            });
          } else {
            progress.report({
              increment: 50,
              message: "⚠️ Copilot unavailable, using template generation...",
            });
            testContent = this.generateControllerTestContent(endpoints);
          }
        } else {
          const reason = !this.configManager.useGitHubCopilot
            ? "Copilot disabled in settings"
            : "Copilot not available";
          progress.report({
            increment: 50,
            message: `📝 ${reason}, using template generation...`,
          });
          testContent = this.generateControllerTestContent(endpoints);
        }

        progress.report({ increment: 100, message: "Complete!" });
        return testContent;
      }
    );

    if (!progress) {
      vscode.window.showInformationMessage(
        "Controller test generation cancelled"
      );
      return;
    }

    const testContent = progress;
    const testFilePath = this.getControllerTestFilePath(
      controller,
      endpoints[0].filePath
    );

    try {
      // Ensure directory exists
      const testDir = path.dirname(testFilePath);
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      // Check if test file already exists
      if (fs.existsSync(testFilePath)) {
        const choice = await vscode.window.showWarningMessage(
          `Test file already exists: ${path.basename(testFilePath)}`,
          "Overwrite",
          "Cancel"
        );
        if (choice !== "Overwrite") {
          return;
        }
      }

      // Write test file
      fs.writeFileSync(testFilePath, testContent, "utf8");

      // Open the generated test file
      const uri = vscode.Uri.file(testFilePath);
      await vscode.window.showTextDocument(uri);

      vscode.window.showInformationMessage(
        `Controller test file generated: ${path.basename(testFilePath)}`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to generate controller test: ${error}`
      );
    }
  }

  private generateTestContent(endpoint: EndpointInfo): string {
    const className = endpoint.controller;
    const methodName = endpoint.handlerName;
    const httpMethod = endpoint.method.toLowerCase();
    const route = endpoint.path;

    return `import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ${className} } from './${this.getControllerFileName(
      endpoint.filePath
    )}';

describe('${className} - ${methodName}', () => {
  let app: INestApplication;
  let controller: ${className};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [${className}],
      // Add your providers, services, and dependencies here
      providers: [],
    }).compile();

    app = module.createNestApplication();
    controller = module.get<${className}>(${className});
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('${httpMethod.toUpperCase()} ${route}', () => {
    it('should be defined', () => {
      expect(controller.${methodName}).toBeDefined();
    });

    it('should return expected response', async () => {
      ${this.generateTestCase(endpoint)}
    });

    ${this.generateAdditionalTestCases(endpoint)}
  });
});
`;
  }

  private generateControllerTestContent(endpoints: EndpointInfo[]): string {
    const className = endpoints[0].controller;
    const controllerFileName = this.getControllerFileName(
      endpoints[0].filePath
    );

    return `import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ${className} } from './${controllerFileName}';

describe('${className}', () => {
  let app: INestApplication;
  let controller: ${className};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [${className}],
      // Add your providers, services, and dependencies here
      providers: [],
    }).compile();

    app = module.createNestApplication();
    controller = module.get<${className}>(${className});
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

${endpoints
  .map((endpoint) => this.generateEndpointTestSuite(endpoint))
  .join("\n\n")}
});
`;
  }

  private generateEndpointTestSuite(endpoint: EndpointInfo): string {
    const httpMethod = endpoint.method.toLowerCase();
    const route = endpoint.path;
    const methodName = endpoint.handlerName;

    return `  describe('${httpMethod.toUpperCase()} ${route}', () => {
    it('should ${this.getTestDescription(endpoint)}', async () => {
      ${this.generateTestCase(endpoint)}
    });

    ${this.generateAdditionalTestCases(endpoint)}
  });`;
  }

  private generateTestCase(endpoint: EndpointInfo): string {
    const httpMethod = endpoint.method.toLowerCase();
    const route = endpoint.path;
    const hasBody = ["post", "put", "patch"].includes(httpMethod);

    let testCase = `const response = await request(app.getHttpServer())
        .${httpMethod}('${route}')`;

    if (hasBody && endpoint.inputDto) {
      testCase += `
        .send(${this.generateMockData(endpoint.inputDto)})`;
    }

    if (!endpoint.isPublic) {
      testCase += `
        .set('Authorization', 'Bearer valid-jwt-token')`;
    }

    testCase += `
        .expect(${this.getExpectedStatusCode(endpoint)});

      // Add your assertions here
      expect(response.body).toBeDefined();
      // expect(response.body).toMatchObject(expectedResponseShape);`;

    return testCase;
  }

  private generateAdditionalTestCases(endpoint: EndpointInfo): string {
    const cases = [];

    // Authentication test for protected endpoints
    if (!endpoint.isPublic) {
      cases.push(`it('should return 401 for unauthorized requests', async () => {
      await request(app.getHttpServer())
        .${endpoint.method.toLowerCase()}('${endpoint.path}')
        .expect(401);
    });`);
    }

    // Validation test for endpoints with DTOs
    if (
      endpoint.inputDto &&
      ["POST", "PUT", "PATCH"].includes(endpoint.method)
    ) {
      cases.push(`it('should return 400 for invalid input', async () => {
      await request(app.getHttpServer())
        .${endpoint.method.toLowerCase()}('${endpoint.path}')
        .send({}) // Invalid empty payload
        ${
          !endpoint.isPublic
            ? `.set('Authorization', 'Bearer valid-jwt-token')`
            : ""
        }
        .expect(400);
    });`);
    }

    return cases.join("\n\n    ");
  }

  private generateMockData(dtoType: string): string {
    // Simple mock data generation - could be enhanced with actual DTO analysis
    switch (dtoType) {
      case "CreateUserDto":
        return `{
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123'
        }`;
      case "UpdateUserDto":
        return `{
          name: 'Updated User',
          email: 'updated@example.com'
        }`;
      case "LoginDto":
        return `{
          email: 'test@example.com',
          password: 'password123'
        }`;
      default:
        return `{
          // Add mock data for ${dtoType} here
        }`;
    }
  }

  private getTestDescription(endpoint: EndpointInfo): string {
    switch (endpoint.method) {
      case "GET":
        return endpoint.path.includes(":id")
          ? "retrieve a specific resource"
          : "retrieve resources";
      case "POST":
        return "create a new resource";
      case "PUT":
        return "update a resource completely";
      case "PATCH":
        return "update a resource partially";
      case "DELETE":
        return "delete a resource";
      default:
        return "handle the request correctly";
    }
  }

  private getExpectedStatusCode(endpoint: EndpointInfo): number {
    switch (endpoint.method) {
      case "GET":
        return 200;
      case "POST":
        return 201;
      case "PUT":
      case "PATCH":
        return 200;
      case "DELETE":
        return endpoint.path.includes(":id") ? 200 : 204;
      default:
        return 200;
    }
  }

  private getTestFilePath(endpoint: EndpointInfo): string {
    const originalPath = endpoint.filePath;
    const dir = path.dirname(originalPath);
    const baseName = path.basename(originalPath, ".ts");
    const methodName = endpoint.handlerName;

    return path.join(dir, `${baseName}.${methodName}.spec.ts`);
  }

  private getControllerTestFilePath(
    controller: string,
    originalFilePath: string
  ): string {
    const dir = path.dirname(originalFilePath);
    const baseName = path.basename(originalFilePath, ".ts");

    return path.join(dir, `${baseName}.spec.ts`);
  }

  private getControllerFileName(filePath: string): string {
    return path.basename(filePath, ".ts");
  }
}
