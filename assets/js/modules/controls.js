import { TAB_CONFIG, chartRegistry, dashboardState, dashboardUiState, macroFilters, temporalFilters, uiBindings } from "./state.js";
import {
    aggregateEvolutionByBucketAndCode,
    applyEvolutionFilters,
    buildEvolutionTemporalBuckets,
    buildTemporalBuckets,
    formatDateInput,
    formatNumber,
    getTemporalDateRange,
    normalizeEvolutionRows,
    parseDateTime,
    rowsToCsv,
    parseDateInput,
    clampDate,
} from "./utils.js";
import { getActiveTabId, getChartText, getTabTitle, resetKpiThresholds, saveKpiThresholds } from "./data.js";
import { buildTemporalChart, refreshTempoExtremeKpiTones, refreshTemporalChart, refreshMacroSection } from "./charts.js";

const KPI_THRESHOLD_FIELDS = [
    {
        key: "finalizados_rate",
        label: "Taxa de finalizados",
        help: "Maior é melhor (0 a 100%).",
        unit: "percent",
        trend: "higher",
    },
    {
        key: "priority_rate",
        label: "Taxa de prioridade",
        help: "Menor é melhor (0 a 100%).",
        unit: "percent",
        trend: "lower",
    },
    {
        key: "overdue_rate",
        label: "Taxa de atrasos",
        help: "Menor é melhor (0 a 100%).",
        unit: "percent",
        trend: "lower",
    },
    {
        key: "tempo_medio_dias",
        label: "Tempo medio (dias)",
        help: "Menor é melhor (dias).",
        unit: "number",
        trend: "lower",
    },
    {
        key: "critical_delay_total",
        label: "Qtd. de atrasados",
        help: "Menor é melhor (contagem).",
        unit: "number",
        trend: "lower",
    },
    {
        key: "mais_lento_dias",
        label: "Processo mais lento",
        help: "Menor é melhor (dias).",
        unit: "number",
        trend: "lower",
    },
];

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

function syncSideMenuToggleState(toggleButton) {
    const isDesktop = window.innerWidth >= 992;
    const isCollapsedDesktop = isDesktop && document.body.classList.contains("vertical-collpsed");
    const isOpenMobile = !isDesktop && document.body.classList.contains("sidebar-enable");
    const labelElement = toggleButton.querySelector("span");

    if (labelElement) {
        if (isDesktop) {
            labelElement.textContent = isCollapsedDesktop ? "Expandir menu" : "Recolher menu";
        } else {
            labelElement.textContent = isOpenMobile ? "Fechar menu" : "Abrir menu";
        }
    }

    const expanded = isDesktop ? !isCollapsedDesktop : isOpenMobile;
    toggleButton.setAttribute("aria-expanded", String(expanded));
}

export function initSideMenuToggle() {
    if (uiBindings.sideMenuToggleBound) {
        return;
    }

    const toggleButton = document.getElementById("vertical-menu-btn");
    if (!toggleButton) {
        return;
    }

    if (window.jQuery) {
        window.jQuery("#vertical-menu-btn").off("click");
    }

    toggleButton.addEventListener("click", (event) => {
        event.preventDefault();
        document.body.classList.toggle("sidebar-enable");

        if (window.innerWidth >= 992) {
            document.body.classList.toggle("vertical-collpsed");
        } else {
            document.body.classList.remove("vertical-collpsed");
        }

        syncSideMenuToggleState(toggleButton);
    });

    window.addEventListener("resize", () => syncSideMenuToggleState(toggleButton));
    syncSideMenuToggleState(toggleButton);
    uiBindings.sideMenuToggleBound = true;
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

function toDisplayThresholdValue(value, unit) {
    if (!Number.isFinite(Number(value))) {
        return "";
    }

    if (unit === "percent") {
        return String(Math.round(Number(value) * 10000) / 100);
    }

    return String(Number(value));
}

function toStoredThresholdValue(value, unit) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return null;
    }

    if (unit === "percent") {
        return numericValue / 100;
    }

    return numericValue;
}

function populateKpiThresholdModalValues() {
    KPI_THRESHOLD_FIELDS.forEach((field) => {
        const threshold = dashboardUiState.kpiThresholds[field.key] || {};
        const goodInput = document.getElementById(`kpi-threshold-${field.key}-good`);
        const warningInput = document.getElementById(`kpi-threshold-${field.key}-warning`);

        if (goodInput) {
            goodInput.value = toDisplayThresholdValue(threshold.good, field.unit);
        }

        if (warningInput) {
            warningInput.value = toDisplayThresholdValue(threshold.warning, field.unit);
        }
    });
}

