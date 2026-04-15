
const COLORS = [
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

const TAB_CONFIG = {
    "dashboard-all": {
        title: "Painel Administrativo Consolidado",
        chartIds: [
            "chart-orgaos",
            "chart-tempo",
            "chart-temporal-orgaos",
            "chart-macro-mod-jud-risk",
            "chart-macro-priority-stage",
            "chart-macro-sla-risk",
            "chart-stage-evolution"
        ],
    },
};

const chartRegistry = {};
const CHART_RULES = {
    "chart-orgaos": {
        title: "Distribuicao de processos por orgao (top 15)",
        text:
            "Fonte por_orgao. Ordena por total_processos em ordem decrescente e exibe os 15 orgaos com maior volume.",
    },
    "chart-temporal-orgaos": {
        title: "Evolucao temporal de processos por orgao",
        text:
            "Fonte espelho_processos. Agrupa por created_at (fallback updated_at) na granularidade selecionada (dia/semana/mes/total), empilha por orgao (top 8 + Outros) e aplica intervalo de datas. No modo diario, sempre considera uma janela de 31 dias.",
    },
    "chart-tempo": {
        title: "Tempo medio de processo por orgao (dias, top 15)",
        text:
            "Fonte tempo_medio. Considera apenas tempo_medio_dias valido, ordena em ordem decrescente e exibe os 15 orgaos com maior tempo medio.",
    },
    "chart-macro-mod-jud-risk": {
        title: "Modalidade x Forum de Julgamento por Risco de Prazo",
        text:
            "Aplica filtros macro, agrupa por combinacao modalidade|julgamento e empilha No prazo, Alerta, Atrasado e Sem referencia. Ordena priorizando maior atraso e exibe 12 grupos.",
    },
    "chart-macro-priority-stage": {
        title: "Concentracao por Status x Prioridade",
        text:
            "Aplica filtros macro, agrupa por stage e empilha processos prioritarios e nao prioritarios. Exibe os 10 stages com maior volume.",
    },
    "chart-macro-sla-risk": {
        title: "Risco de Prazo por Orgao",
        text:
            "Aplica filtros macro, classifica risco por processo (No prazo/Alerta/Atrasado), agrega por orgao e ordena por criticidade (Atrasado, depois Alerta, depois Total).",
    },
    "chart-stage-evolution": {
        title: "Evolucao temporal de processos por stage",
        text:
            "Aplica filtros macro, agrupa por created_at (fallback updated_at) na granularidade selecionada (dia/semana/mes/total), empilha por stage (top 8 + Outros) e aplica intervalo de datas. No modo diario, sempre considera uma janela de 31 dias.",
    }
};
const dashboardState = {
    rawData: null,
    fileStamp: "",
    processed: {
        sortedOrg: [],
        sortedStage: [],
        sortedTempo: [],
        stageDual: [],
    },
    macro: {
        allRows: [],
        filteredRows: [],
        referenceDate: new Date(),
    },
};

const macroFilters = {
    orgao: "all",
    priority: "all",
    modality: "all",
    stage: "all",
};

const temporalFilters = {
    granularity: "day",
    startDate: "",
    endDate: "",
};

let controlsAreBound = false;
let exportActionsBound = false;
let temporalControlsAreBound = false;
let chartToolsBound = false;
let temporalFullscreenBound = false;

const sanitizeHtml = (value) =>
    String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

function renderMarkdown(text) {
    if (!text) {
        return "Insights nao disponiveis no JSON.";
    }

    const safe = sanitizeHtml(text);
    const lines = safe.split("\n");
    const result = [];
    let inList = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith("- ")) {
            if (!inList) {
                result.push("<ul>");
                inList = true;
            }
            const item = line.slice(2).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
            result.push(`<li>${item}</li>`);
            continue;
        }

        if (inList) {
            result.push("</ul>");
            inList = false;
        }

        if (!line) {
            result.push("<br>");
            continue;
        }

        if (line.startsWith("### ")) {
            result.push(`<p><strong>${line.slice(4)}</strong></p>`);
            continue;
        }

        result.push(`<p>${line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</p>`);
    }

    if (inList) {
        result.push("</ul>");
    }

    return result.join("");
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString("pt-BR");
}

function formatDays(value) {
    return `${Math.max(0, Math.round(Number(value) || 0))} dias`;
}

function formatPercent(value) {
    return `${(Number(value || 0) * 100).toFixed(1).replace(".", ",")}%`;
}

