import { COLORS, chartRegistry, dashboardState, dashboardUiState, macroFilters, temporalFilters } from "./state.js";
import { fillLegend } from "./markdown.js";
import {
    aggregateCountBy,
    aggregateEvolutionByBucketAndCode,
    applyEvolutionFilters,
    buildEvolutionTemporalBuckets,
    buildTemporalBuckets,
    filterMacroRows,
    formatDays,
    formatNumber,
    formatPercent,
    getMacroReferenceDate,
    normalizeEvolutionRows,
    parseDateTime,
} from "./utils.js";

const legendHoverCursor = {
    onHover: (event) => {
        const target = event?.native?.target;
        if (target) {
            target.style.cursor = "pointer";
        }
    },
    onLeave: (event) => {
        const target = event?.native?.target;
        if (target) {
            target.style.cursor = "default";
        }
    },
};

function setMetricText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = String(value);
    }
}

function setMetricTextMany(ids, value) {
    ids.forEach((id) => setMetricText(id, value));
}

const KPI_TONE_CLASSES = ["kpi-tone-good", "kpi-tone-warning", "kpi-tone-critical", "kpi-tone-neutral"];

function setMetricTone(metricId, tone) {
    const metricElement = document.getElementById(metricId);
    if (!metricElement) {
        return;
    }

    const metricCard = metricElement.closest(".mini-stats-wid");
    if (!metricCard) {
        return;
    }

    metricCard.classList.remove(...KPI_TONE_CLASSES);

    if (!tone) {
        return;
    }

    metricCard.classList.add(`kpi-tone-${tone}`);
}

function setMetricToneMany(ids, tone) {
    ids.forEach((id) => setMetricTone(id, tone));
}

export function refreshTempoExtremeKpiTones() {
    const fastestDays = Number(dashboardState.processed.fastestDurationDays);
    const slowestDays = Number(dashboardState.processed.slowestDurationDays);

    if (Number.isFinite(fastestDays)) {
        setMetricTone("m-mais-rapido", "good");
    } else {
        setMetricTone("m-mais-rapido", "neutral");
    }

    if (Number.isFinite(slowestDays)) {
        setMetricTone("m-mais-lento", classifyLowerIsBetter(slowestDays, "mais_lento_dias"));
    } else {
        setMetricTone("m-mais-lento", "neutral");
    }
}

function getKpiThreshold(metricKey) {
    const threshold = dashboardUiState.kpiThresholds?.[metricKey];
    if (!threshold || typeof threshold !== "object") {
        return { good: 0, warning: 0 };
    }

    const good = Number(threshold.good);
    const warning = Number(threshold.warning);

    return {
        good: Number.isFinite(good) ? good : 0,
        warning: Number.isFinite(warning) ? warning : 0,
    };
}

function classifyHigherIsBetter(value, metricKey) {
    const { good, warning } = getKpiThreshold(metricKey);

    if (!Number.isFinite(value)) {
        return "neutral";
    }

    if (value >= good) {
        return "good";
    }

    if (value >= warning) {
        return "warning";
    }

    return "critical";
}

function classifyLowerIsBetter(value, metricKey) {
    const { good, warning } = getKpiThreshold(metricKey);

    if (!Number.isFinite(value)) {
        return "neutral";
    }

    if (value <= good) {
        return "good";
    }

    if (value <= warning) {
        return "warning";
    }

    return "critical";
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function toDetailLabel(key) {
    const labels = {
        // Identificação e Controle
        id: "ID",
        process_number: "Número do processo",
        orgao: "Órgão",
        stage: "Etapa atual",
        user_name: "Criado por",
        current_owner_name: "Responsável atual",
        gerencia_nome: "Gerência",
        gerencia_id: "ID da gerência",
        priority: "Prioridade",
        priority_level: "Nível de prioridade",
        
        // Datas e Prazos
        created_at: "Data de criação",
        updated_at: "Última atualização",
        stage_started_at: "Início da fase atual",
        atual_entrada_neste_estagio: "Entrada na fase atual",
        received_at: "Data de recebimento",
        finalized_at: "Data de finalização",
        award_published_at: "Data de adjudicação",
        opening_published_at: "Data de publicação da abertura",
        
        // SLA e Indicadores (Prefixados com _)
        _age_days: "Dias em tramitação",
        _sla_limit_days: "Limite SLA (dias)",
        _days_overdue: "Dias de atraso",
        _sla_risk: "Risco de SLA",
        _is_overdue: "Está atrasado?",
        _stage_movement_count: "Qtd. de movimentações",
        _last_stage_movement_at: "Última movimentação da fase",
        _last_stage_from_history: "Última fase no histórico",
        _days_without_stage_movement: "Dias sem movimentação",
        tempo_no_estagio_atual: "Tempo na fase atual",
        process_max_time: "Tempo máximo do processo",
        
        // Detalhes do Objeto e Licitação
        summary_object: "Objeto de compra",
        specification: "Especificação",
        modality: "Modalidade",
        judgment: "Critério de julgamento",
        mode_of_dispute: "Modo de disputa",
        legal_framework: "Base legal",
        price_record: "Registro de preço",
        topic: "Tópico/Categoria",
        purchase_request: "Solicitação de compra",
        
        // Integração e SEI
        sei: "Processo SEI",
        sei_id: "ID do SEI",
        initial_sei: "Protocolo SEI inicial",
        pncp_number: "Número PNCP",
        external_phase_number: "Número da fase externa",
        agent_id: "ID do Agente"
    };

    return labels[key] || String(key).replaceAll("_", " ");
}

function toDetailValue(key, value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    if (key === "_is_overdue") {
        return value ? "Sim" : "Nao";
    }

    if (["_age_days", "_sla_limit_days", "_days_overdue", "_days_without_stage_movement"].includes(key)) {
        return formatDays(value);
    }

    if (key === "_stage_movement_count") {
        return formatNumber(value);
    }

    return String(value);
}

function openCriticalDelayRowModal(row) {
    const modalElement = document.getElementById("critical-delay-row-modal");
    const titleElement = document.getElementById("critical-delay-row-modal-title");
    const bodyElement = document.getElementById("critical-delay-row-modal-body");
    if (!modalElement || !titleElement || !bodyElement || !row) {
        return;
    }

    titleElement.textContent = `Detalhes do processo ${String(row.process_number || "-")}`;

    const prioritizedKeys = [
        "id",
        "process_number",
        "orgao",
        "stage",
        "user_name",
        "current_owner_name",
        "created_at",
        "updated_at",
        "stage_started_at",
        "_age_days",
        "_sla_limit_days",
        "_days_overdue",
        "_stage_movement_count",
        "_last_stage_movement_at",
        "_days_without_stage_movement",
    ];

    const keys = Object.keys(row);
    const sortedKeys = [
        ...prioritizedKeys.filter((key) => keys.includes(key)),
        ...keys.filter((key) => !prioritizedKeys.includes(key)).sort((a, b) => a.localeCompare(b)),
    ];

    const tableRows = sortedKeys
        .map((key) => {
            const label = escapeHtml(toDetailLabel(key));
            const value = escapeHtml(toDetailValue(key, row[key]));
            return `<tr><th class="text-muted" style="width: 38%;">${label}</th><td>${value}</td></tr>`;
        })
        .join("");

    bodyElement.innerHTML = `<div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-0"><tbody>${tableRows}</tbody></table></div>`;

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
}

function renderCriticalDelayTable(rows) {
    const tableBody = document.getElementById("table-critical-delay-body");
    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = "";

    if (!Array.isArray(rows) || rows.length === 0) {
        const emptyRow = document.createElement("tr");
        emptyRow.innerHTML = '<td colspan="11" class="text-center text-muted">Nao ha processos atrasados para os filtros atuais.</td>';
        tableBody.appendChild(emptyRow);
        return;
    }

    rows.forEach((row) => {
        const daysInFlow = Number(row._age_days);
        const slaLimit = Number(row._sla_limit_days);
        const overdueDays = Number(row._days_overdue);
        const daysWithoutMovement = Number(row._days_without_stage_movement);
        const tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.setAttribute("role", "button");
        tr.setAttribute("aria-label", `Ver detalhes do processo ${String(row.process_number || "")}`);
        tr.innerHTML = `
            <td>${formatNumber(row.id || 0)}</td>
            <td>${String(row.process_number || "-")}</td>
            <td>${String(row.orgao || "-")}</td>
            <td>${String(row.stage || "-")}</td>
            <td>${Number.isFinite(daysInFlow) ? formatDays(daysInFlow) : "-"}</td>
            <td>${Number.isFinite(slaLimit) ? formatDays(slaLimit) : "-"}</td>
            <td><span class="badge bg-danger-subtle text-danger-emphasis">${Number.isFinite(overdueDays) ? formatDays(overdueDays) : "-"}</span></td>
            <td>${String(row._last_stage_from_history || "-")}</td>
            <td>${String(row._last_stage_movement_at || "-")}</td>
            <td>${Number.isFinite(daysWithoutMovement) ? formatDays(daysWithoutMovement) : "-"}</td>
            <td>${formatNumber(row._stage_movement_count || 0)}</td>
        `;
        tr.addEventListener("click", () => openCriticalDelayRowModal(row));
        tr.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openCriticalDelayRowModal(row);
            }
        });
        tableBody.appendChild(tr);
    });
}

