import _ from "underscore";
import userEvent from "@testing-library/user-event";
import { createMockMetadata } from "__support__/metadata";
import { createMockEntitiesState } from "__support__/store";
import { renderWithProviders, screen, within } from "__support__/ui";
import { checkNotNull } from "metabase/lib/types";

import type { Metric, StructuredDatasetQuery } from "metabase-types/api";
import {
  createMockMetric,
  COMMON_DATABASE_FEATURES,
} from "metabase-types/api/mocks";
import {
  createAdHocCard,
  createSampleDatabase,
  createOrdersTable,
  createPeopleTable,
  createProductsTable,
  createReviewsTable,
  ORDERS,
  ORDERS_ID,
  PRODUCTS_ID,
  PRODUCTS,
  SAMPLE_DB_ID,
} from "metabase-types/api/mocks/presets";
import type { State } from "metabase-types/store";
import { createMockState } from "metabase-types/store/mocks";
import * as Lib from "metabase-lib";
import Question from "metabase-lib/Question";
import type Metadata from "metabase-lib/metadata/Metadata";
import type StructuredQuery from "metabase-lib/queries/StructuredQuery";
import {
  createQuery,
  columnFinder,
  findAggregationOperator,
} from "metabase-lib/test-helpers";

import { AggregationPicker } from "./AggregationPicker";

function createQueryWithCountAggregation({
  metadata,
}: { metadata?: Metadata } = {}) {
  const initialQuery = createQuery({ metadata });
  const count = findAggregationOperator(initialQuery, "count");
  const clause = Lib.aggregationClause(count);
  return Lib.aggregate(initialQuery, 0, clause);
}

function createQueryWithMaxAggregation({
  metadata,
}: { metadata?: Metadata } = {}) {
  const initialQuery = createQuery({ metadata });
  const max = findAggregationOperator(initialQuery, "max");
  const findColumn = columnFinder(
    initialQuery,
    Lib.aggregationOperatorColumns(max),
  );
  const quantity = findColumn("ORDERS", "QUANTITY");
  const clause = Lib.aggregationClause(max, quantity);
  return Lib.aggregate(initialQuery, 0, clause);
}

function createQueryWithInlineExpression() {
  return createQuery({
    query: {
      database: SAMPLE_DB_ID,
      type: "query",
      query: {
        aggregation: [
          [
            "aggregation-options",
            ["avg", ["field", ORDERS.QUANTITY, null]],
            { name: "Avg Q", "display-name": "Avg Q" },
          ],
        ],
      },
    },
  });
}

function createQueryWithInlineExpressionWithOperator() {
  return createQuery({
    query: {
      database: SAMPLE_DB_ID,
      type: "query",
      query: {
        aggregation: [
          [
            "aggregation-options",
            ["count"],
            { name: "My count", "display-name": "My count" },
          ],
        ],
      },
    },
  });
}

const TEST_METRIC = createMockMetric({
  id: 1,
  table_id: ORDERS_ID,
  name: "Total Order Value",
  description: "The total value of all orders",
  definition: {
    aggregation: [["sum", ["field", ORDERS.TOTAL, null]]],
    "source-table": ORDERS_ID,
  },
});

const PRODUCT_METRIC = createMockMetric({
  id: 2,
  table_id: PRODUCTS_ID,
  name: "Average Rating",
  definition: {
    aggregation: [["avg", ["field", PRODUCTS.RATING, null]]],
    "source-table": PRODUCTS_ID,
  },
});

function createMetadata({
  metrics = [],
  hasExpressionSupport = true,
}: { metrics?: Metric[]; hasExpressionSupport?: boolean } = {}) {
  return createMockMetadata({
    databases: [
      createSampleDatabase({
        tables: [
          createOrdersTable({ metrics }),
          createPeopleTable(),
          createProductsTable({ metrics: [PRODUCT_METRIC] }),
          createReviewsTable(),
        ],
        features: hasExpressionSupport
          ? COMMON_DATABASE_FEATURES
          : _.without(COMMON_DATABASE_FEATURES, "expression-aggregations"),
      }),
    ],
    metrics: [...metrics, PRODUCT_METRIC],
  });
}

type SetupOpts = {
  state?: State;
  metadata?: Metadata;
  query?: Lib.Query;
  hasExpressionInput?: boolean;
};

