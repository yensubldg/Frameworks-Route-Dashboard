import * as path from "path";
import { workspace } from "vscode";
import {
  Project,
  SyntaxKind,
  StringLiteral,
  MethodDeclaration,
  Decorator,
} from "ts-morph";
import { ConfigurationManager } from "../ConfigurationManager";
import { Parser, EndpointInfo, EntityInfo, PropertyInfo } from "./Parser";

export interface RelationshipInfo {
  type: "OneToOne" | "OneToMany" | "ManyToOne" | "ManyToMany";
  target: string;
  property: string;
}

export interface MonorepoInfo {
  apps: string[];
  libs: string[];
  selectedApp?: string;
}

export interface SwaggerInfo {
  isEnabled: boolean;
  setupPath?: string;
  documentPath?: string;
  title?: string;
  version?: string;
}

export class NestParser implements Parser {
  private config = ConfigurationManager.getInstance();

  private extractDecorators(method: MethodDeclaration): {
    guards: string[];
    pipes: string[];
    interceptors: string[];
    tags: string[];
    isPublic: boolean;
  } {
    const guards: string[] = [];
    const pipes: string[] = [];
    const interceptors: string[] = [];
    const tags: string[] = [];
    let isPublic = false;

    method.getDecorators().forEach((decorator: Decorator) => {
      const name = decorator.getName();

      if (name === "UseGuards") {
        const args = decorator.getArguments();
        args.forEach((arg) => {
          guards.push(arg.getText().replace(/\(\)/g, ""));
        });
      } else if (name === "UsePipes") {
        const args = decorator.getArguments();
        args.forEach((arg) => {
          pipes.push(arg.getText().replace(/\(\)/g, ""));
        });
      } else if (name === "UseInterceptors") {
        const args = decorator.getArguments();
        args.forEach((arg) => {
          interceptors.push(arg.getText().replace(/\(\)/g, ""));
        });
      } else if (name === "Public") {
        isPublic = true;
      } else if (name === "ApiTags") {
        const args = decorator.getArguments();
        args.forEach((arg) => {
          if (arg.getKind() === SyntaxKind.StringLiteral) {
            tags.push((arg as StringLiteral).getLiteralText());
          }
        });
      }
    });

    return { guards, pipes, interceptors, tags, isPublic };
  }

  private extractDTOInfo(method: MethodDeclaration): {
    inputDto?: string;
    outputDto?: string;
  } {
    let inputDto: string | undefined;
    let outputDto: string | undefined;

    // Extract input DTO from @Body() decorator or method parameters
    const parameters = method.getParameters();
    parameters.forEach((param) => {
      const bodyDecorator = param.getDecorator("Body");
      if (bodyDecorator) {
        const typeNode = param.getTypeNode();
        if (typeNode) {
          inputDto = typeNode.getText();
        }
      }
    });

    // Extract output DTO from return type annotation
    const returnType = method.getReturnTypeNode();
    if (returnType) {
      outputDto = returnType.getText();
    }

    return { inputDto, outputDto };
  }

  private getModuleName(filePath: string): string {
    // Extract module name from file path for monorepo support
    const pathParts = filePath.split(path.sep);
    const appsIndex = pathParts.findIndex((part) => part === "apps");
    const libsIndex = pathParts.findIndex((part) => part === "libs");

    if (appsIndex !== -1 && appsIndex + 1 < pathParts.length) {
      return `apps/${pathParts[appsIndex + 1]}`;
    } else if (libsIndex !== -1 && libsIndex + 1 < pathParts.length) {
      return `libs/${pathParts[libsIndex + 1]}`;
    }

    return "main";
  }

  private getSearchPatterns(): string[] {
    if (this.config.monorepoMode) {
      const selectedApp = this.config.selectedApp;
      if (selectedApp) {
        return [`apps/${selectedApp}/**/*.ts`, "libs/**/*.ts"];
      }
      return ["apps/**/*.ts", "libs/**/*.ts", "src/**/*.ts"];
    }

    // Use configured root folder, but also include nested src folders and controller files
    const rootFolder = this.config.rootFolder || "src";
    return [
      `${rootFolder}/**/*.ts`,
      `**/${rootFolder}/**/*.ts`,
      `**/*.controller.ts`,
    ];
  }