function buildCriticalDelayChart(rows) {
    const delayedRows = rows
        .filter((row) => Number(row._days_overdue || 0) > 0)
        .sort((a, b) => {
            if (Number(b._days_overdue || 0) !== Number(a._days_overdue || 0)) {
                return Number(b._days_overdue || 0) - Number(a._days_overdue || 0);
            }

            return Number(b._days_without_stage_movement || 0) - Number(a._days_without_stage_movement || 0);
        });

    const topRows = delayedRows.slice(0, 12);
    const tableRows = delayedRows.slice(0, 25);
    dashboardState.macro.filteredDelayRows = tableRows;

    setMetricText("m-critical-delay-total", formatNumber(delayedRows.length));
    setMetricTone("m-critical-delay-total", classifyLowerIsBetter(delayedRows.length, "critical_delay_total"));
    setMetricText(
        "m-critical-delay-max",
        delayedRows.length > 0
            ? `${String(delayedRows[0].process_number || "-")} (${formatDays(delayedRows[0]._days_overdue)})`
            : "Sem atrasos"
    );
    setMetricTone("m-critical-delay-max", delayedRows.length > 0 ? "critical" : "good");

    renderCriticalDelayTable(tableRows);

    createChart("chart-critical-delay", {
        type: "bar",
        data: {
            labels: topRows.length > 0 ? topRows.map((row) => `${row.process_number} - ${row.orgao}`) : ["Sem atrasos"],
            datasets: [
                {
                    label: "Dias de atraso",
                    data: topRows.length > 0 ? topRows.map((row) => Number(row._days_overdue || 0)) : [0],
                    backgroundColor: "#f46a6a",
                    borderRadius: 6,
                    borderSkipped: false,
                },
            ],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false, ...legendHoverCursor },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` Atraso: ${formatDays(ctx.raw)}`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: "#6c757d" },
                    grid: { color: "rgba(116, 120, 141, 0.15)" },
                },
                y: {
                    ticks: {
                        color: "#495057",
                        callback: (_value, index) => {
                            const row = topRows[index];
                            return row ? String(row.process_number || "-") : "Sem atrasos";
                        },
                    },
                    grid: { display: false },
                },
            },
        },
    });
}

