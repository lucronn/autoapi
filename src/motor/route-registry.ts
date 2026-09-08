import { ConnectorError } from "../errors.js";

export type MotorRouteParams = Record<string, unknown>;

export type MotorRequest = {
  method: "GET";
  url: string;
  responseKind: "json" | "text";
};

type RouteDefinition = {
  id: string;
  method: "GET";
  responseKind: "json" | "text";
  path: (params: MotorRouteParams) => string;
  query: readonly string[];
};

const segment = (params: MotorRouteParams, name: string): string => {
  const value = params[name];
  if (value === undefined || value === null || String(value).length === 0) {
    throw new ConnectorError("invalid_request", `${name} is required`, 400);
  }
  return encodeURIComponent(String(value));
};

const path = (...parts: string[]): string => `/m1/api/${parts.join("/")}`;

export const MOTOR_ROUTES = {
  years: {
    id: "years",
    method: "GET",
    responseKind: "json",
    path: () => path("years"),
    query: [],
  },
  makes: {
    id: "makes",
    method: "GET",
    responseKind: "json",
    path: (params) => path("year", segment(params, "year"), "makes"),
    query: [],
  },
  models: {
    id: "models",
    method: "GET",
    responseKind: "json",
    path: (params) => path("year", segment(params, "year"), "make", segment(params, "make"), "models"),
    query: [],
  },
  vinVehicle: {
    id: "vinVehicle",
    method: "GET",
    responseKind: "json",
    path: (params) => path("vin", segment(params, "vin"), "vehicle"),
    query: [],
  },
  vehicles: {
    id: "vehicles",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicles"),
    query: ["vehicleIds"],
  },
  motorVehicleDetails: {
    id: "motorVehicleDetails",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), segment(params, "vehicleId"), "motorvehicles"),
    query: [],
  },
  vehicleName: {
    id: "vehicleName",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), segment(params, "vehicleId"), "name"),
    query: [],
  },
  articles: {
    id: "articles",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicle", segment(params, "vehicleId"), "articles", "v2"),
    query: ["bucketName", "articleSubtype", "searchTerm"],
  },
  article: {
    id: "article",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicle", segment(params, "vehicleId"), "article", segment(params, "articleId")),
    query: ["bucketName", "articleSubtype", "searchTerm"],
  },
  articleTitle: {
    id: "articleTitle",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicle", segment(params, "vehicleId"), "article", segment(params, "articleId"), "title"),
    query: [],
  },
  labor: {
    id: "labor",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicle", segment(params, "vehicleId"), "labor", segment(params, "articleId")),
    query: [],
  },
  maintenanceFrequency: {
    id: "maintenanceFrequency",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicle", segment(params, "vehicleId"), "maintenanceSchedules", "frequency"),
    query: [],
  },
  maintenanceIntervals: {
    id: "maintenanceIntervals",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicle", segment(params, "vehicleId"), "maintenanceSchedules", "intervals"),
    query: [],
  },
  maintenanceIndicators: {
    id: "maintenanceIndicators",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicle", segment(params, "vehicleId"), "maintenanceSchedules", "indicators"),
    query: [],
  },
  parts: {
    id: "parts",
    method: "GET",
    responseKind: "json",
    path: (params) => path("source", segment(params, "contentSource"), "vehicle", segment(params, "vehicleId"), "parts"),
    query: [],
  },
  graphic: {
    id: "graphic",
    method: "GET",
    responseKind: "text",
    path: (params) => path("source", segment(params, "contentSource"), "graphic", segment(params, "id")),
    query: [],
  },
  asset: {
    id: "asset",
    method: "GET",
    responseKind: "text",
    path: (params) => path("asset", segment(params, "handleId")),
    query: [],
  },
  xml: {
    id: "xml",
    method: "GET",
    responseKind: "text",
    path: (params) => path("source", segment(params, "contentSource"), "xml", segment(params, "articleId")),
    query: [],
  },
  userSettings: {
    id: "userSettings",
    method: "GET",
    responseKind: "json",
    path: () => path("ui", "usersettings"),
    query: [],
  },
} satisfies Record<string, RouteDefinition>;

export type MotorRouteId = keyof typeof MOTOR_ROUTES;

function queryValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(String).join(",");
  return String(value);
}

function encodeQuery(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "%20");
}

export function buildMotorRequest(
  routeId: MotorRouteId,
  params: MotorRouteParams,
  apiOrigin: string,
  allowedContentSources: readonly string[] = ["GeneralMotors", "Motor", "Toyota"],
): MotorRequest {
  const route = MOTOR_ROUTES[routeId];
  const contentSource = params.contentSource;
  if (contentSource !== undefined && !allowedContentSources.includes(String(contentSource))) {
    throw new ConnectorError("invalid_request", "content source is not allowed", 400);
  }

  const origin = new URL(apiOrigin);
  if (origin.protocol !== "https:") throw new ConnectorError("blocked_upstream_target", "Only HTTPS upstream targets are allowed", 400);
  const url = new URL(route.path(params), origin);
  const query = route.query
    .map((name) => [name, queryValue(params[name])] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${encodeQuery(name)}=${encodeQuery(value)}`)
    .join("&");
  if (query) url.search = query;

  return { method: route.method, url: url.toString(), responseKind: route.responseKind };
}
