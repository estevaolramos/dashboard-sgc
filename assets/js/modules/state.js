export const COLORS = [
    "#556ee6",
    "#34c38f",
    "#f46a6a",
    "#f1b44c",
    "#50a5f1",
    "#6f42c1",
    "#2a3042",
    "#74788d",
    "#4b7bec",
    "#20bf6b",
    "#eb3b5a",
    "#fa8231",
    "#8854d0",
    "#0fb9b1",
    "#778ca3",
];

export const TAB_CONFIG = {
    "dashboard-all": {
        title: "Painel Administrativo Consolidado",
        chartIds: [
            "chart-orgaos",
            "chart-gerencias",
            "chart-tempo",
            "chart-critical-delay",
            "chart-temporal-orgaos",
            "chart-macro-mod-jud-risk",
            "chart-macro-priority-stage",
            "chart-macro-sla-risk",
            "chart-stage-evolution",
            "chart-stage-evolution-line",
            "chart-stage-evolution-area",
            "chart-stage-evolution-heatmap",
            "chart-stage-evolution-total-gradient",
            "chart-stage-evolution-doughnut-mono",
            "chart-stage-evolution-bar-mono",
        ],
    },
};

export const chartRegistry = {};

export const dashboardTextState = {
    charts: {},
    summaries: {},
};

export const dashboardState = {
    rawData: null,
    fileStamp: "",
    processed: {
        sortedOrg: [],
        sortedGerencia: [],
        sortedStage: [],
        sortedTempo: [],
        stageDual: [],
    },
    macro: {
        allRows: [],
        filteredRows: [],
        filteredDelayRows: [],
        evolutionRows: [],
        referenceDate: new Date(),
    },
};

export const macroFilters = {
    orgao: "all",
    priority: "all",
    modality: "all",
    stage: "all",
    overdue: "all",
};

export const temporalFilters = {
    granularity: "day",
    startDate: "",
    endDate: "",
};

export const uiBindings = {
    controlsAreBound: false,
    exportActionsBound: false,
    temporalControlsAreBound: false,
    chartToolsBound: false,
    temporalFullscreenBound: false,
};
