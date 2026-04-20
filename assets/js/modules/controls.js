import { TAB_CONFIG, chartRegistry, dashboardState, macroFilters, temporalFilters, uiBindings } from "./state.js";
import {
    aggregateEvolutionByBucketAndCode,
    applyEvolutionFilters,
    buildEvolutionTemporalBuckets,
    buildTemporalBuckets,
    formatDateInput,
    formatNumber,
    getTemporalDateRange,
    normalizeEvolutionRows,
    rowsToCsv,
    parseDateInput,
    clampDate,
} from "./utils.js";
import { getActiveTabId, getChartText, getTabTitle } from "./data.js";
import { buildTemporalChart, refreshTemporalChart, refreshMacroSection } from "./charts.js";

export function populateSelectOptions(selectId, values) {
    const select = document.getElementById(selectId);
    if (!select) {
        return;
    }

    const currentValue = select.value;
    select.innerHTML = '<option value="all">Todos</option>';

    values.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });

    if (["all", ...values].includes(currentValue)) {
        select.value = currentValue;
    }
}

export function updateTemporalInputState() {
    const startInput = document.getElementById("filter-temporal-start");
    const endInput = document.getElementById("filter-temporal-end");
    const isDay = temporalFilters.granularity === "day";

    if (startInput) {
        startInput.disabled = isDay;
        startInput.title = isDay ? "No modo diario, o intervalo eh sempre de 30 dias." : "";
    }

    if (endInput) {
        endInput.title = isDay ? "Define o ultimo dia da janela movel de 30 dias." : "";
    }
}

export function syncTemporalFilterInputs(rows) {
    const range = getTemporalDateRange(rows, temporalFilters.granularity);
    if (!range) {
        return;
    }

    temporalFilters.startDate = formatDateInput(range.startDate);
    temporalFilters.endDate = formatDateInput(range.endDate);

    const startInput = document.getElementById("filter-temporal-start");
    const endInput = document.getElementById("filter-temporal-end");

    if (startInput) {
        startInput.min = formatDateInput(range.minDate);
        startInput.max = formatDateInput(range.maxDate);
        startInput.value = temporalFilters.startDate;
    }

    if (endInput) {
        endInput.min = formatDateInput(range.minDate);
        endInput.max = formatDateInput(range.maxDate);
        endInput.value = temporalFilters.endDate;
    }

    updateTemporalInputState();
}

export function bindTemporalFullscreenModal() {
    if (uiBindings.temporalFullscreenBound) {
        return;
    }

    const modalElement = document.getElementById("temporal-fullscreen-modal");
    if (!modalElement) {
        return;
    }

    modalElement.addEventListener("shown.bs.modal", () => {
        buildTemporalChart(dashboardState.macro.allRows, "chart-temporal-orgaos-fullscreen", "temporal-chart-box-fullscreen");
    });

    modalElement.addEventListener("hidden.bs.modal", () => {
        if (chartRegistry["chart-temporal-orgaos-fullscreen"]) {
            chartRegistry["chart-temporal-orgaos-fullscreen"].destroy();
            delete chartRegistry["chart-temporal-orgaos-fullscreen"];
        }
    });

    uiBindings.temporalFullscreenBound = true;
}

export function initTemporalControls() {
    if (uiBindings.temporalControlsAreBound) {
        return;
    }

    const temporalSelect = document.getElementById("filter-temporal-group");
    const startInput = document.getElementById("filter-temporal-start");
    const endInput = document.getElementById("filter-temporal-end");

    if (!temporalSelect || !startInput || !endInput) {
        return;
    }

    temporalSelect.value = temporalFilters.granularity;
    syncTemporalFilterInputs(dashboardState.macro.allRows);

    temporalSelect.addEventListener("change", () => {
        temporalFilters.granularity = temporalSelect.value;
        syncTemporalFilterInputs(dashboardState.macro.allRows);
        refreshTemporalChart();
    });

    startInput.addEventListener("change", () => {
        temporalFilters.startDate = startInput.value;
        syncTemporalFilterInputs(dashboardState.macro.allRows);
        refreshTemporalChart();
    });

    endInput.addEventListener("change", () => {
        temporalFilters.endDate = endInput.value;
        syncTemporalFilterInputs(dashboardState.macro.allRows);
        refreshTemporalChart();
    });

    bindTemporalFullscreenModal();
    uiBindings.temporalControlsAreBound = true;
}

