import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  ApiError,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
} from "@x-builder/shared";

const writerPageModulePath = "../writer-page";

type WriterApiClient = {
  generateIdea: (input: GenerateIdeaRequest) => Promise<GenerateIdeaResponse>;
};

type WriterPageProps = {
  apiClient: WriterApiClient;
  onOpenSettings: () => void;
};

type WriterPagePublicDriverOptions = WriterPageProps & {
  renderPage?: (props: WriterPageProps) => ReactElement;
};

type WriterPagePublicDriver = {
  generate: () => Promise<string>;
  openSettings: () => void;
  render: () => string;
  retry: () => Promise<string>;
  updateIdea: (idea: string) => string;
};

type WriterPageModule = {
  WriterPage: (props: WriterPageProps) => ReactElement;
  createWriterPagePublicDriver: (
    options: WriterPagePublicDriverOptions,
  ) => WriterPagePublicDriver;
};

async function loadWriterPage() {
  return (await import(writerPageModulePath)) as WriterPageModule;
}

function textContent(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function expectIdeaPreserved(html: string, idea: string) {
  expect(html).toContain(escapeHtml(idea));
}

function createValidIdeaResponse(): GenerateIdeaResponse {
  return {
    candidates: [
      {
        format: "one-liner",
        id: "candidate-one-liner",
        text: "Local-first writing tools need boring edges.",
      },
      {
        format: "mini-framework",
        id: "candidate-mini-framework",
        text: "Name the constraint, show the tradeoff, then make the local-first call.",
      },
      {
        format: "debate-question",
        id: "candidate-debate-question",
        text: "What local-first compromise would make builders trust the tool more?",
      },
    ],
  };
}

function createApiError(overrides: Partial<ApiError> = {}): ApiError {
  return {
    code: "engine_unreachable",
    message: "Could not reach the local engine. Your idea is still here.",
    retryable: true,
    scope: "writer",
    status: 503,
    ...overrides,
  };
}

function throwApiError(apiError: ApiError): never {
  throw Object.assign(new Error(apiError.message), {
    apiError,
  });
}

function createApiClient(
  generateIdea: WriterApiClient["generateIdea"] = vi.fn(async () =>
    createValidIdeaResponse(),
  ),
): WriterApiClient {
  return {
    generateIdea,
  };
}

function createDriver(
  createWriterPagePublicDriver: WriterPageModule["createWriterPagePublicDriver"],
  options: WriterPagePublicDriverOptions,
) {
  return createWriterPagePublicDriver(options);
}

describe("WriterPage generation behavior", () => {
  it("keeps empty submissions local and shows a field error", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const apiClient = createApiClient();
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("   ");
    const html = await driver.generate();

    expect(apiClient.generateIdea).not.toHaveBeenCalled();
    expect(textContent(html)).toContain("Enter an idea before generating.");
  });

  it("submits valid ideas through the typed API boundary and renders three candidates", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const apiClient = createApiClient(vi.fn(async () => response));
    const idea = "Make a local-first writing tool feel trustworthy.";
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expect(apiClient.generateIdea).toHaveBeenCalledOnce();
    expect(apiClient.generateIdea).toHaveBeenCalledWith({
      idea,
    });
    expect(text).toContain("Local-first writing tools need boring edges.");
    expect(text).toContain(
      "Name the constraint, show the tradeoff, then make the local-first call.",
    );
    expect(text).toContain(
      "What local-first compromise would make builders trust the tool more?",
    );
    expect(text).toContain("one-liner");
    expect(text).toContain("mini-framework");
    expect(text).toContain("debate-question");
  });

  it("keeps overlong ideas local and shows the shared field validation message", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const apiClient = createApiClient();
    const idea = "x".repeat(4_001);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expect(apiClient.generateIdea).not.toHaveBeenCalled();
    expectIdeaPreserved(html, idea);
    expect(text).toContain("Idea must be 4,000 characters or fewer.");
    expect(text).not.toContain("Route unavailable");
    expect(text).not.toContain("Retry");
  });

  it("maps backend idea field validation to the local Idea error", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const validationError = createApiError({
      code: "validation_failed",
      fieldErrors: {
        idea: ["Idea must be 4,000 characters or fewer."],
      },
      message: "The request is invalid.",
      retryable: false,
      scope: "field",
      status: 400,
    });
    const apiClient = createApiClient(
      vi.fn(async () => throwApiError(validationError)),
    );
    const idea = "This idea passes local validation but fails at the backend boundary.";
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expect(apiClient.generateIdea).toHaveBeenCalledOnce();
    expectIdeaPreserved(html, idea);
    expect(text).toContain("Idea must be 4,000 characters or fewer.");
    expect(text).not.toContain("Route unavailable");
    expect(text).not.toContain("Retry");
  });

  it("preserves the idea and offers retry plus Settings when the backend is unavailable", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const engineError = createApiError();
    const apiClient = createApiClient(vi.fn(async () => throwApiError(engineError)));
    const onOpenSettings = vi.fn();
    const idea = "The engine may be offline, but the draft should survive.";
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings,
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expectIdeaPreserved(html, idea);
    expect(text).toContain("Could not reach the local engine. Your idea is still here.");
    expect(text).toContain("Retry");
    expect(text).toContain("Open Settings");

    driver.openSettings();

    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("retries failed generation with the same payload", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const engineError = createApiError();
    const response = createValidIdeaResponse();
    const generateIdea = vi
      .fn<WriterApiClient["generateIdea"]>()
      .mockImplementationOnce(async () => throwApiError(engineError))
      .mockImplementationOnce(async () => response);
    const apiClient = createApiClient(generateIdea);
    const idea = "Retry should not mutate the submitted idea.";
    const expectedPayload: GenerateIdeaRequest = {
      idea,
    };
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    await driver.generate();
    const retryHtml = await driver.retry();

    expect(generateIdea).toHaveBeenCalledTimes(2);
    expect(generateIdea).toHaveBeenNthCalledWith(1, expectedPayload);
    expect(generateIdea).toHaveBeenNthCalledWith(2, expectedPayload);
    expect(textContent(retryHtml)).toContain(
      "Local-first writing tools need boring edges.",
    );
  });

  it("shows invalid_response as a route error when the API client rejects schema output", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const invalidResponseError = createApiError({
      code: "invalid_response",
      message: "invalid_response",
      retryable: true,
      scope: "writer",
      status: 502,
    });
    const apiClient = createApiClient(
      vi.fn(async () => throwApiError(invalidResponseError)),
    );
    const idea = "Bad candidate payloads should not look successful.";
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expectIdeaPreserved(html, idea);
    expect(text).toContain("invalid_response");
    expect(text).toContain("Retry");
  });
});