function getNowStamp() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
        now.getDate()
    ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(
        2,
        "0"
    )}`;
}

function parseDateTime(value) {
    if (!value) {
        return null;
    }

    const normalized = String(value).replace(" ", "T");
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function getActiveTabId() {
    return "dashboard-all";
}

function getTabTitle(tabId) {
    return TAB_CONFIG[tabId]?.title || "Dashboard";
}

function fillLegend(containerId, items, formatter) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    container.innerHTML = "";
    items.forEach((item, index) => {
        const legendItem = document.createElement("span");
        legendItem.className = "legend-item";
        legendItem.innerHTML = `
            <span class="legend-color" style="background:${COLORS[index % COLORS.length]}"></span>
            <span>${formatter(item)}</span>
          `;
        container.appendChild(legendItem);
    });
}

function fillCustomLegend(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    container.innerHTML = "";
    items.forEach((item) => {
        const legendItem = document.createElement("span");
        legendItem.className = "legend-item";
        legendItem.innerHTML = `
            <span class="legend-color" style="background:${item.color}"></span>
            <span>${item.label}</span>
          `;
        container.appendChild(legendItem);
    });
}

function buildStageDualRows(porStageRows, espelhoRows) {
    if (Array.isArray(espelhoRows) && espelhoRows.length > 0) {
        const stageMap = espelhoRows.reduce((accumulator, row) => {
            const stage = String(row.stage || "Nao Informado");
            const currentValue = accumulator[stage] || {
                stage,
                priority: 0,
                nonPriority: 0,
                total: 0,
            };

            const nextValue = {
                stage,
                priority: currentValue.priority + (Number(row.priority_level || 0) === 1 ? 1 : 0),
                nonPriority: currentValue.nonPriority + (Number(row.priority_level || 0) === 0 ? 1 : 0),
                total: currentValue.total + 1,
            };

            return {
                ...accumulator,
                [stage]: nextValue,
            };
        }, {});

        return Object.values(stageMap)
            .sort((a, b) => b.total - a.total)
            .slice(0, 12);
    }

    return porStageRows.map((row) => {
        const total = Number(row.total_processos || 0);
        return {
            stage: String(row.description || "Nao Informado"),
            priority: 0,
            nonPriority: total,
            total,
        };
    });
}

function createChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        return;
    }

    if (chartRegistry[canvasId]) {
        chartRegistry[canvasId].destroy();
    }

    const chart = new Chart(canvas, config);
    chartRegistry[canvasId] = chart;
}

function resizeCharts() {
    Object.values(chartRegistry).forEach((chart) => chart.resize());
}

function populateSelectOptions(selectId, values) {
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

function getMacroReferenceDate(rows) {
    const candidates = rows
        .flatMap((row) => [row.updated_at, row.finalized_at, row.created_at])
        .map(parseDateTime)
        .filter((value) => value instanceof Date);

    if (candidates.length === 0) {
        return new Date();
    }

    return candidates.reduce((maxDate, currentDate) => (currentDate > maxDate ? currentDate : maxDate), candidates[0]);
}

function getSlaLimitDays(row, priorityValue) {
    const byPriority =
        priorityValue === 1
            ? toFiniteNumber(row.process_max_time_with_priority)
            : toFiniteNumber(row.process_max_time_without_priority);

    const fallback =
        toFiniteNumber(row.process_max_time) ||
        toFiniteNumber(row.process_max_time_with_priority) ||
        toFiniteNumber(row.process_max_time_without_priority);

    return byPriority || fallback || 0;
}

function classifySlaRisk(ageDays, limitDays) {
    if (!Number.isFinite(ageDays) || !Number.isFinite(limitDays) || limitDays <= 0) {
        return "Sem referencia";
    }

    if (ageDays > limitDays) {
        return "Atrasado";
    }

    if (ageDays >= limitDays * 0.8) {
        return "Alerta";
    }

    return "No prazo";
}

function enrichMacroRows(rows) {
    const referenceDate = getMacroReferenceDate(rows);

    const enriched = rows.map((row) => {
        const priorityValue = Number(row.priority_level || 0);
        const createdDate = parseDateTime(row.created_at);
        const finalizedDate = parseDateTime(row.finalized_at);
        const endDate = finalizedDate || referenceDate;
        const ageDays = createdDate ? Math.max(0, Math.round((endDate - createdDate) / 86400000)) : null;
        const slaLimitDays = getSlaLimitDays(row, priorityValue);
        const slaRisk = classifySlaRisk(ageDays, slaLimitDays);

        return {
            ...row,
            _priority: priorityValue,
            _age_days: ageDays,
            _sla_limit_days: slaLimitDays,
            _sla_risk: slaRisk,
        };
    });

    return { referenceDate, rows: enriched };
}

function filterMacroRows(rows) {
    return rows.filter((row) => {
        const orgao = String(row.orgao || "Nao Informado");
        const modality = String(row.modality || "Nao Informado");
        const stage = String(row.stage || "Nao Informado");

        if (macroFilters.orgao !== "all" && orgao !== macroFilters.orgao) {
            return false;
        }

        if (macroFilters.priority !== "all" && Number(macroFilters.priority) !== row._priority) {
            return false;
        }

        if (macroFilters.modality !== "all" && modality !== macroFilters.modality) {
            return false;
        }

        if (macroFilters.stage !== "all" && stage !== macroFilters.stage) {
            return false;
        }

        return true;
    });
}

function aggregateCountBy(rows, keySelector) {
    return rows.reduce((accumulator, row) => {
        const key = keySelector(row);
        accumulator[key] = (accumulator[key] || 0) + 1;
        return accumulator;
    }, {});
}

function formatDateLabel(date) {
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function formatDateInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateInput(value) {
    if (!value) {
        return null;
    }

    const [year, month, day] = String(value)
        .split("-")
        .map((part) => Number(part));

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }

    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clampDate(date, minDate, maxDate) {
    if (date < minDate) {
        return new Date(minDate.getTime());
    }

    if (date > maxDate) {
        return new Date(maxDate.getTime());
    }

    return date;
}

function getTemporalSourceDate(row) {
    return parseDateTime(row.created_at) || parseDateTime(row.updated_at);
}

function collectTemporalDateBounds(rows) {
    const dates = rows.map(getTemporalSourceDate).filter((date) => date instanceof Date);

    if (dates.length === 0) {
        return null;
    }

    const minDate = dates.reduce((min, current) => (current < min ? current : min), dates[0]);
    const maxDate = dates.reduce((max, current) => (current > max ? current : max), dates[0]);

    return {
        minDate: new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()),
        maxDate: new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()),
    };
}

function getTemporalDateRange(rows, granularity) {
    const bounds = collectTemporalDateBounds(rows);
    if (!bounds) {
        return null;
    }

    const selectedEnd = parseDateInput(temporalFilters.endDate) || bounds.maxDate;
    const endDateBase = clampDate(selectedEnd, bounds.minDate, bounds.maxDate);
    const endDate = new Date(
        endDateBase.getFullYear(),
        endDateBase.getMonth(),
        endDateBase.getDate(),
        23,
        59,
        59,
        999
    );

    if (granularity === "day") {
        const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - 30);

        return {
            startDate: clampDate(startDate, bounds.minDate, bounds.maxDate),
            endDate,
            ...bounds,
        };
    }

    const selectedStart = parseDateInput(temporalFilters.startDate) || bounds.minDate;
    let startDate = clampDate(selectedStart, bounds.minDate, bounds.maxDate);
    startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);

    if (startDate > endDate) {
        startDate = new Date(endDate.getTime());
    }

    return {
        startDate,
        endDate,
        ...bounds,
    };
}

function updateTemporalInputState() {
    const startInput = document.getElementById("filter-temporal-start");
    const endInput = document.getElementById("filter-temporal-end");
    const isDay = temporalFilters.granularity === "day";

    if (startInput) {
        startInput.disabled = isDay;
        startInput.title = isDay ? "No modo diario, o intervalo eh sempre de 31 dias." : "";
    }

    if (endInput) {
        endInput.title = isDay ? "Define o ultimo dia da janela movel de 31 dias." : "";
    }
}

function syncTemporalFilterInputs(rows) {
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

function getWeekStartDate(date) {
    const baseDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = baseDate.getDay();
    const offsetToMonday = day === 0 ? -6 : 1 - day;
    baseDate.setDate(baseDate.getDate() + offsetToMonday);
    return baseDate;
}

function getIsoWeekInfo(date) {
    const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);

    return {
        week,
        year: utcDate.getUTCFullYear(),
    };
}

function getTemporalBucketMeta(date, granularity) {
    if (granularity === "day") {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return {
            key,
            label: formatDateLabel(date),
            sortKey: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
        };
    }

    if (granularity === "week") {
        const weekStart = getWeekStartDate(date);
        const weekInfo = getIsoWeekInfo(weekStart);
        return {
            key: `${weekInfo.year}-W${String(weekInfo.week).padStart(2, "0")}`,
            label: `Sem ${String(weekInfo.week).padStart(2, "0")}/${weekInfo.year}`,
            sortKey: weekStart.getTime(),
        };
    }

    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthLabel = `${String(monthStart.getMonth() + 1).padStart(2, "0")}/${monthStart.getFullYear()}`;

    return {
        key: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`,
        label: monthLabel,
        sortKey: monthStart.getTime(),
    };
}

