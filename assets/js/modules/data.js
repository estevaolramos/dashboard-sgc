import { KPI_THRESHOLD_DEFAULTS, TAB_CONFIG, dashboardTextState, dashboardUiState } from "./state.js";
import { buildStageDualRows } from "./charts.js";

const KPI_THRESHOLDS_STORAGE_KEY = "dashboard_sgc_kpi_thresholds";

export function getActiveTabId() {
    const view = document.body?.dataset?.dashboardView;

    if (view === "volume") {
        return "dashboard-volume";
    }

    if (view === "atraso") {
        return "dashboard-atraso";
    }

    if (view === "consolidado") {
        return "dashboard-consolidado";
    }

    return "dashboard-all";
}

export function getTabTitle(tabId) {
    return TAB_CONFIG[tabId]?.title || "Dashboard";
}

export function getChartText(chartId) {
    const text = dashboardTextState.charts[chartId];
    const fallbackName = chartId || "Grafico";
    return {
        name: text?.name || fallbackName,
        description: text?.description || "Descricao nao disponivel para este grafico.",
        alt: text?.alt || text?.name || fallbackName,
    };
}

function parseTextEntries(items) {
    const parsed = {};

    items.forEach((item) => {
        const id = String(item?.id || "").trim();
        if (!id) {
            return;
        }

        parsed[id] = {
            id,
            titleTagId: item?.titleTagId ? String(item.titleTagId) : "",
            descriptionTagId: item?.descriptionTagId ? String(item.descriptionTagId) : "",
            fullscreenTitleTagId: item?.fullscreenTitleTagId ? String(item.fullscreenTitleTagId) : "",
            name: item?.name ? String(item.name) : "",
            description: item?.description ? String(item.description) : "",
            alt: item?.alt ? String(item.alt) : "",
        };
    });

    return parsed;
}

function toFiniteNumberOrFallback(value, fallback) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function parseKpiThresholds(rawThresholds) {
    const safeRawThresholds = rawThresholds && typeof rawThresholds === "object" ? rawThresholds : {};

    return Object.entries(KPI_THRESHOLD_DEFAULTS).reduce((accumulator, [thresholdKey, defaults]) => {
        const rawEntry = safeRawThresholds[thresholdKey];
        const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};

        return {
            ...accumulator,
            [thresholdKey]: {
                good: toFiniteNumberOrFallback(entry.good, defaults.good),
                warning: toFiniteNumberOrFallback(entry.warning, defaults.warning),
            },
        };
    }, {});
}

function cloneObject(value) {
    return JSON.parse(JSON.stringify(value));
}

