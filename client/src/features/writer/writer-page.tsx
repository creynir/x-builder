import {
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  apiErrorSchema,
  generateIdeaRequestSchema,
  type ApiError,
  type GenerateIdeaRequest,
  type GenerateIdeaResponse,
  type GeneratedIdeaCandidate,
} from "@x-builder/shared";

import { RouteErrorBanner } from "../../shell/route-error-banner";
import { Badge, Button, Skeleton } from "../../ui/foundation";

export type WriterApiClient = {
  generateIdea: (input: GenerateIdeaRequest) => Promise<GenerateIdeaResponse>;
};

export type WriterPageProps = {
  apiClient: WriterApiClient;
  onOpenSettings: () => void;
};

type WriterPageModel = {
  candidates: GeneratedIdeaCandidate[];
  fieldError: string | null;
  idea: string;
  isGenerating: boolean;
  lastPayload: GenerateIdeaRequest | null;
  routeError: ApiError | null;
};

export type WriterPagePublicDriverOptions = WriterPageProps & {
  renderPage?: (props: WriterPageProps) => ReactElement;
};

export type WriterPagePublicDriver = {
  generate: () => Promise<string>;
  openSettings: () => void;
  render: () => string;
  retry: () => Promise<string>;
  updateIdea: (idea: string) => string;
};

const emptyIdeaError = "Enter an idea before generating.";

function createInitialModel(): WriterPageModel {
  return {
    candidates: [],
    fieldError: null,
    idea: "",
    isGenerating: false,
    lastPayload: null,
    routeError: null,
  };
}

function normalizeWriterError(error: unknown): ApiError {
  if (
    typeof error === "object" &&
    error !== null &&
    "apiError" in error
  ) {
    const parsed = apiErrorSchema.safeParse((error as { apiError: unknown }).apiError);

    if (parsed.success) {
      return parsed.data;
    }
  }

  return {
    code: "generation_failed",
    message: "Generation failed. Your idea is still here.",
    retryable: true,
    scope: "writer",
    status: 500,
  };
}

type PayloadResult =
  | {
      payload: GenerateIdeaRequest;
      type: "valid";
    }
  | {
      fieldError: string;
      type: "field-error";
    };

function payloadFromIdea(idea: string): PayloadResult {
  const trimmedIdea = idea.trim();

  if (trimmedIdea.length === 0) {
    return {
      fieldError: emptyIdeaError,
      type: "field-error",
    };
  }

  const parsed = generateIdeaRequestSchema.safeParse({
    idea: trimmedIdea,
  });

  if (!parsed.success) {
    return {
      fieldError: parsed.error.flatten().fieldErrors.idea?.[0] ?? "Idea is invalid.",
      type: "field-error",
    };
  }

  return {
    payload: parsed.data,
    type: "valid",
  };
}

function candidateLabel(format: GeneratedIdeaCandidate["format"]): string {
  return format;
}

type WriterPageViewProps = WriterPageModel & {
  onGenerate: () => void;
  onIdeaChange: (idea: string) => void;
  onOpenSettings: () => void;
  onRetry: () => Promise<void>;
};

