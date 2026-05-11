// @vitest-environment jsdom
//// Neocompany Modification — UI test for CreateCompanyDialog (Phase 3)
//// Pins the create-company flow: name required, isTest checkbox toggles,
//// onSubmit calls companiesApi.create with the full payload, success
//// toast + dialog close. Catches regressions in the SuperAdmin create
//// flow that the E2E (admin.spec.ts) only validates at the HTTP layer.
//// End Neocompany Modification

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCompaniesApi = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockPushToast = vi.hoisted(() => vi.fn());

vi.mock("@/api/companies", () => ({
  companiesApi: mockCompaniesApi,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    pushToast: mockPushToast,
  }),
}));

import { CreateCompanyDialog } from "./CreateCompanyDialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function newQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CreateCompanyDialog", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    onClose = vi.fn();
    mockCompaniesApi.create.mockReset();
    mockPushToast.mockReset();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    document.body.removeChild(container);
  });

  async function render(): Promise<void> {
    const qc = newQueryClient();
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={qc}>
          <CreateCompanyDialog onClose={onClose} />
        </QueryClientProvider>,
      );
    });
  }

  function nameInput(): HTMLInputElement {
    const inputs = container.querySelectorAll<HTMLInputElement>(
      "input:not([type='checkbox'])",
    );
    return inputs[0]!;
  }

  function descriptionInput(): HTMLInputElement {
    const inputs = container.querySelectorAll<HTMLInputElement>(
      "input:not([type='checkbox'])",
    );
    return inputs[1]!;
  }

  function isTestCheckbox(): HTMLInputElement {
    return container.querySelector<HTMLInputElement>("input[type='checkbox']")!;
  }

  function createButton(): HTMLButtonElement {
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.match(/^(Create|Creating…)$/),
    )!;
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("renders the create form with name, description, and isTest checkbox", async () => {
    await render();

    expect(nameInput()).toBeTruthy();
    expect(descriptionInput()).toBeTruthy();
    expect(isTestCheckbox()).toBeTruthy();
    expect(container.textContent).toContain("🧪 Test company");
    expect(container.textContent).toContain("Hidden from client boards");
  });

  it("disables the Create button when name is empty", async () => {
    await render();
    expect(createButton().disabled).toBe(true);
  });

  it("enables Create once a name is entered", async () => {
    await render();

    await act(async () => {
      setInputValue(nameInput(), "Acme Labs");
    });
    expect(createButton().disabled).toBe(false);
  });

  it("submits with isTest=false by default and calls onClose on success", async () => {
    mockCompaniesApi.create.mockResolvedValue({ id: "co-new", name: "Acme Labs" });
    await render();

    await act(async () => {
      setInputValue(nameInput(), "Acme Labs");
      setInputValue(descriptionInput(), "Manufacturer of widgets");
    });

    await act(async () => {
      createButton().click();
    });
    await flushAsync();

    expect(mockCompaniesApi.create).toHaveBeenCalledTimes(1);
    expect(mockCompaniesApi.create).toHaveBeenCalledWith({
      name: "Acme Labs",
      description: "Manufacturer of widgets",
      isTest: false,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPushToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success" }),
    );
  });

  it("submits with isTest=true when the checkbox is ticked", async () => {
    mockCompaniesApi.create.mockResolvedValue({ id: "co-test", name: "__E2E_TEST__" });
    await render();

    await act(async () => {
      setInputValue(nameInput(), "__E2E_TEST__");
      isTestCheckbox().click();
    });
    expect(isTestCheckbox().checked).toBe(true);

    await act(async () => {
      createButton().click();
    });
    await flushAsync();

    expect(mockCompaniesApi.create).toHaveBeenCalledWith({
      name: "__E2E_TEST__",
      description: null,
      isTest: true,
    });
  });

  it("shows an error toast and does NOT close the dialog when create fails", async () => {
    mockCompaniesApi.create.mockRejectedValue(new Error("duplicate prefix"));
    await render();

    await act(async () => {
      setInputValue(nameInput(), "Conflicting Name");
    });
    await act(async () => {
      createButton().click();
    });
    await flushAsync();

    expect(mockPushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "error",
        title: expect.stringContaining("duplicate prefix"),
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
