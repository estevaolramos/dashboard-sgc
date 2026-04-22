import { bindChartTools, bindExportActions, bindKpiSettingsModal, initMacroControls, initSideMenuToggle, initTemporalControls } from "../modules/controls.js";
import { applyChartTextsToDom, loadChartTexts, loadDashboardData } from "../modules/data.js";
import { renderMarkdown } from "../modules/markdown.js";
import { dashboardState } from "../modules/state.js";
import { enrichMacroRows, getNowStamp } from "../modules/utils.js";
import { buildOverviewCharts, buildTemporalChart, refreshMacroSection, resizeCharts } from "../modules/charts.js";

const VIEW_SECTION_MAP = {
    consolidado: "sec-consolidado",
    volume: "sec-volume",
    atraso: "sec-atraso",
};

function getDashboardView() {
    const view = new URLSearchParams(window.location.search).get("view");
    return Object.prototype.hasOwnProperty.call(VIEW_SECTION_MAP, view) ? view : "consolidado";
}

function applyDashboardView(view) {
    const activeSectionId = VIEW_SECTION_MAP[view] || VIEW_SECTION_MAP.consolidado;
    document.body.dataset.dashboardView = view;

    Object.values(VIEW_SECTION_MAP).forEach((sectionId) => {
        if (sectionId === activeSectionId) {
            return;
        }

        const section = document.getElementById(sectionId);
        if (section) {
            section.remove();
        }
    });

    const menuLinks = [...document.querySelectorAll("#side-menu a[data-dashboard-view]")];
    menuLinks.forEach((link) => {
        const isActive = link.dataset.dashboardView === view;
        link.classList.toggle("active", isActive);
        link.setAttribute("aria-current", isActive ? "page" : "false");
    });
}

function setInsightsContent(markdownText) {
    const insightElement = document.getElementById("ai-content");
    if (!insightElement) {
        return;
    }

    insightElement.innerHTML = renderMarkdown(markdownText);
}

function resolveViewInsight(data) {
    const currentView = document.body?.dataset?.dashboardView || "consolidado";
    const byView = data?.insights_by_view;

    if (byView && typeof byView === "object") {
        if (currentView === "volume" && byView.volume) {
            return byView.volume;
        }

        if (currentView === "atraso" && byView.atraso) {
            return byView.atraso;
        }

        if (byView.consolidado) {
            return byView.consolidado;
        }
    }

    if (currentView === "volume" && data?.insights_volume) {
        return data.insights_volume;
    }

    if (currentView === "atraso" && data?.insights_atraso) {
        return data.insights_atraso;
    }

    return data?.insights_consolidado || data?.insights || "";
}

function setBootstrapError(error) {
    console.error("Falha na inicializacao do dashboard:", error);

    setInsightsContent("Nao foi possivel carregar os dados do dashboard no momento.");

    const titleElements = document.querySelectorAll(".macro-chart-title");
    titleElements.forEach((element) => {
        if (element.textContent && element.textContent.toLowerCase().includes("carregando")) {
            element.textContent = "Falha ao carregar";
        }
    });
}

async function bootstrapDashboard() {
    try {
        applyDashboardView(getDashboardView());

        await loadChartTexts();
        applyChartTextsToDom();

        const { data, porOrgao, porStage, tempoMedio, espelhoBruto, evolutionBruto, sortedOrg, sortedStage, sortedTempo, stageDualRows } =
            await loadDashboardData();

        dashboardState.rawData = data;
        dashboardState.fileStamp = getNowStamp();
        dashboardState.processed.sortedOrg = sortedOrg;
        dashboardState.processed.sortedStage = sortedStage;
        dashboardState.processed.sortedTempo = sortedTempo;
        dashboardState.processed.stageDual = stageDualRows;

        buildOverviewCharts({
            porOrgao,
            porStage,
            tempoMedio,
            sortedOrg,
            sortedStage,
            sortedTempo,
            espelhoRows: espelhoBruto,
        });

        const macroState = enrichMacroRows(espelhoBruto, evolutionBruto);
        dashboardState.macro.referenceDate = macroState.referenceDate;
        dashboardState.macro.allRows = macroState.rows;
        dashboardState.macro.evolutionRows = evolutionBruto;

        buildTemporalChart(dashboardState.macro.allRows);
        initSideMenuToggle();
        initMacroControls(dashboardState.macro.allRows);
        refreshMacroSection();
        initTemporalControls();

        bindChartTools();
        bindExportActions();
        bindKpiSettingsModal();

        setInsightsContent(resolveViewInsight(data));

        window.addEventListener("resize", resizeCharts);
    } catch (error) {
        setBootstrapError(error);
    }
}

bootstrapDashboard();