export function initMacroControls(rows) {
    const orgaos = [...new Set(rows.map((row) => String(row.orgao || "Nao Informado")))].sort();
    const modalities = [...new Set(rows.map((row) => String(row.modality || "Nao Informado")))].sort();
    const stages = [...new Set(rows.map((row) => String(row.stage || "Nao Informado")))].sort();

    populateSelectOptions("filter-macro-orgao", orgaos);
    populateSelectOptions("filter-macro-modality", modalities);
    populateSelectOptions("filter-macro-stage", stages);
    const overdueSelect = document.getElementById("filter-macro-overdue");
    if (overdueSelect) {
        overdueSelect.value = macroFilters.overdue;
    }

    if (!uiBindings.controlsAreBound) {
        const onFilterChange = () => {
            macroFilters.orgao = document.getElementById("filter-macro-orgao").value;
            macroFilters.priority = document.getElementById("filter-macro-priority").value;
            macroFilters.modality = document.getElementById("filter-macro-modality").value;
            macroFilters.stage = document.getElementById("filter-macro-stage").value;
            macroFilters.overdue = document.getElementById("filter-macro-overdue")?.value || "all";
            refreshMacroSection();
        };

        ["filter-macro-orgao", "filter-macro-priority", "filter-macro-modality", "filter-macro-stage", "filter-macro-overdue"].forEach((selectId) => {
            const select = document.getElementById(selectId);
            if (select) {
                select.addEventListener("change", onFilterChange);
            }
        });

        const clearButton = document.getElementById("btn-macro-clear");
        if (clearButton) {
            clearButton.addEventListener("click", () => {
                macroFilters.orgao = "all";
                macroFilters.priority = "all";
                macroFilters.modality = "all";
                macroFilters.stage = "all";
                macroFilters.overdue = "all";
                

                document.getElementById("filter-macro-orgao").value = "all";
                document.getElementById("filter-macro-priority").value = "all";
                document.getElementById("filter-macro-modality").value = "all";
                document.getElementById("filter-macro-stage").value = "all";
                const overdueSelect = document.getElementById("filter-macro-overdue");
                if (overdueSelect) {
                    overdueSelect.value = "all";
                }

                refreshMacroSection();
            });
        }

        uiBindings.controlsAreBound = true;
    }
}

function triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function triggerDataUrlDownload(dataUrl, fileName) {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

function getCsvRowsForChart(chartId) {
    if (chartId === "chart-orgaos") {
        return dashboardState.processed.sortedOrg.map((row) => ({
            sigla: row.sigla,
            orgao: row.nome,
            total_processos: Number(row.total_processos || 0),
        }));
    }

    if (chartId === "chart-gerencias") {
        return dashboardState.processed.sortedGerencia.map((row) => ({
            gerencia_nome: String(row.gerencia_nome || "Sem gerencia"),
            total_processos: Number(row.total_processos || 0),
        }));
    }

    if (chartId === "chart-temporal-orgaos") {
        const temporalBuckets = buildTemporalBuckets(dashboardState.macro.allRows, temporalFilters.granularity);
        const rows = [];

        temporalBuckets.forEach((bucket) => {
            Object.entries(bucket.byOrgao).forEach(([orgao, count]) => {
                rows.push({ periodo: bucket.label, orgao, quantidade_processos: Number(count || 0) });
            });
        });

        return rows;
    }

    if (chartId === "chart-tempo") {
        return dashboardState.processed.sortedTempo.map((row) => ({
            sigla: row.sigla,
            orgao: row.nome,
            tempo_medio_dias: Number(row.tempo_medio_dias || 0),
            tempo_min_dias: Number(row.tempo_min_dias || 0),
            tempo_max_dias: Number(row.tempo_max_dias || 0),
        }));
    }

    if (chartId === "chart-critical-delay") {
        return dashboardState.macro.filteredDelayRows.map((row) => ({
            id: Number(row.id || 0),
            process_number: String(row.process_number || ""),
            orgao: String(row.orgao || ""),
            stage: String(row.stage || ""),
            dias_em_tramitacao: Number(row._age_days || 0),
            limite_sla_dias: Number(row._sla_limit_days || 0),
            dias_em_atraso: Number(row._days_overdue || 0),
            dias_sem_movimentacao: Number(row._days_without_stage_movement || 0),
            qtd_mov_stage: Number(row._stage_movement_count || 0),
            ultima_movimentacao_stage: String(row._last_stage_movement_at || ""),
        }));
    }

    if (chartId === "chart-macro-mod-jud-risk") {
        const grouped = dashboardState.macro.filteredRows.reduce((accumulator, row) => {
            const modality = String(row.modality || "Nao Informado");
            const judgment = String(row.judgment || "Nao Informado");
            const key = `${modality} | ${judgment}`;
            const current = accumulator[key] || { no_prazo: 0, alerta: 0, atrasado: 0, sem_referencia: 0, total: 0 };
            const next = {
                no_prazo: current.no_prazo + (row._sla_risk === "No prazo" ? 1 : 0),
                alerta: current.alerta + (row._sla_risk === "Alerta" ? 1 : 0),
                atrasado: current.atrasado + (row._sla_risk === "Atrasado" ? 1 : 0),
                sem_referencia: current.sem_referencia + (row._sla_risk === "Sem referencia" ? 1 : 0),
                total: current.total + 1,
            };

            return { ...accumulator, [key]: next };
        }, {});

        return Object.entries(grouped)
            .map(([grupo, values]) => ({ grupo, ...values }))
            .sort((a, b) => b.atrasado - a.atrasado || b.alerta - a.alerta || b.total - a.total)
            .slice(0, 12);
    }

    if (chartId === "chart-macro-priority-stage") {
        const stageRows = dashboardState.macro.filteredRows.reduce((accumulator, row) => {
            const stage = String(row.stage || "Nao Informado");
            const current = accumulator[stage] || { prioritario: 0, nao_prioritario: 0, total: 0 };
            const next = {
                prioritario: current.prioritario + (row._priority === 1 ? 1 : 0),
                nao_prioritario: current.nao_prioritario + (row._priority === 0 ? 1 : 0),
                total: current.total + 1,
            };

            return { ...accumulator, [stage]: next };
        }, {});

        return Object.entries(stageRows)
            .map(([stage, values]) => ({ stage, ...values }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);
    }

    if (chartId === "chart-macro-sla-risk") {
        const orgaoRisk = dashboardState.macro.filteredRows.reduce((accumulator, row) => {
            const orgao = String(row.orgao || "Nao Informado");
            const current = accumulator[orgao] || { no_prazo: 0, alerta: 0, atrasado: 0, total: 0 };
            const next = {
                no_prazo: current.no_prazo + (row._sla_risk === "No prazo" ? 1 : 0),
                alerta: current.alerta + (row._sla_risk === "Alerta" ? 1 : 0),
                atrasado: current.atrasado + (row._sla_risk === "Atrasado" ? 1 : 0),
                total: current.total + 1,
            };

            return { ...accumulator, [orgao]: next };
        }, {});

        return Object.entries(orgaoRisk)
            .map(([orgao, values]) => ({ orgao, ...values }))
            .sort((a, b) => b.atrasado - a.atrasado || b.alerta - a.alerta || b.total - a.total)
            .slice(0, 10);
    }

    if ([
        "chart-stage-evolution",
        "chart-stage-evolution-line",
        "chart-stage-evolution-area",
        "chart-stage-evolution-heatmap",
        "chart-stage-evolution-total-gradient",
        "chart-stage-evolution-doughnut-mono",
        "chart-stage-evolution-bar-mono",
    ].includes(chartId)) {
        const normalizedRows = normalizeEvolutionRows(dashboardState.macro.evolutionRows);
        const filteredRows = applyEvolutionFilters(normalizedRows, macroFilters);
        const buckets = buildEvolutionTemporalBuckets(filteredRows, temporalFilters.granularity);
        const aggregated = aggregateEvolutionByBucketAndCode(buckets);
        const codeToStageMap = filteredRows.reduce((accumulator, row) => {
            if (!accumulator[row.code]) {
                accumulator[row.code] = row.stage;
            }
            return accumulator;
        }, {});

        const rows = [];
        aggregated.labels.forEach((periodo, index) => {
            Object.entries(aggregated.byCodeSeries).forEach(([code, values]) => {
                const quantidade = Number(values[index] || 0);
                if (quantidade > 0) {
                    rows.push({
                        periodo,
                        code,
                        stage: codeToStageMap[code] || "Nao Informado",
                        quantidade_processos: quantidade,
                    });
                }
            });
        });

        return rows;
    }

    return [];
}

function exportChartCsv(chartId) {
    const rows = getCsvRowsForChart(chartId);
    const csv = rowsToCsv(rows);

    if (!csv) {
        window.alert("Nao ha dados disponiveis para exportacao deste grafico.");
        return;
    }

    const fileName = `${chartId}-${dashboardState.fileStamp}.csv`;
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    triggerBlobDownload(blob, fileName);
}

function exportChartPng(chartId) {
    const chart = chartRegistry[chartId];
    if (!chart) {
        window.alert("Grafico ainda nao inicializado para exportacao.");
        return;
    }

    const dataUrl = chart.toBase64Image("image/png", 1);
    triggerDataUrlDownload(dataUrl, `${chartId}-${dashboardState.fileStamp}.png`);
}

function exportChartPdf(chartId) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        window.alert("Biblioteca de PDF indisponivel no navegador.");
        return;
    }

    const chart = chartRegistry[chartId];
    if (!chart) {
        window.alert("Grafico ainda nao inicializado para exportacao.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const documentPdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    const title = getChartText(chartId).name;
    const imageData = chart.toBase64Image("image/png", 1);

    documentPdf.setFontSize(14);
    documentPdf.text(title, 36, 42);
    documentPdf.setFontSize(10);
    documentPdf.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 36, 58);
    documentPdf.addImage(imageData, "PNG", 36, 78, 520, 300);
    documentPdf.save(`${chartId}-${dashboardState.fileStamp}.pdf`);
}

function openChartRuleModal(chartId) {
    const modalElement = document.getElementById("chart-rule-modal");
    const titleElement = document.getElementById("chart-rule-modal-title");
    const bodyElement = document.getElementById("chart-rule-modal-body");
    const rule = getChartText(chartId);

    if (!modalElement || !titleElement || !bodyElement) {
        window.alert("Regra de negocio nao encontrada para este grafico.");
        return;
    }

    titleElement.textContent = rule.name;
    bodyElement.textContent = rule.description;
    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
}

function openTemporalFullscreenModal(chartId) {
    if (chartId !== "chart-temporal-orgaos") {
        return;
    }

    const modalElement = document.getElementById("temporal-fullscreen-modal");
    if (!modalElement) {
        return;
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
}

const chartToolActions = {
    csv: exportChartCsv,
    png: exportChartPng,
    pdf: exportChartPdf,
    info: openChartRuleModal,
    fullscreen: openTemporalFullscreenModal,
};

function runChartToolAction(action, chartId) {
    const handler = chartToolActions[action];
    if (!handler) {
        return;
    }

    handler(chartId);
}

export function bindChartTools() {
    if (uiBindings.chartToolsBound) {
        return;
    }

    const buttons = [...document.querySelectorAll(".chart-tool-btn")];
    buttons.forEach((button) => {
        button.addEventListener("click", () => {
            const chartId = button.dataset.chartId;
            const action = button.dataset.action;
            if (!chartId || !action) {
                return;
            }

            runChartToolAction(action, chartId);
        });
    });

    uiBindings.chartToolsBound = true;
}

function getCsvRowsForTab(tabId) {
    if (tabId === "dashboard-all") {
        const rows = [];

        dashboardState.processed.sortedOrg.forEach((row) => {
            rows.push({ bloco: "por_orgao", referencia: row.sigla, valor_1: row.nome, valor_2: Number(row.total_processos || 0) });
        });

        dashboardState.processed.sortedGerencia.forEach((row) => {
            rows.push({
                bloco: "por_gerencia",
                referencia: String(row.gerencia_nome || "Sem gerencia"),
                valor_1: Number(row.total_processos || 0),
            });
        });

        dashboardState.processed.sortedTempo.forEach((row) => {
            rows.push({ bloco: "tempo_medio", referencia: row.sigla, valor_1: Number(row.tempo_medio_dias || 0), valor_2: Number(row.tempo_max_dias || 0) });
        });

        const temporalBuckets = buildTemporalBuckets(dashboardState.macro.allRows, temporalFilters.granularity);
        temporalBuckets.forEach((bucket) => {
            Object.entries(bucket.byOrgao).forEach(([orgao, count]) => {
                rows.push({ bloco: `temporal_${temporalFilters.granularity}`, referencia: bucket.label, valor_1: orgao, valor_2: Number(count || 0) });
            });
        });

        dashboardState.macro.filteredRows.forEach((row) => {
            rows.push({ bloco: "macro_espelho", referencia: row.orgao, valor_1: row.stage, valor_2: row._sla_risk });
        });

        return rows;
    }

    if (tabId === "tab-orgaos") {
        return dashboardState.processed.sortedOrg.map((row) => ({ sigla: row.sigla, orgao: row.nome, total_processos: row.total_processos }));
    }

    if (tabId === "tab-tempo") {
        return dashboardState.processed.sortedTempo.map((row) => ({
            sigla: row.sigla,
            orgao: row.nome,
            tempo_medio_dias: row.tempo_medio_dias,
            tempo_min_dias: row.tempo_min_dias,
            tempo_max_dias: row.tempo_max_dias,
        }));
    }

    if (tabId === "tab-macro") {
        return dashboardState.macro.filteredRows.map((row) => ({
            orgao: row.orgao,
            stage: row.stage,
            modalidade: row.modality,
            julgamento: row.judgment,
            prioridade: row._priority,
            dias_em_tramitacao: row._age_days,
            limite_sla_dias: row._sla_limit_days,
            risco_sla: row._sla_risk,
            dias_em_atraso: row._days_overdue,
            dias_sem_movimentacao: row._days_without_stage_movement,
            processo: row.process_number,
            criado_em: row.created_at,
        }));
    }

    return [];
}

function exportActiveTabCsv() {
    const activeTabId = getActiveTabId();
    const rows = getCsvRowsForTab(activeTabId);
    const csv = rowsToCsv(rows);

    if (!csv) {
        window.alert("Nao ha dados disponiveis para exportar em CSV nesta aba.");
        return;
    }

    const fileName = `${activeTabId}-${dashboardState.fileStamp}.csv`;
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    triggerBlobDownload(blob, fileName);
}

function exportActiveTabPng() {
    const activeTabId = getActiveTabId();
    const chartIds = TAB_CONFIG[activeTabId]?.chartIds || [];
    const charts = chartIds.map((chartId) => ({ chartId, chart: chartRegistry[chartId] })).filter((item) => item.chart);

    if (charts.length === 0) {
        window.alert("Nao ha graficos disponiveis para exportar em PNG nesta aba.");
        return;
    }

    charts.forEach((item, index) => {
        const dataUrl = item.chart.toBase64Image("image/png", 1);
        const fileName = `${activeTabId}-${item.chartId}-${dashboardState.fileStamp}.png`;
        setTimeout(() => {
            triggerDataUrlDownload(dataUrl, fileName);
        }, index * 150);
    });
}

function collectMetricRowsFromTab(tabId) {
    const tabElement = document.getElementById(tabId);
    const cards = tabElement ? [...tabElement.querySelectorAll(".mini-stats-wid .card-body")] : [...document.querySelectorAll(".mini-stats-wid .card-body")];

    return cards
        .map((card) => {
            const label = card.querySelector("p")?.textContent?.trim();
            const value = card.querySelector(".metric-value")?.textContent?.trim();
            return label && value ? { label, value } : null;
        })
        .filter(Boolean);
}

function exportActiveTabPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        window.alert("Biblioteca de PDF indisponivel no navegador.");
        return;
    }

    const activeTabId = getActiveTabId();
    const chartIds = TAB_CONFIG[activeTabId]?.chartIds || [];
    const metrics = collectMetricRowsFromTab(activeTabId);
    const { jsPDF } = window.jspdf;
    const documentPdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });

    let cursorY = 42;
    const pageWidth = documentPdf.internal.pageSize.getWidth();
    const maxWidth = pageWidth - 72;

    documentPdf.setFontSize(16);
    documentPdf.text(`Dashboard SGC - ${getTabTitle(activeTabId)}`, 36, cursorY);
    cursorY += 18;

    documentPdf.setFontSize(10);
    documentPdf.setTextColor(90);
    documentPdf.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 36, cursorY);
    cursorY += 22;
    documentPdf.setTextColor(20);

    if (metrics.length > 0) {
        documentPdf.setFontSize(11);
        metrics.forEach((metric, index) => {
            documentPdf.text(`${metric.label}: ${metric.value}`, 36, cursorY);
            cursorY += 14;
            if ((index + 1) % 8 === 0 && index < metrics.length - 1) {
                documentPdf.addPage();
                cursorY = 42;
            }
        });
        cursorY += 8;
    }

    chartIds.forEach((chartId, index) => {
        const chart = chartRegistry[chartId];
        if (!chart) {
            return;
        }

        if (cursorY + 240 > documentPdf.internal.pageSize.getHeight()) {
            documentPdf.addPage();
            cursorY = 42;
        }

        documentPdf.setFontSize(11);
        documentPdf.text(getChartText(chartId).name, 36, cursorY);
        cursorY += 8;

        const imageData = chart.toBase64Image("image/png", 1);
        documentPdf.addImage(imageData, "PNG", 36, cursorY, maxWidth, 205);
        cursorY += 220;

        if (index < chartIds.length - 1) {
            cursorY += 6;
        }
    });

    documentPdf.save(`${activeTabId}-${dashboardState.fileStamp}.pdf`);
}

export function bindExportActions() {
    if (uiBindings.exportActionsBound) {
        return;
    }

    const buttonPng = document.getElementById("btn-export-png");
    const buttonCsv = document.getElementById("btn-export-csv");
    const buttonPdf = document.getElementById("btn-export-pdf");

    if (buttonPng) {
        buttonPng.addEventListener("click", exportActiveTabPng);
    }

    if (buttonCsv) {
        buttonCsv.addEventListener("click", exportActiveTabCsv);
    }

    if (buttonPdf) {
        buttonPdf.addEventListener("click", exportActiveTabPdf);
    }

    uiBindings.exportActionsBound = true;
}
