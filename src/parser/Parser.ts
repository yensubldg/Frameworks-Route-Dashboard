export interface EndpointInfo {
  method: string;
  path: string;
  handler: string;
  filePath: string;
  lineNumber: number;
  controller?: string;
  summary?: string;
  description?: string;
  inputDto?: string;
  outputDto?: string;
  guards?: string[];
  middlewares?: string[];
  pipes?: string[];
  interceptors?: string[];
  tags?: string[];
  isPublic?: boolean;
  module?: string;
  framework?: "nestjs" | "fastapi";
  handlerName?: string;
}

export interface EntityInfo {
  name: string;
  filePath: string;
  lineNumber: number;
  properties: PropertyInfo[];
  tableName?: string;
  module?: string;
  imports?: string[];
  relationships?: any[];
  framework?: "nestjs" | "fastapi";
}

export interface PropertyInfo {
  name: string;
  type: string;
  decorators: string[];
  isOptional?: boolean;
  defaultValue?: string;
  validationRules?: string[];
}

export interface Parser {
  parseEndpoints(): EndpointInfo[];
  parseEntities?(): EntityInfo[];
}

export class CombinedParser implements Parser {
  private parsers: Parser[];

  constructor(parsers: Parser[]) {
    this.parsers = parsers;
  }

  parseEndpoints(): EndpointInfo[] {
    const merged: EndpointInfo[] = [];
    this.parsers.forEach((p) => {
      try {
        merged.push(...(p.parseEndpoints() || []));
      } catch (e) {
        // ignore parser failure to keep others working
      }
    });
    return merged;
  }

  parseEntities?(): EntityInfo[] {
    const merged: EntityInfo[] = [];
    this.parsers.forEach((p) => {
      try {
        if (p.parseEntities) {
          merged.push(...(p.parseEntities() || []));
        }
      } catch (e) {
        // ignore
      }
    });
    return merged;
  }
}