function WriterPageView({
  candidates,
  fieldError,
  idea,
  isGenerating,
  onGenerate,
  onIdeaChange,
  onOpenSettings,
  onRetry,
  routeError,
}: WriterPageViewProps): ReactElement {
  const ideaErrorId = fieldError === null ? undefined : "writer-idea-error";
  const helperId = "writer-idea-helper";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onGenerate();
  };

  return (
    <section className="xb-writer-page" aria-label="Writer workspace">
      <RouteErrorBanner
        error={routeError}
        isRetrying={isGenerating}
        onOpenSettings={onOpenSettings}
        onRetry={onRetry}
      />
      <form
        aria-label="Idea input"
        aria-busy={isGenerating}
        className="xb-writer-form"
        onSubmit={handleSubmit}
      >
        <label className="xb-writer-form__label" htmlFor="writer-idea">
          Idea
        </label>
        <textarea
          aria-describedby={fieldError === null ? helperId : `${helperId} ${ideaErrorId}`}
          aria-invalid={fieldError === null ? undefined : true}
          id="writer-idea"
          onChange={(event) => onIdeaChange(event.target.value)}
          placeholder="Paste a raw idea or rough angle..."
          value={idea}
        />
        <p className="xb-writer-form__helper" id={helperId}>
          Start with the messy version. The engine will shape three first-pass directions.
        </p>
        {fieldError === null ? null : (
          <p className="xb-writer-form__error" id={ideaErrorId}>
            {fieldError}
          </p>
        )}
        <Button loading={isGenerating} type="submit" variant="primary">
          Generate
        </Button>
      </form>
      <section
        aria-label="Generated candidates"
        aria-live="polite"
        className="xb-writer-results"
      >
        {isGenerating ? (
          <div className="xb-writer-results__skeletons">
            <Skeleton height={92} label="Generating candidate one" width={540} />
            <Skeleton height={92} label="Generating candidate two" width={540} />
            <Skeleton height={92} label="Generating candidate three" width={540} />
          </div>
        ) : null}
        {!isGenerating && candidates.length > 0 ? (
          <div className="xb-writer-candidates">
            {candidates.map((candidate) => (
              <article className="xb-writer-candidate" key={candidate.id}>
                <Badge variant="info">{candidateLabel(candidate.format)}</Badge>
                <p>{candidate.text}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}

type GenerationResult =
  | {
      candidates: GeneratedIdeaCandidate[];
      type: "success";
    }
  | {
      error: ApiError;
      type: "error";
    };

async function requestGeneration(
  apiClient: WriterApiClient,
  payload: GenerateIdeaRequest,
): Promise<GenerationResult> {
  try {
    const response = await apiClient.generateIdea(payload);

    return {
      candidates: response.candidates,
      type: "success",
    };
  } catch (error) {
    return {
      error: normalizeWriterError(error),
      type: "error",
    };
  }
}

function applyGenerationResult(
  model: WriterPageModel,
  payload: GenerateIdeaRequest,
  result: GenerationResult,
): WriterPageModel {
  if (result.type === "success") {
    return {
      ...model,
      candidates: result.candidates,
      fieldError: null,
      isGenerating: false,
      lastPayload: payload,
      routeError: null,
    };
  }

  const ideaFieldError = result.error.fieldErrors?.idea?.[0];

  if (result.error.scope === "field" && ideaFieldError !== undefined) {
    return {
      ...model,
      fieldError: ideaFieldError,
      isGenerating: false,
      lastPayload: payload,
      routeError: null,
    };
  }

  return {
    ...model,
    fieldError: null,
    isGenerating: false,
    lastPayload: payload,
    routeError: result.error,
  };
}

export function WriterPage({
  apiClient,
  onOpenSettings,
}: WriterPageProps): ReactElement {
  const [model, setModel] = useState(createInitialModel);

  const updateIdea = (idea: string) => {
    setModel((current) => ({
      ...current,
      fieldError: null,
      idea,
    }));
  };

  const generate = () => {
    void (async () => {
      const payloadResult = payloadFromIdea(model.idea);

      if (payloadResult.type === "field-error") {
        setModel((current) => ({
          ...current,
          fieldError: payloadResult.fieldError,
          routeError: null,
        }));
        return;
      }

      const { payload } = payloadResult;

      setModel((current) => ({
        ...current,
        fieldError: null,
        isGenerating: true,
        lastPayload: payload,
      }));
      const result = await requestGeneration(apiClient, payload);
      setModel((current) => applyGenerationResult(current, payload, result));
    })();
  };

  const retry = async () => {
    const payload = model.lastPayload;

    if (payload === null) {
      return;
    }

    setModel((current) => ({
      ...current,
      isGenerating: true,
    }));
    const result = await requestGeneration(apiClient, payload);
    setModel((current) => applyGenerationResult(current, payload, result));
  };

  return (
    <WriterPageView
      {...model}
      onGenerate={generate}
      onIdeaChange={updateIdea}
      onOpenSettings={onOpenSettings}
      onRetry={retry}
    />
  );
}

function renderDriverPage(
  onOpenSettings: () => void,
  model: WriterPageModel,
) {
  return renderToStaticMarkup(
    <WriterPageView
      {...model}
      onGenerate={() => undefined}
      onIdeaChange={() => undefined}
      onOpenSettings={onOpenSettings}
      onRetry={async () => undefined}
    />,
  );
}

export function createWriterPagePublicDriver(
  options: WriterPagePublicDriverOptions,
): WriterPagePublicDriver {
  let model = createInitialModel();

  const render = () => renderDriverPage(options.onOpenSettings, model);

  const generate = async () => {
    const payloadResult = payloadFromIdea(model.idea);

    if (payloadResult.type === "field-error") {
      model = {
        ...model,
        fieldError: payloadResult.fieldError,
        routeError: null,
      };
      return render();
    }

    const { payload } = payloadResult;

    model = {
      ...model,
      fieldError: null,
      isGenerating: true,
      lastPayload: payload,
    };
    model = applyGenerationResult(
      model,
      payload,
      await requestGeneration(options.apiClient, payload),
    );
    return render();
  };

  return {
    generate,
    openSettings: () => {
      options.onOpenSettings();
    },
    render,
    retry: async () => {
      const payload = model.lastPayload;

      if (payload === null) {
        return render();
      }

      model = {
        ...model,
        isGenerating: true,
      };
      model = applyGenerationResult(
        model,
        payload,
        await requestGeneration(options.apiClient, payload),
      );
      return render();
    },
    updateIdea: (idea: string) => {
      model = {
        ...model,
        fieldError: null,
        idea,
      };
      return render();
    },
  };
}