export function createChart(canvasId, config) {
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

export function resizeCharts() {
    Object.values(chartRegistry).forEach((chart) => chart.resize());
}

export function buildStageDualRows(porStageRows, espelhoRows) {
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

export function buildOverviewCharts({ porOrgao, porStage, tempoMedio, sortedOrg, sortedStage, sortedTempo, espelhoRows = [] }) {
    const totalProcessos = porOrgao.reduce((acc, item) => acc + Number(item.total_processos || 0), 0);
    setMetricText("m-total", formatNumber(totalProcessos));
    setMetricText("m-orgaos", formatNumber(porOrgao.length));
    const hiddenOrgaosLegendItems = new Set();
    const orgaoColorBySigla = new Map(
        sortedOrg.map((item, index) => [String(item.sigla || "N/A"), COLORS[index % COLORS.length]])
    );

    const renderOrgaosChart = () => {
        const availableSiglas = new Set(sortedOrg.map((item) => String(item.sigla || "N/A")));
        [...hiddenOrgaosLegendItems].forEach((sigla) => {
            if (!availableSiglas.has(sigla)) {
                hiddenOrgaosLegendItems.delete(sigla);
            }
        });

        const visibleRows = sortedOrg.filter((item) => !hiddenOrgaosLegendItems.has(String(item.sigla || "N/A")));
        const rowsForChart = visibleRows.length > 0 ? visibleRows : sortedOrg;

        dashboardState.processed.sortedOrg = rowsForChart;
        setMetricText("m-top", rowsForChart.length > 0 ? `${rowsForChart[0].sigla} (${formatNumber(rowsForChart[0].total_processos)})` : "Nao identificado");

        fillLegend("legend-orgaos", sortedOrg, (item) => item.sigla || "-", {
            isActive: (item) => !hiddenOrgaosLegendItems.has(String(item.sigla || "N/A")),
            getColor: (item) => orgaoColorBySigla.get(String(item.sigla || "N/A")) || COLORS[0],
            onToggle: (item) => {
                const sigla = String(item.sigla || "N/A");
                if (hiddenOrgaosLegendItems.has(sigla)) {
                    hiddenOrgaosLegendItems.delete(sigla);
                } else {
                    hiddenOrgaosLegendItems.add(sigla);
                }

                renderOrgaosChart();
            },
        });

        createChart("chart-orgaos", {
            type: "bar",
            data: {
                labels: rowsForChart.map((item) => item.sigla || "N/A"),
                datasets: [
                    {
                        label: "Processos",
                        data: rowsForChart.map((item) => Number(item.total_processos || 0)),
                        backgroundColor: rowsForChart.map(
                            (item) => orgaoColorBySigla.get(String(item.sigla || "N/A")) || COLORS[0]
                        ),
                        borderRadius: 6,
                        borderSkipped: false,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false, ...legendHoverCursor },
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
    };

    renderOrgaosChart();
 
    const detailedRows = Array.isArray(espelhoRows) ? espelhoRows : [];

    const gerenciaRowsBase = detailedRows
        .reduce((accumulator, row) => {
            const gerenciaNome = String(row?.gerencia_nome || "Sem gerência").trim() || "Sem gerência";
            const current = accumulator[gerenciaNome] || { gerencia_nome: gerenciaNome, total_processos: 0 };
            current.total_processos += 1;
            accumulator[gerenciaNome] = current;
            return accumulator;
        }, {});

    const sortedGerencias = Object.values(gerenciaRowsBase)
        .sort((a, b) => Number(b.total_processos || 0) - Number(a.total_processos || 0))
        .slice(0, 15);
    if (sortedGerencias.length === 0) {
        sortedGerencias.push({ gerencia_nome: "Sem gerência", total_processos: 0 });
    }
    const hiddenGerenciasLegendItems = new Set();
    const gerenciaColorByName = new Map(
        sortedGerencias.map((item, index) => [String(item.gerencia_nome || "Sem gerência"), COLORS[index % COLORS.length]])
    );

    const renderGerenciasChart = () => {
        const availableNames = new Set(sortedGerencias.map((item) => String(item.gerencia_nome || "Sem gerência")));
        [...hiddenGerenciasLegendItems].forEach((name) => {
            if (!availableNames.has(name)) {
                hiddenGerenciasLegendItems.delete(name);
            }
        });

        const visibleRows = sortedGerencias.filter((item) => !hiddenGerenciasLegendItems.has(String(item.gerencia_nome || "Sem gerência")));
        const rowsForChart = visibleRows.length > 0 ? visibleRows : sortedGerencias;

        dashboardState.processed.sortedGerencia = rowsForChart;

        fillLegend("legend-gerencias", sortedGerencias, (item) => item.gerencia_nome || "Sem gerência", {
            isActive: (item) => !hiddenGerenciasLegendItems.has(String(item.gerencia_nome || "Sem gerência")),
            getColor: (item) => gerenciaColorByName.get(String(item.gerencia_nome || "Sem gerência")) || COLORS[0],
            onToggle: (item) => {
                const gerenciaName = String(item.gerencia_nome || "Sem gerência");
                if (hiddenGerenciasLegendItems.has(gerenciaName)) {
                    hiddenGerenciasLegendItems.delete(gerenciaName);
                } else {
                    hiddenGerenciasLegendItems.add(gerenciaName);
                }

                renderGerenciasChart();
            },
        });

        createChart("chart-gerencias", {
            type: "bar",
            data: {
                labels: rowsForChart.map((item) => item.gerencia_nome || "Sem gerência"),
                datasets: [
                    {
                        label: "Processos",
                        data: rowsForChart.map((item) => Number(item.total_processos || 0)),
                        backgroundColor: rowsForChart.map(
                            (item) => gerenciaColorByName.get(String(item.gerencia_nome || "Sem gerência")) || COLORS[0]
                        ),
                        borderRadius: 6,
                        borderSkipped: false,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false, ...legendHoverCursor },
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
                        beginAtZero: true,
                        ticks: { color: "#6c757d" },
                        grid: { color: "rgba(116, 120, 141, 0.15)" },
                    },
                },
            },
        });
    };

    renderGerenciasChart();

    setMetricText("m-stages", formatNumber(porStage.length));
    setMetricText(
        "m-top-stage",
        sortedStage.length > 0 ? `${sortedStage[0].description} (${formatNumber(sortedStage[0].total_processos)})` : "Nao identificado"
    );

    const stageFinalizado = porStage.find((stage) => String(stage.description || "").toLowerCase().includes("finalizado"));
    setMetricText("m-finalizados", formatNumber(stageFinalizado ? stageFinalizado.total_processos : 0));

    const temposMediosValidos = tempoMedio
        .map((item) => Number(item.tempo_medio_dias))
        .filter((value) => Number.isFinite(value));

    const mediaGeral = temposMediosValidos.length > 0 ? temposMediosValidos.reduce((acc, value) => acc + value, 0) / temposMediosValidos.length : 0;
    setMetricText("m-tempo-medio", formatDays(mediaGeral));

    const tempoComFaixaValida = tempoMedio.filter((item) => {
        const min = Number(item?.tempo_min_dias);
        const max = Number(item?.tempo_max_dias);
        return Number.isFinite(min) && Number.isFinite(max);
    });

    if (tempoComFaixaValida.length > 0) {
        const processoMaisRapido = tempoComFaixaValida.reduce((menor, atual) =>
            Number(atual.tempo_min_dias || Number.POSITIVE_INFINITY) < Number(menor.tempo_min_dias || Number.POSITIVE_INFINITY)
                ? atual
                : menor
        );

        const processoMaisLento = tempoComFaixaValida.reduce((maior, atual) =>
            Number(atual.tempo_max_dias || Number.NEGATIVE_INFINITY) > Number(maior.tempo_max_dias || Number.NEGATIVE_INFINITY)
                ? atual
                : maior
        );

        setMetricText("m-mais-rapido", `${processoMaisRapido.sigla} (${formatDays(Math.max(1,processoMaisRapido.tempo_min_dias))})`);
        setMetricText("m-mais-lento", `${processoMaisLento.sigla} (${formatDays(processoMaisLento.tempo_max_dias)})`);
        dashboardState.processed.fastestDurationDays = Number(processoMaisRapido.tempo_min_dias);
        dashboardState.processed.slowestDurationDays = Number(processoMaisLento.tempo_max_dias);
        refreshTempoExtremeKpiTones();
    } else {
        setMetricText("m-mais-rapido", "Nao identificado");
        setMetricText("m-mais-lento", "Nao identificado");
        dashboardState.processed.fastestDurationDays = null;
        dashboardState.processed.slowestDurationDays = null;
        refreshTempoExtremeKpiTones();
    }

    const scopeSelect = document.getElementById("filter-tempo-scope");
    const referenceDate = getMacroReferenceDate(detailedRows);
    const hiddenTempoLegendItems = new Set();

    const buildTempoRowsByScope = (scope) => {
        const safeScope = String(scope || "total");
        const grouped = detailedRows.reduce((accumulator, row) => {
            const createdAt = parseDateTime(row?.created_at);
            if (!(createdAt instanceof Date)) {
                return accumulator;
            }

            const finalizedAt = parseDateTime(row?.finalized_at);
            const isFinalized = finalizedAt instanceof Date;

            if (safeScope === "finalized" && !isFinalized) {
                return accumulator;
            }

            if (safeScope === "open" && isFinalized) {
                return accumulator;
            }

            const endDate = isFinalized ? finalizedAt : referenceDate;
            const durationDays = (endDate - createdAt) / 86400000;
            if (!Number.isFinite(durationDays) || durationDays < 0) {
                return accumulator;
            }

            const sigla = String(row?.orgao || "Nao Informado");
            const current = accumulator[sigla] || { sigla, nome: sigla, total_processos: 0, values: [] };
            current.total_processos += 1;
            current.values.push(durationDays);
            accumulator[sigla] = current;
            return accumulator;
        }, {});

        return Object.values(grouped)
            .map((entry) => {
                const values = entry.values;
                const total = values.length;
                const average = total > 0 ? values.reduce((sum, value) => sum + value, 0) / total : 0;
                const min = total > 0 ? values.reduce((low, value) => Math.min(low, value), Number.POSITIVE_INFINITY) : 0;
                const max = total > 0 ? values.reduce((high, value) => Math.max(high, value), Number.NEGATIVE_INFINITY) : 0;

                return {
                    sigla: entry.sigla,
                    nome: entry.nome,
                    total_processos: total,
                    tempo_medio_dias: average,
                    tempo_min_dias: Number.isFinite(min) ? min : 0,
                    tempo_max_dias: Number.isFinite(max) ? max : 0,
                };
            })
            .sort((a, b) => Number(b.tempo_medio_dias || 0) - Number(a.tempo_medio_dias || 0));
    };

    const renderTempoChart = (scope) => {
        const fallbackRows = sortedTempo || [];
        const scopedRows = detailedRows.length > 0 ? buildTempoRowsByScope(scope) : fallbackRows;
        const baseRowsForChart = scopedRows.length > 0 ? scopedRows : fallbackRows;

        const availableSiglas = new Set(baseRowsForChart.map((item) => String(item.sigla || "N/A")));
        [...hiddenTempoLegendItems].forEach((sigla) => {
            if (!availableSiglas.has(sigla)) {
                hiddenTempoLegendItems.delete(sigla);
            }
        });

        const visibleRows = baseRowsForChart.filter((item) => !hiddenTempoLegendItems.has(String(item.sigla || "N/A")));
        const rowsForChart = visibleRows.length > 0 ? visibleRows : baseRowsForChart;

        dashboardState.processed.sortedTempo = rowsForChart;
        fillLegend("legend-tempo", baseRowsForChart, (item) => item.sigla || "-", {
            isActive: (item) => !hiddenTempoLegendItems.has(String(item.sigla || "N/A")),
            onToggle: (item) => {
                const sigla = String(item.sigla || "N/A");
                if (hiddenTempoLegendItems.has(sigla)) {
                    hiddenTempoLegendItems.delete(sigla);
                } else {
                    hiddenTempoLegendItems.add(sigla);
                }

                renderTempoChart(scopeSelect?.value || "total");
            },
        });

        createChart("chart-tempo", {
            type: "bar",
            data: {
                labels: rowsForChart.map((item) => item.sigla || "N/A"),
                datasets: [
                    {
                        label: "Tempo máximo",
                        data: rowsForChart.map((item) => Number(item.tempo_max_dias || 0)),
                        backgroundColor: "rgba(11, 94, 215, 0.8)",
                        borderColor: "rgba(8, 66, 152, 1)",
                        borderWidth: 1,
                        borderRadius: 6,
                        borderSkipped: false,
                        order: 2,
                    },
                    {
                        label: "Tempo mínimo",
                        data: rowsForChart.map((item) => Number(item.tempo_min_dias || 0)),
                        backgroundColor: "rgba(80, 165, 241, 0.85)",
                        borderColor: "rgba(41, 128, 200, 1)",
                        borderWidth: 1,
                        borderRadius: 6,
                        borderSkipped: false,
                        order: 2,
                    },
                    {
                        type: "line",
                        label: "Tempo médio",
                        data: rowsForChart.map((item) => Number(item.tempo_medio_dias || 0)),
                        borderColor: "#102a43",
                        backgroundColor: "#102a43",
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: "#102a43",
                        pointBorderColor: "#ffffff",
                        pointBorderWidth: 1,
                        borderWidth: 4,
                        borderDash: [8, 4],
                        showLine: true,
                        tension: 0.15,
                        fill: false,
                        order: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: "top", labels: { color: "#495057" }, ...legendHoverCursor },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                if (ctx.dataset.label === "Tempo mínimo") {
                                    return ` Minimo: ${formatDays(ctx.raw)}`;
                                }

                                if (ctx.dataset.label === "Tempo máximo") {
                                    return ` Máximo: ${formatDays(ctx.raw)}`;
                                }

                                return ` Medio: ${formatDays(ctx.raw)}`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: { color: "#6c757d", maxRotation: 45, autoSkip: false },
                        grid: { display: false },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: "#6c757d" },
                        grid: { color: "rgba(116, 120, 141, 0.15)" },
                        title: {
                            display: true,
                            text: "Dias",
                        },
                    },
                },
            },
        });
    };

    if (scopeSelect) {
        const finalizedCount = detailedRows.filter((row) => parseDateTime(row?.finalized_at) instanceof Date).length;
        const totalCount = detailedRows.filter((row) => parseDateTime(row?.created_at) instanceof Date).length;
        const openCount = Math.max(0, totalCount - finalizedCount);

        const optionsByValue = {
            total: `Total (${formatNumber(totalCount)})`,
            finalized: `Finalizados (${formatNumber(finalizedCount)})`,
            open: `Em andamento (${formatNumber(openCount)})`,
        };

        [...scopeSelect.options].forEach((option) => {
            const nextLabel = optionsByValue[option.value];
            if (nextLabel) {
                option.textContent = nextLabel;
            }
        });

        if (!scopeSelect.dataset.bound) {
            scopeSelect.addEventListener("change", () => {
                renderTempoChart(scopeSelect.value);
            });
            scopeSelect.dataset.bound = "1";
        }
    }

    renderTempoChart(scopeSelect?.value || "total");
}

export function getTemporalChartHeight(bucketCount) {
    const baseHeight = bucketCount * 26;
    return Math.max(360, baseHeight);
}

function getStageEvolutionChartHeight(bucketCount) {
    const baseHeight = bucketCount * 24;
    return Math.max(360, baseHeight);
}

export function buildTemporalChart(rows, targetChartId = "chart-temporal-orgaos", targetBoxId = "temporal-chart-box") {
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
        Object.entries(bucket.byOrgao).reduce((sum, [orgao, count]) => sum + (trackedOrgaos.has(orgao) ? 0 : Number(count || 0)), 0)
    );

    if (outrosData.some((value) => value > 0)) {
        stackedDatasets.push({
            label: "Outros",
            data: outrosData,
            backgroundColor: "#000000",
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
                    ...legendHoverCursor,
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

export function refreshTemporalChart() {
    buildTemporalChart(dashboardState.macro.allRows);
    refreshMacroSection();

    const modalElement = document.getElementById("temporal-fullscreen-modal");
    if (modalElement && modalElement.classList.contains("show")) {
        buildTemporalChart(dashboardState.macro.allRows, "chart-temporal-orgaos-fullscreen", "temporal-chart-box-fullscreen");
    }
}

function getCodePaletteColor(code) {
    const normalized = String(code || "");
    const hash = [...normalized].reduce((accumulator, char) => accumulator + char.charCodeAt(0), 0);
    return COLORS[hash % COLORS.length];
}

function compareStageCodeById(a, b) {
    const codeA = String(a || "").trim();
    const codeB = String(b || "").trim();
    const numberA = Number(codeA);
    const numberB = Number(codeB);
    const isNumberA = Number.isFinite(numberA);
    const isNumberB = Number.isFinite(numberB);

    if (isNumberA && isNumberB) {
        return numberA - numberB;
    }

    if (isNumberA) {
        return -1;
    }

    if (isNumberB) {
        return 1;
    }

    return codeA.localeCompare(codeB, "pt-BR", { numeric: true, sensitivity: "base" });
}

function buildStageEvolutionModel() {
    const normalizedRows = normalizeEvolutionRows(dashboardState.macro.evolutionRows);
    const filteredRows = applyEvolutionFilters(normalizedRows, macroFilters);
    const buckets = buildEvolutionTemporalBuckets(filteredRows, temporalFilters.granularity);
    const safeBuckets =
        buckets.length > 0
            ? buckets
            : [
                {
                    label: "Sem dados",
                    sortKey: 0,
                    total: 0,
                    byCode: {},
                },
            ];

    const aggregated = aggregateEvolutionByBucketAndCode(safeBuckets);
    const orderedCodesByVolume = Object.entries(aggregated.codeTotals)
        .sort((a, b) => b[1] - a[1])
        .map(([code]) => code);
    const codeLabelMap = filteredRows.reduce((accumulator, row) => {
        if (!accumulator[row.code]) {
            accumulator[row.code] = row.stage;
        }
        return accumulator;
    }, {});
    const orderedCodesById = Object.keys(aggregated.byCodeSeries).sort(compareStageCodeById);

    return {
        labels: aggregated.labels,
        totalsByBucket: aggregated.totalsByBucket,
        byCodeSeries: aggregated.byCodeSeries,
        orderedCodesByVolume,
        orderedCodesById,
        codeLabelMap,
    };
}

function buildStageEvolutionLineChart(model) {
    const trackedCodes = model.orderedCodesByVolume.slice(0, 8);
    const datasets = trackedCodes.map((code) => ({
        label: model.codeLabelMap[code] || code,
        data: model.byCodeSeries[code] || model.labels.map(() => 0),
        borderColor: getCodePaletteColor(code),
        backgroundColor: getCodePaletteColor(code),
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: 0.25,
    }));

    if (datasets.length === 0) {
        datasets.push({
            label: "Sem codigo",
            data: model.labels.map(() => 0),
            borderColor: COLORS[0],
            backgroundColor: COLORS[0],
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            tension: 0.25,
        });
    }

    createChart("chart-stage-evolution-line", {
        type: "line",
        data: {
            labels: model.labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: { color: "#495057" },
                    ...legendHoverCursor,
                },
                tooltip: {
                    callbacks: {
                        title: (ctx) => ctx[0].label,
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: "#888", font: { size: 11 } },
                    grid: { color: "rgba(128,128,128,0.1)" },
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: "#888", font: { size: 11 } },
                    grid: { color: "rgba(128,128,128,0.1)" },
                    title: {
                        display: true,
                        text: "Quantidade de processos",
                    },
                },
            },
        },
    });
}

function withAlpha(hexColor, alpha) {
    const parsed = String(hexColor || "").trim();
    if (!parsed.startsWith("#") || (parsed.length !== 7 && parsed.length !== 4)) {
        return `rgba(85, 110, 230, ${alpha})`;
    }

    const full =
        parsed.length === 4
            ? `#${parsed[1]}${parsed[1]}${parsed[2]}${parsed[2]}${parsed[3]}${parsed[3]}`
            : parsed;

    const red = Number.parseInt(full.slice(1, 3), 16);
    const green = Number.parseInt(full.slice(3, 5), 16);
    const blue = Number.parseInt(full.slice(5, 7), 16);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildStageEvolutionAreaChart(model) {
    const trackedCodes = model.orderedCodesByVolume.slice(0, 8);
    const trackedSet = new Set(trackedCodes);
    const datasets = trackedCodes.map((code) => ({
        label: model.codeLabelMap[code] || code,
        data: model.byCodeSeries[code] || model.labels.map(() => 0),
        borderColor: getCodePaletteColor(code),
        backgroundColor: withAlpha(getCodePaletteColor(code), 0.35),
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.25,
        fill: true,
        stack: "stages-area",
    }));

    const outrosData = model.labels.map((_, index) =>
        Object.entries(model.byCodeSeries).reduce((sum, [code, values]) => sum + (trackedSet.has(code) ? 0 : Number(values[index] || 0)), 0)
    );

    if (outrosData.some((value) => value > 0)) {
        datasets.push({
            label: "Outros",
            data: outrosData,
            borderColor: "#2a3042",
            backgroundColor: "rgba(42, 48, 66, 0.3)",
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25,
            fill: true,
            stack: "stages-area",
        });
    }

    if (datasets.length === 0) {
        datasets.push({
            label: "Sem codigo",
            data: model.labels.map(() => 0),
            borderColor: COLORS[0],
            backgroundColor: withAlpha(COLORS[0], 0.35),
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25,
            fill: true,
            stack: "stages-area",
        });
    }

    createChart("chart-stage-evolution-area", {
        type: "line",
        data: {
            labels: model.labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: { color: "#495057" },
                    ...legendHoverCursor,
                },
                tooltip: {
                    callbacks: {
                        title: (ctx) => ctx[0].label,
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                        footer: (items) => `Total: ${formatNumber(items.reduce((sum, item) => sum + Number(item.raw || 0), 0))}`,
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: "#888", font: { size: 11 } },
                    grid: { color: "rgba(128,128,128,0.1)" },
                },
                y: {
                    beginAtZero: true,
                    stacked: true,
                    ticks: { color: "#888", font: { size: 11 } },
                    grid: { color: "rgba(128,128,128,0.1)" },
                    title: {
                        display: true,
                        text: "Quantidade de processos",
                    },
                },
            },
        },
    });
}

function getHeatmapColor(value, maxValue) {
    const safeMax = Math.max(Number(maxValue || 0), 1);
    const safeValue = Math.max(Number(value || 0), 0);

    if (safeValue === 0) {
        return "rgba(232, 238, 247, 0.75)";
    }

    const ratio = Math.min(1, safeValue / safeMax);
    const normalizedRatio = Math.pow(ratio, 0.7);
    const start = { r: 198, g: 219, b: 239 };
    const end = { r: 8, g: 48, b: 107 };
    const red = Math.round(start.r + (end.r - start.r) * normalizedRatio);
    const green = Math.round(start.g + (end.g - start.g) * normalizedRatio);
    const blue = Math.round(start.b + (end.b - start.b) * normalizedRatio);
    return `rgba(${red}, ${green}, ${blue}, 0.95)`;
}

function buildStageEvolutionHeatmapChart(model) {
    const stageLabelByCode = {
        CADASTRAMENTO: "Processo em Cadastramento",
        AG_ASS_TECNICA: "Aguardando Assinatura da Área Técnica",
        AG_AUT_ORGAO: "Aguardando Autorização da Autoridade do Órgão",
        AG_CORRECAO: "Ajustes Solicitados",
        CORRECAO_RELIZADA: "Ajustes Realizados",
        AUTORIZADO: "Processo Autorizado",
        AG_DISTRIBUICAO: "Aguardando Distribuição",
        ANALISE: "Processo em Análise",
        SUSPENSO: "Processo Suspenso",
        RETOMADO: "Processo Retomado",
        AUTORIZADO_PUBLICACAO: "Processo autorizado para Publicação do Edital",
        ANALISE_SEI: "Processo em Análise SEI",
        DISPUTA: "Processo em Fase de Disputa",
        TRAMITE_FINAL: "Processo em Trâmites Finais",
        FINALIZADO: "Processo Finalizado",
        COTA_REPROVADA: "Cota Reprovada",
        REPROVADO: "Processo Reprovado",
        DOCUMENTO_COTA_EM_CONTRUCAO: "Documento de Cotas em Construção",
        ANALISE_COTAS: "Enviado para Análise de Cotas",
    };

    const preferredStageCodeOrder = [
        "FINALIZADO",
        "TRAMITE_FINAL",
        "DISPUTA",
        "REPROVADO",
        "AUTORIZADO_PUBLICACAO",
        "AUTORIZADO",
        "RETOMADO",
        "SUSPENSO",
        "ANALISE_SEI",
        "CORRECAO_RELIZADA",
        "AG_CORRECAO",
        "COTA_REPROVADA",
        "ANALISE_COTAS",
        "DOCUMENTO_COTA_EM_CONTRUCAO",
        "ANALISE",
        "AG_DISTRIBUICAO",
        "AG_AUT_ORGAO",
        "AG_ASS_TECNICA",
        "CADASTRAMENTO",
    ];

    const availableCodes = (model.orderedCodesById.length > 0 ? model.orderedCodesById : ["Sem codigo"]).map((code) => String(code || "Sem codigo").trim());
    const availableSet = new Set(availableCodes);
    const orderedPreferredCodes = preferredStageCodeOrder.filter((code) => availableSet.has(code));
    const remainingCodes = availableCodes.filter((code) => !preferredStageCodeOrder.includes(code)).sort(compareStageCodeById);
    const yCodes = [...orderedPreferredCodes, ...remainingCodes];
    const yLabels = yCodes.map((code) => stageLabelByCode[code] || model.codeLabelMap[code] || `Etapa ${code}`);
    const heatmapData = [];

    const heatmapCanvas = document.getElementById("chart-stage-evolution-heatmap");
    const heatmapChartBox = heatmapCanvas?.closest(".chart-box");
    if (heatmapChartBox) {
        const dynamicHeight = Math.max(460, yLabels.length * 42);
        heatmapChartBox.style.height = `${dynamicHeight}px`;
    }

    yCodes.forEach((code, rowIndex) => {
        model.labels.forEach((label, columnIndex) => {
            const value = Number(model.byCodeSeries[code]?.[columnIndex] || 0);
            heatmapData.push({
                x: label,
                y: yLabels[rowIndex],
                value,
                stageCode: code,
            });
        });
    });

    const maxValue = heatmapData.reduce((max, item) => Math.max(max, item.value), 0);

    createChart("chart-stage-evolution-heatmap", {
        type: "bubble",
        data: {
            datasets: [
                {
                    label: "Intensidade de processos",
                    data: heatmapData.map((item) => ({ x: item.x, y: item.y, r: 10, value: item.value, stageCode: item.stageCode })),
                    backgroundColor: (ctx) => getHeatmapColor(ctx.raw?.value, maxValue),
                    borderColor: "rgba(255, 255, 255, 0.7)",
                    borderWidth: 1,
                    hoverBorderColor: "#1f2a44",
                    hoverBorderWidth: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 8,
                    right: 8,
                    bottom: 14,
                    left: 10,
                },
            },
            plugins: {
                legend: {
                    display: false,
                    ...legendHoverCursor,
                },
                tooltip: {
                    callbacks: {
                        title: (ctx) => String(ctx?.[0]?.raw?.x || "Sem periodo"),
                        label: (ctx) => {
                            const stageCode = String(ctx.raw?.stageCode || "Sem codigo");
                            const stageLabel = stageLabelByCode[stageCode] || model.codeLabelMap[stageCode] || "Nao Informado";
                            return ` ${stageCode} - ${stageLabel}: ${formatNumber(ctx.raw?.value || 0)} processos`;
                        },
                    },
                },
            },
            elements: {
                point: {
                    pointStyle: "rectRounded",
                    radius: (ctx) => {
                        const chartArea = ctx.chart.chartArea;
                        if (!chartArea) {
                            return 8;
                        }

                        const width = chartArea.right - chartArea.left;
                        const height = chartArea.bottom - chartArea.top;
                        const cellWidth = width / Math.max(model.labels.length, 1);
                        const cellHeight = height / Math.max(yCodes.length, 1);
                        return Math.max(4, Math.min(cellWidth, cellHeight) / 2 - 2);
                    },
                },
            },
            scales: {
                x: {
                    type: "category",
                    labels: model.labels,
                    title: {
                        display: true,
                        text: "Eixo X - Periodo",
                        color: "#495057",
                    },
                    ticks: {
                        color: "#6c757d",
                        autoSkip: false,
                        minRotation: 90,
                        maxRotation: 90,
                        padding: 8,
                        font: { size: 10 },
                    },
                    grid: { color: "rgba(116, 120, 141, 0.1)" },
                },
                y: {
                    type: "category",
                    labels: yLabels,
                    reverse: true,
                    title: {
                        display: true,
                        text: "Eixo Y - Fases",
                        color: "#495057",
                    },
                    ticks: {
                        color: "#495057",
                        autoSkip: false,
                        padding: 10,
                        font: { size: 11 },
                    },
                    grid: { color: "rgba(116, 120, 141, 0.1)" },
                },
            },
        },
    });
}

function interpolateMonochromeColor(ratio) {
    const clamped = Math.min(1, Math.max(0, Number(ratio || 0)));
    const start = { r: 214, g: 228, b: 247 };
    const end = { r: 8, g: 48, b: 107 };
    const red = Math.round(start.r + (end.r - start.r) * clamped);
    const green = Math.round(start.g + (end.g - start.g) * clamped);
    const blue = Math.round(start.b + (end.b - start.b) * clamped);
    return `rgb(${red}, ${green}, ${blue})`;
}

function buildMonochromePalette(size) {
    const safeSize = Math.max(1, Number(size || 0));
    return Array.from({ length: safeSize }, (_, index) => {
        const ratio = safeSize === 1 ? 0.8 : index / (safeSize - 1);
        return interpolateMonochromeColor(ratio);
    });
}

function getMonochromeColorByValue(value, minValue, maxValue) {
    if (maxValue === minValue) {
        return interpolateMonochromeColor(0.55);
    }

    const normalized = (Number(value || 0) - minValue) / (maxValue - minValue);
    const ratio = 0.08 + normalized * 0.92;
    return interpolateMonochromeColor(ratio);
}

function parseRgbColor(colorValue) {
    const matched = String(colorValue || "").match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    if (!matched) {
        return null;
    }

    return {
        r: Number(matched[1] || 0),
        g: Number(matched[2] || 0),
        b: Number(matched[3] || 0),
    };
}

function getReadableTextColor(backgroundColor) {
    const rgb = parseRgbColor(backgroundColor);
    if (!rgb) {
        return "#1f2937";
    }

    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.55 ? "#1f2937" : "#ffffff";
}

const drawDoughnutSliceValuePlugin = {
    id: "draw-doughnut-slice-values",
    afterDatasetsDraw: (chart) => {
        const dataset = chart.data?.datasets?.[0];
        if (!dataset || !Array.isArray(dataset.data)) {
            return;
        }

        const meta = chart.getDatasetMeta(0);
        if (!meta || !Array.isArray(meta.data)) {
            return;
        }

        const backgroundColor = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor : [];
        const { ctx } = chart;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "600 11px sans-serif";

        meta.data.forEach((arc, index) => {
            const value = Number(dataset.data[index] || 0);
            if (value <= 0) {
                return;
            }

            const arcProps = arc.getProps(["x", "y", "startAngle", "endAngle", "innerRadius", "outerRadius"], true);
            const angle = (arcProps.startAngle + arcProps.endAngle) / 2;
            const radius = arcProps.innerRadius + (arcProps.outerRadius - arcProps.innerRadius) * 0.62;
            const x = arcProps.x + Math.cos(angle) * radius;
            const y = arcProps.y + Math.sin(angle) * radius;

            ctx.fillStyle = getReadableTextColor(backgroundColor[index]);
            ctx.fillText(formatNumber(value), x, y);
        });

        ctx.restore();
    },
};

function buildCreatedLast30DaysSeries(rows) {
    const createdDates = (Array.isArray(rows) ? rows : [])
        .map((row) => parseDateTime(row?.created_at))
        .filter((date) => date instanceof Date);

    if (createdDates.length === 0) {
        return {
            labels: ["Sem dados"],
            totals: [0],
        };
    }

    const maxCreatedAt = createdDates.reduce((maxDate, currentDate) => (currentDate > maxDate ? currentDate : maxDate), createdDates[0]);
    const endDate = new Date(maxCreatedAt.getFullYear(), maxCreatedAt.getMonth(), maxCreatedAt.getDate(), 23, 59, 59, 999);
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - 29);

    const dayMap = new Map();
    const cursorDate = new Date(startDate.getTime());
    while (cursorDate <= endDate) {
        const dateKey = `${cursorDate.getFullYear()}-${String(cursorDate.getMonth() + 1).padStart(2, "0")}-${String(cursorDate.getDate()).padStart(2, "0")}`;
        const dateLabel = `${String(cursorDate.getDate()).padStart(2, "0")}/${String(cursorDate.getMonth() + 1).padStart(2, "0")}`;
        dayMap.set(dateKey, {
            label: dateLabel,
            total: 0,
        });
        cursorDate.setDate(cursorDate.getDate() + 1);
    }

    rows.forEach((row) => {
        const createdAt = parseDateTime(row?.created_at);
        if (!createdAt) {
            return;
        }

        if (createdAt < startDate || createdAt > endDate) {
            return;
        }

        const dateKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}-${String(createdAt.getDate()).padStart(2, "0")}`;
        const current = dayMap.get(dateKey);
        if (!current) {
            return;
        }

        dayMap.set(dateKey, {
            ...current,
            total: current.total + 1,
        });
    });

    const buckets = [...dayMap.values()];
    return {
        labels: buckets.map((bucket) => bucket.label),
        totals: buckets.map((bucket) => bucket.total),
    };
}

function buildStageEvolutionTotalGradientChart(filteredRows) {
    const createdSeries = buildCreatedLast30DaysSeries(filteredRows);

    createChart("chart-stage-evolution-total-gradient", {
        type: "line",
        data: {
            labels: createdSeries.labels,
            datasets: [
                {
                    label: "Processos criados (últimos 30 dias)",
                    data: createdSeries.totals,
                    borderColor: "#08306b",
                    borderWidth: 2,
                    tension: 0.25,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    fill: true,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const chartArea = chart.chartArea;
                        if (!chartArea) {
                            return "rgba(8, 48, 107, 0.2)";
                        }

                        const gradient = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, "rgba(8, 48, 107, 0.50)");
                        gradient.addColorStop(0.6, "rgba(8, 48, 107, 0.18)");
                        gradient.addColorStop(1, "rgba(8, 48, 107, 0.04)");
                        return gradient;
                    },
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "top",
                    labels: { color: "#495057" },
                    ...legendHoverCursor,
                },
                tooltip: {
                    callbacks: {
                        title: (ctx) => `Data: ${ctx?.[0]?.label || "-"}`,
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: "#6c757d" },
                    grid: { color: "rgba(116, 120, 141, 0.1)" },
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: "#6c757d",
                        callback: (value) => formatNumber(value),
                    },
                    grid: { color: "rgba(116, 120, 141, 0.15)" },
                    title: {
                        display: true,
                        text: "Quantidade de processos criados",
                    },
                },
            },
        },
    });
}

function buildStageEvolutionDoughnutMonochromeChart(filteredRows) {
    const groupedByStage = (Array.isArray(filteredRows) ? filteredRows : []).reduce((accumulator, row) => {
        const stage = String(row?.stage || "Nao Informado");
        accumulator[stage] = (accumulator[stage] || 0) + 1;
        return accumulator;
    }, {});

    const orderedStageRows = Object.entries(groupedByStage)
        .map(([stage, total]) => ({ stage, total: Number(total || 0) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    const labels = orderedStageRows.map((item) => item.stage);
    const data = orderedStageRows.map((item) => item.total);

    if (labels.length === 0) {
        labels.push("Nao Informado");
        data.push(0);
    }

    const totalGeral = data.reduce((sum, value) => sum + Number(value || 0), 0);
    const maxTotal = data.reduce((max, value) => Math.max(max, Number(value || 0)), 0);
    const minTotal = data.reduce((min, value) => Math.min(min, Number(value || 0)), maxTotal);
    const palette = data.map((value) => getMonochromeColorByValue(value, minTotal, maxTotal));

    createChart("chart-stage-evolution-doughnut-mono", {
        type: "doughnut",
        plugins: [drawDoughnutSliceValuePlugin],
        data: {
            labels,
            datasets: [
                {
                    label: "Total por Fase",
                    data,
                    backgroundColor: palette,
                    borderColor: "#ffffff",
                    borderWidth: 1,
                    hoverOffset: 6,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "right",
                    labels: { color: "#495057", boxWidth: 12 },
                    ...legendHoverCursor,
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const value = Number(ctx.raw || 0);
                            const percent = totalGeral > 0 ? (value / totalGeral) * 100 : 0;
                            return ` ${formatNumber(value)} processos (${percent.toFixed(1).replace(".", ",")}%)`;
                        },
                    },
                },
            },
            cutout: "52%",
        },
    });
}

function buildStageEvolutionBarMonochromeChart() {
    const normalizedRows = normalizeEvolutionRows(dashboardState.macro.evolutionRows);
    const filteredRows = applyEvolutionFilters(normalizedRows, macroFilters);
    const referenceDates = filteredRows
        .flatMap((row) => [row.stageStart, row.stageEnd, row.processUpdatedAt])
        .filter((value) => value instanceof Date && !Number.isNaN(value.getTime()));

    if (referenceDates.length === 0) {
        createChart("chart-stage-evolution-bar-mono", {
            type: "line",
            data: {
                labels: ["Sem dados"],
                datasets: [
                    {
                        label: "Sem fase",
                        data: [0],
                        borderColor: COLORS[0],
                        backgroundColor: COLORS[0],
                        borderWidth: 1,
                        fill: true,
                        pointRadius: 0,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false,
                        ...legendHoverCursor,
                    },
                },
            },
        });
        return;
    }

    const endDate = new Date(Math.max(...referenceDates.map((date) => date.getTime())));
    endDate.setUTCHours(23, 59, 59, 999);

    const startDate = new Date(endDate.getTime());
    startDate.setUTCDate(startDate.getUTCDate() - 29);
    startDate.setUTCHours(0, 0, 0, 0);

    const labels = [];
    const dayEnds = [];
    const cursor = new Date(startDate.getTime());
    while (cursor <= endDate) {
        labels.push(
            cursor.toLocaleDateString("pt-BR", {
                timeZone: "UTC",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
            })
        );

        const endOfDay = new Date(cursor.getTime());
        endOfDay.setUTCHours(23, 59, 59, 999);
        dayEnds.push(endOfDay);

        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const filteredWindowRows = filteredRows.filter((row) => {
        const stageStart = row.stageStart;
        const stageEnd = row.stageEnd;
        if (!(stageStart instanceof Date) || Number.isNaN(stageStart.getTime())) {
            return false;
        }

        if (stageStart > endDate) {
            return false;
        }

        if (stageEnd instanceof Date && !Number.isNaN(stageEnd.getTime()) && stageEnd < startDate) {
            return false;
        }

        return true;
    });

    const preferredStageCodeOrder = [
        "CADASTRAMENTO",
        "AG_ASS_TECNICA",
        "AG_AUT_ORGAO",
        "AG_DISTRIBUICAO",
        "ANALISE",
        "DOCUMENTO_COTA_EM_CONTRUCAO",
        "ANALISE_COTAS",
        "COTA_REPROVADA",
        "AG_CORRECAO",
        "CORRECAO_RELIZADA",
        "ANALISE_SEI",
        "SUSPENSO",
        "RETOMADO",
        "AUTORIZADO",
        "AUTORIZADO_PUBLICACAO",
        "REPROVADO",
        "DISPUTA",
        "TRAMITE_FINAL",
        "FINALIZADO",
    ];

    const rawCodesInWindow = [...new Set(filteredWindowRows.map((row) => String(row.code || "Sem codigo").trim()))];
    const availableSet = new Set(rawCodesInWindow);
    const orderedPreferredCodes = preferredStageCodeOrder.filter((code) => availableSet.has(code));
    const remainingCodes = rawCodesInWindow.filter((code) => !preferredStageCodeOrder.includes(code)).sort(compareStageCodeById);
    const codesInWindow = [...orderedPreferredCodes, ...remainingCodes];

    const byCodeSeries = codesInWindow.reduce((accumulator, code) => {
        accumulator[code] = dayEnds.map((dayEnd) =>
            filteredWindowRows.reduce((sum, row) => {
                const rowCode = row.code || "Sem codigo";
                if (rowCode !== code) {
                    return sum;
                }

                const stageStart = row.stageStart;
                const stageEnd = row.stageEnd;
                const isActiveAtDayEnd =
                    stageStart instanceof Date &&
                    !Number.isNaN(stageStart.getTime()) &&
                    stageStart <= dayEnd &&
                    (!(stageEnd instanceof Date) || Number.isNaN(stageEnd.getTime()) || stageEnd > dayEnd);

                return sum + (isActiveAtDayEnd ? 1 : 0);
            }, 0)
        );
        return accumulator;
    }, {});

    const codeLabelMap = filteredRows.reduce((accumulator, row) => {
        if (!accumulator[row.code]) {
            accumulator[row.code] = row.stage;
        }
        return accumulator;
    }, {});

    const orderedCodes = codesInWindow;

    const datasets = (orderedCodes.length > 0 ? orderedCodes : ["Sem codigo"]).map((code) => {
        const series = byCodeSeries[code] || labels.map(() => 0);
        const color = getCodePaletteColor(code);
        return {
            label: codeLabelMap[code] || code,
            data: series.map((value) => Number(value || 0)),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 1,
            tension: 0.2,
            pointRadius: 0,
            pointHoverRadius: 3,
            fill: true,
            stack: "stages-snapshot",
        };
    });

    createChart("chart-stage-evolution-bar-mono", {
        type: "line",
        data: {
            labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: {
                        color: "#495057",
                        boxWidth: 12,
                    },
                    ...legendHoverCursor,
                },
                tooltip: {
                    callbacks: {
                        title: (ctx) => `Data: ${ctx?.[0]?.label || "-"}`,
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: "#6c757d" },
                    grid: { color: "rgba(116, 120, 141, 0.1)" },
                },
                y: {
                    beginAtZero: true,
                    stacked: true,
                    ticks: {
                        color: "#6c757d",
                        callback: (value) => formatNumber(value),
                    },
                    grid: { color: "rgba(116, 120, 141, 0.15)" },
                    title: {
                        display: true,
                        text: "Total de processos no dia",
                    },
                },
            },
        },
    });
}

function updateStageEvolutionMetrics({ totalsByBucket, byCodeSeries, orderedCodes, codeLabelMap, labels, focusIndex }) {
    const metricsElement = document.getElementById("metrics");
    if (!metricsElement) {
        return;
    }

    metricsElement.innerHTML = "";

    const firstIndex = 0;
    const lastIndex = totalsByBucket.length - 1;
    const hasValidFocusIndex = Number.isInteger(focusIndex) && focusIndex >= 0 && focusIndex <= lastIndex;
    const selectedIndex = hasValidFocusIndex ? focusIndex : lastIndex;
    const selectedLabel = labels?.[selectedIndex] || "periodo atual";
    const metricRows = [{ label: `Total em ${selectedLabel}`, val: totalsByBucket[selectedIndex] || 0 }];

    orderedCodes.slice(0, 3).forEach((code) => {
        const series = byCodeSeries[code] || [];
        const currentValue = series[selectedIndex] || 0;
        const initialValue = series[firstIndex] || 0;
        metricRows.push({
            label: codeLabelMap[code] || code,
            val: currentValue,
            delta: currentValue - initialValue,
        });
    });

    metricRows.forEach((metric) => {
        const delta = metric.delta;
        const deltaHtml =
            delta !== undefined
                ? `<div class="met-delta ${delta >= 0 ? "up" : "dn"}">${delta > 0 ? "+" : ""}${delta} vs inicio da janela</div>`
                : "";
        metricsElement.innerHTML += `<div class="met"><div class="met-label">${metric.label}</div><div class="met-val">${formatNumber(metric.val)}</div>${deltaHtml}</div>`;
    });
}

function buildStageEvolutionChart() {
    const model = buildStageEvolutionModel();
    const trackedCodes = model.orderedCodesByVolume.slice(0, 8);
    const trackedSet = new Set(trackedCodes);
    const bucketCount = model.labels.length;
    const barThickness = bucketCount > 24 ? 12 : 18;
    const maxBarThickness = bucketCount > 24 ? 18 : 28;
    let hoveredBucketIndex = null;

    const renderStageEvolutionMetrics = (focusIndex) => {
        updateStageEvolutionMetrics({
            totalsByBucket: model.totalsByBucket,
            byCodeSeries: model.byCodeSeries,
            orderedCodes: model.orderedCodesByVolume,
            codeLabelMap: model.codeLabelMap,
            labels: model.labels,
            focusIndex,
        });
    };

    const stageEvolutionChartBox = document.getElementById("stage-evolution-chart-box");
    if (stageEvolutionChartBox) {
        stageEvolutionChartBox.style.height = `${getStageEvolutionChartHeight(bucketCount)}px`;
    }

    const datasets = trackedCodes.map((code) => ({
        label: model.codeLabelMap[code] || code,
        data: model.byCodeSeries[code] || model.labels.map(() => 0),
        backgroundColor: getCodePaletteColor(code),
        stageCode: code,
        borderRadius: 4,
        borderSkipped: false,
        stack: "stages",
        barThickness,
        maxBarThickness,
    }));

    const outrosData = model.labels.map((_, index) =>
        Object.entries(model.byCodeSeries).reduce((sum, [code, values]) => sum + (trackedSet.has(code) ? 0 : Number(values[index] || 0)), 0)
    );

    if (outrosData.some((value) => value > 0)) {
        datasets.push({
            label: "Outros",
            data: outrosData,
            backgroundColor: "#000000",
            borderRadius: 4,
            borderSkipped: false,
            stack: "stages",
            barThickness,
            maxBarThickness,
        });
    }

    if (datasets.length === 0) {
        datasets.push({
            label: "Sem codigo",
            data: model.labels.map(() => 0),
            backgroundColor: COLORS[0],
            borderRadius: 4,
            borderSkipped: false,
            stack: "stages",
            barThickness,
            maxBarThickness,
        });
    }

    createChart("chart-stage-evolution", {
        type: "bar",
        data: {
            labels: model.labels,
            datasets,
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false, axis: "y" },
            onHover: (_event, activeElements) => {
                const activeIndex = activeElements?.[0]?.index;
                const nextHoverIndex = Number.isInteger(activeIndex) ? activeIndex : null;

                if (nextHoverIndex === hoveredBucketIndex) {
                    return;
                }

                hoveredBucketIndex = nextHoverIndex;
                renderStageEvolutionMetrics(nextHoverIndex);
            },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: { color: "#495057" },
                    ...legendHoverCursor,
                },
                tooltip: {
                    callbacks: {
                        title: (ctx) => ctx[0].label,
                        footer: (items) => `Total: ${formatNumber(items.reduce((sum, item) => sum + Number(item.raw || 0), 0))}`,
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: "#888", font: { size: 11 } },
                    grid: { color: "rgba(128,128,128,0.1)" },
                    title: {
                        display: true,
                        text: "Quantidade de processos",
                    },
                },
                y: {
                    stacked: true,
                    ticks: { color: "#888", font: { size: 11 } },
                    grid: { display: false },
                    title: {
                        display: true,
                        text: "Eixo temporal",
                    },
                },
            },
        },
    });

    renderStageEvolutionMetrics();

    buildStageEvolutionLineChart(model);
    buildStageEvolutionAreaChart(model);
    buildStageEvolutionHeatmapChart(model);
    buildStageEvolutionTotalGradientChart(dashboardState.macro.filteredRows);
    buildStageEvolutionDoughnutMonochromeChart(dashboardState.macro.filteredRows);
    buildStageEvolutionBarMonochromeChart();
}

export function setMacroMetricValues(filteredRows) {
    const totalProcessos = formatNumber(filteredRows.length);
    setMetricTextMany(["m-consolidado-total", "m-macro-total", "m-total"], totalProcessos);
    setMetricToneMany(["m-consolidado-total", "m-macro-total", "m-total"], "neutral");

    const orgaoCounts = aggregateCountBy(filteredRows, (row) => String(row.orgao || "Nao Informado"));
    const orderedOrgaos = Object.entries(orgaoCounts).sort((a, b) => b[1] - a[1]);
    const topOrgao = orderedOrgaos[0];
    const minorOrgao =
        orderedOrgaos.length > 0
            ? [...orderedOrgaos].sort((a, b) => {
                if (a[1] !== b[1]) {
                    return a[1] - b[1];
                }
                return String(a[0]).localeCompare(String(b[0]), "pt-BR");
            })[0]
            : null;
    setMetricTextMany(
        ["m-consolidado-top-orgao", "m-top"],
        topOrgao ? `${topOrgao[0]} (${formatNumber(topOrgao[1])})` : "Nao identificado"
    );
    setMetricToneMany(["m-consolidado-top-orgao", "m-top"], "neutral");
    setMetricTextMany(
        ["m-consolidado-minor-orgao"],
        minorOrgao ? `${minorOrgao[0]} (${formatNumber(minorOrgao[1])})` : "Nao identificado"
    );
    setMetricToneMany(["m-consolidado-minor-orgao"], "neutral");

    const gerenciaCounts = aggregateCountBy(filteredRows, (row) => String(row.gerencia_nome || "Sem gerência"));
    const orderedGerencias = Object.entries(gerenciaCounts).sort((a, b) => b[1] - a[1]);
    const topGerencia = orderedGerencias[0];
    setMetricTextMany(
        ["m-consolidado-top-gerencia"],
        topGerencia ? `${topGerencia[0]} (${formatNumber(topGerencia[1])})` : "Nao identificado"
    );
    setMetricToneMany(["m-consolidado-top-gerencia"], "neutral");


    const stageCounts = aggregateCountBy(filteredRows, (row) => String(row.stage || "Nao Informado"));
    const orderedStages = Object.entries(stageCounts).sort((a, b) => b[1] - a[1]);
    const topStage = orderedStages[0];
    setMetricTextMany(
        ["m-consolidado-top-stage", "m-top-stage"],
        topStage ? `${topStage[0]} (${formatNumber(topStage[1])})` : "Nao identificado"
    );
    setMetricToneMany(["m-consolidado-top-stage", "m-top-stage"], "neutral");

    const finalizados = filteredRows.filter((row) => String(row.stage || "").toLowerCase().includes("finaliz")).length;
    setMetricTextMany(["m-consolidado-finalizados", "m-finalizados"], formatNumber(finalizados));
    const finalizadosRate = filteredRows.length > 0 ? finalizados / filteredRows.length : 0;
    setMetricToneMany(["m-consolidado-finalizados", "m-finalizados"], classifyHigherIsBetter(finalizadosRate, "finalizados_rate"));

    const averageAgeValues = filteredRows.map((row) => Number(row._age_days)).filter((value) => Number.isFinite(value));
    const averageAge = averageAgeValues.length > 0 ? averageAgeValues.reduce((acc, value) => acc + value, 0) / averageAgeValues.length : 0;
    setMetricTextMany(["m-consolidado-tempo-medio", "m-tempo-medio"], formatDays(averageAge));
    setMetricToneMany(["m-consolidado-tempo-medio", "m-tempo-medio"], classifyLowerIsBetter(averageAge, "tempo_medio_dias"));

    const modCounts = aggregateCountBy(filteredRows, (row) => String(row.modality || "Nao Informado"));
    const orderedModalities = Object.entries(modCounts).sort((a, b) => b[1] - a[1]);
    const topModality = orderedModalities[0];

    setMetricTextMany(
        ["m-consolidado-top-modality", "m-macro-modality"],
        topModality ? `${topModality[0]} (${formatNumber(topModality[1])})` : "Nao identificado"
    );
    setMetricToneMany(["m-consolidado-top-modality", "m-macro-modality"], "neutral");

    const pregaoCount = filteredRows.filter((row) => String(row.modality || "").toLowerCase().includes("pregao")).length;
    setMetricTextMany(["m-operacional-pregao", "m-macro-pregao"], formatNumber(pregaoCount));
    setMetricToneMany(["m-operacional-pregao", "m-macro-pregao"], "neutral");

    const priorityCount = filteredRows.filter((row) => row._priority === 1).length;
    setMetricTextMany(
        ["m-operacional-priority-rate", "m-macro-priority-rate"],
        filteredRows.length > 0 ? formatPercent(priorityCount / filteredRows.length) : "0,0%"
    );
    const priorityRate = filteredRows.length > 0 ? priorityCount / filteredRows.length : 0;
    setMetricToneMany(["m-operacional-priority-rate", "m-macro-priority-rate"], classifyLowerIsBetter(priorityRate, "priority_rate"));

    const overdueCount = filteredRows.filter((row) => row._sla_risk === "Atrasado").length;
    setMetricTextMany(
        ["m-operacional-overdue-rate", "m-macro-overdue-rate"],
        filteredRows.length > 0 ? formatPercent(overdueCount / filteredRows.length) : "0,0%"
    );
    const overdueRate = filteredRows.length > 0 ? overdueCount / filteredRows.length : 0;
    setMetricToneMany(["m-operacional-overdue-rate", "m-macro-overdue-rate"], classifyLowerIsBetter(overdueRate, "overdue_rate"));

    const overdueByOrgao = filteredRows.reduce((accumulator, row) => {
        if (row._sla_risk !== "Atrasado") {
            return accumulator;
        }

        const orgao = String(row.orgao || "Nao Informado");
        accumulator[orgao] = (accumulator[orgao] || 0) + 1;
        return accumulator;
    }, {});

    const criticalOrgao = Object.entries(overdueByOrgao).sort((a, b) => b[1] - a[1])[0];
    setMetricTextMany(
        ["m-operacional-critical-orgao", "m-macro-critical-orgao"],
        criticalOrgao ? `${criticalOrgao[0]} (${formatNumber(criticalOrgao[1])})` : "Sem atrasos"
    );
    setMetricToneMany(["m-operacional-critical-orgao", "m-macro-critical-orgao"], criticalOrgao ? "critical" : "good");
}

export function buildMacroCharts(filteredRows) {
    dashboardState.macro.filteredRows = filteredRows;
    setMacroMetricValues(filteredRows);
    buildCriticalDelayChart(filteredRows);

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

    const modJudLabels = orderedModJudRows.map((item) => (item.group.length > 100 ? `${item.group.slice(0, 97)}...` : item.group));

    createChart("chart-macro-mod-jud-risk", {
        type: "bar",
        data: {
            labels: modJudLabels.length > 0 ? modJudLabels : ["Sem dados"],
            datasets: [
                { label: "No prazo", data: modJudLabels.length > 0 ? orderedModJudRows.map((item) => item.noPrazo) : [0], backgroundColor: "#34c38f", borderRadius: 4 },
                { label: "Alerta", data: modJudLabels.length > 0 ? orderedModJudRows.map((item) => item.alerta) : [0], backgroundColor: "#f1b44c", borderRadius: 4 },
                { label: "Atrasado", data: modJudLabels.length > 0 ? orderedModJudRows.map((item) => item.atrasado) : [0], backgroundColor: "#f46a6a", borderRadius: 4 },
                { label: "Sem referencia", data: modJudLabels.length > 0 ? orderedModJudRows.map((item) => item.semReferencia) : [0], backgroundColor: "#74788d", borderRadius: 4 },
            ],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top", ...legendHoverCursor },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: { stacked: true, ticks: { color: "#6c757d" }, grid: { color: "rgba(116, 120, 141, 0.15)" } },
                y: { stacked: true, ticks: { color: "#495057" }, grid: { display: false } },
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

    createChart("chart-macro-priority-stage", {
        type: "bar",
        data: {
            labels: orderedStages.length > 0 ? orderedStages.map(([label]) => label) : ["Sem dados"],
            datasets: [
                { label: "Nao prioritario", data: orderedStages.length > 0 ? orderedStages.map(([, values]) => values.nonPriority) : [0], backgroundColor: "#4b7bec", borderRadius: 4 },
                { label: "Prioritario", data: orderedStages.length > 0 ? orderedStages.map(([, values]) => values.priority) : [0], backgroundColor: "#f46a6a", borderRadius: 4 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: { position: "top", ...legendHoverCursor },

                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: { stacked: true, ticks: { color: "#6c757d", maxRotation: 25 }, grid: { display: false } },
                y: { stacked: true, ticks: { color: "#6c757d" }, grid: { color: "rgba(116, 120, 141, 0.15)" } },
            },
        },
    });

    const riskByOrgao = filteredRows.reduce((accumulator, row) => {
        const orgao = String(row.orgao || "Nao Informado");
        const current = accumulator[orgao] || { noPrazo: 0, alerta: 0, atrasado: 0 };
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
        .map(([orgao, values]) => ({ orgao, ...values, total: values.noPrazo + values.alerta + values.atrasado }))
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

    createChart("chart-macro-sla-risk", {
        type: "bar",
        data: {
            labels: orderedRiskRows.length > 0 ? orderedRiskRows.map((item) => item.orgao) : ["Sem dados"],
            datasets: [
                { label: "No prazo", data: orderedRiskRows.length > 0 ? orderedRiskRows.map((item) => item.noPrazo) : [0], backgroundColor: "#34c38f", borderRadius: 4 },
                { label: "Alerta", data: orderedRiskRows.length > 0 ? orderedRiskRows.map((item) => item.alerta) : [0], backgroundColor: "#f1b44c", borderRadius: 4 },
                { label: "Atrasado", data: orderedRiskRows.length > 0 ? orderedRiskRows.map((item) => item.atrasado) : [0], backgroundColor: "#f46a6a", borderRadius: 4 },
            ],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top", ...legendHoverCursor },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} processos`,
                    },
                },
            },
            scales: {
                x: { stacked: true, ticks: { color: "#6c757d" }, grid: { color: "rgba(116, 120, 141, 0.15)" } },
                y: { stacked: true, ticks: { color: "#495057" }, grid: { display: false } },
            },
        },
    });

    buildStageEvolutionChart();
}

export function refreshMacroSection() {
    const filtered = filterMacroRows(dashboardState.macro.allRows);
    buildMacroCharts(filtered);
}
