import { bindChartTools, bindExportActions, initMacroControls, initTemporalControls } from "../modules/controls.js";
import { applyChartTextsToDom, loadChartTexts, loadDashboardData } from "../modules/data.js";
import { renderMarkdown } from "../modules/markdown.js";
import { dashboardState } from "../modules/state.js";
import { enrichMacroRows, getNowStamp } from "../modules/utils.js";
import { buildOverviewCharts, buildTemporalChart, refreshMacroSection, resizeCharts } from "../modules/charts.js";

function setInsightsContent(markdownText) {
    const insightElement = document.getElementById("ai-content");
    if (!insightElement) {
        return;
    }

    insightElement.innerHTML = renderMarkdown(markdownText);
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
        initMacroControls(dashboardState.macro.allRows);
        refreshMacroSection();
        initTemporalControls();

        bindChartTools();
        bindExportActions();

        setInsightsContent(data?.insights || "");

        window.addEventListener("resize", resizeCharts);
    } catch (error) {
        setBootstrapError(error);
    }
}

bootstrapDashboard();
