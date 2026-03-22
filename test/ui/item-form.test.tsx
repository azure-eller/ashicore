import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockPush = vi.fn();
const mockBack = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

vi.mock("@/lib/units-of-measure", () => ({
  getUomOptions: () => [
    {
      category: "Weight",
      options: [{ value: "kg", label: "Kilogram (kg)" }],
    },
  ],
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => <span data-testid="icon" />,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  ArrowDown01Icon: "arrow-down-icon",
  Cancel01Icon: "cancel-icon",
  Tick02Icon: "tick-icon",
}));

vi.mock("@/components/ui/select", () => {
  type SelectContextValue = {
    name?: string;
    onValueChange?: (value: string) => void;
    value?: string;
  };

  const SelectContext = React.createContext<SelectContextValue>({});

  function Select({
    children,
    name,
    onValueChange,
    value,
  }: React.PropsWithChildren<SelectContextValue>) {
    return (
      <SelectContext.Provider value={{ name, onValueChange, value }}>
        {children}
      </SelectContext.Provider>
    );
  }

  function SelectTrigger({
    children,
    id,
    ...props
  }: React.PropsWithChildren<
    { id?: string } & React.HTMLAttributes<HTMLDivElement>
  >) {
    return (
      <div data-slot="select-trigger" id={id} {...props}>
        {children}
      </div>
    );
  }

  function SelectValue({ placeholder }: { placeholder?: string }) {
    const context = React.useContext(SelectContext);
    return <span>{context.value ? undefined : placeholder}</span>;
  }

  function SelectContent({ children }: React.PropsWithChildren) {
    const context = React.useContext(SelectContext);
    return (
      <select
        aria-label={context.name ?? ""}
        data-testid={`select-${context.name ?? "unknown"}`}
        value={context.value ?? ""}
        onChange={(event) => context.onValueChange?.(event.target.value)}
      >
        <option value="">--</option>
        {children}
      </select>
    );
  }

  function SelectItem({
    children,
    value,
  }: React.PropsWithChildren<{ value: string }>) {
    return <option value={value}>{children}</option>;
  }

  function SelectGroup({ children }: React.PropsWithChildren) {
    return <>{children}</>;
  }

  function SelectLabel({ children }: React.PropsWithChildren) {
    return <>{children}</>;
  }

  function SelectSeparator() {
    return null;
  }

  return {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
  };
});

import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mockPush.mockReset();
  mockBack.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const defaultProps = {
  itemType: "product" as const,
  units: [{ id: "unit-1", name: "Bag", size: "25", uom: "kg" }],
  categories: ["Soil", "Aggregate"],
  availableComponents: [
    { id: "comp-a", name: "Sand", itemType: "material", unit: "Bag" },
    { id: "comp-b", name: "Gravel", itemType: "material", unit: "Bag" },
  ],
};

function renderItemForm(
  props?: Partial<React.ComponentProps<typeof ItemForm>>
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ItemForm {...defaultProps} {...props} />
    </QueryClientProvider>
  );
}

function mockFetchSuccess(data: Record<string, unknown> = { id: "new-id" }) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

function getSubmittedPayload(callIndex = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

async function selectMockedOption(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  value: string
) {
  await user.selectOptions(screen.getByTestId(testId), value);
}

describe("ItemForm", () => {
  test("submits a quantity-only product payload", async () => {
    const user = userEvent.setup();
    mockFetchSuccess();
    renderItemForm();

    await user.type(screen.getByLabelText("Name"), "Quantity Only Product");
    await selectMockedOption(user, "select-unitDefinitionId", "unit-1");
    await user.click(screen.getByRole("button", { name: "Create Product" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/items",
      expect.objectContaining({ method: "POST" })
    );

    expect(getSubmittedPayload()).toMatchObject({
      bom: [],
      itemType: "product",
      name: "Quantity Only Product",
      unitDefinitionId: "unit-1",
    });
    expect(getSubmittedPayload()).not.toHaveProperty("bomMode");
    expect(mockPush).toHaveBeenCalledWith("/inventory/products");
  });

  test("BOM editor stays quantity-only", async () => {
    const user = userEvent.setup();
    renderItemForm();

    expect(
      screen.getByText("Add ingredients to define what goes into one unit of this product.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Quantity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Percentage" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add Ingredient" }));

    expect(screen.getByRole("columnheader", { name: "Qty" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "%" })).not.toBeInTheDocument();
  });

  test("create unit dialog requires all fields before enabling create", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await selectMockedOption(user, "select-unitDefinitionId", "__create_new__");

    const dialog = screen.getByRole("dialog");
    const createButton = within(dialog).getByRole("button", {
      name: "Create",
      exact: true,
    });

    expect(createButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Name"), "Bag");
    expect(createButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Size"), "1");
    expect(createButton).toBeDisabled();

    await user.selectOptions(
      within(dialog).getByTestId("select-unknown"),
      "kg"
    );
    expect(createButton).toBeEnabled();
  });
});