function buildKpiThresholdFromModal() {
    const parsedThresholds = {};

    for (const field of KPI_THRESHOLD_FIELDS) {
        const goodInput = document.getElementById(`kpi-threshold-${field.key}-good`);
        const warningInput = document.getElementById(`kpi-threshold-${field.key}-warning`);
        const goodValue = toStoredThresholdValue(goodInput?.value, field.unit);
        const warningValue = toStoredThresholdValue(warningInput?.value, field.unit);

        if (!Number.isFinite(goodValue) || !Number.isFinite(warningValue)) {
            window.alert(`Preencha valores numericos validos em \"${field.label}\".`);
            return null;
        }

        if (field.trend === "lower" && goodValue > warningValue) {
            window.alert(`Em \"${field.label}\", o limite Saudavel deve ser menor ou igual ao limite Atencao.`);
            return null;
        }

        if (field.trend === "higher" && goodValue < warningValue) {
            window.alert(`Em \"${field.label}\", o limite Saudavel deve ser maior ou igual ao limite Atencao.`);
            return null;
        }

        parsedThresholds[field.key] = {
            good: goodValue,
            warning: warningValue,
        };
    }

    return parsedThresholds;
}

function applyKpiThresholdRefresh() {
    refreshMacroSection();
    refreshTempoExtremeKpiTones();
}

export function bindKpiSettingsModal() {
    if (uiBindings.kpiSettingsBound) {
        return;
    }

    const openButton = document.getElementById("btn-open-kpi-settings");
    const modalElement = document.getElementById("kpi-settings-modal");
    const saveButton = document.getElementById("btn-kpi-threshold-save");
    const resetButton = document.getElementById("btn-kpi-threshold-reset");

    if (!openButton || !modalElement || !saveButton || !resetButton) {
        return;
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);

    openButton.addEventListener("click", () => {
        populateKpiThresholdModalValues();
        modal.show();
    });

    saveButton.addEventListener("click", () => {
        const parsedThresholds = buildKpiThresholdFromModal();
        if (!parsedThresholds) {
            return;
        }

        saveKpiThresholds(parsedThresholds);
        applyKpiThresholdRefresh();
        modal.hide();
    });

    resetButton.addEventListener("click", () => {
        resetKpiThresholds();
        populateKpiThresholdModalValues();
        applyKpiThresholdRefresh();
    });

    uiBindings.kpiSettingsBound = true;
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

    if (chartId === "chart-stage-evolution-total-gradient") {
        const rows = Array.isArray(dashboardState.macro.filteredRows) ? dashboardState.macro.filteredRows : [];
        const createdDates = rows
            .map((row) => parseDateTime(row?.created_at))
            .filter((date) => date instanceof Date);

        if (createdDates.length === 0) {
            return [];
        }

        const maxCreatedAt = createdDates.reduce((maxDate, currentDate) => (currentDate > maxDate ? currentDate : maxDate), createdDates[0]);
        const endDate = new Date(maxCreatedAt.getFullYear(), maxCreatedAt.getMonth(), maxCreatedAt.getDate(), 23, 59, 59, 999);
        const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - 29);

        const countsByDay = new Map();
        const cursor = new Date(startDate.getTime());
        while (cursor <= endDate) {
            const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
            countsByDay.set(key, 0);
            cursor.setDate(cursor.getDate() + 1);
        }

        rows.forEach((row) => {
            const createdAt = parseDateTime(row?.created_at);
            if (!createdAt || createdAt < startDate || createdAt > endDate) {
                return;
            }

            const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}-${String(createdAt.getDate()).padStart(2, "0")}`;
            const current = countsByDay.get(key);
            countsByDay.set(key, (current || 0) + 1);
        });

        return [...countsByDay.entries()].map(([data, quantidade_processos]) => ({ data, quantidade_processos }));
    }

    if (chartId === "chart-stage-evolution-doughnut-mono") {
        const rows = Array.isArray(dashboardState.macro.filteredRows) ? dashboardState.macro.filteredRows : [];
        const groupedByStage = rows.reduce((accumulator, row) => {
            const stage = String(row?.stage || "Nao Informado");
            accumulator[stage] = (accumulator[stage] || 0) + 1;
            return accumulator;
        }, {});

        return Object.entries(groupedByStage)
            .map(([fase, total_processos]) => ({ fase, total_processos: Number(total_processos || 0) }))
            .sort((a, b) => b.total_processos - a.total_processos)
            .slice(0, 10);
    }

    if ([
        "chart-stage-evolution",
        "chart-stage-evolution-line",
        "chart-stage-evolution-area",
        "chart-stage-evolution-heatmap",
        "chart-stage-evolution-total-gradient",
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

function openFullscreenChartModal(chartId) {
    if (chartId === "chart-temporal-orgaos") {
        const temporalModalElement = document.getElementById("temporal-fullscreen-modal");
        if (!temporalModalElement) {
            return;
        }

        const temporalModal = bootstrap.Modal.getOrCreateInstance(temporalModalElement);
        temporalModal.show();
        return;
    }

    const chart = chartRegistry[chartId];
    const modalElement = document.getElementById("stage-evolution-fullscreen-modal");
    const imageElement = document.getElementById("chart-stage-evolution-fullscreen-image");
    const titleElement = document.getElementById("text-chart-stage-evolution-fullscreen-title");

    if (!modalElement || !imageElement || !chart) {
        return;
    }

    if (titleElement) {
        titleElement.textContent = getChartText(chartId).name;
    }

    imageElement.src = chart.toBase64Image("image/png", 1);
    imageElement.alt = getChartText(chartId).alt;

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
}

function ensureFullscreenButtons() {
    const panelActions = [...document.querySelectorAll(".chart-panel-actions")];

    panelActions.forEach((actionsContainer) => {
        const chartButton = actionsContainer.querySelector(".chart-tool-btn[data-chart-id]");
        if (!chartButton) {
            return;
        }

        const chartId = chartButton.dataset.chartId;
        if (!chartId) {
            return;
        }

        const hasFullscreenButton = Boolean(
            actionsContainer.querySelector(`.chart-tool-btn[data-action=\"fullscreen\"][data-chart-id=\"${chartId}\"]`)
        );

        if (hasFullscreenButton) {
            return;
        }

        const fullscreenButton = document.createElement("button");
        fullscreenButton.type = "button";
        fullscreenButton.className = "btn btn-outline-secondary btn-sm chart-tool-btn";
        fullscreenButton.dataset.action = "fullscreen";
        fullscreenButton.dataset.chartId = chartId;
        fullscreenButton.textContent = "Tela cheia";

        actionsContainer.prepend(fullscreenButton);
    });
}