function buildTemporalBuckets(rows, granularity) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    const range = getTemporalDateRange(rows, granularity);
    if (!range) {
        return [];
    }

    const filteredRows = rows.filter((row) => {
        const baseDate = getTemporalSourceDate(row);
        if (!baseDate) {
            return false;
        }

        return baseDate >= range.startDate && baseDate <= range.endDate;
    });

    if (granularity === "total") {
        const groupedByOrgao = filteredRows.reduce((accumulator, row) => {
            const orgao = String(row.orgao || "Nao Informado");
            accumulator[orgao] = (accumulator[orgao] || 0) + 1;
            return accumulator;
        }, {});

        return [
            {
                label: "Total geral",
                sortKey: 0,
                total: filteredRows.length,
                byOrgao: groupedByOrgao,
            },
        ];
    }

    const bucketMap = new Map();

    if (granularity === "day") {
        const cursorDate = new Date(range.startDate.getTime());
        while (cursorDate <= range.endDate) {
            const bucketMeta = getTemporalBucketMeta(cursorDate, "day");
            bucketMap.set(bucketMeta.key, {
                label: bucketMeta.label,
                sortKey: bucketMeta.sortKey,
                total: 0,
                byOrgao: {},
            });

            cursorDate.setDate(cursorDate.getDate() + 1);
        }
    }

    filteredRows.forEach((row) => {
        const baseDate = getTemporalSourceDate(row);
        if (!baseDate) {
            return;
        }

        const bucketMeta = getTemporalBucketMeta(baseDate, granularity);
        const orgao = String(row.orgao || "Nao Informado");
        const currentBucket = bucketMap.get(bucketMeta.key) || {
            label: bucketMeta.label,
            sortKey: bucketMeta.sortKey,
            total: 0,
            byOrgao: {},
        };

        currentBucket.total += 1;
        currentBucket.byOrgao = {
            ...currentBucket.byOrgao,
            [orgao]: (currentBucket.byOrgao[orgao] || 0) + 1,
        };

        bucketMap.set(bucketMeta.key, currentBucket);
    });

    return [...bucketMap.values()].sort((a, b) => a.sortKey - b.sortKey);
}

function getTemporalChartHeight(bucketCount) {
    const baseHeight = bucketCount * 26;
    return Math.max(360, baseHeight);
}

function buildTemporalChart(rows, targetChartId = "chart-temporal-orgaos", targetBoxId = "temporal-chart-box") {
    const granularity = temporalFilters.granularity;
    const temporalBuckets = buildTemporalBuckets(rows, granularity);
    const safeBuckets =
        temporalBuckets.length > 0
            ? temporalBuckets
            : [
                {
                    label: "Sem dados",
                    sortKey: 0,
                    total: 0,
                    byOrgao: {},
                },
            ];

    const targetBox = document.getElementById(targetBoxId);
    if (targetBox) {
        targetBox.style.height = `${getTemporalChartHeight(safeBuckets.length)}px`;
    }

    const orgaoTotals = safeBuckets.reduce((accumulator, bucket) => {
        Object.entries(bucket.byOrgao).forEach(([orgao, count]) => {
            accumulator[orgao] = (accumulator[orgao] || 0) + Number(count || 0);
        });
        return accumulator;
    }, {});

    const topOrgaos = Object.entries(orgaoTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([orgao]) => orgao);

    const trackedOrgaos = new Set(topOrgaos);
    const stackedDatasets = topOrgaos.map((orgao, index) => ({
        label: orgao,
        data: safeBuckets.map((bucket) => Number(bucket.byOrgao[orgao] || 0)),
        backgroundColor: COLORS[index % COLORS.length],
        borderRadius: 4,
        borderSkipped: false,
        stack: "orgaos",
        barThickness: 18,
        maxBarThickness: 28,
    }));

    const outrosData = safeBuckets.map((bucket) =>
        Object.entries(bucket.byOrgao).reduce(
            (sum, [orgao, count]) => sum + (trackedOrgaos.has(orgao) ? 0 : Number(count || 0)),
            0
        )
    );

    if (outrosData.some((value) => value > 0)) {
        stackedDatasets.push({
            label: "Outros",
            data: outrosData,
            backgroundColor: "#74788d",
            borderRadius: 4,
            borderSkipped: false,
            stack: "orgaos",
            barThickness: 18,
            maxBarThickness: 28,
        });
    }

    if (stackedDatasets.length === 0) {
        stackedDatasets.push({
            label: "Sem orgao",
            data: safeBuckets.map(() => 0),
            backgroundColor: COLORS[0],
            borderRadius: 4,
            borderSkipped: false,
            stack: "orgaos",
            barThickness: 18,
            maxBarThickness: 28,
        });
    }

    createChart(targetChartId, {
        type: "bar",
        data: {
            labels: safeBuckets.map((bucket) => bucket.label),
            datasets: stackedDatasets,
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "top",
                    labels: { color: "#495057" },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: "#6c757d" },
                    grid: { color: "rgba(116, 120, 141, 0.15)" },
                    title: {
                        display: true,
                        text: "Quantidade de processos",
                    },
                },
                y: {
                    stacked: true,
                    ticks: { color: "#495057" },
                    grid: { display: false },
                    title: {
                        display: true,
                        text: "Eixo temporal",
                    },
                },
            },
        },
    });
}

function refreshTemporalChart() {
    buildTemporalChart(dashboardState.macro.allRows);

    const modalElement = document.getElementById("temporal-fullscreen-modal");
    if (modalElement && modalElement.classList.contains("show")) {
        buildTemporalChart(
            dashboardState.macro.allRows,
            "chart-temporal-orgaos-fullscreen",
            "temporal-chart-box-fullscreen"
        );
    }
}

function bindTemporalFullscreenModal() {
    if (temporalFullscreenBound) {
        return;
    }

    const modalElement = document.getElementById("temporal-fullscreen-modal");
    if (!modalElement) {
        return;
    }

    modalElement.addEventListener("shown.bs.modal", () => {
        buildTemporalChart(
            dashboardState.macro.allRows,
            "chart-temporal-orgaos-fullscreen",
            "temporal-chart-box-fullscreen"
        );
    });

    modalElement.addEventListener("hidden.bs.modal", () => {
        if (chartRegistry["chart-temporal-orgaos-fullscreen"]) {
            chartRegistry["chart-temporal-orgaos-fullscreen"].destroy();
            delete chartRegistry["chart-temporal-orgaos-fullscreen"];
        }
    });

    temporalFullscreenBound = true;
}