function readStoredKpiThresholds() {
    if (!window?.localStorage) {
        return null;
    }

    try {
        const raw = window.localStorage.getItem(KPI_THRESHOLDS_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
        console.warn("Falha ao ler limites KPI salvos no navegador:", error);
        return null;
    }
}

function writeStoredKpiThresholds(nextThresholds) {
    if (!window?.localStorage) {
        return;
    }

    try {
        window.localStorage.setItem(KPI_THRESHOLDS_STORAGE_KEY, JSON.stringify(nextThresholds));
    } catch (error) {
        console.warn("Falha ao salvar limites KPI no navegador:", error);
    }
}

function removeStoredKpiThresholds() {
    if (!window?.localStorage) {
        return;
    }

    try {
        window.localStorage.removeItem(KPI_THRESHOLDS_STORAGE_KEY);
    } catch (error) {
        console.warn("Falha ao limpar limites KPI salvos no navegador:", error);
    }
}

export function saveKpiThresholds(nextThresholds) {
    const parsedThresholds = parseKpiThresholds(nextThresholds);
    dashboardUiState.kpiThresholds = cloneObject(parsedThresholds);
    writeStoredKpiThresholds(parsedThresholds);
}

export function resetKpiThresholds() {
    const baseThresholds = dashboardUiState.kpiThresholdsBase || KPI_THRESHOLD_DEFAULTS;
    dashboardUiState.kpiThresholds = cloneObject(baseThresholds);
    removeStoredKpiThresholds();
}

function applyTextEntriesToDom(entries, options = {}) {
    const { withAria = false } = options;

    Object.values(entries).forEach((item) => {
        if (!item || !item.id) {
            return;
        }

        if (item.titleTagId) {
            const titleElement = document.getElementById(item.titleTagId);
            if (titleElement && item.name) {
                titleElement.textContent = item.name;
            }
        }

        if (item.descriptionTagId) {
            const descriptionElement = document.getElementById(item.descriptionTagId);
            if (descriptionElement && item.description) {
                descriptionElement.textContent = item.description;
            }
        }

        if (item.fullscreenTitleTagId) {
            const fullscreenTitleElement = document.getElementById(item.fullscreenTitleTagId);
            if (fullscreenTitleElement && item.name) {
                fullscreenTitleElement.textContent = item.name;
            }
        }

        if (!withAria) {
            return;
        }

        const chartElement = document.getElementById(item.id);
        if (chartElement) {
            chartElement.setAttribute("role", "img");
            chartElement.setAttribute("aria-label", item.alt || item.name || item.id);
        }

        const fullscreenChartElement = document.getElementById(`${item.id}-fullscreen`);
        if (fullscreenChartElement) {
            fullscreenChartElement.setAttribute("role", "img");
            fullscreenChartElement.setAttribute("aria-label", item.alt || item.name || item.id);
        }
    });
}

export function applyChartTextsToDom() {
    applyTextEntriesToDom(dashboardTextState.charts, { withAria: true });
    applyTextEntriesToDom(dashboardTextState.summaries);
}

export async function loadChartTexts() {
    try {
        const response = await fetch("./assets/data/text.json", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const charts = Array.isArray(payload?.charts) ? payload.charts : [];
        const summaries = Array.isArray(payload?.summaries) ? payload.summaries : [];
        const baseThresholds = parseKpiThresholds(payload?.kpi_thresholds);
        const storedThresholds = readStoredKpiThresholds();
        const effectiveThresholds = storedThresholds ? parseKpiThresholds(storedThresholds) : baseThresholds;

        dashboardTextState.charts = parseTextEntries(charts);
        dashboardTextState.summaries = parseTextEntries(summaries);
        dashboardUiState.kpiThresholdsBase = cloneObject(baseThresholds);
        dashboardUiState.kpiThresholds = cloneObject(effectiveThresholds);
    } catch (error) {
        console.warn("Falha ao carregar textos dinamicos:", error);
        dashboardTextState.charts = {};
        dashboardTextState.summaries = {};
        dashboardUiState.kpiThresholdsBase = cloneObject(KPI_THRESHOLD_DEFAULTS);
        dashboardUiState.kpiThresholds = cloneObject(KPI_THRESHOLD_DEFAULTS);
    }
}

export async function loadDashboardData() {
    const response = await fetch("./assets/data/data.json", { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const porOrgao = Array.isArray(data.por_orgao) ? [...data.por_orgao] : [];
    const porStage = Array.isArray(data.por_stage) ? [...data.por_stage] : [];
    const tempoMedio = Array.isArray(data.tempo_medio) ? [...data.tempo_medio] : [];
    const espelhoBruto = Array.isArray(data.espelho_processos) ? [...data.espelho_processos] : [];
    const evolutionBruto = Array.isArray(data.evolution) ? [...data.evolution] : [];

    const sortedOrg = porOrgao.sort((a, b) => Number(b.total_processos || 0) - Number(a.total_processos || 0)).slice(0, 15);
    const sortedStage = porStage.sort((a, b) => Number(b.total_processos || 0) - Number(a.total_processos || 0)).slice(0, 15);
    const sortedTempo = tempoMedio
        .filter((row) => Number.isFinite(Number(row.tempo_medio_dias)))
        .sort((a, b) => Number(b.tempo_medio_dias || 0) - Number(a.tempo_medio_dias || 0))
        .slice(0, 15);

    return {
        data,
        porOrgao,
        porStage,
        tempoMedio,
        espelhoBruto,
        evolutionBruto,
        sortedOrg,
        sortedStage,
        sortedTempo,
        stageDualRows: buildStageDualRows(sortedStage, espelhoBruto),
    };
}
