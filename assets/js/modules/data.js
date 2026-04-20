import { TAB_CONFIG, dashboardTextState } from "./state.js";
import { buildStageDualRows } from "./charts.js";

export function getActiveTabId() {
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

        dashboardTextState.charts = parseTextEntries(charts);
        dashboardTextState.summaries = parseTextEntries(summaries);
    } catch (error) {
        console.warn("Falha ao carregar textos dinamicos:", error);
        dashboardTextState.charts = {};
        dashboardTextState.summaries = {};
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