  parseEndpoints(): EndpointInfo[] {
    const endpoints: EndpointInfo[] = [];
    const folders = workspace.workspaceFolders;
    if (!folders) {
      return endpoints;
    }
    const rootPath = folders[0].uri.fsPath;

    // Initialize project without assuming root tsconfig exists
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
    });

    // Use configuration-aware patterns
    const patterns = this.getSearchPatterns();
    patterns.forEach((pattern) => {
      project.addSourceFilesAtPaths(path.join(rootPath, pattern));
    });

    project
      .getSourceFiles()
      .forEach((sourceFile: import("ts-morph").SourceFile) => {
        sourceFile
          .getClasses()
          .forEach((cls: import("ts-morph").ClassDeclaration) => {
            const controllerDecorator = cls.getDecorator("Controller");
            if (controllerDecorator) {
              let basePath = "/";
              const args = controllerDecorator.getArguments();
              if (args.length > 0) {
                const arg = args[0];
                if (arg.getKind() === SyntaxKind.StringLiteral) {
                  basePath = (arg as StringLiteral).getLiteralText();
                }
              }
              cls
                .getMethods()
                .forEach((method: import("ts-morph").MethodDeclaration) => {
                  [
                    "Get",
                    "Post",
                    "Put",
                    "Delete",
                    "Patch",
                    "Options",
                    "Head",
                    "All",
                  ].forEach((decoName) => {
                    const decorator = method.getDecorator(decoName);
                    if (decorator) {
                      let subPath = "";
                      const decoArgs = decorator.getArguments();
                      if (decoArgs.length > 0) {
                        const decArg = decoArgs[0];
                        if (decArg.getKind() === SyntaxKind.StringLiteral) {
                          subPath = (decArg as StringLiteral).getLiteralText();
                        }
                      }
                      const fullPath = path.posix.join(basePath, subPath);
                      let summary: string | undefined;
                      const jsDocs = method.getJsDocs();
                      if (jsDocs.length > 0) {
                        const comment = jsDocs[0].getComment();
                        if (typeof comment === "string") {
                          summary = comment.split(/\r?\n/)[0];
                        }
                      }

                      // Extract enhanced metadata
                      const decoratorInfo = this.extractDecorators(method);
                      const dtoInfo = this.extractDTOInfo(method);

                      endpoints.push({
                        method: decoName.toUpperCase(),
                        path: fullPath,
                        handler: method.getName(),
                        controller: cls.getName() || "",
                        handlerName: method.getName(),
                        summary,
                        description: summary,
                        filePath: sourceFile.getFilePath(),
                        lineNumber: method.getStartLineNumber(),
                        inputDto: dtoInfo.inputDto,
                        outputDto: dtoInfo.outputDto,
                        guards: decoratorInfo.guards,
                        middlewares: [], // Will be enhanced later
                        pipes: decoratorInfo.pipes,
                        interceptors: decoratorInfo.interceptors,
                        tags: decoratorInfo.tags,
                        isPublic: decoratorInfo.isPublic,
                        module: this.getModuleName(sourceFile.getFilePath()),
                        framework: "nestjs",
                      });
                    }
                  });
                });
            }
          });
      });

    return endpoints;
  }

  parseEntities(): EntityInfo[] {
    const entities: EntityInfo[] = [];
    const folders = workspace.workspaceFolders;
    if (!folders) {
      return entities;
    }
    const rootPath = folders[0].uri.fsPath;

    const project = new Project({
      skipAddingFilesFromTsConfig: true,
    });

    // Use the same configuration-aware patterns
    const patterns = this.getSearchPatterns();
    patterns.forEach((pattern: string) => {
      project.addSourceFilesAtPaths(path.join(rootPath, pattern));
    });

    project
      .getSourceFiles()
      .forEach((sourceFile: import("ts-morph").SourceFile) => {
        sourceFile
          .getClasses()
          .forEach((cls: import("ts-morph").ClassDeclaration) => {
            const entityDecorator = cls.getDecorator("Entity");
            if (entityDecorator) {
              let tableName: string | undefined;
              const args = entityDecorator.getArguments();
              if (args.length > 0) {
                const arg = args[0];
                if (arg.getKind() === SyntaxKind.StringLiteral) {
                  tableName = (arg as StringLiteral).getLiteralText();
                }
              }

              const properties: PropertyInfo[] = [];
              cls.getProperties().forEach((prop) => {
                const decorators: string[] = [];
                prop.getDecorators().forEach((decorator) => {
                  decorators.push(decorator.getName());
                });

                const typeText =
                  prop.getTypeNode()?.getText() ||
                  prop.getType().getText() ||
                  "any";

                properties.push({
                  name: prop.getName(),
                  type: typeText,
                  decorators,
                  isOptional: prop.hasQuestionToken(),
                  defaultValue: prop.getInitializer()?.getText(),
                  validationRules: decorators.filter(
                    (d) =>
                      d.includes("Is") || d.includes("Min") || d.includes("Max")
                  ),
                });
              });

              entities.push({
                name: cls.getName() || "",
                tableName,
                properties,
                filePath: sourceFile.getFilePath(),
                lineNumber: cls.getStartLineNumber(),
                module: undefined,
                imports: [],
                relationships: [],
                framework: "nestjs",
              });
            }
          });
      });

    return entities;
  }
}