function initTemporalControls() {
    if (temporalControlsAreBound) {
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

    temporalControlsAreBound = true;
}

function setMacroMetricValues(filteredRows) {
    document.getElementById("m-macro-total").textContent = formatNumber(filteredRows.length);

    const modCounts = aggregateCountBy(filteredRows, (row) => String(row.modality || "Nao Informado"));
    const orderedModalities = Object.entries(modCounts).sort((a, b) => b[1] - a[1]);
    const topModality = orderedModalities[0];

    document.getElementById("m-macro-modality").textContent = topModality
        ? `${topModality[0]} (${formatNumber(topModality[1])})`
        : "Nao identificado";

    const pregaoCount = filteredRows.filter((row) => String(row.modality || "").toLowerCase().includes("pregao")).length;
    document.getElementById("m-macro-pregao").textContent = formatNumber(pregaoCount);

    const priorityCount = filteredRows.filter((row) => row._priority === 1).length;
    document.getElementById("m-macro-priority-rate").textContent =
        filteredRows.length > 0 ? formatPercent(priorityCount / filteredRows.length) : "0,0%";

    const overdueCount = filteredRows.filter((row) => row._sla_risk === "Atrasado").length;
    document.getElementById("m-macro-overdue-rate").textContent =
        filteredRows.length > 0 ? formatPercent(overdueCount / filteredRows.length) : "0,0%";

    const overdueByOrgao = filteredRows.reduce((accumulator, row) => {
        if (row._sla_risk !== "Atrasado") {
            return accumulator;
        }

        const orgao = String(row.orgao || "Nao Informado");
        accumulator[orgao] = (accumulator[orgao] || 0) + 1;
        return accumulator;
    }, {});

    const criticalOrgao = Object.entries(overdueByOrgao).sort((a, b) => b[1] - a[1])[0];
    document.getElementById("m-macro-critical-orgao").textContent = criticalOrgao
        ? `${criticalOrgao[0]} (${formatNumber(criticalOrgao[1])})`
        : "Sem atrasos";

    return {
        modCounts,
        orderedModalities,
        judCounts: aggregateCountBy(filteredRows, (row) => String(row.judgment || "Nao Informado")),
    };
}

function buildMacroCharts(filteredRows) {
    setMacroMetricValues(filteredRows);

    const groupedByModalityAndJudgment = filteredRows.reduce((accumulator, row) => {
        const modality = String(row.modality || "Nao Informado");
        const judgment = String(row.judgment || "Nao Informado");
        const key = `${modality} | ${judgment}`;
        const current = accumulator[key] || {
            noPrazo: 0,
            alerta: 0,
            atrasado: 0,
            semReferencia: 0,
            total: 0,
        };

        const next = {
            noPrazo: current.noPrazo + (row._sla_risk === "No prazo" ? 1 : 0),
            alerta: current.alerta + (row._sla_risk === "Alerta" ? 1 : 0),
            atrasado: current.atrasado + (row._sla_risk === "Atrasado" ? 1 : 0),
            semReferencia: current.semReferencia + (row._sla_risk === "Sem referencia" ? 1 : 0),
            total: current.total + 1,
        };

        return {
            ...accumulator,
            [key]: next,
        };
    }, {});

    const orderedModJudRows = Object.entries(groupedByModalityAndJudgment)
        .map(([group, values]) => ({ group, ...values }))
        .sort((a, b) => {
            if (b.atrasado !== a.atrasado) {
                return b.atrasado - a.atrasado;
            }

            if (b.alerta !== a.alerta) {
                return b.alerta - a.alerta;
            }

            return b.total - a.total;
        })
        .slice(0, 12);

    const modJudLabels = orderedModJudRows.map((item) =>
        item.group.length > 100 ? `${item.group.slice(0, 97)}...` : item.group
    );

    createChart("chart-macro-mod-jud-risk", {
        type: "bar",
        data: {
            labels: modJudLabels.length > 0 ? modJudLabels : ["Sem dados"],
            datasets: [
                {
                    label: "No prazo",
                    data: modJudLabels.length > 0 ? orderedModJudRows.map((item) => item.noPrazo) : [0],
                    backgroundColor: "#34c38f",
                    borderRadius: 4,
                },
                {
                    label: "Alerta",
                    data: modJudLabels.length > 0 ? orderedModJudRows.map((item) => item.alerta) : [0],
                    backgroundColor: "#f1b44c",
                    borderRadius: 4,
                },
                {
                    label: "Atrasado",
                    data: modJudLabels.length > 0 ? orderedModJudRows.map((item) => item.atrasado) : [0],
                    backgroundColor: "#f46a6a",
                    borderRadius: 4,
                },
                {
                    label: "Sem referencia",
                    data: modJudLabels.length > 0 ? orderedModJudRows.map((item) => item.semReferencia) : [0],
                    backgroundColor: "#74788d",
                    borderRadius: 4,
                },
            ],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top" },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: "#6c757d" },
                    grid: { color: "rgba(116, 120, 141, 0.15)" },
                },
                y: {
                    stacked: true,
                    ticks: { color: "#495057" },
                    grid: { display: false },
                },
            },
        },
    });

    const stageMap = filteredRows.reduce((accumulator, row) => {
        const stage = String(row.stage || "Nao Informado");
        const currentValue = accumulator[stage] || { priority: 0, nonPriority: 0, total: 0 };
        const nextValue = {
            priority: currentValue.priority + (row._priority === 1 ? 1 : 0),
            nonPriority: currentValue.nonPriority + (row._priority === 0 ? 1 : 0),
            total: currentValue.total + 1,
        };

        return {
            ...accumulator,
            [stage]: nextValue,
        };
    }, {});

    const orderedStages = Object.entries(stageMap)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10);

    const stageLabels = orderedStages.map(([label]) => label);
    const stagePriorityVals = orderedStages.map(([, values]) => values.priority);
    const stageNonPriorityVals = orderedStages.map(([, values]) => values.nonPriority);

    createChart("chart-macro-priority-stage", {
        type: "bar",
        data: {
            labels: stageLabels.length > 0 ? stageLabels : ["Sem dados"],
            datasets: [
                {
                    label: "Nao prioritario",
                    data: stageNonPriorityVals.length > 0 ? stageNonPriorityVals : [0],
                    backgroundColor: "#4b7bec",
                    borderRadius: 4,
                },
                {
                    label: "Prioritario",
                    data: stagePriorityVals.length > 0 ? stagePriorityVals : [0],
                    backgroundColor: "#f46a6a",
                    borderRadius: 4,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top" },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: "#6c757d", maxRotation: 25 },
                    grid: { display: false },
                },
                y: {
                    stacked: true,
                    ticks: { color: "#6c757d" },
                    grid: { color: "rgba(116, 120, 141, 0.15)" },
                },
            },
        },
    });

    const riskByOrgao = filteredRows.reduce((accumulator, row) => {
        const orgao = String(row.orgao || "Nao Informado");
        const current = accumulator[orgao] || {
            noPrazo: 0,
            alerta: 0,
            atrasado: 0,
        };

        const next = {
            noPrazo: current.noPrazo + (row._sla_risk === "No prazo" ? 1 : 0),
            alerta: current.alerta + (row._sla_risk === "Alerta" ? 1 : 0),
            atrasado: current.atrasado + (row._sla_risk === "Atrasado" ? 1 : 0),
        };

        return {
            ...accumulator,
            [orgao]: next,
        };
    }, {});

    const orderedRiskRows = Object.entries(riskByOrgao)
        .map(([orgao, values]) => ({
            orgao,
            ...values,
            total: values.noPrazo + values.alerta + values.atrasado,
        }))
        .sort((a, b) => {
            if (b.atrasado !== a.atrasado) {
                return b.atrasado - a.atrasado;
            }

            if (b.alerta !== a.alerta) {
                return b.alerta - a.alerta;
            }

            return b.total - a.total;
        })
        .slice(0, 10);

    dashboardState.macro.filteredRows = filteredRows;

    const riskLabels = orderedRiskRows.map((item) => item.orgao);
    const noPrazoVals = orderedRiskRows.map((item) => item.noPrazo);
    const alertaVals = orderedRiskRows.map((item) => item.alerta);
    const atrasadoVals = orderedRiskRows.map((item) => item.atrasado);

    createChart("chart-macro-sla-risk", {
        type: "bar",
        data: {
            labels: riskLabels.length > 0 ? riskLabels : ["Sem dados"],
            datasets: [
                {
                    label: "No prazo",
                    data: noPrazoVals.length > 0 ? noPrazoVals : [0],
                    backgroundColor: "#34c38f",
                    borderRadius: 4,
                },
                {
                    label: "Alerta",
                    data: alertaVals.length > 0 ? alertaVals : [0],
                    backgroundColor: "#f1b44c",
                    borderRadius: 4,
                },
                {
                    label: "Atrasado",
                    data: atrasadoVals.length > 0 ? atrasadoVals : [0],
                    backgroundColor: "#f46a6a",
                    borderRadius: 4,
                },
            ],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top" },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: "#6c757d" },
                    grid: { color: "rgba(116, 120, 141, 0.15)" },
                },
                y: {
                    stacked: true,
                    ticks: { color: "#495057" },
                    grid: { display: false },
                },
            },
        },
    });


    const raw = [
        { d: '16/03', AG_CORRECAO: 42, CORRECAO_RELIZADA: 16, AG_DISTRIBUICAO: 0, ANALISE: 34, ANALISE_SEI: 17, DISPUTA: 10, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '17/03', AG_CORRECAO: 39, CORRECAO_RELIZADA: 17, AG_DISTRIBUICAO: 0, ANALISE: 36, ANALISE_SEI: 20, DISPUTA: 10, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '18/03', AG_CORRECAO: 40, CORRECAO_RELIZADA: 21, AG_DISTRIBUICAO: 0, ANALISE: 35, ANALISE_SEI: 21, DISPUTA: 10, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '19/03', AG_CORRECAO: 38, CORRECAO_RELIZADA: 20, AG_DISTRIBUICAO: 1, ANALISE: 31, ANALISE_SEI: 21, DISPUTA: 10, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 1 },
        { d: '20/03', AG_CORRECAO: 37, CORRECAO_RELIZADA: 22, AG_DISTRIBUICAO: 1, ANALISE: 31, ANALISE_SEI: 24, DISPUTA: 11, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 3 },
        { d: '21/03', AG_CORRECAO: 43, CORRECAO_RELIZADA: 25, AG_DISTRIBUICAO: 4, ANALISE: 37, ANALISE_SEI: 25, DISPUTA: 11, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 6 },
        { d: '22/03', AG_CORRECAO: 43, CORRECAO_RELIZADA: 24, AG_DISTRIBUICAO: 4, ANALISE: 36, ANALISE_SEI: 25, DISPUTA: 11, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 6 },
        { d: '23/03', AG_CORRECAO: 38, CORRECAO_RELIZADA: 19, AG_DISTRIBUICAO: 2, ANALISE: 35, ANALISE_SEI: 25, DISPUTA: 11, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '24/03', AG_CORRECAO: 47, CORRECAO_RELIZADA: 20, AG_DISTRIBUICAO: 1, ANALISE: 39, ANALISE_SEI: 25, DISPUTA: 11, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '25/03', AG_CORRECAO: 45, CORRECAO_RELIZADA: 18, AG_DISTRIBUICAO: 3, ANALISE: 44, ANALISE_SEI: 26, DISPUTA: 12, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '26/03', AG_CORRECAO: 45, CORRECAO_RELIZADA: 17, AG_DISTRIBUICAO: 2, ANALISE: 41, ANALISE_SEI: 26, DISPUTA: 13, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '27/03', AG_CORRECAO: 43, CORRECAO_RELIZADA: 18, AG_DISTRIBUICAO: 2, ANALISE: 39, ANALISE_SEI: 28, DISPUTA: 13, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 1 },
        { d: '28/03', AG_CORRECAO: 48, CORRECAO_RELIZADA: 25, AG_DISTRIBUICAO: 5, ANALISE: 45, ANALISE_SEI: 34, DISPUTA: 15, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 4 },
        { d: '29/03', AG_CORRECAO: 48, CORRECAO_RELIZADA: 25, AG_DISTRIBUICAO: 5, ANALISE: 45, ANALISE_SEI: 34, DISPUTA: 15, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 4 },
        { d: '30/03', AG_CORRECAO: 46, CORRECAO_RELIZADA: 17, AG_DISTRIBUICAO: 2, ANALISE: 40, ANALISE_SEI: 31, DISPUTA: 13, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 2 },
        { d: '31/03', AG_CORRECAO: 42, CORRECAO_RELIZADA: 18, AG_DISTRIBUICAO: 2, ANALISE: 47, ANALISE_SEI: 33, DISPUTA: 15, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 1 },
        { d: '01/04', AG_CORRECAO: 50, CORRECAO_RELIZADA: 21, AG_DISTRIBUICAO: 1, ANALISE: 46, ANALISE_SEI: 33, DISPUTA: 15, TRAMITE_FINAL: 2, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '02/04', AG_CORRECAO: 52, CORRECAO_RELIZADA: 25, AG_DISTRIBUICAO: 3, ANALISE: 52, ANALISE_SEI: 34, DISPUTA: 19, TRAMITE_FINAL: 3, FINALIZADO: 3, ANALISE_COTAS: 3 },
        { d: '03/04', AG_CORRECAO: 52, CORRECAO_RELIZADA: 25, AG_DISTRIBUICAO: 3, ANALISE: 52, ANALISE_SEI: 34, DISPUTA: 19, TRAMITE_FINAL: 3, FINALIZADO: 3, ANALISE_COTAS: 3 },
        { d: '04/04', AG_CORRECAO: 52, CORRECAO_RELIZADA: 25, AG_DISTRIBUICAO: 3, ANALISE: 52, ANALISE_SEI: 34, DISPUTA: 19, TRAMITE_FINAL: 3, FINALIZADO: 3, ANALISE_COTAS: 3 },
        { d: '05/04', AG_CORRECAO: 52, CORRECAO_RELIZADA: 25, AG_DISTRIBUICAO: 3, ANALISE: 52, ANALISE_SEI: 34, DISPUTA: 19, TRAMITE_FINAL: 3, FINALIZADO: 3, ANALISE_COTAS: 3 },
        { d: '06/04', AG_CORRECAO: 50, CORRECAO_RELIZADA: 18, AG_DISTRIBUICAO: 1, ANALISE: 46, ANALISE_SEI: 31, DISPUTA: 17, TRAMITE_FINAL: 3, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '07/04', AG_CORRECAO: 55, CORRECAO_RELIZADA: 18, AG_DISTRIBUICAO: 1, ANALISE: 48, ANALISE_SEI: 35, DISPUTA: 19, TRAMITE_FINAL: 3, FINALIZADO: 4, ANALISE_COTAS: 0 },
        { d: '08/04', AG_CORRECAO: 53, CORRECAO_RELIZADA: 15, AG_DISTRIBUICAO: 2, ANALISE: 42, ANALISE_SEI: 35, DISPUTA: 22, TRAMITE_FINAL: 3, FINALIZADO: 3, ANALISE_COTAS: 0 },
        { d: '09/04', AG_CORRECAO: 55, CORRECAO_RELIZADA: 18, AG_DISTRIBUICAO: 2, ANALISE: 42, ANALISE_SEI: 35, DISPUTA: 23, TRAMITE_FINAL: 3, FINALIZADO: 4, ANALISE_COTAS: 1 },
        { d: '10/04', AG_CORRECAO: 59, CORRECAO_RELIZADA: 20, AG_DISTRIBUICAO: 3, ANALISE: 40, ANALISE_SEI: 35, DISPUTA: 26, TRAMITE_FINAL: 4, FINALIZADO: 4, ANALISE_COTAS: 1 },
        { d: '11/04', AG_CORRECAO: 62, CORRECAO_RELIZADA: 21, AG_DISTRIBUICAO: 4, ANALISE: 41, ANALISE_SEI: 40, DISPUTA: 27, TRAMITE_FINAL: 4, FINALIZADO: 4, ANALISE_COTAS: 3 },
        { d: '12/04', AG_CORRECAO: 62, CORRECAO_RELIZADA: 21, AG_DISTRIBUICAO: 4, ANALISE: 41, ANALISE_SEI: 40, DISPUTA: 27, TRAMITE_FINAL: 4, FINALIZADO: 4, ANALISE_COTAS: 3 },
        { d: '13/04', AG_CORRECAO: 62, CORRECAO_RELIZADA: 21, AG_DISTRIBUICAO: 3, ANALISE: 41, ANALISE_SEI: 40, DISPUTA: 27, TRAMITE_FINAL: 4, FINALIZADO: 4, ANALISE_COTAS: 2 },
        { d: '14/04', AG_CORRECAO: 63, CORRECAO_RELIZADA: 21, AG_DISTRIBUICAO: 4, ANALISE: 42, ANALISE_SEI: 40, DISPUTA: 27, TRAMITE_FINAL: 4, FINALIZADO: 4, ANALISE_COTAS: 2 },
    ];

    const series = [
        { key: 'AG_CORRECAO', label: 'Ajustes solicitados', color: '#E24B4A' },
        { key: 'ANALISE', label: 'Em análise', color: '#378ADD' },
        { key: 'ANALISE_SEI', label: 'Análise SEI', color: '#7F77DD' },
        { key: 'DISPUTA', label: 'Fase de disputa', color: '#D85A30' },
        { key: 'CORRECAO_RELIZADA', label: 'Ajustes realizados', color: '#1D9E75' },
        { key: 'TRAMITE_FINAL', label: 'Trâmites finais', color: '#BA7517' },
        { key: 'FINALIZADO', label: 'Finalizado', color: '#639922' },
        { key: 'AG_DISTRIBUICAO', label: 'Ag. distribuição', color: '#888780' },
        { key: 'ANALISE_COTAS', label: 'Análise de cotas', color: '#D4537E' },
    ];

    const labels = raw.map(r => r.d);
    const first = raw[0], last = raw[raw.length - 1];
    const total = r => series.reduce((s, se) => s + (r[se.key] || 0), 0);

    const mEl = document.getElementById('metrics');
    [
        { label: 'Total hoje', val: total(last) },
        { label: 'Ajustes solicitados', val: last.AG_CORRECAO, delta: last.AG_CORRECAO - first.AG_CORRECAO },
        { label: 'Em análise', val: last.ANALISE, delta: last.ANALISE - first.ANALISE },
        { label: 'Fase de disputa', val: last.DISPUTA, delta: last.DISPUTA - first.DISPUTA },
    ].forEach(m => {
        const d = m.delta;
        const dHtml = d !== undefined
            ? `<div class="met-delta ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${d} vs 30 dias atrás</div>`
            : '';
        mEl.innerHTML += `<div class="met"><div class="met-label">${m.label}</div><div class="met-val">${m.val}</div>${dHtml}</div>`;
    });

    let active = new Set(series.map(s => s.key));

    const filtersEl = document.getElementById('filters');
    series.forEach(s => {
        const b = document.createElement('button');
        b.className = 'fbtn on';
        b.dataset.key = s.key;
        b.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:4px;vertical-align:middle"></span>${s.label}`;
        b.addEventListener('click', () => {
            if (active.has(s.key)) { active.delete(s.key); b.classList.remove('on'); }
            else { active.add(s.key); b.classList.add('on'); }
            chart.data.datasets.forEach(ds => {
                const found = series.find(x => x.label === ds.label);
                ds.hidden = found ? !active.has(found.key) : false;
            });
            chart.update();
        });
        filtersEl.appendChild(b);
    });
    createChart("chart-stage-evolution", {
        type: 'bar',
        data: {
            labels,
            datasets: series.map(s => ({
                label: s.label,
                data: raw.map(r => r[s.key] || 0),
                backgroundColor: s.color,
                borderWidth: 0,
                borderRadius: 0,
            }))
        },
        options: {
            indexAxis: 'x',
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: ctx => ctx[0].label,
                        footer: items => 'Total: ' + items.reduce((s, i) => s + i.raw, 0),
                        label: ctx => ctx.raw > 0 ? ` ${ctx.dataset.label}: ${ctx.raw}` : null,
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: '#888', font: { size: 11 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 16 },
                    grid: { display: false }
                },
                y: {
                    stacked: true,
                    ticks: { color: '#888', font: { size: 11 } },
                    grid: { color: 'rgba(128,128,128,0.1)' }
                }
            }
        }
    });
}