function setup({
  state = createMockState({
    entities: createMockEntitiesState({
      databases: [createSampleDatabase()],
    }),
  }),
  metadata = createMetadata(),
  query = createQuery({ metadata }),
  hasExpressionInput = true,
}: SetupOpts = {}) {
  const dataset_query = Lib.toLegacyQuery(query) as StructuredDatasetQuery;
  const question = new Question(createAdHocCard({ dataset_query }), metadata);
  const legacyQuery = question.query() as StructuredQuery;
  const stageIndex = 0;
  const clause = Lib.aggregations(query, stageIndex)[0];

  const baseOperators = Lib.availableAggregationOperators(query, stageIndex);
  const operators = clause
    ? Lib.selectedAggregationOperators(baseOperators, clause)
    : baseOperators;

  const onSelect = jest.fn();

  renderWithProviders(
    <AggregationPicker
      query={query}
      legacyQuery={legacyQuery}
      clause={clause}
      stageIndex={stageIndex}
      operators={operators}
      hasExpressionInput={hasExpressionInput}
      onSelect={onSelect}
    />,
    { storeInitialState: state },
  );

  function getRecentClause() {
    expect(onSelect).toHaveBeenCalled();
    const [clause] = onSelect.mock.lastCall;
    return clause;
  }

  function getRecentClauseInfo() {
    return Lib.displayInfo(query, stageIndex, getRecentClause());
  }

  return {
    metadata,
    query,
    stageIndex,
    getRecentClause,
    getRecentClauseInfo,
    onSelect,
  };
}

