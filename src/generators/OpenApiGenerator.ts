import { EndpointInfo, Parser } from "../parser/Parser";

export interface OpenApiGeneratorOptions {
  title: string;
  version: string;
  serverUrl: string;
}

type OpenApiSchema = Record<string, unknown>;
type OpenApiDocument = Record<string, unknown>;

export class OpenApiGenerator {
  constructor(private parser: Parser, private options: OpenApiGeneratorOptions) {}

  public generate(): OpenApiDocument {
    const endpoints = this.parser.parseEndpoints();
    const paths: Record<string, Record<string, unknown>> = {};
    const schemas: Record<string, OpenApiSchema> = {};
    const tagNames = new Set<string>();
    let hasProtectedEndpoint = false;

    endpoints.forEach((endpoint) => {
      const method = this.toOpenApiMethod(endpoint.method);
      if (!method) return;

      const normalizedPath = this.normalizePath(endpoint.path);
      const tag = this.getPrimaryTag(endpoint);
      const responses = this.buildResponses(endpoint, schemas);
      const operation: Record<string, unknown> = {
        tags: [tag],
        operationId: endpoint.operationId || this.buildOperationId(endpoint),
        responses,
      };

      tagNames.add(tag);

      if (endpoint.summary) {
        operation.summary = endpoint.summary;
      }

      if (endpoint.description) {
        operation.description = endpoint.description;
      }

      const pathParameters = this.buildPathParameters(normalizedPath);
      if (pathParameters.length > 0) {
        operation.parameters = pathParameters;
      }

      if (endpoint.deprecated) {
        operation.deprecated = true;
      }

      const requestType = endpoint.requestBodyType || endpoint.inputDto;
      if (requestType && ["post", "put", "patch"].includes(method)) {
        operation.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: this.schemaRef(requestType, schemas),
            },
          },
        };
      }

      if (!endpoint.isPublic) {
        hasProtectedEndpoint = true;
        operation.security = [{ bearerAuth: [] }];
      }

      if (!paths[normalizedPath]) {
        paths[normalizedPath] = {};
      }
      paths[normalizedPath][method] = operation;
    });

    const document: OpenApiDocument = {
      openapi: "3.0.3",
      info: {
        title: this.options.title,
        version: this.options.version,
      },
      servers: [
        {
          url: this.options.serverUrl,
        },
      ],
      tags: Array.from(tagNames)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name })),
      paths,
    };

    const components: Record<string, unknown> = {};
    if (Object.keys(schemas).length > 0) {
      components.schemas = schemas;
    }

    if (hasProtectedEndpoint) {
      components.securitySchemes = {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      };
    }

    if (Object.keys(components).length > 0) {
      document.components = components;
    }

    return document;
  }

  public generateJson(space: number = 2): string {
    return JSON.stringify(this.generate(), null, space);
  }

  private toOpenApiMethod(method: string): string | undefined {
    const normalized = method.toLowerCase();
    return ["get", "put", "post", "delete", "options", "head", "patch", "trace"].includes(normalized)
      ? normalized
      : undefined;
  }

  private buildPathParameters(routePath: string): Array<Record<string, unknown>> {
    const params = new Set<string>();
    const pattern = /\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(routePath)) !== null) {
      params.add(match[1]);
    }

    return Array.from(params).map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
  }

  private normalizePath(routePath: string): string {
    const withSlash = routePath.startsWith("/") ? routePath : "/" + routePath;
    return withSlash.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
  }

  private getPrimaryTag(endpoint: EndpointInfo): string {
    return endpoint.tags?.[0] || endpoint.controller || endpoint.framework || "default";
  }

  private buildOperationId(endpoint: EndpointInfo): string {
    const controller = endpoint.controller || endpoint.framework || "api";
    const handler = endpoint.handlerName || endpoint.handler || endpoint.method.toLowerCase();
    return this.cleanSchemaName(controller + "_" + handler);
  }

  private buildResponses(
    endpoint: EndpointInfo,
    schemas: Record<string, OpenApiSchema>
  ): Record<string, unknown> {
    const statusCodes = endpoint.statusCodes && endpoint.statusCodes.length > 0
      ? endpoint.statusCodes
      : [this.defaultStatusCode(endpoint.method)];
    const responseType = endpoint.responseType || endpoint.outputDto;

    return statusCodes.reduce<Record<string, unknown>>((responses, statusCode) => {
      const response: Record<string, unknown> = {
        description: this.defaultResponseDescription(statusCode),
      };

      if (responseType && statusCode >= 200 && statusCode < 300) {
        response.content = {
          "application/json": {
            schema: this.schemaRef(responseType, schemas),
          },
        };
      }

      responses[String(statusCode)] = response;
      return responses;
    }, {});
  }

  private defaultStatusCode(method: string): number {
    switch (method.toUpperCase()) {
      case "POST":
        return 201;
      case "GET":
      case "PUT":
      case "PATCH":
      case "DELETE":
        return 200;
      default:
        return 200;
    }
  }

  private defaultResponseDescription(statusCode: number): string {
    if (statusCode >= 200 && statusCode < 300) {
      return "Successful response";
    }
    if (statusCode === 400) return "Bad request";
    if (statusCode === 401) return "Unauthorized";
    if (statusCode === 403) return "Forbidden";
    if (statusCode === 404) return "Not found";
    return "Response";
  }

  private schemaRef(typeName: string, schemas: Record<string, OpenApiSchema>): OpenApiSchema {
    const cleanName = this.cleanSchemaName(typeName);
    if (!schemas[cleanName]) {
      schemas[cleanName] = {
        type: "object",
        additionalProperties: true,
      };
    }

    return {
      $ref: "#/components/schemas/" + cleanName,
    };
  }

  private cleanSchemaName(typeName: string): string {
    return typeName
      .replace(/Promise<(.+)>/g, "$1")
      .replace(/Array<(.+)>/g, "$1")
      .replace(/\[\]/g, "")
      .replace(/[<>|&{},]/g, " ")
      .trim()
      .split(/\s+/)[0]
      .replace(/[^A-Za-z0-9_.-]/g, "") || "Schema";
  }
}
