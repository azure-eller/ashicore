import { render, screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/units-of-measure", () => ({
  getUomOptions: () => [
    {
      category: "Weight",
      options: [{ value: "kg", label: "Kilogram (kg)" }],
    },
  ],
}));

// HugeIcons fail in jsdom — stub them out
vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: ({ icon, ...props }: any) => (
    <span data-testid="icon" {...props} />
  ),
}));
vi.mock("@hugeicons/core-free-icons", () => ({
  Cancel01Icon: "i",
  ArrowDown01Icon: "i",
  ArrowUp01Icon: "i",
  Tick02Icon: "i",
  UnfoldMoreIcon: "i",
  SortByDown02Icon: "i",
  SortByUp02Icon: "i",
  Add01Icon: "i",
  MoreVerticalIcon: "i",
  ArrowLeft01Icon: "i",
  ArrowRight01Icon: "i",
  MoreHorizontalCircle01Icon: "i",
  SidebarLeftIcon: "i",
  PackageIcon: "i",
  LayoutBottomIcon: "i",
  Notification03Icon: "i",
  CheckmarkBadgeIcon: "i",
  LogoutIcon: "i",
  PlusSignIcon: "i",
  Sun03Icon: "i",
  Moon02Icon: "i",
}));

/**
 * Radix Select does not work in jsdom (value selection via pointer events fails).
 * We replace it with a jsdom-friendly implementation that uses a native <select>.
 * A React context passes the controlled value/onValueChange from <Select> root
 * down to <SelectContent> which renders the actual <select>.
 */
vi.mock("@/components/ui/select", () => {
  const SelectCtx = React.createContext<{
    value?: string;
    onValueChange?: (v: string) => void;
    name?: string;
  }>({});

  function Select({ children, value, onValueChange, name }: any) {
    return (
      <SelectCtx.Provider value={{ value, onValueChange, name }}>
        {children}
      </SelectCtx.Provider>
    );
  }

  function SelectTrigger({ children, id, className, ...props }: any) {
    // Render a non-interactive wrapper; the real selection happens via <select>
    return (
      <div data-slot="select-trigger" id={id} {...props}>
        {children}
      </div>
    );
  }

  function SelectValue({ placeholder }: any) {
    const ctx = React.useContext(SelectCtx);
    return <span>{ctx.value ? undefined : placeholder}</span>;
  }

  function SelectContent({ children }: any) {
    const ctx = React.useContext(SelectCtx);
    return (
      <select
        data-testid={`select-${ctx.name || "unknown"}`}
        aria-label={ctx.name || ""}
        value={ctx.value || ""}
        onChange={(e) => ctx.onValueChange?.(e.target.value)}
      >
        <option value="">--</option>
        {children}
      </select>
    );
  }

  function SelectItem({ children, value: v }: any) {
    return <option value={v}>{children}</option>;
  }

  function SelectGroup({ children }: any) {
    return <>{children}</>;
  }
  function SelectLabel({ children }: any) {
    return <>{children}</>;
  }
  function SelectSeparator() {
    return null;
  }

  return {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
  };
});

// Import ItemForm AFTER all vi.mock calls (hoisting ensures correct order)
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mockPush.mockReset();
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
    { id: "comp-c", name: "Cement", itemType: "material", unit: "Bag" },
    { id: "comp-d", name: "Water", itemType: "material", unit: "Bag" },
  ],
};

function renderItemForm(
  props?: Partial<React.ComponentProps<typeof ItemForm>>
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
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

function mockFetchError(
  body: Record<string, unknown> = { error: "Something went wrong" },
  status = 500
) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => body,
  });
}

/** Parse the JSON body from the Nth fetch call */
function getSubmittedPayload(callIndex = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[callIndex];
  return JSON.parse(init.body as string);
}

/**
 * Select a value from a mocked Radix Select (rendered as native <select>).
 */
async function selectFromMockedSelect(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  value: string
) {
  const sel = screen.getByTestId(testId) as HTMLSelectElement;
  await user.selectOptions(sel, value);
}

