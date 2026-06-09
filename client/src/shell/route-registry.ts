import { routeConfigSchema, type RouteConfig } from "@x-builder/shared";

export type RouteResolution = {
  route: RouteConfig;
  canonicalPath: RouteConfig["path"];
  shouldReplace: boolean;
};

export const appRoutes = validateRouteConfigs([
  {
    enabled: true,
    id: "writer",
    label: "Studio",
    navOrder: 0,
    path: "/writer",
    placeholder: false,
    requiresBackend: true,
    title: "Studio",
  },
  {
    enabled: true,
    id: "voice",
    label: "Voice",
    navOrder: 1,
    path: "/voice",
    placeholder: true,
    requiresBackend: false,
    title: "Voice",
  },
  {
    enabled: true,
    id: "library",
    label: "Post Library",
    navOrder: 2,
    path: "/library",
    placeholder: true,
    requiresBackend: false,
    title: "Post Library",
  },
  {
    enabled: true,
    id: "settings",
    label: "Settings",
    navOrder: 3,
    path: "/settings",
    placeholder: false,
    requiresBackend: true,
    title: "Settings",
  },
]);

const requireWriterRoute = (): RouteConfig => {
  const route = appRoutes.find((candidate) => candidate.id === "writer");

  if (route === undefined) {
    throw new Error("Route registry must include the Writer route.");
  }

  return route;
};

const writerRoute = requireWriterRoute();

export function validateRouteConfigs(input: unknown): RouteConfig[] {
  return routeConfigSchema.array().parse(input);
}

export function resolveRoutePath(path: string): RouteResolution {
  const route = appRoutes.find((candidate) => candidate.path === path);

  if (route !== undefined) {
    return {
      route,
      canonicalPath: route.path,
      shouldReplace: false,
    };
  }

  return {
    route: writerRoute,
    canonicalPath: writerRoute.path,
    shouldReplace: true,
  };
}