function refreshMacroSection() {
    const filtered = filterMacroRows(dashboardState.macro.allRows);
    buildMacroCharts(filtered);
}

function initMacroControls(rows) {
    const orgaos = [...new Set(rows.map((row) => String(row.orgao || "Nao Informado")))].sort();
    const modalities = [...new Set(rows.map((row) => String(row.modality || "Nao Informado")))].sort();
    const stages = [...new Set(rows.map((row) => String(row.stage || "Nao Informado")))].sort();

    populateSelectOptions("filter-macro-orgao", orgaos);
    populateSelectOptions("filter-macro-modality", modalities);
    populateSelectOptions("filter-macro-stage", stages);

    if (!controlsAreBound) {
        const onFilterChange = () => {
            macroFilters.orgao = document.getElementById("filter-macro-orgao").value;
            macroFilters.priority = document.getElementById("filter-macro-priority").value;
            macroFilters.modality = document.getElementById("filter-macro-modality").value;
            macroFilters.stage = document.getElementById("filter-macro-stage").value;
            refreshMacroSection();
        };

        [
            "filter-macro-orgao",
            "filter-macro-priority",
            "filter-macro-modality",
            "filter-macro-stage",
        ].forEach((selectId) => {
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

                document.getElementById("filter-macro-orgao").value = "all";
                document.getElementById("filter-macro-priority").value = "all";
                document.getElementById("filter-macro-modality").value = "all";
                document.getElementById("filter-macro-stage").value = "all";

                refreshMacroSection();
            });
        }

        controlsAreBound = true;
    }
}