/**
 * Select a BOM component by typing into the base-ui Combobox input.
 */
async function selectBomComponent(
  user: ReturnType<typeof userEvent.setup>,
  rowIndex: number,
  componentName: string
) {
  const inputs = screen.getAllByPlaceholderText("Search items...");
  const input = inputs[rowIndex];
  await user.click(input);
  await user.clear(input);
  await user.type(input, componentName);
  const option = await screen.findByRole("option", {
    name: new RegExp(componentName, "i"),
  });
  await user.click(option);
}

/**
 * The form's create-mode defaultValues omit nullable fields (sku, category,
 * description, prices). These Controllers register with value=undefined.
 * The Zod schema (via drizzle-zod) does NOT add .optional() when a direct
 * refinement value is provided, so undefined fails validation.
 *
 * In the real browser, users interact with (or at least Tab through) fields,
 * triggering onChange which sets them to "". We replicate this here.
 */
async function touchOptionalFields(
  user: ReturnType<typeof userEvent.setup>
) {
  // Type and delete to set empty string (not undefined) in react-hook-form.
  // The Zod schema rejects undefined but accepts "" for nullable string fields.
  for (const label of [
    "SKU",
    "Description",
    "Purchase Price",
    "Selling Price",
  ]) {
    const input = screen.getByLabelText(label);
    await user.type(input, "x");
    await user.clear(input);
  }
  // Category: the Combobox onInputValueChange fires setCategoryInput,
  // and the Controller's onChange fires when a value is selected.
  // We type and clear to set the input's value, which triggers the Controller.
  const catInput = screen.getByPlaceholderText("Search or create category...");
  await user.type(catInput, "x");
  await user.clear(catInput);
  // Close any open Combobox dropdown by pressing Escape
  await user.keyboard("{Escape}");
}

/**
 * Fill the minimum required fields + touch optionals so the form can submit.
 */
async function fillRequiredFields(
  user: ReturnType<typeof userEvent.setup>
) {
  const nameInput = screen.getByLabelText("Name");
  await user.clear(nameInput);
  await user.type(nameInput, "Test Product");

  await selectFromMockedSelect(user, "select-unitDefinitionId", "unit-1");

  await touchOptionalFields(user);
}

async function addBomRow(user: ReturnType<typeof userEvent.setup>) {
  const addBtn = screen.getByRole("button", { name: /add ingredient/i });
  await user.click(addBtn);
}

async function typeBomValue(
  user: ReturnType<typeof userEvent.setup>,
  rowIndex: number,
  value: string
) {
  const valueInputs = screen
    .getAllByPlaceholderText("0")
    .filter((el) => el.closest("td") !== null);
  const input = valueInputs[rowIndex];
  await user.clear(input);
  await user.type(input, value);
}

async function switchBomMode(
  user: ReturnType<typeof userEvent.setup>,
  mode: "quantity" | "percentage"
) {
  await selectFromMockedSelect(user, "select-bomMode", mode);
}

async function clickSubmit(user: ReturnType<typeof userEvent.setup>) {
  const btn = screen.getByRole("button", { name: /create product/i });
  await user.click(btn);
}

async function clickSaveChanges(user: ReturnType<typeof userEvent.setup>) {
  const btn = screen.getByRole("button", { name: /save changes/i });
  await user.click(btn);
}