const chartToolActions = {
    csv: exportChartCsv,
    png: exportChartPng,
    pdf: exportChartPdf,
    info: openChartRuleModal,
    fullscreen: openFullscreenChartModal,
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

    ensureFullscreenButtons();

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

    const stageFullscreenModal = document.getElementById("stage-evolution-fullscreen-modal");
    if (stageFullscreenModal && !stageFullscreenModal.dataset.bound) {
        stageFullscreenModal.addEventListener("hidden.bs.modal", () => {
            const imageElement = document.getElementById("chart-stage-evolution-fullscreen-image");
            if (imageElement) {
                imageElement.removeAttribute("src");
            }
        });
        stageFullscreenModal.dataset.bound = "1";
    }

    uiBindings.chartToolsBound = true;
}

function getCsvRowsForTab(tabId) {
    if (tabId === "dashboard-consolidado") {
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

        dashboardState.macro.filteredRows.forEach((row) => {
            rows.push({ bloco: "macro_espelho", referencia: row.orgao, valor_1: row.stage, valor_2: row._sla_risk });
        });

        return rows;
    }

    if (tabId === "dashboard-volume") {
        const rows = [];

        dashboardState.processed.sortedTempo.forEach((row) => {
            rows.push({ bloco: "tempo_medio", referencia: row.sigla, valor_1: Number(row.tempo_medio_dias || 0), valor_2: Number(row.tempo_max_dias || 0) });
        });

        const temporalBuckets = buildTemporalBuckets(dashboardState.macro.allRows, temporalFilters.granularity);
        temporalBuckets.forEach((bucket) => {
            Object.entries(bucket.byOrgao).forEach(([orgao, count]) => {
                rows.push({ bloco: `temporal_${temporalFilters.granularity}`, referencia: bucket.label, valor_1: orgao, valor_2: Number(count || 0) });
            });
        });

        return rows;
    }

    if (tabId === "dashboard-atraso") {
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