function csvEscape(value) {
    const raw = value === null || value === undefined ? "" : String(value);
    return `"${raw.replaceAll('"', '""')}"`;
}

function rowsToCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return "";
    }

    const headers = Object.keys(rows[0]);
    const lines = [headers.map(csvEscape).join(";")];

    rows.forEach((row) => {
        const line = headers.map((header) => csvEscape(row[header])).join(";");
        lines.push(line);
    });

    return lines.join("\n");
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

    if (chartId === "chart-temporal-orgaos") {
        const temporalBuckets = buildTemporalBuckets(dashboardState.macro.allRows, temporalFilters.granularity);
        const rows = [];

        temporalBuckets.forEach((bucket) => {
            Object.entries(bucket.byOrgao).forEach(([orgao, count]) => {
                rows.push({
                    periodo: bucket.label,
                    orgao,
                    quantidade_processos: Number(count || 0),
                });
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

    if (chartId === "chart-macro-mod-jud-risk") {
        const grouped = dashboardState.macro.filteredRows.reduce((accumulator, row) => {
            const modality = String(row.modality || "Nao Informado");
            const judgment = String(row.judgment || "Nao Informado");
            const key = `${modality} | ${judgment}`;
            const current = accumulator[key] || {
                no_prazo: 0,
                alerta: 0,
                atrasado: 0,
                sem_referencia: 0,
                total: 0,
            };

            const next = {
                no_prazo: current.no_prazo + (row._sla_risk === "No prazo" ? 1 : 0),
                alerta: current.alerta + (row._sla_risk === "Alerta" ? 1 : 0),
                atrasado: current.atrasado + (row._sla_risk === "Atrasado" ? 1 : 0),
                sem_referencia: current.sem_referencia + (row._sla_risk === "Sem referencia" ? 1 : 0),
                total: current.total + 1,
            };

            return {
                ...accumulator,
                [key]: next,
            };
        }, {});

        return Object.entries(grouped)
            .map(([grupo, values]) => ({
                grupo,
                no_prazo: values.no_prazo,
                alerta: values.alerta,
                atrasado: values.atrasado,
                sem_referencia: values.sem_referencia,
                total: values.total,
            }))
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

            return {
                ...accumulator,
                [stage]: next,
            };
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

            return {
                ...accumulator,
                [orgao]: next,
            };
        }, {});

        return Object.entries(orgaoRisk)
            .map(([orgao, values]) => ({ orgao, ...values }))
            .sort((a, b) => b.atrasado - a.atrasado || b.alerta - a.alerta || b.total - a.total)
            .slice(0, 10);
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
    const title = CHART_RULES[chartId]?.title || chartId;
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
    const rule = CHART_RULES[chartId];

    if (!modalElement || !titleElement || !bodyElement || !rule) {
        window.alert("Regra de negocio nao encontrada para este grafico.");
        return;
    }

    titleElement.textContent = rule.title;
    bodyElement.textContent = rule.text;

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
}

function bindChartTools() {
    if (chartToolsBound) {
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

            if (action === "csv") {
                exportChartCsv(chartId);
                return;
            }

            if (action === "png") {
                exportChartPng(chartId);
                return;
            }

            if (action === "pdf") {
                exportChartPdf(chartId);
                return;
            }

            if (action === "info") {
                openChartRuleModal(chartId);
                return;
            }

            if (action === "fullscreen" && chartId === "chart-temporal-orgaos") {
                const modalElement = document.getElementById("temporal-fullscreen-modal");
                if (!modalElement) {
                    return;
                }

                const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
                modal.show();
            }
        });
    });

    chartToolsBound = true;
}