function getBomRemoveButtons() {
  const dataRows = screen
    .getAllByRole("row")
    .filter((row) => row.querySelector("td"));
  return dataRows.map((row) => {
    const cells = row.querySelectorAll("td");
    const lastCell = cells[cells.length - 1];
    return within(lastCell as HTMLElement).getByRole("button");
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("product-bom UI contracts", () => {
  // 1. category-create-new-via-combobox
  test("category-create-new-via-combobox: typing a new category shows create option and includes it in payload", async () => {
    const user = userEvent.setup();
    renderItemForm();
    mockFetchSuccess();

    await fillRequiredFields(user);

    // Type a new category into the category combobox
    const categoryInput = screen.getByPlaceholderText(
      "Search or create category..."
    );
    await user.clear(categoryInput);
    await user.type(categoryInput, "Mulch");

    // The create option should appear
    const createOption = await screen.findByText('+ Create "Mulch"');
    expect(createOption).toBeInTheDocument();
    await user.click(createOption);

    await clickSubmit(user);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const payload = getSubmittedPayload();
    expect(payload.category).toBe("Mulch");
  });

  // 2. unit-immutable-on-edit
  test("unit-immutable-on-edit: edit mode shows unit as static text and payload excludes unitDefinitionId and itemType", async () => {
    const user = userEvent.setup();
    renderItemForm({
      initialData: {
        id: "item-1",
        name: "Existing Product",
        sku: "SKU-001",
        itemType: "product",
        category: "Soil",
        description: "A product",
        unitDefinitionId: "unit-1",
        defaultPurchasePrice: "10.00",
        defaultSellingPrice: "20.00",
        bomMode: "quantity",
        stock: "5",
        committedQty: "0",
        expectedQty: "0",
        safetyStock: "1",
        unitName: "Bag",
        unitSize: "25",
        unitUom: "kg",
        bom: [],
      },
    });
    mockFetchSuccess();

    // Unit should show as static text
    expect(screen.getByText("Bag (25 kg)")).toBeInTheDocument();
    // No unit select in edit mode
    expect(
      screen.queryByTestId("select-unitDefinitionId")
    ).not.toBeInTheDocument();

    await clickSaveChanges(user);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const payload = getSubmittedPayload();
    expect(payload).not.toHaveProperty("unitDefinitionId");
    expect(payload).not.toHaveProperty("itemType");
  });

  // 3. bom-mode-switch-preserves-stale-quantity-values
  test("bom-mode-switch-preserves-stale-quantity-values: switching to percentage mode preserves stale quantity in payload", async () => {
    const user = userEvent.setup();
    renderItemForm();
    mockFetchSuccess();

    await fillRequiredFields(user);
    await addBomRow(user);
    await selectBomComponent(user, 0, "Sand");
    await typeBomValue(user, 0, "5.5");

    await switchBomMode(user, "percentage");
    await typeBomValue(user, 0, "50");

    await clickSubmit(user);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const payload = getSubmittedPayload();
    const bom = payload.bom as Array<Record<string, unknown>>;
    expect(bom).toHaveLength(1);
    expect(bom[0].quantity).toBe("5.5");
    expect(bom[0].percentage).toBe("50");
  });

  // 4. bom-mode-roundtrip-stale-data-both-directions
  test("bom-mode-roundtrip-stale-data-both-directions: switching modes back and forth preserves both quantity and percentage", async () => {
    const user = userEvent.setup();
    renderItemForm();
    mockFetchSuccess();

    await fillRequiredFields(user);
    await addBomRow(user);
    await selectBomComponent(user, 0, "Sand");

    await typeBomValue(user, 0, "10");
    await switchBomMode(user, "percentage");
    await typeBomValue(user, 0, "25");
    await switchBomMode(user, "quantity");

    await clickSubmit(user);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const payload = getSubmittedPayload();
    const bom = payload.bom as Array<Record<string, unknown>>;
    expect(bom[0].quantity).toBe("10");
    expect(bom[0].percentage).toBe("25");
  });

  // 5. bom-row-add-remove-add-reindexing
  test("bom-row-add-remove-add-reindexing: removing middle row and adding new one produces correct indices in payload", async () => {
    const user = userEvent.setup();
    renderItemForm();
    mockFetchSuccess();

    await fillRequiredFields(user);

    await addBomRow(user);
    await addBomRow(user);
    await addBomRow(user);

    await selectBomComponent(user, 0, "Sand");
    await selectBomComponent(user, 1, "Gravel");
    await selectBomComponent(user, 2, "Cement");

    await typeBomValue(user, 0, "1");
    await typeBomValue(user, 1, "2");
    await typeBomValue(user, 2, "3");

    // Remove middle row (Gravel)
    const removeButtons = getBomRemoveButtons();
    await user.click(removeButtons[1]);

    // Add new row with Water
    await addBomRow(user);
    await selectBomComponent(user, 2, "Water");
    await typeBomValue(user, 2, "4");

    await clickSubmit(user);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const payload = getSubmittedPayload();
    const bom = payload.bom as Array<Record<string, unknown>>;
    expect(bom).toHaveLength(3);
    expect(bom[0].componentId).toBe("comp-a");
    expect(bom[0].quantity).toBe("1");
    expect(bom[1].componentId).toBe("comp-c");
    expect(bom[1].quantity).toBe("3");
    expect(bom[2].componentId).toBe("comp-d");
    expect(bom[2].quantity).toBe("4");
  });

  // 6. unit-dialog-create-success-sets-form-value-and-resets-dialog
  test("unit-dialog-create-success-sets-form-value-and-resets-dialog: creating a unit sets form value and closes dialog", async () => {
    const user = userEvent.setup();
    renderItemForm();

    // Select the "__create_new__" sentinel to open the dialog
    await selectFromMockedSelect(
      user,
      "select-unitDefinitionId",
      "__create_new__"
    );

    // Dialog should be open
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Fill dialog fields
    const nameInput = within(dialog).getByLabelText("Name");
    await user.type(nameInput, "Bag");

    const sizeInput = within(dialog).getByLabelText("Size");
    await user.type(sizeInput, "25");

    // UOM select inside dialog
    await selectFromMockedSelect(user, "select-unknown", "kg");

    // Mock unit creation API
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "new-unit-id",
        name: "Bag",
        size: "25",
        uom: "kg",
      }),
    });

    // Click Create in dialog
    const createBtn = within(dialog).getByRole("button", {
      name: /^create$/i,
    });
    await user.click(createBtn);

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Now fill name and touch optional fields
    const formNameInput = screen.getByLabelText("Name");
    await user.clear(formNameInput);
    await user.type(formNameInput, "Test Product");
    await touchOptionalFields(user);

    mockFetchSuccess();
    await clickSubmit(user);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const formPayload = getSubmittedPayload(1);
    expect(formPayload.unitDefinitionId).toBe("new-unit-id");
  });

  // 7. form-error-cleared-on-resubmit
  test("form-error-cleared-on-resubmit: error banner disappears when form is resubmitted", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await fillRequiredFields(user);
    mockFetchError({ error: "Server error occurred" });

    await clickSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("Server error occurred")).toBeInTheDocument();
    });

    mockFetchSuccess();
    await clickSubmit(user);

    await waitFor(() => {
      expect(
        screen.queryByText("Server error occurred")
      ).not.toBeInTheDocument();
    });
  });

  // 8. submit-double-click-guard
  test("submit-double-click-guard: submit button becomes disabled while mutation is pending", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await fillRequiredFields(user);

    // Never-resolving fetch
    fetchMock.mockReturnValueOnce(new Promise(() => {}));

    await clickSubmit(user);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /creating/i });
      expect(btn).toBeDisabled();
    });
  });

  // 9. bom-empty-rows-block-submit-with-component-required-error
  test("bom-empty-rows-block-submit-with-component-required-error: empty BOM row shows component required error", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await fillRequiredFields(user);
    await addBomRow(user);

    await clickSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("Component is required")).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 10. unit-create-sentinel-value-never-reaches-form-state
  test("unit-create-sentinel-value-never-reaches-form-state: closing unit dialog without creating keeps unitDefinitionId empty", async () => {
    const user = userEvent.setup();
    renderItemForm();

    // Select "__create_new__" sentinel to open dialog
    await selectFromMockedSelect(
      user,
      "select-unitDefinitionId",
      "__create_new__"
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Close dialog without creating
    const cancelBtn = within(dialog).getByRole("button", {
      name: /cancel/i,
    });
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Fill name
    const nameInput = screen.getByLabelText("Name");
    await user.type(nameInput, "Test Product");

    await clickSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("Unit is required")).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 11. nullable-fields-empty-string-to-null-transform
  test("nullable-fields-empty-string-to-null-transform: empty optional fields become null in payload", async () => {
    const user = userEvent.setup();
    renderItemForm();
    mockFetchSuccess();

    await fillRequiredFields(user);

    await clickSubmit(user);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const payload = getSubmittedPayload();
    expect(payload.sku).toBeNull();
    expect(payload.description).toBeNull();
    expect(payload.defaultPurchasePrice).toBeNull();
    expect(payload.defaultSellingPrice).toBeNull();
  });

  // 12. validation-errors-appear-on-blur-then-clear-on-fix
  test("validation-errors-appear-on-blur-then-clear-on-fix: name error shows on blur and clears after typing", async () => {
    const user = userEvent.setup();
    renderItemForm();

    const nameInput = screen.getByLabelText("Name");
    await user.click(nameInput);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });

    await user.click(nameInput);
    await user.type(nameInput, "Product");
    await user.tab();

    await waitFor(() => {
      expect(
        screen.queryByText("Name is required")
      ).not.toBeInTheDocument();
    });
  });

  // 13. submit-validation-fires-all-fields-at-once
  test("submit-validation-fires-all-fields-at-once: submitting empty form shows both name and unit errors", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await clickSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
      expect(screen.getByText("Unit is required")).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 14. server-field-errors-displayed-then-cleared-on-resubmit
  test("server-field-errors-displayed-then-cleared-on-resubmit: server field error renders and clears on resubmit", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await fillRequiredFields(user);
    mockFetchError({ errors: { sku: ["SKU already exists"] } }, 422);

    await clickSubmit(user);

    await waitFor(() => {
      expect(screen.getByText(/SKU already exists/)).toBeInTheDocument();
    });

    mockFetchSuccess();
    await clickSubmit(user);

    await waitFor(() => {
      expect(
        screen.queryByText(/SKU already exists/)
      ).not.toBeInTheDocument();
    });
  });

  // 15. bom-mode-switch-changes-table-header-and-controller-name
  test("bom-mode-switch-changes-table-header-and-controller-name: table header changes between Qty and % on mode switch", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await addBomRow(user);

    expect(screen.getByText("Qty")).toBeInTheDocument();
    expect(screen.queryByText("%")).not.toBeInTheDocument();

    await switchBomMode(user, "percentage");

    await waitFor(() => {
      expect(screen.getByText("%")).toBeInTheDocument();
      expect(screen.queryByText("Qty")).not.toBeInTheDocument();
    });
  });

  // 16. bom-validation-error-on-mode-mismatch-submit
  test("bom-validation-error-on-mode-mismatch-submit: switching to percentage mode with empty percentage shows error on submit", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await fillRequiredFields(user);
    await addBomRow(user);
    await selectBomComponent(user, 0, "Sand");
    await typeBomValue(user, 0, "5");

    await switchBomMode(user, "percentage");

    await clickSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("Percentage is required")).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 17. create-product-with-bom-percentage-shows-total
  test("create-product-with-bom-percentage-shows-total: percentage total displays correctly at 100%", async () => {
    const user = userEvent.setup();
    renderItemForm();

    await addBomRow(user);
    await switchBomMode(user, "percentage");

    await addBomRow(user);
    await addBomRow(user);

    await typeBomValue(user, 0, "40");
    await typeBomValue(user, 1, "35");
    await typeBomValue(user, 2, "25");

    await waitFor(() => {
      expect(screen.getByText("Total: 100.0%")).toBeInTheDocument();
    });

    const totalEl = screen.getByText("Total: 100.0%");
    expect(totalEl.textContent).not.toContain("should be 100%");
  });
});