describe("AggregationPicker", () => {
  it("should allow switching between aggregation approaches", () => {
    const metadata = createMetadata({ metrics: [TEST_METRIC] });
    const { getRecentClauseInfo } = setup({
      query: createQueryWithCountAggregation({ metadata }),
      metadata,
    });
    const metric = checkNotNull(metadata.metric(TEST_METRIC.id));

    userEvent.click(screen.getByText("Common Metrics"));
    userEvent.click(screen.getByText(TEST_METRIC.name));

    expect(getRecentClauseInfo()).toMatchObject({
      displayName: metric.displayName(),
    });
  });

  describe("basic operators", () => {
    it("should list basic operators", () => {
      setup();

      expect(screen.getByText("Basic Metrics")).toBeInTheDocument();

      [
        "Count of rows",
        "Sum of ...",
        "Average of ...",
        "Number of distinct values of ...",
        "Cumulative sum of ...",
        "Cumulative count of rows",
        "Standard deviation of ...",
        "Minimum of ...",
        "Maximum of ...",
      ].forEach(name => {
        expect(screen.getByRole("option", { name })).toBeInTheDocument();
      });
    });

    it("should show operator descriptions", () => {
      setup();

      const sumOfOption = screen.getByRole("option", { name: "Sum of ..." });
      const infoIcon = within(sumOfOption).getByRole("img", {
        name: "question icon",
      });
      userEvent.hover(infoIcon);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "Sum of all the values of a column",
      );
    });

    it("should apply a column-less operator", () => {
      const { getRecentClauseInfo } = setup();

      userEvent.click(screen.getByText("Count of rows"));

      expect(getRecentClauseInfo()).toMatchObject({
        name: "count",
        displayName: "Count",
      });
    });

    it("should apply an operator requiring columns", () => {
      const { getRecentClauseInfo } = setup();

      userEvent.click(screen.getByText("Average of ..."));
      userEvent.click(screen.getByText("Quantity"));

      expect(getRecentClauseInfo()).toMatchObject({
        name: "avg",
        displayName: "Average of Quantity",
      });
    });

    it("should allow picking a foreign column", () => {
      const { getRecentClauseInfo } = setup();

      userEvent.click(screen.getByText("Average of ..."));
      userEvent.click(screen.getByText("Product"));
      userEvent.click(screen.getByText("Rating"));

      expect(getRecentClauseInfo()).toMatchObject({
        name: "avg",
        displayName: "Average of Rating",
      });
    });

    it("should highlight selected operator", () => {
      setup({ query: createQueryWithCountAggregation() });

      expect(
        screen.getByRole("option", { name: "Count of rows" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        screen.getByRole("option", { name: "Sum of ..." }),
      ).not.toHaveAttribute("aria-selected");
    });

    it("should highlight selected operator column", () => {
      setup({ query: createQueryWithMaxAggregation() });

      expect(screen.getByRole("option", { name: "Quantity" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("option", { name: "Discount" })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });

    it("shouldn't list columns for column-less operators", () => {
      setup();

      userEvent.click(screen.getByText("Count of rows"));

      expect(screen.queryByText("Quantity")).not.toBeInTheDocument();
      // check that we're still in the same step
      expect(screen.getByText("Average of ...")).toBeInTheDocument();
    });

    it("should allow to change an operator for existing aggregation", () => {
      const { getRecentClauseInfo } = setup({
        query: createQueryWithMaxAggregation(),
      });

      userEvent.click(screen.getByText("Maximum of ...")); // go back
      userEvent.click(screen.getByText("Average of ..."));
      userEvent.click(screen.getByText("Quantity"));

      expect(getRecentClauseInfo()).toMatchObject({
        name: "avg",
        displayName: "Average of Quantity",
      });
    });

    it("should allow to change a column for existing aggregation", () => {
      const { getRecentClauseInfo } = setup({
        query: createQueryWithMaxAggregation(),
      });

      userEvent.click(screen.getByText("Discount"));

      expect(getRecentClauseInfo()).toMatchObject({
        name: "max",
        displayName: "Max of Discount",
      });
    });
  });

  describe("metrics", () => {
    function setupMetrics(opts: SetupOpts = {}) {
      const result = setup(opts);

      // Expand the metrics section
      userEvent.click(screen.getByText("Common Metrics"));

      return result;
    }

    it("shouldn't show the metrics section when there're no metics", () => {
      setup({ metadata: createMetadata({ metrics: [] }) });
      expect(screen.queryByText("Common Metrics")).not.toBeInTheDocument();
    });

    it("should list metrics for the query table", () => {
      setupMetrics({ metadata: createMetadata({ metrics: [TEST_METRIC] }) });
      expect(screen.getByText(TEST_METRIC.name)).toBeInTheDocument();
    });

    it("shouldn't list metrics for other tables", () => {
      setupMetrics({ metadata: createMetadata({ metrics: [TEST_METRIC] }) });
      expect(screen.queryByText(PRODUCT_METRIC.name)).not.toBeInTheDocument();
    });

    it("should show a description for each metric", () => {
      setupMetrics({ metadata: createMetadata({ metrics: [TEST_METRIC] }) });

      const metricOption = screen.getByRole("option", {
        name: TEST_METRIC.name,
      });
      const infoIcon = within(metricOption).getByRole("img", {
        name: "question icon",
      });
      userEvent.hover(infoIcon);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        TEST_METRIC.description,
      );
    });

    it("should allow picking a metric", () => {
      const metadata = createMetadata({ metrics: [TEST_METRIC] });
      const { getRecentClauseInfo } = setupMetrics({ metadata });
      const metric = checkNotNull(metadata.metric(TEST_METRIC.id));

      userEvent.click(screen.getByText(TEST_METRIC.name));

      expect(getRecentClauseInfo()).toMatchObject({
        displayName: metric.displayName(),
      });
    });
  });

  describe("custom expressions", () => {
    it("should allow to enter a custom expression", async () => {
      const { getRecentClauseInfo } = setup();

      const expression = "1 + 1";
      const expressionName = "My expression";

      userEvent.click(screen.getByText("Custom Expression"));
      userEvent.type(screen.getByLabelText("Expression"), expression);
      userEvent.type(screen.getByLabelText("Name"), expressionName);
      userEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(getRecentClauseInfo().displayName).toBe(expressionName);
    });

    it("should open the editor when a named expression without operator is used", async () => {
      setup({ query: createQueryWithInlineExpression() });

      expect(screen.getByText("Custom Expression")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Avg Q")).toBeInTheDocument();
    });

    it("should open the editor when a named expression with operator is used", async () => {
      setup({ query: createQueryWithInlineExpressionWithOperator() });

      expect(screen.getByText("Custom Expression")).toBeInTheDocument();
      expect(screen.getByDisplayValue("My count")).toBeInTheDocument();
    });

    it("shouldn't be available if database doesn't support custom expressions", () => {
      setup({
        state: createMockState({
          entities: createMockEntitiesState({
            databases: [
              {
                ...createSampleDatabase(),
                features: _.without(
                  COMMON_DATABASE_FEATURES,
                  "expression-aggregations",
                ),
              },
            ],
          }),
        }),
        metadata: createMetadata({ hasExpressionSupport: false }),
      });
      expect(screen.queryByText("Custom Expression")).not.toBeInTheDocument();
    });

    it("shouldn't be shown if `hasExpressionInput` prop is false", () => {
      setup({ hasExpressionInput: false });
      expect(screen.queryByText("Custom Expression")).not.toBeInTheDocument();
    });

    it("should open the editor even if `hasExpressionInput` prop is false if expression is used", () => {
      setup({
        query: createQueryWithInlineExpression(),
        hasExpressionInput: false,
      });

      expect(screen.getByText("Custom Expression")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Avg Q")).toBeInTheDocument();
    });
  });
});
