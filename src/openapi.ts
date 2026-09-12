import type { FastifyInstance } from "fastify";
import type { OpenAPIV3 } from "openapi-types";
import { PUBLIC_API_ROUTES } from "./routes/api-routes.js";
import { MOTOR_ROUTES } from "./motor/route-registry.js";

type ExampleValue = string | boolean;

type ParameterExample = {
  type: "string" | "boolean";
  example: ExampleValue;
  description: string;
};

const PARAMETER_EXAMPLES: Record<string, ParameterExample> = {
  year: { type: "string", example: "2024", description: "Model year." },
  make: { type: "string", example: "Toyota", description: "Vehicle make name." },
  vin: { type: "string", example: "1HGCM82633A004352", description: "Vehicle identification number." },
  contentSource: { type: "string", example: "GeneralMotors", description: "MOTOR content source." },
  vehicleId: { type: "string", example: "100342221", description: "MOTOR vehicle identifier." },
  articleId: { type: "string", example: "4481222:17911387", description: "MOTOR article identifier." },
  id: { type: "string", example: "4481151", description: "MOTOR graphic identifier." },
  handleId: { type: "string", example: "example-asset-handle", description: "MOTOR asset handle." },
  vehicleIds: { type: "string", example: "100342221", description: "Comma-separated MOTOR vehicle identifiers." },
  bucketName: { type: "string", example: "Component Location Diagrams", description: "Optional MOTOR article bucket." },
  articleSubtype: { type: "string", example: "", description: "Optional MOTOR article subtype." },
  searchTerm: { type: "string", example: "", description: "Optional MOTOR article search term." },
  raw: { type: "boolean", example: false, description: "Return the upstream envelope without HTML normalization." },
};

function routeParameterNames(routeUrl: string): string[] {
  return [...routeUrl.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

function openApiParameter(name: string, location: "path" | "query", required: boolean): OpenAPIV3.ParameterObject {
  const definition = PARAMETER_EXAMPLES[name] ?? { type: "string", example: "", description: `MOTOR ${name} value.` };
  return {
    name,
    in: location,
    required,
    description: definition.description,
    example: definition.example,
    schema: {
      type: definition.type,
      default: definition.example,
      example: definition.example,
    },
  };
}

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  const openapi = app.swagger?.();
  if (!openapi) return;
  openapi.paths ??= {};
  for (const route of PUBLIC_API_ROUTES) {
    const path = route.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const motorRoute = MOTOR_ROUTES[route.routeId];
    const parameters = [
      ...routeParameterNames(route.url).map((name) => openApiParameter(name, "path", true)),
      ...route.query.map((name) => openApiParameter(name, "query", false)),
      ...(motorRoute.responseKind === "json" ? [openApiParameter("raw", "query", false)] : []),
    ];
    openapi.paths[path] ??= {};
    openapi.paths[path].get = {
      operationId: route.routeId,
      summary: `Read MOTOR ${route.routeId}`,
      parameters,
      responses: {
        "200": { description: "Upstream MOTOR response envelope" },
        ...(route.routeId === "parts" ? { "404": { description: "No parts list is available for this vehicle" } } : {}),
        "502": { description: "Upstream failure" },
      },
    };
  }
}
