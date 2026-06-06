import { describe, expect, it } from "vitest";
import { routeConfigSchema, type RouteConfig } from "@x-builder/shared";

import { appRoutes, resolveRoutePath, validateRouteConfigs } from "../route-registry";

const routeById = (routes: RouteConfig[], id: RouteConfig["id"]) => {
  const route = routes.find((candidate) => candidate.id === id);

  if (!route) {
    throw new Error(`Expected route registry to include ${id}.`);
  }

  return route;
};

describe("route registry", () => {
  it("redirects the root URL to the Writer route", () => {
    const resolution = resolveRoutePath("/");

    expect(resolution.route.id).toBe("writer");
    expect(resolution.route.path).toBe("/writer");
    expect(resolution.canonicalPath).toBe("/writer");
    expect(resolution.shouldReplace).toBe(true);
  });

  it("falls back unknown URLs to the Writer route", () => {
    const resolution = resolveRoutePath("/not-a-real-route");

    expect(resolution.route.id).toBe("writer");
    expect(resolution.route.path).toBe("/writer");
    expect(resolution.canonicalPath).toBe("/writer");
    expect(resolution.shouldReplace).toBe(true);
  });

  it("loads Voice and Post Library as enabled placeholder routes", () => {
    const routes: RouteConfig[] = validateRouteConfigs(appRoutes);
    const voiceRoute = routeById(routes, "voice");
    const libraryRoute = routeById(routes, "library");

    expect(routeConfigSchema.parse(voiceRoute)).toMatchObject({
      enabled: true,
      id: "voice",
      path: "/voice",
      placeholder: true,
    });
    expect(routeConfigSchema.parse(libraryRoute)).toMatchObject({
      enabled: true,
      id: "library",
      path: "/library",
      placeholder: true,
    });
  });

  it("validates route configs with the shared route schema", () => {
    const invalidRoutes = [
      {
        enabled: true,
        id: "writer",
        label: "Writer",
        navOrder: 0,
        path: "/drafts",
        placeholder: false,
        requiresBackend: false,
        title: "Writer",
      },
    ];

    expect(() => validateRouteConfigs(invalidRoutes)).toThrow();
  });
});