function getCsvRowsForTab(tabId) {
    if (tabId === "dashboard-all") {
        const rows = [];

        dashboardState.processed.sortedOrg.forEach((row) => {
            rows.push({
                bloco: "por_orgao",
                referencia: row.sigla,
                valor_1: row.nome,
                valor_2: Number(row.total_processos || 0),
            });
        });

        dashboardState.processed.sortedTempo.forEach((row) => {
            rows.push({
                bloco: "tempo_medio",
                referencia: row.sigla,
                valor_1: Number(row.tempo_medio_dias || 0),
                valor_2: Number(row.tempo_max_dias || 0),
            });
        });

        const temporalBuckets = buildTemporalBuckets(dashboardState.macro.allRows, temporalFilters.granularity);
        temporalBuckets.forEach((bucket) => {
            Object.entries(bucket.byOrgao).forEach(([orgao, count]) => {
                rows.push({
                    bloco: `temporal_${temporalFilters.granularity}`,
                    referencia: bucket.label,
                    valor_1: orgao,
                    valor_2: Number(count || 0),
                });
            });
        });

        dashboardState.macro.filteredRows.forEach((row) => {
            rows.push({
                bloco: "macro_espelho",
                referencia: row.orgao,
                valor_1: row.stage,
                valor_2: row._sla_risk,
            });
        });

        return rows;
    }

    if (tabId === "tab-orgaos") {
        return dashboardState.processed.sortedOrg.map((row) => ({
            sigla: row.sigla,
            orgao: row.nome,
            total_processos: row.total_processos,
        }));
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
    const charts = chartIds
        .map((chartId) => ({ chartId, chart: chartRegistry[chartId] }))
        .filter((item) => item.chart);

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
    const cards = tabElement
        ? [...tabElement.querySelectorAll(".mini-stats-wid .card-body")]
        : [...document.querySelectorAll(".mini-stats-wid .card-body")];

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
            const text = `${metric.label}: ${metric.value}`;
            documentPdf.text(text, 36, cursorY);
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
        documentPdf.text(chartId, 36, cursorY);
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

function bindExportActions() {
    if (exportActionsBound) {
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

    exportActionsBound = true;
}

async function buildCharts() {
    try {
        const dados = require("./assets/data.json");
        console.log("Dados importados via require:", dados);
    } catch (error) {
        console.error("Erro ao importar dados via require:", error);
    }

    try {
        const response = await fetch("./assets/data.json", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const porOrgao = Array.isArray(data.por_orgao) ? [...data.por_orgao] : [];
        const porStage = Array.isArray(data.por_stage) ? [...data.por_stage] : [];
        const tempoMedio = Array.isArray(data.tempo_medio) ? [...data.tempo_medio] : [];
        const espelhoBruto = Array.isArray(data.espelho_processos) ? [...data.espelho_processos] : [];

        dashboardState.rawData = data;
        dashboardState.fileStamp = getNowStamp();

        const sortedOrg = porOrgao
            .sort((a, b) => Number(b.total_processos || 0) - Number(a.total_processos || 0))
            .slice(0, 15);

        const sortedStage = porStage
            .sort((a, b) => Number(b.total_processos || 0) - Number(a.total_processos || 0))
            .slice(0, 15);

        const sortedTempo = tempoMedio
            .filter((row) => Number.isFinite(Number(row.tempo_medio_dias)))
            .sort((a, b) => Number(b.tempo_medio_dias || 0) - Number(a.tempo_medio_dias || 0))
            .slice(0, 15);

        const stageDualRows = buildStageDualRows(sortedStage, espelhoBruto);

        dashboardState.processed.sortedOrg = sortedOrg;
        dashboardState.processed.sortedStage = sortedStage;
        dashboardState.processed.sortedTempo = sortedTempo;
        dashboardState.processed.stageDual = stageDualRows;

        document.getElementById("ai-content").innerHTML = renderMarkdown(data.insights);

        const totalProcessos = porOrgao.reduce((acc, item) => acc + Number(item.total_processos || 0), 0);
        document.getElementById("m-total").textContent = formatNumber(totalProcessos);
        document.getElementById("m-orgaos").textContent = formatNumber(porOrgao.length);
        document.getElementById("m-top").textContent =
            sortedOrg.length > 0
                ? `${sortedOrg[0].sigla} (${formatNumber(sortedOrg[0].total_processos)})`
                : "Nao identificado";

        fillLegend("legend-orgaos", sortedOrg, (item) => item.sigla || "-");

        createChart("chart-orgaos", {
            type: "bar",
            data: {
                labels: sortedOrg.map((item) => item.sigla || "N/A"),
                datasets: [
                    {
                        label: "Processos",
                        data: sortedOrg.map((item) => Number(item.total_processos || 0)),
                        backgroundColor: sortedOrg.map((_, index) => COLORS[index % COLORS.length]),
                        borderRadius: 6,
                        borderSkipped: false,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${formatNumber(ctx.raw)} processos`,
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: {
                            color: "#6c757d",
                            maxRotation: 45,
                            autoSkip: false,
                        },
                        grid: { display: false },
                    },
                    y: {
                        ticks: { color: "#6c757d" },
                        grid: { color: "rgba(116, 120, 141, 0.15)" },
                    },
                },
            },
        });

        document.getElementById("m-stages").textContent = formatNumber(porStage.length);
        document.getElementById("m-top-stage").textContent =
            sortedStage.length > 0
                ? `${sortedStage[0].description} (${formatNumber(sortedStage[0].total_processos)})`
                : "Nao identificado";

        const stageFinalizado = porStage.find((stage) =>
            String(stage.description || "").toLowerCase().includes("finalizado")
        );
        document.getElementById("m-finalizados").textContent = formatNumber(
            stageFinalizado ? stageFinalizado.total_processos : 0
        );

        const temposMediosValidos = tempoMedio
            .map((item) => Number(item.tempo_medio_dias))
            .filter((value) => Number.isFinite(value));

        const mediaGeral =
            temposMediosValidos.length > 0
                ? temposMediosValidos.reduce((acc, value) => acc + value, 0) / temposMediosValidos.length
                : 0;

        document.getElementById("m-tempo-medio").textContent = formatDays(mediaGeral);

        if (tempoMedio.length > 0) {
            const processoMaisRapido = tempoMedio.reduce((menor, atual) =>
                Number(atual.tempo_min_dias || Number.POSITIVE_INFINITY) <
                    Number(menor.tempo_min_dias || Number.POSITIVE_INFINITY)
                    ? atual
                    : menor
            );

            const processoMaisLento = tempoMedio.reduce((maior, atual) =>
                Number(atual.tempo_max_dias || Number.NEGATIVE_INFINITY) >
                    Number(maior.tempo_max_dias || Number.NEGATIVE_INFINITY)
                    ? atual
                    : maior
            );

            document.getElementById("m-mais-rapido").textContent = `${processoMaisRapido.sigla} (${formatDays(
                processoMaisRapido.tempo_min_dias
            )})`;
            document.getElementById("m-mais-lento").textContent = `${processoMaisLento.sigla} (${formatDays(
                processoMaisLento.tempo_max_dias
            )})`;
        } else {
            document.getElementById("m-mais-rapido").textContent = "Nao identificado";
            document.getElementById("m-mais-lento").textContent = "Nao identificado";
        }

        fillLegend("legend-tempo", sortedTempo, (item) => item.sigla || "-");

        createChart("chart-tempo", {
            type: "bar",
            data: {
                labels: sortedTempo.map((item) => item.sigla || "N/A"),
                datasets: [
                    {
                        label: "Dias medios",
                        data: sortedTempo.map((item) => Number(item.tempo_medio_dias || 0)),
                        backgroundColor: sortedTempo.map((_, index) => COLORS[index % COLORS.length]),
                        borderRadius: 6,
                        borderSkipped: false,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${formatDays(ctx.raw)}`,
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: { color: "#6c757d", maxRotation: 45, autoSkip: false },
                        grid: { display: false },
                    },
                    y: {
                        ticks: { color: "#6c757d" },
                        grid: { color: "rgba(116, 120, 141, 0.15)" },
                    },
                },
            },
        });

        const macroEnriched = enrichMacroRows(espelhoBruto);
        dashboardState.macro.referenceDate = macroEnriched.referenceDate;
        dashboardState.macro.allRows = macroEnriched.rows;

        initMacroControls(macroEnriched.rows);
        initTemporalControls();
        refreshTemporalChart();
        refreshMacroSection();

        bindExportActions();
        bindChartTools();
    } catch (error) {
        console.error("Erro carregando dashboard data:", error);
        document.getElementById("m-total").textContent = "Err";
        document.getElementById("ai-content").textContent = `Falha ao ler data.json: ${error}`;
    }
}

window.addEventListener("resize", () => {
    setTimeout(resizeCharts, 50);
});

buildCharts();
